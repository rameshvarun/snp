import * as log from "loglevel";
import { EventEmitter } from "eventemitter3";
import { SNPConnection } from "./connection";

export abstract class SNPBase extends EventEmitter {
  /** A list of currently open connections. */
  connections: Array<SNPConnection> = [];

  /** Find a specific connection, given the ID, address, and port. */
  findConnection(
    connectionID: number,
    address: string,
    port: number
  ): SNPConnection | null {
    for (let conn of this.connections) {
      if (
        conn.connectionID === connectionID &&
        conn.remoteAddress === address &&
        conn.remotePort === port
      ) {
        return conn;
      }
    }
    return null;
  }

  /** Remove a connection from the active connections list. */
  removeConnection(conn) {
    this.connections = this.connections.filter((c) => c !== conn);
  }
}
