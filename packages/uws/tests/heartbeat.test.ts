// packages/uws/tests/heartbeat.test.ts
import uWS from "uWebSockets.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { ByteSocket, LifecycleTypes, type SocketEvents } from "../src";

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
		io = new ByteSocket<TestEvents>(app, { serialization: "json" });
		app.ws("/ws", io.handler);

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

	it("should respond to ping with pong", async () => {
		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));

		const pongReceived = vi.fn();
		client.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.type === LifecycleTypes.pong) {
				pongReceived();
			}
		});

		client.send(JSON.stringify({ type: LifecycleTypes.ping }));

		await vi.waitFor(() => expect(pongReceived).toHaveBeenCalled());
		client.close();
	});
});
