import * as log from "loglevel";
import { SNPConnection } from "../connection";
import { SNPClientNode, SNPServerNode } from "../node";

test("snp-node", (done) => {
  const server = new SNPServerNode(3000);
  const client = new SNPClientNode();

  server.on("listening", () => {
    console.log("Server started...");

    client.on("connection", (conn: SNPConnection) => {
      conn.send(new Uint8Array([1]), true);
      conn.send(new Uint8Array([2]), false);
      conn.send(new Uint8Array([3]), true);
      conn.send(new Uint8Array([4]), false);

      expect(conn.reliableSequenceNumber).toBe(2);
      expect(conn.unreliableSequenceNumber).toBe(2);

      expect(conn.lastReliableSequenceNumberSeen).toBe(0);
      expect(conn.lastUnreliableSequenceNumberSeen).toBe(0);
    });
    client.connect("localhost", 3000);
  });
  server.on("connection", (conn: SNPConnection) => {
    console.log("Server received connection.");
    let messages: Uint8Array[] = [];
    conn.on("message", (msg) => {
      messages.push(msg)

      if (messages.length === 4) {
        expect(messages[0][0]).toBe(1);
        expect(messages[1][0]).toBe(2);
        expect(messages[2][0]).toBe(3);
        expect(messages[3][0]).toBe(4);

        expect(conn.lastReliableSequenceNumberSeen).toBe(2);
        expect(conn.lastUnreliableSequenceNumberSeen).toBe(2);

        expect(conn.reliableSequenceNumber).toBe(0);
        expect(conn.unreliableSequenceNumber).toBe(0);

        server.close();
        client.close();

        done();
      }
    });
  });
});
