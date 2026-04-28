// packages/node/tests/auth.test.ts
import { createServer, Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket, { type AddressInfo } from "ws";
import { ByteSocket, LifecycleTypes, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket node: Auth", () => {
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

	it("should authenticate clients with valid token", async () => {
		const authFn = vi.fn((_socket, data, cb) => {
			if (data.token === "secret") {
				cb({ userId: 1 });
			} else {
				cb(null, new Error("Invalid token"));
			}
		});

		io = new ByteSocket<TestEvents>({ auth: authFn, serialization: "json" });

		const authSuccessHandler = vi.fn();
		io.lifecycle.onAuthSuccess(authSuccessHandler);

		io.attach(server, "/ws");

		const client = await createClient();

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "secret" } }));

		await vi.waitFor(() => expect(authSuccessHandler).toHaveBeenCalled());
		const socket = authSuccessHandler.mock.calls[0][0];
		await vi.waitFor(() => expect(socket.payload).toEqual({ userId: 1 }));

		client.close();
	});

	it("should reject clients with invalid token", async () => {
		const authFn = vi.fn((_socket, data, cb) => {
			if (data.token === "secret") {
				cb({ userId: 1 });
			} else {
				cb(null, new Error("Invalid token"));
			}
		});

		io = new ByteSocket<TestEvents>({ auth: authFn, serialization: "json" });

		const authErrorHandler = vi.fn();
		io.lifecycle.onAuthError(authErrorHandler);

		io.attach(server, "/ws");

		const client = await createClient();

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "wrong" } }));

		await vi.waitFor(() => expect(authErrorHandler).toHaveBeenCalled());
		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
	});

	it("should timeout authentication when client does not respond in time", async () => {
		const authFn = vi.fn();
		io = new ByteSocket<TestEvents>({ auth: authFn, authTimeout: 50, serialization: "json" });

		const authErrorHandler = vi.fn();
		io.lifecycle.onAuthError(authErrorHandler);

		io.attach(server, "/ws");

		const client = await createClient();

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));

		await vi.waitFor(() => expect(authErrorHandler).toHaveBeenCalled());
		const ctx = authErrorHandler.mock.calls[0][1];
		await vi.waitFor(() => expect(ctx).toMatchObject({ phase: "auth", error: expect.any(Error) }));
		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
	});

	it("should call onceAuthSuccess only once", async () => {
		const authFn = vi.fn((_socket, data, cb) => {
			if (data.token === "secret") {
				cb({ userId: 1 });
			} else {
				cb(null, new Error("Invalid token"));
			}
		});
		io = new ByteSocket<TestEvents>({ auth: authFn, serialization: "json" });

		const handler = vi.fn();
		io.lifecycle.onceAuthSuccess(handler);

		io.attach(server, "/ws");

		const client1 = await createClient();
		await vi.waitFor(() => expect(io.sockets.size).toBe(1));
		client1.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "secret" } }));
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

		const client2 = await createClient();
		await vi.waitFor(() => expect(io.sockets.size).toBe(2));
		client2.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "secret" } }));
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

		client1.close();
		client2.close();
	});

	it("should remove auth error listener with offAuthError", async () => {
		const authFn = vi.fn((_socket, _data, cb) => {
			cb(null, new Error("Invalid token"));
		});
		io = new ByteSocket<TestEvents>({ auth: authFn, serialization: "json" });

		const handler = vi.fn();
		io.lifecycle.onAuthError(handler);
		io.lifecycle.offAuthError(handler);

		io.attach(server, "/ws");

		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "wrong" } }));

		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
		await vi.waitFor(() => expect(handler).not.toHaveBeenCalled());
	});

	it("should fail when auth function throws synchronously", async () => {
		const authFn = vi.fn((_socket, _data, _cb) => {
			throw new Error("Sync error");
		});
		io = new ByteSocket<TestEvents>({ auth: authFn, serialization: "json" });

		const authErrorHandler = vi.fn();
		io.lifecycle.onAuthError(authErrorHandler);

		io.attach(server, "/ws");

		const client = await createClient();

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "any" } }));

		await vi.waitFor(() => expect(authErrorHandler).toHaveBeenCalled());
		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
	});

	it("should fail when auth callback receives null payload", async () => {
		const authFn = vi.fn((_socket, _data, cb) => {
			cb(null);
		});
		io = new ByteSocket<TestEvents>({ auth: authFn, serialization: "json" });

		const authErrorHandler = vi.fn();
		io.lifecycle.onAuthError(authErrorHandler);

		io.attach(server, "/ws");

		const client = await createClient();

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));

		await vi.waitFor(() => expect(authErrorHandler).toHaveBeenCalled());
		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
	});

	it("should ignore duplicate auth messages from the same client", async () => {
		const authFn = vi.fn((_socket, data, cb) => {
			if (data.token === "secret") {
				cb({ userId: 1 });
			} else {
				cb(null, new Error("Invalid token"));
			}
		});
		io = new ByteSocket<TestEvents>({ auth: authFn, serialization: "json" });

		const authSuccessHandler = vi.fn();
		io.lifecycle.onAuthSuccess(authSuccessHandler);

		io.attach(server, "/ws");

		const client = await createClient();
		await vi.waitFor(() => expect(io.sockets.size).toBe(1));

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "secret" } }));
		await vi.waitFor(() => expect(authSuccessHandler).toHaveBeenCalledTimes(1));

		authFn.mockClear();
		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "secret" } }));
		await vi.waitFor(() => expect(authFn).not.toHaveBeenCalled());
		await vi.waitFor(() => expect(authSuccessHandler).toHaveBeenCalledTimes(1));

		client.close();
	});

	it("should not trigger auth timeout if socket is already closed", async () => {
		const authFn = vi.fn((_socket, _data, _cb) => {});
		io = new ByteSocket<TestEvents>({ auth: authFn, authTimeout: 50, serialization: "json" });

		const authErrorHandler = vi.fn();
		io.lifecycle.onAuthError(authErrorHandler);

		io.attach(server, "/ws");

		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));

		client.close();
		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));

		await vi.waitFor(() => expect(io.sockets.size).toBe(0));
		await vi.waitFor(() => expect(authErrorHandler).not.toHaveBeenCalled());
	});

	it("should support offAuthSuccess and onceAuthError life-cycle methods", async () => {
		const authFn = vi.fn((_socket, data, cb) => {
			if (data.token === "secret") {
				cb({ userId: 1 });
			} else {
				cb(null, new Error("Invalid token"));
			}
		});
		io = new ByteSocket<TestEvents>({ auth: authFn, serialization: "json" });

		const successHandler = vi.fn();
		io.lifecycle.onAuthSuccess(successHandler);
		io.lifecycle.offAuthSuccess(successHandler);

		const errorHandler = vi.fn();
		io.lifecycle.onceAuthError(errorHandler);

		io.attach(server, "/ws");

		const client = await createClient();

		await vi.waitFor(() => expect(io.sockets.size).toBe(1));

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "wrong" } }));

		await vi.waitFor(() => expect(errorHandler).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(successHandler).not.toHaveBeenCalled());

		const client2 = await createClient();
		await vi.waitFor(() => expect(io.sockets.size).toBe(1));
		client2.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "wrong" } }));
		await vi.waitFor(() => expect(errorHandler).toHaveBeenCalledTimes(1));

		client.close();
		client2.close();
	});

	it("should not send or join rooms while authentication is pending", async () => {
		const authFn = vi.fn((_socket, _data, _cb) => {});
		io = new ByteSocket<TestEvents>({
			auth: authFn,
			authTimeout: 1000,
			serialization: "json",
		});

		io.attach(server, "/ws");

		const client = await createClient();

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));

		await vi.waitFor(() => expect(io.sockets.size).toBe(1));

		const socket = Array.from(io.sockets.values())[0];
		await vi.waitFor(() => expect(socket.isAuthenticated).toBe(false));
		await vi.waitFor(() => expect(socket.canSend).toBe(false));

		expect(() => socket.emit("echo", { message: "nope" })).not.toThrow();
		expect(() => socket.send({ event: "echo", data: { message: "nope" } })).not.toThrow();
		expect(() => socket.broadcast("broadcast", { text: "nope" })).not.toThrow();
		expect(() => socket.rooms.join("room")).not.toThrow();

		expect(socket.rooms.list()).not.toContain("room");

		client.close();
	});

	it("should not send, join, or emit to rooms while authentication is pending", async () => {
		const authFn = vi.fn((_socket, _data, _cb) => {});
		io = new ByteSocket<TestEvents>({
			auth: authFn,
			authTimeout: 1000,
			serialization: "json",
		});

		io.attach(server, "/ws");

		const client = await createClient();
		const listener = await createClient();

		await vi.waitFor(() => expect(io.sockets.size).toBe(2));

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));

		const socket = Array.from(io.sockets.values())[0];
		await vi.waitFor(() => expect(socket.isAuthenticated).toBe(false));
		await vi.waitFor(() => expect(socket.canSend).toBe(false));

		const listenerSocket = Array.from(io.sockets.values())[1];
		listenerSocket.rooms.join("test-room");

		const listenerMessages: string[] = [];
		listener.on("message", (data) => listenerMessages.push(JSON.parse(data.toString())));

		socket.rooms.emit("test-room", "echo", { message: "should not send" });
		socket.rooms.bulk.emit(["test-room"], "echo", { message: "bulk nope" });

		await vi.waitFor(() => expect(listenerMessages).toEqual([]));

		client.close();
		listener.close();
	});

	it("should log auth timeout warning when debug is enabled", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const authFn = vi.fn((_socket, _data, _cb) => {});
		io = new ByteSocket<TestEvents>({
			auth: authFn,
			authTimeout: 50,
			debug: true,
			serialization: "json",
		});

		io.attach(server, "/ws");

		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));

		await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
		warnSpy.mockRestore();
	});

	it("should ignore auth message when no auth is configured (socket already open)", async () => {
		io.attach(server, "/ws");

		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];
		await vi.waitFor(() => expect(socket.isAuthenticated).toBe(true));

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "any" } }));

		await vi.waitFor(() => expect(socket.isClosed).toBe(false));
		client.close();
	});
});
