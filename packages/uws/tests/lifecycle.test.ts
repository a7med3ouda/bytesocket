// packages/uws/tests/lifecycle.test.ts
import uWS from "uWebSockets.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { ByteSocket, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket uws: Lifecycle", () => {
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

	it("should emit onOpen event for each new connection", async () => {
		const openHandler = vi.fn();
		io.lifecycle.onOpen(openHandler);

		const client = await createClient();
		await vi.waitFor(() => expect(openHandler).toHaveBeenCalledTimes(1));
		const socket = openHandler.mock.calls[0][0];
		expect(socket).toBeDefined();

		client.close();
	});

	it("should emit onClose event when client disconnects", async () => {
		const closeHandler = vi.fn();
		io.lifecycle.onClose(closeHandler);

		const client = await createClient();
		await vi.waitFor(() => expect(io.sockets.size).toBe(1));

		client.close();

		await vi.waitFor(() => expect(closeHandler).toHaveBeenCalled());
		const [socket, code, _reason] = closeHandler.mock.calls[0];
		expect(socket).toBeDefined();
		expect(code).toBeGreaterThanOrEqual(1000);
	});

	it("should clean up all sockets on destroy", async () => {
		const _client1 = await createClient();
		const _client2 = await createClient();
		await vi.waitFor(() => expect(io.sockets.size).toBe(2));

		io.destroy();

		expect(io.sockets.size).toBe(0);
		expect(io.destroyed).toBe(true);
	});

	it("should emit onMessage lifecycle with raw data", async () => {
		const rawHandler = vi.fn();
		io.lifecycle.onMessage(rawHandler);

		const client = await createClient();
		client.send("raw message");

		await vi.waitFor(() => expect(rawHandler).toHaveBeenCalled());
		const [socket, data, isBinary] = rawHandler.mock.calls[0];
		expect(socket).toBeDefined();
		expect(data).toBeInstanceOf(ArrayBuffer);
		expect(isBinary).toBe(false);

		client.close();
	});

	it("should emit onError lifecycle when middleware calls next(error)", async () => {
		const errorHandler = vi.fn();
		io.lifecycle.onError(errorHandler);

		io.use((_socket, _ctx, next) => {
			next(new Error("Middleware error"));
		});

		const client = await createClient();
		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(errorHandler).toHaveBeenCalled());

		const [, ctx] = errorHandler.mock.calls[0];
		expect(ctx.phase).toBe("middleware");
		client.close();
	});

	it("should remove onClose listener with offClose", async () => {
		const closeHandler = vi.fn();
		io.lifecycle.onClose(closeHandler);
		io.lifecycle.offClose(closeHandler);

		const client = await createClient();
		await vi.waitFor(() => expect(io.sockets.size).toBe(1));

		client.close();
		await vi.waitFor(() => expect(io.sockets.size).toBe(0));
		expect(closeHandler).not.toHaveBeenCalled();
	});

	it("should call onceOpen listener only once", async () => {
		const openHandler = vi.fn();
		io.lifecycle.onceOpen(openHandler);

		const client1 = await createClient();
		await vi.waitFor(() => expect(openHandler).toHaveBeenCalledTimes(1));

		const client2 = await createClient();
		await new Promise((r) => setTimeout(r, 50));
		expect(openHandler).toHaveBeenCalledTimes(1);

		client1.close();
		client2.close();
	});

	it("should remove onOpen listener with offOpen", async () => {
		const openHandler = vi.fn();
		io.lifecycle.onOpen(openHandler);
		io.lifecycle.offOpen(openHandler);

		const client = await createClient();
		await new Promise((r) => setTimeout(r, 50));
		expect(openHandler).not.toHaveBeenCalled();
		client.close();
	});

	it("should expose connection metadata on socket", async () => {
		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		expect(socket.id).toBeTypeOf("string");
		expect(socket.userData).toBeDefined();
		expect(socket.url).toContain("/ws");
		expect(socket.isAuthenticated).toBe(true);
		expect(socket.canSend).toBe(true);
		expect(socket.isClosed).toBe(false);

		client.close();
	});

	it("should not throw when using socket after close", async () => {
		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		client.close();
		await vi.waitFor(() => expect(io.sockets.size).toBe(0));

		expect(() => socket.emit("echo", { message: "test" })).not.toThrow();
		expect(() => socket.rooms.join("lobby")).not.toThrow();
		expect(() => socket.close()).not.toThrow();
	});

	it("should not throw when closing a socket already removed from the map", async () => {
		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		io.sockets.delete(socket.id);
		client.close();

		await new Promise((r) => setTimeout(r, 50));
		expect(io.sockets.size).toBe(0);
	});

	it("should call destroy idempotently without errors", () => {
		expect(() => {
			io.destroy();
			io.destroy();
		}).not.toThrow();
		expect(io.destroyed).toBe(true);
	});

	it("should catch errors thrown in onOpen and trigger onError", async () => {
		const errorHandler = vi.fn();
		io.lifecycle.onError(errorHandler);

		io.lifecycle.onOpen(() => {
			throw new Error("open crash");
		});

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));

		await vi.waitFor(() => expect(errorHandler).toHaveBeenCalled());
		client.close();
	});

	it("should call onceUpgrade only once", async () => {
		const upgradeHandler = vi.fn((_res, _req, _data, _ctx) => {});
		io.lifecycle.onceUpgrade(upgradeHandler);

		const client1 = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client1.on("open", r));

		const client2 = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client2.on("open", r));

		expect(upgradeHandler).toHaveBeenCalledTimes(1);
		client1.close();
		client2.close();
	});

	it("should call onceMessage only once", async () => {
		const msgHandler = vi.fn();
		io.lifecycle.onceMessage(msgHandler);

		const client1 = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client1.on("open", r));
		client1.send("raw");

		const client2 = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client2.on("open", r));
		client2.send("raw");

		await vi.waitFor(() => expect(msgHandler).toHaveBeenCalledTimes(1));
		client1.close();
		client2.close();
	});

	it("should call onceClose only once", async () => {
		const closeHandler = vi.fn();
		io.lifecycle.onceClose(closeHandler);

		const client1 = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client1.on("open", r));
		client1.close();

		await new Promise((r) => setTimeout(r, 50));

		const client2 = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client2.on("open", r));
		client2.close();

		await new Promise((r) => setTimeout(r, 50));
		expect(closeHandler).toHaveBeenCalledTimes(1);
	});

	it("should call onceError only once", async () => {
		const errHandler = vi.fn();
		io.lifecycle.onceError(errHandler);

		const client1 = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client1.on("open", r));
		client1.send("not json");

		await new Promise((r) => setTimeout(r, 50));

		const client2 = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client2.on("open", r));
		client2.send("not json");

		await new Promise((r) => setTimeout(r, 50));
		expect(errHandler).toHaveBeenCalledTimes(1);
	});

	it("should remove onceClose listener with offClose", async () => {
		const handler = vi.fn();
		io.lifecycle.onceClose(handler);
		io.lifecycle.offClose(handler);

		const client = await createClient();
		client.close();

		await new Promise((r) => setTimeout(r, 50));
		expect(handler).not.toHaveBeenCalled();
	});

	it("should remove all error listeners with offError()", async () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		io.lifecycle.onError(handler1);
		io.lifecycle.onError(handler2);
		io.lifecycle.offError();

		const client = await createClient();
		client.send("not json");

		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
		expect(handler1).not.toHaveBeenCalled();
		expect(handler2).not.toHaveBeenCalled();
	});

	it("should remove upgrade handler with offUpgrade", () => {
		const handler = vi.fn();
		io.lifecycle.onUpgrade(handler);
		io.lifecycle.offUpgrade(handler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		return new Promise<void>((resolve) => {
			client.on("open", () => {
				expect(handler).not.toHaveBeenCalled();
				client.close();
				resolve();
			});
		});
	});
});
