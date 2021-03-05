import { SNPClient } from "./client";
import { SNPConnection } from "./connection";
import * as log from "loglevel";

export class SNPClientB2G extends SNPClient {
  socket: any;

  constructor() {
    super();
    // @ts-ignore
    this.socket = new UDPSocket();
    this.socket.opened.then(() => {
      this.emit("open");
    });
    this.socket.addEventListener("message", (e) => {
      this.onPacket(e.remoteAddress, e.remotePort, new Uint8Array(e.data));
    });
  }

  sendPacket(address: string, port: number, data: Uint8Array) {
    this.socket.send(data, address, port);
  }
}
