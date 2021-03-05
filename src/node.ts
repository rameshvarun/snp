import { SNPConnection } from "./connection";
import * as dgram from "dgram";
import * as log from "loglevel";
import { SNPServer } from "./server";
import { SNPClient } from "./client";

export class SNPServerNode extends SNPServer {
  socket: dgram.Socket;
  constructor(port: number) {
    super();
    this.socket = dgram.createSocket("udp4");
    this.socket.on("message", (msg, rbInfo) => {
      this.onPacket(rbInfo.address, rbInfo.port, msg);
    });
    this.socket.on("listening", () => {
      this.emit("listening");
    });
    this.socket.bind(port);
  }

  sendPacket(address: string, port: number, data: Uint8Array) {
    this.socket.send(data, port, address);
  }

  close() {
    super.close();
    this.socket.close();
  }
}

export class SNPClientNode extends SNPClient {
  socket: dgram.Socket;
  constructor() {
    super();
    this.socket = dgram.createSocket("udp4");
    this.socket.on("message", (msg, rbInfo) => {
      this.onPacket(rbInfo.address, rbInfo.port, msg);
    });
    setTimeout(() => {
      this.emit("open");
    }, 0);
  }

  sendPacket(address: string, port: number, data: Uint8Array) {
    this.socket.send(data, port, address);
  }

  close() {
    super.close();
    this.socket.close();
  }
}
