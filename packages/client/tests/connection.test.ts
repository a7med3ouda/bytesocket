// packages/client/tests/connection.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { ByteSocket, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket Client: Connection", () => {
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

	it("should connect using path and query params", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			path: "/custom",
			queryParams: { token: "abc" },
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));
		socket.close();
	});

	it("should auto-reconnect after unexpected close", async () => {
		vi.useFakeTimers();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			reconnectionDelay: 100,
			maxReconnectionAttempts: 3,
		});

		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		serverSocket.terminate();

		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.CLOSED));

		vi.advanceTimersByTime(150);
		expect(socket.readyState).toBe(WebSocket.CONNECTING);

		socket.destroy();
		vi.useRealTimers();
	});

	it("should queue messages when offline and flush on reconnect", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data, isBinary) => {
				ws.send(data, { binary: isBinary });
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			autoConnect: false,
		});

		socket.emit("echo", { message: "queued" });

		const echoHandler = vi.fn();
		socket.on("echo", echoHandler);

		socket.connect();
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		await vi.waitFor(() => expect(echoHandler).toHaveBeenCalledWith({ message: "queued" }));
		socket.close();
	});

	it("should not send messages after destroy()", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`);
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.destroy();

		expect(() => socket.emit("echo", { message: "test" })).not.toThrow();
		expect(() => socket.rooms.join("lobby")).not.toThrow();
	});

	it("should handle manual close and not reconnect", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			reconnection: true,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const closeHandler = vi.fn();
		socket.lifecycle.onClose(closeHandler);

		socket.close();
		expect(socket.readyState).toBe(WebSocket.CLOSING);

		await vi.waitFor(() => expect(closeHandler).toHaveBeenCalled());
		expect(socket.isClosed).toBe(true);
	});

	it("should force manual reconnection", async () => {
		let connectionCount = 0;
		wss.on("connection", () => {
			connectionCount++;
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { autoConnect: true });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));
		expect(connectionCount).toBe(1);

		await new Promise((r) => setTimeout(r, 20));
		socket.reconnect();

		await vi.waitFor(() => expect(connectionCount).toBe(2));
		expect(socket.readyState).toBe(WebSocket.OPEN);
		socket.destroy();
	});

	it("should not reconnect on normal closure when reconnectOnNormalClosure is false", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			reconnection: true,
			reconnectOnNormalClosure: false,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const closeHandler = vi.fn();
		socket.lifecycle.onClose(closeHandler);

		wss.clients.forEach((ws) => ws.close(1000, "normal"));
		await vi.waitFor(() => expect(closeHandler).toHaveBeenCalled());

		await new Promise((r) => setTimeout(r, 200));
		expect(socket.readyState).toBe(WebSocket.CLOSED);
		expect(socket.isConnected).toBe(false);
		socket.destroy();
	});

	it("should not send messages after manual close (without destroy)", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { reconnection: false });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const received: string[] = [];
		wss.on("connection", (ws) => {
			ws.on("message", (data) => received.push(data.toString()));
		});

		socket.close();
		await vi.waitFor(() => expect(socket.isClosed).toBe(true));

		socket.emit("echo", { message: "after close" });
		await new Promise((r) => setTimeout(r, 50));
		expect(received).not.toContain(expect.stringContaining("after close"));

		socket.sendRaw("raw after close");
		await new Promise((r) => setTimeout(r, 50));
		expect(received).not.toContain("raw after close");
	});

	it("should throw when base URL is relative and no global location", () => {
		const originalLocation = globalThis?.location;
		delete (globalThis as any).location;
		expect(() => new ByteSocket<TestEvents>("/socket")).toThrow(/Relative URLs/);
		globalThis.location = originalLocation;
	});

	it("should throw when base URL has invalid protocol", () => {
		expect(() => new ByteSocket<TestEvents>("ftp://example")).toThrow(/Invalid base URL/);
	});

	it("should warn when connect() is called after destroy", async () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { autoConnect: false, debug: true });
		socket.destroy();
		socket.connect();
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("connect() called after destroy"));
		consoleSpy.mockRestore();
	});

	it("should warn when connect() is called while already connected", async () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { autoConnect: true, debug: true });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));
		socket.connect();
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("already connected or connecting"));
		socket.close();
		consoleSpy.mockRestore();
	});

	it("should warn when reconnect() is called after destroy", async () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { autoConnect: false, debug: true });
		socket.destroy();
		socket.reconnect();
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("reconnect() called after destroy"));
		consoleSpy.mockRestore();
	});

	it("should convert http:// URL to ws://", async () => {
		const socket = new ByteSocket<TestEvents>(`http://localhost:${port}`, { autoConnect: true });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));
		socket.close();
	});

	it("should resolve relative URL when location is available", async () => {
		const originalLocation = globalThis.location;

		(globalThis as any).location = { origin: `http://localhost:${port}` };

		const socket = new ByteSocket<TestEvents>("/socket", {
			reconnection: false,
		});

		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));
		socket.close();

		globalThis.location = originalLocation;
	});

	it("should log 'normal closure will not reconnect' when reconnectOnNormalClosure is false", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			reconnection: false,
			reconnectOnNormalClosure: false,
			debug: true,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		wss.clients.forEach((ws) => ws.close(1000, "normal closure"));
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.CLOSED));

		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("normal closure (code 1000), will not reconnect"));
		logSpy.mockRestore();
		socket.destroy();
	});

	it("should log 'reconnecting immediately as requested' on manual reconnect", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			debug: true,
			reconnection: true,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.reconnect();
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		expect(logSpy).toHaveBeenCalledWith("ByteSocket: reconnecting immediately as requested");
		logSpy.mockRestore();
		socket.destroy();
	});
});
