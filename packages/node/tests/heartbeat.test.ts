// packages/node/tests/heartbeat.test.ts
import { createServer, Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket, { type AddressInfo } from "ws";
import { ByteSocket, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket node: Heartbeat", () => {
	let server: Server;
	let io: ByteSocket<TestEvents>;
	let port: number;

	beforeEach(async () => {
		server = createServer();
		io = new ByteSocket<TestEvents>({ serialization: "json" });

		await new Promise<void>((resolve) => {
			server.listen(0, () => {
				port = (server.address() as AddressInfo).port;
				resolve();
			});
		});
	});

	afterEach(() => {
		io.destroy();
		server.close();
	});

	it("should respond to an empty binary ping with an empty binary pong", async () => {
		io.attach(server, "/ws");

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

	it("should send protocol pings and keep connection alive when client responds", async () => {
		io = new ByteSocket<TestEvents>({
			serialization: "json",
			idleTimeout: 2,
			sendPingsAutomatically: true,
		});
		io.attach(server, "/ws");

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		const closeHandler = vi.fn();
		client.on("close", closeHandler);

		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.OPEN));
		await vi.waitFor(() => expect(closeHandler).not.toHaveBeenCalled(), { timeout: 5000 });

		client.close();
	});

	it("should send protocol pings at the configured interval", async () => {
		io = new ByteSocket<TestEvents>({
			serialization: "json",
			idleTimeout: 2,
			sendPingsAutomatically: true,
		});
		io.attach(server, "/ws");

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		const pingHandler = vi.fn();
		client.on("ping", pingHandler);

		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.OPEN));
		await vi.waitFor(() => expect(pingHandler).toHaveBeenCalled(), { timeout: 3000 });

		client.close();
	});
});
