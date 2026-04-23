// packages/client/tests/messaging.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { ByteSocket, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket Client: Messaging", () => {
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

	it("should send and receive JSON messages", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data, isBinary) => {
				expect(isBinary).toBe(false);
				ws.send(data, { binary: isBinary });
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const echoHandler = vi.fn();
		socket.on("echo", echoHandler);

		socket.emit("echo", { message: "hello" });

		await vi.waitFor(() => expect(echoHandler).toHaveBeenCalledWith({ message: "hello" }));
		socket.close();
	});

	it("should send and receive binary (msgpack) messages", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data, isBinary) => {
				expect(isBinary).toBe(true);
				ws.send(data, { binary: isBinary });
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`);
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const echoHandler = vi.fn();
		socket.on("echo", echoHandler);

		socket.emit("echo", { message: "binary" });

		await vi.waitFor(() => expect(echoHandler).toHaveBeenCalledWith({ message: "binary" }));
		socket.close();
	});

	it("should send raw messages", async () => {
		const receivedMessages: string[] = [];
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				receivedMessages.push(data.toString());
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { autoConnect: false });
		socket.connect();
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.sendRaw("RAW_MESSAGE_1");
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(receivedMessages).toContain("RAW_MESSAGE_1");
		socket.close();
	});

	it("should handle decode errors gracefully", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`);
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const errorHandler = vi.fn();
		socket.lifecycle.onError(errorHandler);

		serverSocket.send("not json", { binary: false });

		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));
		await vi.waitFor(() => expect(errorHandler).toHaveBeenCalled());
		socket.destroy();
	});

	it("should call global once listener only once", async () => {
		const handler = vi.fn();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.once("echo", handler);

		serverSocket.send(JSON.stringify({ event: "echo", data: { message: "first" } }));
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
		expect(handler).toHaveBeenCalledWith({ message: "first" });

		serverSocket.send(JSON.stringify({ event: "echo", data: { message: "second" } }));
		await new Promise((r) => setTimeout(r, 30));
		expect(handler).toHaveBeenCalledTimes(1);
		socket.close();
	});

	it("should remove global event listeners with off", async () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.on("echo", handler1);
		socket.on("echo", handler2);
		socket.off("echo", handler1);

		serverSocket.send(JSON.stringify({ event: "echo", data: { message: "test" } }));
		await vi.waitFor(() => expect(handler2).toHaveBeenCalledTimes(1));
		expect(handler1).not.toHaveBeenCalled();

		socket.off("echo");
		serverSocket.send(JSON.stringify({ event: "echo", data: { message: "again" } }));
		await new Promise((r) => setTimeout(r, 30));
		expect(handler1).toHaveBeenCalledTimes(0);
		expect(handler2).toHaveBeenCalledTimes(1);
		socket.close();
	});

	it("should encode and decode JSON correctly", () => {
		const socket = new ByteSocket<TestEvents>("ws://localhost:1234", { serialization: "json" });
		const payload = { event: "echo", data: { message: "test" } };
		const encoded = socket.encode(payload);
		expect(typeof encoded).toBe("string");
		const decoded = socket.decode(encoded as string);
		expect(decoded).toEqual(payload);
		socket.destroy();
	});

	it("should encode and decode binary (msgpack) correctly", () => {
		const socket = new ByteSocket<TestEvents>("ws://localhost:1234");
		const payload = { event: "echo", data: { message: "test" } };
		const encoded = socket.encode(payload, "binary");
		expect(encoded).toBeInstanceOf(Uint8Array);
		const decoded = socket.decode(encoded as string | ArrayBuffer, true);
		expect(decoded).toEqual(payload);
		socket.destroy();
	});

	it("should drop send() when auth failed", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			auth: { data: { token: "bad" } },
			authTimeout: 100,
			serialization: "json",
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		vi.useFakeTimers();
		vi.advanceTimersByTime(150);
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.CLOSED));
		vi.useRealTimers();

		const received: string[] = [];
		wss.on("connection", (ws) => {
			ws.on("message", (data) => received.push(data.toString()));
		});

		socket.send({ event: "echo", data: { message: "should not arrive" } });
		await new Promise((r) => setTimeout(r, 30));
		expect(received.length).toBe(0);
		socket.destroy();
	});

	it("should queue sendRaw() when not open", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { autoConnect: false });

		socket.sendRaw("queued raw");
		socket.connect();

		const received: string[] = [];
		wss.on("connection", (ws) => {
			ws.on("message", (data) => received.push(data.toString()));
		});

		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));
		await vi.waitFor(() => expect(received).toContain("queued raw"));
		socket.close();
	});

	it("should throw when decode receives string but isBinary is true", () => {
		const socket = new ByteSocket<TestEvents>("ws://localhost:1234");
		expect(() => socket.decode("some text", true)).toThrow("Received string but expected binary");
		socket.destroy();
	});

	it("should warn when an unhandled message is received", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			serialization: "json",
			debug: true,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		wss.clients.forEach((ws) => ws.send(JSON.stringify({ unknownProp: "foo" })));

		await vi.waitFor(() => {
			expect(warnSpy).toHaveBeenCalledWith("ByteSocket: unhandled message", { unknownProp: "foo" });
		});
		warnSpy.mockRestore();
		socket.close();
	});

	it("should catch send failure and warn when debug is on", async () => {
		const sendSpy = vi.spyOn(globalThis.WebSocket.prototype, "send").mockImplementation(() => {
			throw new Error("fake send error");
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			debug: true,
			autoConnect: false,
		});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		socket.connect();
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.sendRaw("test");

		await vi.waitFor(() => {
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("send failed"), expect.any(Error));
		});

		sendSpy.mockRestore();
		warnSpy.mockRestore();
		socket.close();
	});

	it("should handle callback that removes another listener during invocation", async () => {
		const handler2 = vi.fn();
		const remove = () => socket.off("echo", handler2);
		const handler1 = vi.fn(() => remove());

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.on("echo", handler1);
		socket.on("echo", handler2);

		serverSocket.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(handler1).toHaveBeenCalled());

		expect(handler2).not.toHaveBeenCalled();
		socket.close();
	});
});
