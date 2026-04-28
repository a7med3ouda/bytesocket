// packages/uws/tests/heartbeat.test.ts
import uWS from "uWebSockets.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { ByteSocket, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket uws: Heartbeat", () => {
	let app: uWS.TemplatedApp;
	let io: ByteSocket<TestEvents>;
	let listenSocket: false | uWS.us_listen_socket;
	let port: number;

	beforeEach(async () => {
		app = uWS.App();
		io = new ByteSocket<TestEvents>({ serialization: "json" });

		await new Promise<void>((resolve) => {
			app.listen(0, (token) => {
				port = uWS.us_socket_local_port(token);
				listenSocket = token;
				resolve();
			});
		});
	});

	afterEach(() => {
		io.destroy();
		if (listenSocket) {
			uWS.us_listen_socket_close(listenSocket);
		}
	});

	it("should respond to an empty binary ping with an empty binary pong", async () => {
		io.attach(app, "/ws");

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		const openHandler = vi.fn();
		client.on("open", openHandler);
		await vi.waitFor(() => expect(openHandler).toHaveBeenCalled());

		const pongReceived = vi.fn();
		client.on("message", (data, isBinary) => {
			if (isBinary && Buffer.isBuffer(data) && data.length === 0) {
				pongReceived();
			}
		});

		client.send(Buffer.alloc(0), { binary: true });

		await vi.waitFor(() => expect(pongReceived).toHaveBeenCalled());
		client.close();
	});
});
