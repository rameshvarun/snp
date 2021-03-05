import {
  ConnectionAccept,
  SNPMessage,
  NoConnection,
  ConnectionRequest,
  SendUnreliable,
  SendReliable,
  Acknowledgement,
  ConnectionClose,
  KeepAlive,
} from "./protocol";

import * as log from "loglevel";
import { EventEmitter } from "eventemitter3";
import {
  CONNECTION_TIMEOUT,
  KEEP_ALIVE_INTERVAL,
  RETRANSMIT_INTERVAL,
} from "./constants";

interface IConnection {
  on(event: "message", cb: (msg: Uint8Array) => void): void;
}

export class SNPConnection extends EventEmitter {
  connectionID: number;
  remoteAddress: string;
  remotePort: number;

  sendMessage: (msg: SNPMessage) => void;
  removeConnection: (conn: SNPConnection) => void;

  /** Packets we have sent that haven't been acked yet. */
  unackedPackets: Array<{
    sequenceNumber: number;
    lastSent: number;
    tries: number;
    msg: SNPMessage;
  }> = [];
  /** Our current reliable sequence number. */
  reliableSequenceNumber: number = 0;
  /** Our current unreliable sequnce number */
  unreliableSequenceNumber: number = 0;

  /** The last reliable sequence number we saw from the client. */
  lastReliableSequenceNumberSeen: number = 0;
  /** The last unreliable sequence number we saw from the client. */
  lastUnreliableSequenceNumberSeen: number = 0;

  lastPacketSentTimestamp: number = Date.now();
  lastPacketReceivedTimestamp: number = Date.now();

  constructor(
    connectionID: number,
    remoteAddress: string,
    remotePort: number,
    sendMessage: (msg: SNPMessage) => void,
    removeConnection: (conn: SNPConnection) => void
  ) {
    super();
    this.connectionID = connectionID;
    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
    this.sendMessage = (msg: SNPMessage) => {
      this.lastPacketSentTimestamp = Date.now();
      sendMessage(msg);
    };
    this.removeConnection = removeConnection;
  }

  onPacket(msg: SNPMessage) {
    this.lastPacketReceivedTimestamp = Date.now();

    if (msg.connectionRequest) {
      const connectionAccept = new ConnectionAccept();
      this.sendMessage(
        new SNPMessage({ connectionId: this.connectionID, connectionAccept })
      );
    } else if (msg.sendUnreliable) {
      // If we have already seen an unreliable sequence number higher than this one,
      // we cannot deliver this packet to application.
      if (
        msg.sendUnreliable.unreliableSequenceNumber! <
        this.lastUnreliableSequenceNumberSeen
      ) {
        log.debug(
          "Received an unreliable packet with an old sequence number. Discarding."
        );
        return;
      }

      // If this packet has a reliable sequence number different than the last one that
      // we've seen, we have to discard it. This is because the unreliable packet may
      // refer to state changes enacted by the reliable packets.
      if (
        msg.sendUnreliable.reliableSequenceNumber! !==
        this.lastReliableSequenceNumberSeen
      ) {
        log.debug(
          "Received an unreliable packet with an incorrect reliable sequence number. Discarding."
        );
        return;
      }

      // Update the last unreliable sequence number we've seen.
      this.lastUnreliableSequenceNumberSeen = msg.sendUnreliable.unreliableSequenceNumber!;

      // Deliver this packet to application.
      log.debug("Emitting unreliable message.")
      this.emit("message", msg.sendUnreliable.data);
    } else if (msg.sendReliable) {
      if (
        msg.sendReliable.reliableSequenceNumber! <=
        this.lastReliableSequenceNumberSeen
      ) {
        // If we have already received this packet before, send an ACK
        log.debug("Already seen this reliable packet. Discarding.");
        let acknowledgement = new Acknowledgement({
          lastSequenceNumberSeen: this.lastReliableSequenceNumberSeen,
        });
        this.sendMessage(
          new SNPMessage({ connectionId: this.connectionID, acknowledgement })
        );
      } else if (
        msg.sendReliable.reliableSequenceNumber! ===
        this.lastReliableSequenceNumberSeen + 1
      ) {
        // If this is the next packet in sequence, it can be delivered and an ACK can be sent.
        this.lastReliableSequenceNumberSeen++;

        let acknowledgement = new Acknowledgement({
          lastSequenceNumberSeen: this.lastReliableSequenceNumberSeen,
        });
        this.sendMessage(
          new SNPMessage({ connectionId: this.connectionID, acknowledgement })
        );

        log.debug("Emitting reliable message.")
        this.emit("message", msg.sendReliable.data);
      } else if (
        msg.sendReliable.reliableSequenceNumber! >
        this.lastReliableSequenceNumberSeen + 1
      ) {
        // A packet was dropped so we cannot deliver this current packet.
        // TODO: Buffer this packet for immediate delivery on retransmit of the dropped packet.
      }
    } else if (msg.acknowledgement) {
      // We can filter out any unacked packets that our receiver has seen.
      this.unackedPackets = this.unackedPackets.filter(
        (unacked) =>
          unacked.sequenceNumber > msg.acknowledgement!.lastSequenceNumberSeen!
      );
    } else if (msg.connectionClose) {
      // The other side has closed their connection voluntarily. Close our side.
      this.close();
    } else if (msg.noConnection) {
      // There is no remote connection on the other side. Close our side.
      this.close();
    }
  }

  send(data: Uint8Array, reliable: boolean = true) {
    if (reliable) {
      this.reliableSequenceNumber++;
      let sendReliable = new SendReliable({
        reliableSequenceNumber: this.reliableSequenceNumber,
        data: data,
      });
      let msg = new SNPMessage({
        connectionId: this.connectionID,
        sendReliable,
      });

      // Before sending out, store in our unacked packets list.
      this.unackedPackets.push({
        sequenceNumber: this.reliableSequenceNumber,
        lastSent: Date.now(),
        tries: 0,
        msg: msg,
      });
      this.sendMessage(msg);
    } else {
      // For an unreliable send, we simply increment our unreliable sequence
      // number and send on the wire.
      this.unreliableSequenceNumber++;
      let sendUnreliable = new SendUnreliable({
        reliableSequenceNumber: this.reliableSequenceNumber,
        unreliableSequenceNumber: this.unreliableSequenceNumber,
        data: data,
      });
      this.sendMessage(
        new SNPMessage({ connectionId: this.connectionID, sendUnreliable })
      );
    }
  }

  tick() {
    // Resend unacked packets that are ready to be retransmitted.
    for (let unacked of this.unackedPackets) {
      if (Date.now() - unacked.lastSent > RETRANSMIT_INTERVAL) {
        unacked.tries++;
        unacked.lastSent = Date.now();
        this.sendMessage(unacked.msg);
      }
    }

    // No packets have been received in the timeout duration. Disconnect.
    if (Date.now() - this.lastPacketReceivedTimestamp > CONNECTION_TIMEOUT) {
      this.close();
    }

    // Send keepalive packets.
    if (Date.now() - this.lastPacketSentTimestamp > KEEP_ALIVE_INTERVAL) {
      let keepAlive = new KeepAlive();
      this.sendMessage(
        new SNPMessage({ connectionId: this.connectionID, keepAlive })
      );
    }
  }

  close() {
    // Send a connection close message.
    let connectionClose = new ConnectionClose({});
    this.sendMessage(
      new SNPMessage({ connectionId: this.connectionID, connectionClose })
    );

    // Remove connection from container.
    this.removeConnection(this);

    // Emit closed event.
    this.emit("close");
  }
}
