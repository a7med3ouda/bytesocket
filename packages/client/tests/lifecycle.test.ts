// packages/client/tests/lifecycle.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { ByteSocket, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket Client: Lifecycle", () => {
	let wss: WebSocketServer;
	let port: number;
	let serverSocket: WebSocket;

	beforeEach(async () => {
		wss = new WebSocketServer({ port: 0 });
		port = (wss.address() as WebSocket.AddressInfo).port;
		wss.on("connection", (ws) => {
			serverSocket = ws;
		});
	});

	afterEach(() => {
		wss.close();
		vi.useRealTimers();
	});

	it("should emit open event", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			autoConnect: false,
		});

		const openHandler = vi.fn();
		socket.lifecycle.onOpen(openHandler);

		socket.connect();
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN), {
			timeout: 1000,
		});

		expect(openHandler).toHaveBeenCalledOnce();
		socket.close();
	});

	it("should emit reconnectFailed after max attempts", async () => {
		vi.useFakeTimers();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			reconnectionDelay: 10,
			maxReconnectionAttempts: 1,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const reconnectFailedHandler = vi.fn();
		socket.lifecycle.onReconnectFailed(reconnectFailedHandler);

		wss.close();
		await vi.runAllTimersAsync();
		await vi.waitFor(() => expect(socket.isClosed).toBe(true));

		expect(reconnectFailedHandler).toHaveBeenCalled();
		socket.destroy();
		vi.useRealTimers();
	});

	it("should emit reconnectFailed when reconnection disabled", async () => {
		vi.useFakeTimers();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			reconnectionDelay: 10,
			maxReconnectionAttempts: 0,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const reconnectFailedHandler = vi.fn();
		socket.lifecycle.onReconnectFailed(reconnectFailedHandler);

		wss.close();
		await vi.runAllTimersAsync();
		await vi.waitFor(() => expect(socket.isClosed).toBe(true));

		expect(reconnectFailedHandler).toHaveBeenCalled();
		socket.destroy();
		vi.useRealTimers();
	});

	it("should emit queueFull when queue is exceeded", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			autoConnect: false,
			maxQueueSize: 2,
		});

		const queueFullHandler = vi.fn();
		socket.lifecycle.onQueueFull(queueFullHandler);

		socket.emit("echo", { message: "1" });
		socket.emit("echo", { message: "2" });
		socket.emit("echo", { message: "3" });

		expect(queueFullHandler).toHaveBeenCalled();
		socket.destroy();
	});

	it("should emit close event on manual close", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			reconnection: true,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const closeHandler = vi.fn();
		socket.lifecycle.onClose(closeHandler);

		socket.close();
		await vi.waitFor(() => expect(closeHandler).toHaveBeenCalled());
		expect(socket.isClosed).toBe(true);
	});

	it("should emit onMessage lifecycle callback with raw data", async () => {
		const rawHandler = vi.fn();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.lifecycle.onMessage(rawHandler);

		const raw = JSON.stringify({ event: "echo", data: { message: "raw" } });
		for (const ws of wss.clients) {
			ws.send(raw);
		}

		await vi.waitFor(() => {
			expect(rawHandler).toHaveBeenCalledWith(expect.any(String));
		});

		const rawData = rawHandler.mock.calls[0][0];
		expect(JSON.parse(rawData)).toEqual({ event: "echo", data: { message: "raw" } });
		socket.close();
	});

	it("should report isConnected correctly", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { autoConnect: false });
		expect(socket.isConnected).toBe(false);
		socket.connect();
		await vi.waitFor(() => expect(socket.isConnected).toBe(true));
		socket.close();
		await vi.waitFor(() => expect(socket.isConnected).toBe(false));
	});

	it("should remove error listener with offError", async () => {
		const errorHandler = vi.fn();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.lifecycle.onError(errorHandler);
		socket.lifecycle.offError(errorHandler);

		serverSocket.send("not json", { binary: false });

		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));
		await vi.waitFor(() => expect(errorHandler).not.toHaveBeenCalled());
		socket.destroy();
	});

	it("should call onceError listener only once", async () => {
		const errorHandler = vi.fn();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.lifecycle.onceError(errorHandler);

		serverSocket.send("not json");
		serverSocket.send("also not json");

		await vi.waitFor(() => expect(errorHandler).toHaveBeenCalledTimes(1));
		socket.destroy();
	});

	it("should call onceReconnectFailed only once", async () => {
		vi.useFakeTimers();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			reconnectionDelay: 10,
			maxReconnectionAttempts: 1,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.lifecycle.onceReconnectFailed(handler);

		wss.close();
		await vi.runAllTimersAsync();
		await vi.waitFor(() => expect(socket.isClosed).toBe(true));

		expect(handler).toHaveBeenCalledTimes(1);

		socket.destroy();
		vi.useRealTimers();
	});

	it("should remove reconnectFailed listener with offReconnectFailed", async () => {
		vi.useFakeTimers();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			reconnectionDelay: 10,
			maxReconnectionAttempts: 1,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.lifecycle.onReconnectFailed(handler);
		socket.lifecycle.offReconnectFailed(handler);

		wss.close();
		await vi.runAllTimersAsync();
		await vi.waitFor(() => expect(socket.isClosed).toBe(true));

		expect(handler).not.toHaveBeenCalled();
		socket.destroy();
		vi.useRealTimers();
	});

	it("should call onceQueueFull only once", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			autoConnect: false,
			maxQueueSize: 1,
		});

		const handler = vi.fn();
		socket.lifecycle.onceQueueFull(handler);

		socket.emit("echo", { message: "first" });
		socket.emit("echo", { message: "second" });

		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

		socket.emit("echo", { message: "third" });
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
		socket.destroy();
	});

	it("should remove queueFull listener with offQueueFull", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			autoConnect: false,
			maxQueueSize: 1,
		});

		const handler = vi.fn();
		socket.lifecycle.onQueueFull(handler);
		socket.lifecycle.offQueueFull(handler);

		socket.emit("echo", { message: "first" });
		socket.emit("echo", { message: "second" });

		await vi.waitFor(() => expect(handler).not.toHaveBeenCalled());
		socket.destroy();
	});

	it("should call onceMessage only once", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.lifecycle.onceMessage(handler);

		for (const ws of wss.clients) {
			ws.send(JSON.stringify({ event: "echo", data: { x: 1 } }));
		}
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

		for (const ws of wss.clients) {
			ws.send(JSON.stringify({ event: "echo", data: { x: 2 } }));
		}
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
		socket.close();
	});

	it("should remove message listener with offMessage", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.lifecycle.onMessage(handler);
		socket.lifecycle.offMessage(handler);

		for (const ws of wss.clients) {
			ws.send(JSON.stringify({ event: "echo", data: { x: 1 } }));
		}
		await vi.waitFor(() => expect(handler).not.toHaveBeenCalled());
		socket.close();
	});

	it("should do nothing when close() is called after destroy()", () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { autoConnect: false });
		socket.destroy();
		expect(() => socket.close()).not.toThrow();
	});

	it("should call destroy() idempotently", () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { autoConnect: false });
		socket.destroy();
		expect(() => socket.destroy()).not.toThrow();
		expect(socket.isClosed).toBe(true);
	});
});
