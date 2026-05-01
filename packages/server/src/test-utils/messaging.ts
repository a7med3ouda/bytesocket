// packages/server/src/test-utils/messaging.ts
import type * as vitest from "vitest";
import WebSocket from "ws";
import { createClient, type CreateByteSocketServerResponse, type TestEvents } from ".";
import type { ByteSocketServerBase } from "../byte-socket-server-base";
import type { ByteSocketOptionsBase, ServerIncomingData } from "../types";

export function serverMessagingTest<B extends ByteSocketServerBase<TestEvents> = ByteSocketServerBase<TestEvents>>(
	{ vi, afterEach, beforeEach, it, expect }: typeof vitest,
	createByteSocket: (options?: ByteSocketOptionsBase<TestEvents>) => B,
	createByteSocketServer: () => Promise<CreateByteSocketServerResponse<B>>,
	destroyByteSocketServer: (obj: CreateByteSocketServerResponse<B>) => void,
) {
	let obj: CreateByteSocketServerResponse<B>;

	beforeEach(async () => {
		obj = await createByteSocketServer();
	});

	afterEach(() => {
		destroyByteSocketServer(obj);
	});

	it("should receive global events from clients", async () => {
		const echoHandler = vi.fn();
		obj.io.on("echo", echoHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		client.send(JSON.stringify({ event: "echo", data: { message: "hello" } }));

		await vi.waitFor(() => expect(echoHandler).toHaveBeenCalled());
		const [socket, data] = echoHandler.mock.calls[0];
		expect(socket).toBeDefined();
		expect(data).toEqual({ message: "hello" });

		client.close();
	});

	it("should broadcast global events to all clients", async () => {
		obj.io.attach(obj.server, "/ws");

		const client1 = await createClient(obj.port);
		const client2 = await createClient(obj.port);

		const messages: string[] = [];
		client1.on("message", (data) => messages.push(JSON.parse(data.toString())));
		client2.on("message", (data) => messages.push(JSON.parse(data.toString())));

		obj.io.emit("broadcast", { text: "announcement" });

		await vi.waitFor(() => expect(messages.length).toBe(2));
		expect(messages[0]).toEqual({ event: "broadcast", data: { text: "announcement" } });

		client1.close();
		client2.close();
	});

	it("should handle binary (msgpack) messages", async () => {
		const echoHandler = vi.fn();
		obj.io.on("echo", echoHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		const { Packr } = await import("msgpackr");
		const packr = new Packr({ useRecords: false });
		const packed = packr.pack({ event: "echo", data: { message: "binary" } });

		client.send(packed);

		await vi.waitFor(() => expect(echoHandler).toHaveBeenCalled());
		expect(echoHandler.mock.calls[0][1]).toEqual({ message: "binary" });

		client.close();
	});

	it("should handle malformed JSON", async () => {
		const errorHandler = vi.fn();
		obj.io.lifecycle.onError(errorHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send("not json");

		await vi.waitFor(() => expect(errorHandler).toHaveBeenCalled());
		expect(client.readyState).toBe(WebSocket.CLOSED);
	});

	it("should run global middleware before event handlers", async () => {
		const middleware = vi.fn((socket, _ctx, next) => {
			socket.locals.foo = "bar";
			next();
		});
		obj.io.use(middleware);

		const echoHandler = vi.fn();
		obj.io.on("echo", echoHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(echoHandler).toHaveBeenCalled());
		expect(middleware).toHaveBeenCalled();
		expect(echoHandler.mock.calls[0][0].locals.foo).toBe("bar");

		client.close();
	});

	it("should block messages when middleware calls next(error)", async () => {
		obj.io.use((_socket, _ctx, next) => {
			next(new Error("Blocked"));
		});

		const echoHandler = vi.fn();
		obj.io.on("echo", echoHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(echoHandler).not.toHaveBeenCalled());

		client.close();
	});

	it("should remove global event listener with off (specific callback)", async () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		obj.io.on("echo", handler1);
		obj.io.on("echo", handler2);
		obj.io.off("echo", handler1);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(handler2).toHaveBeenCalled());
		expect(handler1).not.toHaveBeenCalled();
		client.close();
	});

	it("should remove all global event listeners with off (no callback)", async () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		obj.io.on("echo", handler1);
		obj.io.on("echo", handler2);
		obj.io.off("echo");

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(handler1).not.toHaveBeenCalled());
		await vi.waitFor(() => expect(handler2).not.toHaveBeenCalled());
		client.close();
	});

	it("should call once listener only once", async () => {
		const handler = vi.fn();
		obj.io.once("echo", handler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ event: "echo", data: { message: "first" } }));
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

		client.send(JSON.stringify({ event: "echo", data: { message: "second" } }));
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
		client.close();
	});

	it("should not emit global events when server is destroyed", async () => {
		obj.io.attach(obj.server, "/ws");

		obj.io.destroy();

		expect(() => obj.io.emit("broadcast", { text: "test" })).not.toThrow();
	});

	it("should timeout middleware and close socket when onMiddlewareTimeout is 'close'", async () => {
		obj.io = createByteSocket({
			serialization: "json",
			middlewareTimeout: 50,
			onMiddlewareTimeout: "close",
		});

		obj.io.use((_socket, _ctx, _next) => {});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ event: "echo", data: { message: "timeout" } }));

		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
	});

	it("should close socket when payload is null or not an object", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		client.send("42");

		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
	});

	it("should send a message to the client using socket.send()", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

		const received: string[] = [];
		client.on("message", (data) => received.push(JSON.parse(data.toString())));

		socket.send({ event: "echo", data: { message: "direct" } });

		await vi.waitFor(() => expect(received).toEqual([{ event: "echo", data: { message: "direct" } }]));
		client.close();
	});

	it("should send typed event to client using socket.emit()", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

		const received: string[] = [];
		client.on("message", (data) => received.push(JSON.parse(data.toString())));

		socket.emit("echo", { message: "typed" });

		await vi.waitFor(() => expect(received).toEqual([{ event: "echo", data: { message: "typed" } }]));
		client.close();
	});

	it("should send raw message to the client using socket.sendRaw()", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

		const received: string[] = [];
		client.on("message", (data) => received.push(data.toString()));

		socket.sendRaw("RAW_DATA");

		await vi.waitFor(() => expect(received).toContain("RAW_DATA"));
		client.close();
	});

	it("should broadcast to all clients except the sender using socket.broadcast()", async () => {
		obj.io.attach(obj.server, "/ws");

		const sender = await createClient(obj.port);
		const other = await createClient(obj.port);

		sender.on("message", (data) => senderMessages.push(JSON.parse(data.toString())));
		other.on("message", (data) => otherMessages.push(JSON.parse(data.toString())));

		const senderSocket = Array.from(obj.io.sockets.values())[0];
		const senderMessages: string[] = [];
		const otherMessages: string[] = [];

		senderSocket.broadcast("broadcast", { text: "except me" });

		await vi.waitFor(() => expect(senderMessages.length).toBe(0));
		await vi.waitFor(() => expect(otherMessages.length).toBe(1));

		sender.close();
		other.close();
	});

	it("should encode outgoing messages as binary when serialization is 'binary'", async () => {
		obj.io = createByteSocket({ serialization: "binary" });

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const rawMessages: Array<Buffer> = [];
		client.on("message", (data) => rawMessages.push(data as Buffer));

		const socket = Array.from(obj.io.sockets.values())[0];
		socket.emit("echo", { message: "binary" });

		await vi.waitFor(() => expect(rawMessages.length).toBe(1));

		const { Packr } = await import("msgpackr");
		const packr = new Packr({ useRecords: false });
		const unpacked = packr.unpack(rawMessages[0]);
		await vi.waitFor(() => expect(unpacked).toEqual({ event: "echo", data: { message: "binary" } }));
		client.close();
	});

	it("should catch synchronous errors in event listeners without triggering onError", async () => {
		const errorSpy = vi.fn();
		obj.io.lifecycle.onError(errorSpy);

		obj.io.on("echo", () => {
			throw new Error("listener crash");
		});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		expect(() => client.send(JSON.stringify({ event: "echo", data: { message: "test" } }))).not.toThrow();

		await vi.waitFor(() => expect(errorSpy).not.toHaveBeenCalled());
		client.close();
	});

	it("should log error in event listener when debug is enabled", async () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		obj.io = createByteSocket({ debug: true, serialization: "json" });

		obj.io.on("echo", () => {
			throw new Error("listener crash");
		});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(consoleSpy).toHaveBeenCalled());
		consoleSpy.mockRestore();
		client.close();
	});

	it("should handle middleware that returns a resolved promise", async () => {
		const middleware = vi.fn((_socket, _ctx, _next) => {
			return Promise.resolve();
		});
		obj.io.use(middleware);

		const echoHandler = vi.fn();
		obj.io.on("echo", echoHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ event: "echo", data: { message: "promise" } }));

		await vi.waitFor(() => expect(echoHandler).toHaveBeenCalled());
		expect(middleware).toHaveBeenCalled();
		client.close();
	});

	it("should handle middleware that returns a rejected promise", async () => {
		const errorSpy = vi.fn();
		obj.io.lifecycle.onError(errorSpy);

		obj.io.use((_socket, _ctx, _next) => {
			return Promise.reject(new Error("Promise rejection"));
		});

		obj.io.on("echo", vi.fn());

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ event: "echo", data: { message: "fail" } }));

		await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
		const [, ctx] = errorSpy.mock.calls[0];
		expect(ctx.phase).toBe("middleware");
		client.close();
	});

	it("should handle middleware that throws synchronously", async () => {
		const errorSpy = vi.fn();
		obj.io.lifecycle.onError(errorSpy);

		obj.io.use((_socket, _ctx, _next) => {
			throw new Error("Sync throw in middleware");
		});

		obj.io.on("echo", vi.fn());

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ event: "echo", data: { message: "fail" } }));

		await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
		const [, ctx] = errorSpy.mock.calls[0];
		expect(ctx.phase).toBe("middleware");
		client.close();
	});

	it("should call custom onMiddlewareError function instead of closing", async () => {
		const customHandler = vi.fn();
		obj.io = createByteSocket({
			serialization: "json",
			onMiddlewareError: customHandler,
		});

		obj.io.use((_socket, _ctx, next) => {
			next(new Error("Custom error"));
		});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(customHandler).toHaveBeenCalled());
		const [error, socket] = customHandler.mock.calls[0];
		expect(error.message).toBe("Custom error");
		expect(socket).toBeDefined();
		client.close();
	});

	it("should call custom onMiddlewareTimeout function on timeout", async () => {
		const customTimeout = vi.fn();
		obj.io = createByteSocket({
			serialization: "json",
			middlewareTimeout: 50,
			onMiddlewareTimeout: customTimeout,
		});

		obj.io.use((_socket, _ctx, _next) => {});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ event: "echo", data: { message: "time" } }));

		await vi.waitFor(() => expect(customTimeout).toHaveBeenCalled());
		const [error, socket] = customTimeout.mock.calls[0];
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("TimeoutError");
		expect(socket).toBeDefined();
		client.close();
	});

	it("should remove a once listener with off before it fires", async () => {
		const handler = vi.fn();
		obj.io.once("echo", handler);
		obj.io.off("echo", handler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ event: "echo", data: { message: "x" } }));

		await vi.waitFor(() => expect(handler).not.toHaveBeenCalled());
		client.close();
	});

	it("should do nothing when sendRaw is called on a closed socket", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];
		client.close();
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(0));

		expect(() => socket.sendRaw("should not throw")).not.toThrow();
	});

	it("should handle callback that removes another listener during invocation", async () => {
		const handler2 = vi.fn();
		const remove = () => obj.io.off("echo", handler2);
		const handler1 = vi.fn(() => remove());

		obj.io.on("echo", handler1);
		obj.io.on("echo", handler2);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(handler1).toHaveBeenCalled());
		expect(handler2).not.toHaveBeenCalled();
		client.close();
	});

	it("should decode binary message as JSON when isBinary is false", () => {
		obj.io.attach(obj.server, "/ws");

		const buffer = Buffer.from(JSON.stringify({ event: "echo", data: { message: "hello" } }));
		const result = obj.io.decode(buffer as unknown as ArrayBuffer, false);
		expect(result).toEqual({ event: "echo", data: { message: "hello" } });
	});

	it("should throw when receiving a string but isBinary is true", () => {
		obj.io.attach(obj.server, "/ws");

		expect(() => obj.io.decode("hello" as unknown as ServerIncomingData, true)).toThrow("Received string but expected binary");
	});
}
