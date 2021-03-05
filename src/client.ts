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
import { SNPConnection } from "./connection";
import { SNPBase } from "./base";
import {
  CONNECTION_ID_MAX,
  CONNECTION_ID_MIN,
  CONNECTION_OPEN_ATTEMPT_DURATION,
  RETRANSMIT_INTERVAL,
  TICK_INTERVAL,
} from "./constants";

export interface IClient {
  on(event: "connection", cb: (conn: SNPConnection) => void): void;
  on(event: "open", cb: () => void): void;
}

export abstract class SNPClient extends SNPBase implements IClient {
  /** A list of requests that have been send out that haven't been acked. */
  requests: Array<{
    connectionId: number;
    address: string;
    port: number;
    tries: number;
    lastRequestTimestamp: number;
    firstAttemptTimestamp: number;
  }> = [];

  tickInterval: NodeJS.Timeout;

  constructor() {
    super();
    this.tickInterval = setInterval(() => {
      this.tick();
    }, TICK_INTERVAL);
  }

  abstract sendPacket(address: string, port: number, data: Uint8Array): void;

  sendMessage(address: string, port: number, msg: SNPMessage) {
    log.debug("Client sent to (%s:%s): %o", address, port, msg);
    this.sendPacket(address, port, SNPMessage.encode(msg).finish());
  }

  generateConnectionID() {
    return (
      Math.floor(Math.random() * (CONNECTION_ID_MAX - CONNECTION_ID_MIN + 1)) +
      CONNECTION_ID_MIN
    );
  }

  connect(address: string, port: number) {
    const connectionId = this.generateConnectionID();
    this.requests.push({
      connectionId,
      address,
      port,
      tries: 1,
      lastRequestTimestamp: Date.now(),
      firstAttemptTimestamp: Date.now(),
    });
    let connectionRequest = new ConnectionRequest();
    this.sendMessage(
      address,
      port,
      new SNPMessage({ connectionId, connectionRequest })
    );
  }

  // Called when a remote packet is received.
  onPacket(address: string, port: number, data: Uint8Array) {
    const msg = SNPMessage.decode(data);
    log.debug("Client recieved from (%s:%s): %o", address, port, msg);

    const connectionID = msg.connectionId;
    const connection = this.findConnection(connectionID, address, port);

    if (!connection) {
      if (!msg.noConnection && !msg.connectionClose) {
        // If there is no current connection, and the packet we got matches
        // a pending request, we can open a connection.
        let request = this.requests.find(
          (r) => r.connectionId === connectionID
        );

        if (request) {
          // We found a matching request. Create a new connection and delete
          // the pending request.
          let connection = new SNPConnection(
            connectionID,
            address,
            port,
            (msg) => {
              this.sendMessage(address, port, msg);
            },
            (conn) => {
              this.removeConnection(conn);
            }
          );
          this.connections.push(connection);
          this.emit("connection", connection);

          this.requests = this.requests.filter(
            (req) => req.connectionId !== connectionID
          );
        } else {
          // Accept doesn't match a request. Send back a NoConnection error.
          let noConnection = new NoConnection();
          this.sendMessage(
            address,
            port,
            new SNPMessage({ connectionId: connectionID, noConnection })
          );
        }
      } else {
        // No connection and no request. Don't send anything.
      }
    } else {
      // If we found a connection, just forward that msg to the connection.
      connection.onPacket(msg);
    }
  }

  tick() {
    for (let conn of this.connections) conn.tick();

    // Retransmit requests that haven't been accepted yet.
    for (let request of this.requests) {
      if (Date.now() - request.lastRequestTimestamp > RETRANSMIT_INTERVAL) {
        if (
          Date.now() - request.firstAttemptTimestamp <
          CONNECTION_OPEN_ATTEMPT_DURATION
        ) {
          // Retry opening a connection if we haven't maxed out our attempts.
          request.tries++;
          request.lastRequestTimestamp = Date.now();

          let connectionRequest = new ConnectionRequest();
          this.sendMessage(
            request.address,
            request.port,
            new SNPMessage({
              connectionId: request.connectionId,
              connectionRequest,
            })
          );
        }
      }
    }

    // Remove requests that have maxed out their retries.
    this.requests = this.requests.filter(
      (req) =>
        Date.now() - req.firstAttemptTimestamp <
        CONNECTION_OPEN_ATTEMPT_DURATION
    );
  }

  close() {
    for (let conn of this.connections) conn.close();
    clearInterval(this.tickInterval);
  }
}
