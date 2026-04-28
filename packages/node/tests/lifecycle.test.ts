// packages/node/tests/lifecycle.test.ts
import { createServer, Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket, { type AddressInfo } from "ws";
import { ByteSocket, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket node: Lifecycle", () => {
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

		io.attach(server, "/ws");

		const client = await createClient();
		await vi.waitFor(() => expect(openHandler).toHaveBeenCalledTimes(1));
		const socket = openHandler.mock.calls[0][0];
		expect(socket).toBeDefined();

		client.close();
	});

	it("should emit onClose event when client disconnects", async () => {
		const closeHandler = vi.fn();
		io.lifecycle.onClose(closeHandler);

		io.attach(server, "/ws");

		const client = await createClient();
		await vi.waitFor(() => expect(io.sockets.size).toBe(1));

		client.close();

		await vi.waitFor(() => expect(closeHandler).toHaveBeenCalled());
		const [socket, code, _reason] = closeHandler.mock.calls[0];
		expect(socket).toBeDefined();
		expect(code).toBeGreaterThanOrEqual(1000);
	});

	it("should clean up all sockets on destroy", async () => {
		io.attach(server, "/ws");

		await createClient();
		await createClient();
		await vi.waitFor(() => expect(io.sockets.size).toBe(2));

		io.destroy();

		await vi.waitFor(() => expect(io.sockets.size).toBe(0));
		await vi.waitFor(() => expect(io.destroyed).toBe(true));
	});

	it("should emit onMessage lifecycle with raw data", async () => {
		const rawHandler = vi.fn();
		io.lifecycle.onMessage(rawHandler);

		io.attach(server, "/ws");

		const client = await createClient();
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
		io.lifecycle.onError(errorHandler);

		io.use((_socket, _ctx, next) => {
			next(new Error("Middleware error"));
		});

		io.attach(server, "/ws");

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

		io.attach(server, "/ws");

		const client = await createClient();
		await vi.waitFor(() => expect(io.sockets.size).toBe(1));

		client.close();
		await vi.waitFor(() => expect(io.sockets.size).toBe(0));
		await vi.waitFor(() => expect(closeHandler).not.toHaveBeenCalled());
	});

	it("should call onceOpen listener only once", async () => {
		const openHandler = vi.fn();
		io.lifecycle.onceOpen(openHandler);

		io.attach(server, "/ws");

		const client1 = await createClient();
		await vi.waitFor(() => expect(io.sockets.size).toBe(1));
		await vi.waitFor(() => expect(openHandler).toHaveBeenCalledTimes(1));

		const client2 = await createClient();
		await vi.waitFor(() => expect(io.sockets.size).toBe(2));
		await vi.waitFor(() => expect(openHandler).toHaveBeenCalledTimes(1));

		client1.close();
		client2.close();
	});

	it("should remove onOpen listener with offOpen", async () => {
		const openHandler = vi.fn();
		io.lifecycle.onOpen(openHandler);
		io.lifecycle.offOpen(openHandler);

		io.attach(server, "/ws");

		const client = await createClient();
		await vi.waitFor(() => expect(io.sockets.size).toBe(1));
		await vi.waitFor(() => expect(openHandler).not.toHaveBeenCalled());
		client.close();
	});

	it("should expose connection metadata on socket", async () => {
		io.attach(server, "/ws");

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
		io.attach(server, "/ws");

		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		client.close();
		await vi.waitFor(() => expect(io.sockets.size).toBe(0));

		expect(() => socket.emit("echo", { message: "test" })).not.toThrow();
		expect(() => socket.rooms.join("lobby")).not.toThrow();
		expect(() => socket.close()).not.toThrow();
	});

	it("should not throw when closing a socket already removed from the map", async () => {
		io.attach(server, "/ws");

		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		io.sockets.delete(socket.id);
		client.close();

		await vi.waitFor(() => expect(io.sockets.size).toBe(0));
	});

	it("should call destroy idempotently without errors", async () => {
		io.attach(server, "/ws");

		expect(() => {
			io.destroy();
			io.destroy();
		}).not.toThrow();
		await vi.waitFor(() => expect(io.destroyed).toBe(true));
	});

	it("should catch errors thrown in onOpen and trigger onError", async () => {
		const errorHandler = vi.fn();
		io.lifecycle.onError(errorHandler);

		io.lifecycle.onOpen(() => {
			throw new Error("open crash");
		});

		io.attach(server, "/ws");

		const client = await createClient();

		await vi.waitFor(() => expect(errorHandler).toHaveBeenCalled());
		client.close();
	});

	it("should call onceUpgrade only once", async () => {
		const upgradeHandler = vi.fn((_res, _req, _data, _ctx) => {});
		io.lifecycle.onceUpgrade(upgradeHandler);

		io.attach(server, "/ws");

		const client1 = await createClient();
		const client2 = await createClient();

		await vi.waitFor(() => expect(upgradeHandler).toHaveBeenCalledTimes(1));
		client1.close();
		client2.close();
	});

	it("should call onceMessage only once", async () => {
		const msgHandler = vi.fn();
		io.lifecycle.onceMessage(msgHandler);

		io.attach(server, "/ws");

		const client1 = await createClient();
		client1.send("raw");

		const client2 = await createClient();
		client2.send("raw");

		await vi.waitFor(() => expect(msgHandler).toHaveBeenCalledTimes(1));
		client1.close();
		client2.close();
	});

	it("should call onceClose only once", async () => {
		const closeHandler = vi.fn();
		io.lifecycle.onceClose(closeHandler);

		io.attach(server, "/ws");

		const client1 = await createClient();
		client1.close();

		const client2 = await createClient();
		client2.close();

		await vi.waitFor(() => expect(closeHandler).toHaveBeenCalledTimes(1));
	});

	it("should call onceError only once", async () => {
		const errHandler = vi.fn();
		io.lifecycle.onceError(errHandler);

		io.attach(server, "/ws");

		const client1 = await createClient();
		client1.send("not json");

		const client2 = await createClient();
		client2.send("not json");

		await vi.waitFor(() => expect(errHandler).toHaveBeenCalledTimes(1));
	});

	it("should remove onceClose listener with offClose", async () => {
		const handler = vi.fn();
		io.lifecycle.onceClose(handler);
		io.lifecycle.offClose(handler);

		io.attach(server, "/ws");

		const client = await createClient();
		client.close();

		await vi.waitFor(() => expect(handler).not.toHaveBeenCalled());
	});

	it("should remove all error listeners with offError()", async () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		io.lifecycle.onError(handler1);
		io.lifecycle.onError(handler2);
		io.lifecycle.offError();

		io.attach(server, "/ws");

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

		io.attach(server, "/ws");

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
