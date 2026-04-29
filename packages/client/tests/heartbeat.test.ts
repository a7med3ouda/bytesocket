// packages/client/tests/heartbeat.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { ByteSocket, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket Client: Heartbeat", () => {
	let wss: WebSocketServer;
	let port: number;

	beforeEach(async () => {
		wss = new WebSocketServer({ port: 0 });
		port = (wss.address() as WebSocket.AddressInfo).port;
	});

	afterEach(() => {
		wss.close();
		vi.useRealTimers();
	});

	it("should send empty binary ping and respond to server pong", async () => {
		const pingHandler = vi.fn();

		wss.on("connection", (ws) => {
			ws.on("message", (data, isBinary) => {
				if (isBinary && Buffer.isBuffer(data) && data.length === 0) {
					pingHandler();
					ws.send(Buffer.alloc(0), { binary: true });
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			pingInterval: 50,
			pingTimeout: 40,
			serialization: "json",
		});

		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN), { timeout: 1000 });

		const closeHandler = vi.fn();
		socket.lifecycle.onClose(closeHandler);

		await vi.waitFor(() => expect(pingHandler).toHaveBeenCalledTimes(2), { timeout: 200 });

		expect(socket.readyState).toBe(WebSocket.OPEN);
		expect(closeHandler).not.toHaveBeenCalled();

		socket.destroy();
	});

	it("should not send pings when heartbeat is disabled", async () => {
		vi.useFakeTimers();
		const pingHandler = vi.fn();
		wss.on("connection", (ws) => {
			ws.on("message", (data, isBinary) => {
				if (isBinary && Buffer.isBuffer(data) && data.length === 0) {
					pingHandler();
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			heartbeatEnabled: false,
			pingInterval: 30,
			serialization: "json",
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		vi.advanceTimersByTime(200);

		expect(pingHandler).not.toHaveBeenCalled();
		socket.destroy();
		vi.useRealTimers();
	});

	it("should warn when pingTimeout >= pingInterval", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			debug: true,
			heartbeatEnabled: false,
			pingInterval: 50,
			pingTimeout: 50,
		});
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("pingTimeout (50ms) should be less than pingInterval (50ms)"));
		warnSpy.mockRestore();
		socket.destroy();
	});

	it("should warn when pingTimeout is close to pingInterval", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			debug: true,
			heartbeatEnabled: false,
			pingInterval: 100,
			pingTimeout: 81,
		});
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("pingTimeout (81ms) is close to pingInterval (100ms)"));
		warnSpy.mockRestore();
		socket.destroy();
	});
});
