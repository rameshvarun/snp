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
import { TICK_INTERVAL } from "./constants";

export interface IServer {
  on(event: "listening", cb: () => void): void;
  on(event: "connection", cb: (conn: SNPConnection) => void): void;
}

export abstract class SNPServer extends SNPBase implements IServer {
  tickInterval: NodeJS.Timeout;

  constructor() {
    super();
    this.tickInterval = setInterval(() => {
      this.tick();
    }, TICK_INTERVAL);
  }

  abstract sendPacket(address: string, port: number, data: Uint8Array): void;

  sendMessage(address: string, port: number, msg: SNPMessage) {
    log.debug("Server sent to (%s:%s): %o", address, port, msg);
    this.sendPacket(address, port, SNPMessage.encode(msg).finish());
  }

  // A remote packet was received.
  onPacket(address: string, port: number, data: Uint8Array) {
    const msg = SNPMessage.decode(data);
    log.debug("Server received from (%s:%s): %o", address, port, msg);

    const connectionID = msg.connectionId;
    const connection = this.findConnection(connectionID, address, port);

    if (!connection) {
      if (msg.connectionRequest) {
        // If this is a connection request, and no existing connection was
        // found, create a new connection and send it that request.
        log.debug("Creating a new connection...");
        let connection = new SNPConnection(
          connectionID,
          address,
          port,
          (msg) => this.sendMessage(address, port, msg),
          (conn) => this.removeConnection(conn)
        );
        this.connections.push(connection);
        connection.onPacket(msg);
        this.emit("connection", connection);
      } else {
        // If this is any other packet, but no connection was found,
        // send back a NoConnection packet.
        const noConnection = new NoConnection();
        this.sendMessage(address, port, new SNPMessage({ noConnection }));
      }
    } else {
      // If a connection was found, simply forward our packet to the connection.
      connection.onPacket(msg);
    }
  }

  tick() {
    for (let conn of this.connections) conn.tick();
  }

  close() {
    for (let conn of this.connections) conn.close();
    clearInterval(this.tickInterval);
  }
}
