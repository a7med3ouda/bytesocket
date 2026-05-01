// packages/server/src/test-utils/lifecycle.ts
import type * as vitest from "vitest";
import WebSocket from "ws";
import { createClient, type CreateByteSocketServerResponse, type TestEvents } from ".";
import type { ByteSocketServerBase } from "../byte-socket-server-base";

export function serverLifecycleTest<B extends ByteSocketServerBase<TestEvents> = ByteSocketServerBase<TestEvents>>(
	{ vi, afterEach, beforeEach, it, expect }: typeof vitest,
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

	it("should emit onOpen event for each new connection", async () => {
		const openHandler = vi.fn();
		obj.io.lifecycle.onOpen(openHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		await vi.waitFor(() => expect(openHandler).toHaveBeenCalledTimes(1));
		const socket = openHandler.mock.calls[0][0];
		expect(socket).toBeDefined();

		client.close();
	});

	it("should emit onClose event when client disconnects", async () => {
		const closeHandler = vi.fn();
		obj.io.lifecycle.onClose(closeHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(1));

		client.close();

		await vi.waitFor(() => expect(closeHandler).toHaveBeenCalled());
		const [socket, code, _reason] = closeHandler.mock.calls[0];
		expect(socket).toBeDefined();
		expect(code).toBeGreaterThanOrEqual(1000);
	});

	it("should clean up all sockets on destroy", async () => {
		obj.io.attach(obj.server, "/ws");

		await createClient(obj.port);
		await createClient(obj.port);
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(2));

		obj.io.destroy();

		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(0));
		await vi.waitFor(() => expect(obj.io.destroyed).toBe(true));
	});

	it("should emit onMessage lifecycle with raw data", async () => {
		const rawHandler = vi.fn();
		obj.io.lifecycle.onMessage(rawHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send("raw message");

		await vi.waitFor(() => expect(rawHandler).toHaveBeenCalled());
		const [socket, data, isBinary] = rawHandler.mock.calls[0];
		expect(socket).toBeDefined();
		expect(data instanceof Buffer || data instanceof ArrayBuffer).toBe(true);
		expect(isBinary).toBe(false);

		client.close();
	});

	it("should emit onError lifecycle when middleware calls next(error)", async () => {
		const errorHandler = vi.fn();
		obj.io.lifecycle.onError(errorHandler);

		obj.io.use((_socket, _ctx, next) => {
			next(new Error("Middleware error"));
		});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ event: "echo", data: { message: "test" } }));

		await vi.waitFor(() => expect(errorHandler).toHaveBeenCalled());

		const [, ctx] = errorHandler.mock.calls[0];
		expect(ctx.phase).toBe("middleware");
		client.close();
	});

	it("should remove onClose listener with offClose", async () => {
		const closeHandler = vi.fn();
		obj.io.lifecycle.onClose(closeHandler);
		obj.io.lifecycle.offClose(closeHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(1));

		client.close();
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(0));
		await vi.waitFor(() => expect(closeHandler).not.toHaveBeenCalled());
	});

	it("should call onceOpen listener only once", async () => {
		const openHandler = vi.fn();
		obj.io.lifecycle.onceOpen(openHandler);

		obj.io.attach(obj.server, "/ws");

		const client1 = await createClient(obj.port);
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(1));
		await vi.waitFor(() => expect(openHandler).toHaveBeenCalledTimes(1));

		const client2 = await createClient(obj.port);
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(2));
		await vi.waitFor(() => expect(openHandler).toHaveBeenCalledTimes(1));

		client1.close();
		client2.close();
	});

	it("should remove onOpen listener with offOpen", async () => {
		const openHandler = vi.fn();
		obj.io.lifecycle.onOpen(openHandler);
		obj.io.lifecycle.offOpen(openHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(1));
		await vi.waitFor(() => expect(openHandler).not.toHaveBeenCalled());
		client.close();
	});

	it("should expose connection metadata on socket", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

		expect(socket.id).toBeTypeOf("string");
		expect(socket.userData).toBeDefined();
		expect(socket.url).toContain("/ws");
		expect(socket.isAuthenticated).toBe(true);
		expect(socket.canSend).toBe(true);
		expect(socket.isClosed).toBe(false);

		client.close();
	});

	it("should not throw when using socket after close", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

		client.close();
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(0));

		expect(() => socket.emit("echo", { message: "test" })).not.toThrow();
		expect(() => socket.rooms.join("lobby")).not.toThrow();
		expect(() => socket.close()).not.toThrow();
	});

	it("should not throw when closing a socket already removed from the map", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

		obj.io.sockets.delete(socket.id);
		client.close();

		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(0));
	});

	it("should call destroy idempotently without errors", async () => {
		obj.io.attach(obj.server, "/ws");

		expect(() => {
			obj.io.destroy();
			obj.io.destroy();
		}).not.toThrow();
		await vi.waitFor(() => expect(obj.io.destroyed).toBe(true));
	});

	it("should catch errors thrown in onOpen and trigger onError", async () => {
		const errorHandler = vi.fn();
		obj.io.lifecycle.onError(errorHandler);

		obj.io.lifecycle.onOpen(() => {
			throw new Error("open crash");
		});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		await vi.waitFor(() => expect(errorHandler).toHaveBeenCalled());
		client.close();
	});

	it("should call onceUpgrade only once", async () => {
		const upgradeHandler = vi.fn((_res, _req, _data, _ctx) => {});
		obj.io.lifecycle.onceUpgrade(upgradeHandler);

		obj.io.attach(obj.server, "/ws");

		const client1 = await createClient(obj.port);
		const client2 = await createClient(obj.port);

		await vi.waitFor(() => expect(upgradeHandler).toHaveBeenCalledTimes(1));
		client1.close();
		client2.close();
	});

	it("should call onceMessage only once", async () => {
		const msgHandler = vi.fn();
		obj.io.lifecycle.onceMessage(msgHandler);

		obj.io.attach(obj.server, "/ws");

		const client1 = await createClient(obj.port);
		client1.send("raw");

		const client2 = await createClient(obj.port);
		client2.send("raw");

		await vi.waitFor(() => expect(msgHandler).toHaveBeenCalledTimes(1));
		client1.close();
		client2.close();
	});

	it("should call onceClose only once", async () => {
		const closeHandler = vi.fn();
		obj.io.lifecycle.onceClose(closeHandler);

		obj.io.attach(obj.server, "/ws");

		const client1 = await createClient(obj.port);
		client1.close();

		const client2 = await createClient(obj.port);
		client2.close();

		await vi.waitFor(() => expect(closeHandler).toHaveBeenCalledTimes(1));
	});

	it("should call onceError only once", async () => {
		const errHandler = vi.fn();
		obj.io.lifecycle.onceError(errHandler);

		obj.io.attach(obj.server, "/ws");

		const client1 = await createClient(obj.port);
		client1.send("not json");

		const client2 = await createClient(obj.port);
		client2.send("not json");

		await vi.waitFor(() => expect(errHandler).toHaveBeenCalledTimes(1));
	});

	it("should remove onceClose listener with offClose", async () => {
		const handler = vi.fn();
		obj.io.lifecycle.onceClose(handler);
		obj.io.lifecycle.offClose(handler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.close();

		await vi.waitFor(() => expect(handler).not.toHaveBeenCalled());
	});

	it("should remove all error listeners with offError()", async () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		obj.io.lifecycle.onError(handler1);
		obj.io.lifecycle.onError(handler2);
		obj.io.lifecycle.offError();

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send("not json");

		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
		expect(handler1).not.toHaveBeenCalled();
		expect(handler2).not.toHaveBeenCalled();
	});

	it("should remove upgrade handler with offUpgrade", () => {
		const handler = vi.fn();
		obj.io.lifecycle.onUpgrade(handler);
		obj.io.lifecycle.offUpgrade(handler);

		obj.io.attach(obj.server, "/ws");

		const client = new WebSocket(`ws://localhost:${obj.port}/ws`);
		return new Promise<void>((resolve) => {
			client.on("open", () => {
				expect(handler).not.toHaveBeenCalled();
				client.close();
				resolve();
			});
		});
	});
}
