// packages/uws/tests/messaging.test.ts
import uWS from "uWebSockets.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { ByteSocket, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket uws: Messaging", () => {
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

	const createClient = (): Promise<WebSocket> => {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(`ws://localhost:${port}/ws`);
			ws.on("open", () => resolve(ws));
			ws.on("error", reject);
		});
	};

	it("should receive global events from clients", async () => {
		const echoHandler = vi.fn();
		io.on("echo", echoHandler);

		const client = await createClient();

		client.send(JSON.stringify({ event: "echo", data: { message: "hello" } }));

		await vi.waitFor(() => expect(echoHandler).toHaveBeenCalled());
		const [socket, data] = echoHandler.mock.calls[0];
		expect(socket).toBeDefined();
		expect(data).toEqual({ message: "hello" });

		client.close();
	});

	it("should broadcast global events to all clients", async () => {
		const client1 = await createClient();
		const client2 = await createClient();

		const messages: string[] = [];
		client1.on("message", (data) => messages.push(JSON.parse(data.toString())));
		client2.on("message", (data) => messages.push(JSON.parse(data.toString())));

		io.emit("broadcast", { text: "announcement" });

		await vi.waitFor(() => expect(messages.length).toBe(2));
		expect(messages[0]).toEqual({ event: "broadcast", data: { text: "announcement" } });

		client1.close();
		client2.close();
	});

	it("should handle binary (msgpack) messages", async () => {
		const echoHandler = vi.fn();
		io.on("echo", echoHandler);

		const client = await createClient();

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
		io.lifecycle.onError(errorHandler);

		const client = await createClient();
		client.send("not json");

		await vi.waitFor(() => expect(errorHandler).toHaveBeenCalled());
		expect(client.readyState).toBe(WebSocket.CLOSED);
	});

	it("should run global middleware before event handlers", async () => {
		const middleware = vi.fn((socket, _ctx, next) => {
			socket.locals.foo = "bar";
			next();
		});
		io.use(middleware);

		const echoHandler = vi.fn();
		io.on("echo", echoHandler);

		const client = await createClient();
		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(echoHandler).toHaveBeenCalled());
		expect(middleware).toHaveBeenCalled();
		expect(echoHandler.mock.calls[0][0].locals.foo).toBe("bar");

		client.close();
	});

	it("should block messages when middleware calls next(error)", async () => {
		io.use((_socket, _ctx, next) => {
			next(new Error("Blocked"));
		});

		const echoHandler = vi.fn();
		io.on("echo", echoHandler);

		const client = await createClient();
		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(echoHandler).not.toHaveBeenCalled();

		client.close();
	});

	it("should remove global event listener with off (specific callback)", async () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		io.on("echo", handler1);
		io.on("echo", handler2);
		io.off("echo", handler1);

		const client = await createClient();
		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(handler2).toHaveBeenCalled());
		expect(handler1).not.toHaveBeenCalled();
		client.close();
	});

	it("should remove all global event listeners with off (no callback)", async () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		io.on("echo", handler1);
		io.on("echo", handler2);
		io.off("echo");

		const client = await createClient();
		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await new Promise((r) => setTimeout(r, 50));
		expect(handler1).not.toHaveBeenCalled();
		expect(handler2).not.toHaveBeenCalled();
		client.close();
	});

	it("should call once listener only once", async () => {
		const handler = vi.fn();
		io.once("echo", handler);

		const client = await createClient();
		client.send(JSON.stringify({ event: "echo", data: { message: "first" } }));
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

		client.send(JSON.stringify({ event: "echo", data: { message: "second" } }));
		await new Promise((r) => setTimeout(r, 50));
		expect(handler).toHaveBeenCalledTimes(1);
		client.close();
	});

	it("should not emit global events when server is destroyed", async () => {
		io.destroy();

		expect(() => io.emit("broadcast", { text: "test" })).not.toThrow();
	});

	it("should timeout middleware and close socket when onMiddlewareTimeout is 'close'", async () => {
		io = new ByteSocket<TestEvents>(app, {
			serialization: "json",
			middlewareTimeout: 50,
			onMiddlewareTimeout: "close",
		});
		app.ws("/ws", io.handler);

		io.use((_socket, _ctx, _next) => {});

		const client = await createClient();
		client.send(JSON.stringify({ event: "echo", data: { message: "timeout" } }));

		await new Promise((r) => setTimeout(r, 100));
		expect(client.readyState).toBe(WebSocket.CLOSED);
	});

	it("should close socket when payload is null or not an object", async () => {
		const client = await createClient();

		client.send("42");

		await new Promise((r) => setTimeout(r, 100));
		expect(client.readyState).toBe(WebSocket.CLOSED);
	});

	it("should send a message to the client using socket.send()", async () => {
		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));
		const socket = Array.from(io.sockets.values())[0];

		const received: string[] = [];
		client.on("message", (data) => received.push(JSON.parse(data.toString())));

		socket.send({ event: "echo", data: { message: "direct" } });

		await vi.waitFor(() => {
			expect(received).toEqual([{ event: "echo", data: { message: "direct" } }]);
		});
		client.close();
	});

	it("should send typed event to client using socket.emit()", async () => {
		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));
		const socket = Array.from(io.sockets.values())[0];

		const received: string[] = [];
		client.on("message", (data) => received.push(JSON.parse(data.toString())));

		socket.emit("echo", { message: "typed" });

		await vi.waitFor(() => {
			expect(received).toEqual([{ event: "echo", data: { message: "typed" } }]);
		});
		client.close();
	});

	it("should send raw message to the client using socket.sendRaw()", async () => {
		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));
		const socket = Array.from(io.sockets.values())[0];

		const received: string[] = [];
		client.on("message", (data) => received.push(data.toString()));

		socket.sendRaw("RAW_DATA");

		await vi.waitFor(() => expect(received).toContain("RAW_DATA"));
		client.close();
	});

	it("should broadcast to all clients except the sender using socket.broadcast()", async () => {
		const sender = new WebSocket(`ws://localhost:${port}/ws`);
		const other = new WebSocket(`ws://localhost:${port}/ws`);

		await new Promise((r) => sender.on("open", r));
		await new Promise((r) => other.on("open", r));

		sender.on("message", (data) => senderMessages.push(JSON.parse(data.toString())));
		const otherMessagePromise = new Promise<void>((resolve) => {
			other.on("message", (data) => {
				otherMessages.push(JSON.parse(data.toString()));
				resolve();
			});
		});

		const senderSocket = Array.from(io.sockets.values())[0];
		const senderMessages: string[] = [];
		const otherMessages: string[] = [];

		senderSocket.broadcast("broadcast", { text: "except me" });

		await otherMessagePromise;
		expect(senderMessages.length).toBe(0);
		expect(otherMessages.length).toBe(1);

		sender.close();
		other.close();
	});

	it("should encode outgoing messages as binary when serialization is 'binary'", async () => {
		io = new ByteSocket<TestEvents>(app, { serialization: "binary" });
		app.ws("/ws", io.handler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		const rawMessages: Array<Buffer> = [];
		client.on("message", (data) => rawMessages.push(data as Buffer));
		await new Promise((r) => client.on("open", r));

		const socket = Array.from(io.sockets.values())[0];
		socket.emit("echo", { message: "binary" });

		await vi.waitFor(() => expect(rawMessages.length).toBe(1));

		const { Packr } = await import("msgpackr");
		const packr = new Packr({ useRecords: false });
		const unpacked = packr.unpack(rawMessages[0]);
		expect(unpacked).toEqual({ event: "echo", data: { message: "binary" } });
		client.close();
	});

	it("should catch synchronous errors in event listeners without triggering onError", async () => {
		const errorSpy = vi.fn();
		io.lifecycle.onError(errorSpy);

		const client = await createClient();

		io.on("echo", () => {
			throw new Error("listener crash");
		});

		expect(() => client.send(JSON.stringify({ event: "echo", data: { message: "test" } }))).not.toThrow();

		await new Promise((r) => setTimeout(r, 50));
		await vi.waitFor(() => expect(errorSpy).not.toHaveBeenCalled());
		client.close();
	});

	it("should log error in event listener when debug is enabled", async () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		io = new ByteSocket<TestEvents>(app, { debug: true, serialization: "json" });
		app.ws("/ws", io.handler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));

		io.on("echo", () => {
			throw new Error("listener crash");
		});

		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(consoleSpy).toHaveBeenCalled());
		consoleSpy.mockRestore();
		client.close();
	});

	it("should handle middleware that returns a resolved promise", async () => {
		const middleware = vi.fn((_socket, _ctx, _next) => {
			return Promise.resolve();
		});
		io.use(middleware);

		const echoHandler = vi.fn();
		io.on("echo", echoHandler);

		const client = await createClient();
		client.send(JSON.stringify({ event: "echo", data: { message: "promise" } }));

		await vi.waitFor(() => expect(echoHandler).toHaveBeenCalled());
		expect(middleware).toHaveBeenCalled();
		client.close();
	});

	it("should handle middleware that returns a rejected promise", async () => {
		const errorSpy = vi.fn();
		io.lifecycle.onError(errorSpy);

		io.use((_socket, _ctx, _next) => {
			return Promise.reject(new Error("Promise rejection"));
		});

		io.on("echo", vi.fn());

		const client = await createClient();
		client.send(JSON.stringify({ event: "echo", data: { message: "fail" } }));

		await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
		const [, ctx] = errorSpy.mock.calls[0];
		expect(ctx.phase).toBe("middleware");
		client.close();
	});

	it("should handle middleware that throws synchronously", async () => {
		const errorSpy = vi.fn();
		io.lifecycle.onError(errorSpy);

		io.use((_socket, _ctx, _next) => {
			throw new Error("Sync throw in middleware");
		});

		io.on("echo", vi.fn());

		const client = await createClient();
		client.send(JSON.stringify({ event: "echo", data: { message: "fail" } }));

		await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
		const [, ctx] = errorSpy.mock.calls[0];
		expect(ctx.phase).toBe("middleware");
		client.close();
	});

	it("should call custom onMiddlewareError function instead of closing", async () => {
		const customHandler = vi.fn();
		io = new ByteSocket<TestEvents>(app, {
			serialization: "json",
			onMiddlewareError: customHandler,
		});
		app.ws("/ws", io.handler);

		io.use((_socket, _ctx, next) => {
			next(new Error("Custom error"));
		});

		const client = await createClient();
		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(customHandler).toHaveBeenCalled());
		const [error, socket] = customHandler.mock.calls[0];
		expect(error.message).toBe("Custom error");
		expect(socket).toBeDefined();
		client.close();
	});

	it("should call custom onMiddlewareTimeout function on timeout", async () => {
		const customTimeout = vi.fn();
		io = new ByteSocket<TestEvents>(app, {
			serialization: "json",
			middlewareTimeout: 50,
			onMiddlewareTimeout: customTimeout,
		});
		app.ws("/ws", io.handler);

		io.use((_socket, _ctx, _next) => {});

		const client = await createClient();
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
		io.once("echo", handler);
		io.off("echo", handler);

		const client = await createClient();
		client.send(JSON.stringify({ event: "echo", data: { message: "x" } }));

		await new Promise((r) => setTimeout(r, 50));
		expect(handler).not.toHaveBeenCalled();
		client.close();
	});

	it("should do nothing when sendRaw is called on a closed socket", async () => {
		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];
		client.close();
		await vi.waitFor(() => expect(io.sockets.size).toBe(0));

		expect(() => socket.sendRaw("should not throw")).not.toThrow();
	});

	it("should handle callback that removes another listener during invocation", async () => {
		const handler2 = vi.fn();
		const remove = () => io.off("echo", handler2);
		const handler1 = vi.fn(() => remove());

		io.on("echo", handler1);
		io.on("echo", handler2);

		const client = await createClient();
		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(handler1).toHaveBeenCalled());
		expect(handler2).not.toHaveBeenCalled();
		client.close();
	});

	it("should decode binary message as JSON when isBinary is false", () => {
		const buffer = Buffer.from(JSON.stringify({ event: "echo", data: { message: "hello" } }));
		const result = io.decode(buffer as unknown as ArrayBuffer, false);
		expect(result).toEqual({ event: "echo", data: { message: "hello" } });
	});

	it("should throw when receiving a string but isBinary is true", () => {
		expect(() => io.decode("hello", true)).toThrow("Received string but expected binary");
	});
});
