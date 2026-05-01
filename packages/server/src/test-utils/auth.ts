// packages/server/src/test-utils/auth.ts
import { LifecycleTypes } from "@bytesocket/core";
import type * as vitest from "vitest";
import WebSocket from "ws";
import { createClient, type CreateByteSocketServerResponse, type TestEvents } from ".";
import type { ByteSocketServerBase } from "../byte-socket-server-base";
import type { ByteSocketOptionsBase } from "../types";

export function serverAuthTest<B extends ByteSocketServerBase<TestEvents> = ByteSocketServerBase<TestEvents>>(
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

	it("should authenticate clients with valid token", async () => {
		const authFn = vi.fn((_socket, data, cb) => {
			if (data.token === "secret") {
				cb({ userId: 1 });
			} else {
				cb(null, new Error("Invalid token"));
			}
		});

		obj.io = createByteSocket({ auth: authFn, serialization: "json" });

		const authSuccessHandler = vi.fn();
		obj.io.lifecycle.onAuthSuccess(authSuccessHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

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

		obj.io = createByteSocket({ auth: authFn, serialization: "json" });

		const authErrorHandler = vi.fn();
		obj.io.lifecycle.onAuthError(authErrorHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "wrong" } }));

		await vi.waitFor(() => expect(authErrorHandler).toHaveBeenCalled());
		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
	});

	it("should timeout authentication when client does not respond in time", async () => {
		const authFn = vi.fn();
		obj.io = createByteSocket({ auth: authFn, authTimeout: 50, serialization: "json" });

		const authErrorHandler = vi.fn();
		obj.io.lifecycle.onAuthError(authErrorHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

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
		obj.io = createByteSocket({ auth: authFn, serialization: "json" });

		const handler = vi.fn();
		obj.io.lifecycle.onceAuthSuccess(handler);

		obj.io.attach(obj.server, "/ws");

		const client1 = await createClient(obj.port);
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(1));
		client1.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "secret" } }));
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

		const client2 = await createClient(obj.port);
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(2));
		client2.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "secret" } }));
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

		client1.close();
		client2.close();
	});

	it("should remove auth error listener with offAuthError", async () => {
		const authFn = vi.fn((_socket, _data, cb) => {
			cb(null, new Error("Invalid token"));
		});
		obj.io = createByteSocket({ auth: authFn, serialization: "json" });

		const handler = vi.fn();
		obj.io.lifecycle.onAuthError(handler);
		obj.io.lifecycle.offAuthError(handler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "wrong" } }));

		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
		await vi.waitFor(() => expect(handler).not.toHaveBeenCalled());
	});

	it("should fail when auth function throws synchronously", async () => {
		const authFn = vi.fn((_socket, _data, _cb) => {
			throw new Error("Sync error");
		});
		obj.io = createByteSocket({ auth: authFn, serialization: "json" });

		const authErrorHandler = vi.fn();
		obj.io.lifecycle.onAuthError(authErrorHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "any" } }));

		await vi.waitFor(() => expect(authErrorHandler).toHaveBeenCalled());
		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
	});

	it("should success when auth callback receives null payload", async () => {
		const authFn = vi.fn((_socket, _data, cb) => {
			cb(null);
		});
		obj.io = createByteSocket({ auth: authFn, serialization: "json" });

		const authSuccessHandler = vi.fn();
		obj.io.lifecycle.onAuthSuccess(authSuccessHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));

		await vi.waitFor(() => expect(authSuccessHandler).toHaveBeenCalled());
	});

	it("should ignore duplicate auth messages from the same client", async () => {
		const authFn = vi.fn((_socket, data, cb) => {
			if (data.token === "secret") {
				cb({ userId: 1 });
			} else {
				cb(null, new Error("Invalid token"));
			}
		});
		obj.io = createByteSocket({ auth: authFn, serialization: "json" });

		const authSuccessHandler = vi.fn();
		obj.io.lifecycle.onAuthSuccess(authSuccessHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(1));

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
		obj.io = createByteSocket({ auth: authFn, authTimeout: 50, serialization: "json" });

		const authErrorHandler = vi.fn();
		obj.io.lifecycle.onAuthError(authErrorHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));

		client.close();
		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));

		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(0));
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
		obj.io = createByteSocket({ auth: authFn, serialization: "json" });

		const successHandler = vi.fn();
		obj.io.lifecycle.onAuthSuccess(successHandler);
		obj.io.lifecycle.offAuthSuccess(successHandler);

		const errorHandler = vi.fn();
		obj.io.lifecycle.onceAuthError(errorHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(1));

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "wrong" } }));

		await vi.waitFor(() => expect(errorHandler).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(successHandler).not.toHaveBeenCalled());

		const client2 = await createClient(obj.port);
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(1));
		client2.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "wrong" } }));
		await vi.waitFor(() => expect(errorHandler).toHaveBeenCalledTimes(1));

		client.close();
		client2.close();
	});

	it("should not send or join rooms while authentication is pending", async () => {
		const authFn = vi.fn((_socket, _data, _cb) => {});
		obj.io = createByteSocket({
			auth: authFn,
			authTimeout: 1000,
			serialization: "json",
		});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));

		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(1));

		const socket = Array.from(obj.io.sockets.values())[0];
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
		obj.io = createByteSocket({
			auth: authFn,
			authTimeout: 1000,
			serialization: "json",
		});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const listener = await createClient(obj.port);

		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(2));

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));

		const socket = Array.from(obj.io.sockets.values())[0];
		await vi.waitFor(() => expect(socket.isAuthenticated).toBe(false));
		await vi.waitFor(() => expect(socket.canSend).toBe(false));

		const listenerSocket = Array.from(obj.io.sockets.values())[1];
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
		obj.io = createByteSocket({
			auth: authFn,
			authTimeout: 50,
			debug: true,
			serialization: "json",
		});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));

		await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
		warnSpy.mockRestore();
	});

	it("should ignore auth message when no auth is configured (socket already open)", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];
		await vi.waitFor(() => expect(socket.isAuthenticated).toBe(true));

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "any" } }));

		await vi.waitFor(() => expect(socket.isClosed).toBe(false));
		client.close();
	});
}
