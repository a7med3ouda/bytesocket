// packages/uws/tests/auth.test.ts
import uWS from "uWebSockets.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { ByteSocket, LifecycleTypes, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket uws: Auth", () => {
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

	it("should authenticate clients with valid token", async () => {
		const authFn = vi.fn((_socket, data, cb) => {
			if (data.token === "secret") {
				cb({ userId: 1 });
			} else {
				cb(null, new Error("Invalid token"));
			}
		});

		io = new ByteSocket<TestEvents>(app, { auth: authFn, serialization: "json" });
		app.ws("/ws", io.handler);

		const authSuccessHandler = vi.fn();
		io.lifecycle.onAuthSuccess(authSuccessHandler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((resolve) => client.on("open", resolve));

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "secret" } }));

		await vi.waitFor(() => expect(authSuccessHandler).toHaveBeenCalled());
		const socket = authSuccessHandler.mock.calls[0][0];
		expect(socket.payload).toEqual({ userId: 1 });

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

		io = new ByteSocket<TestEvents>(app, { auth: authFn, serialization: "json" });
		app.ws("/ws", io.handler);

		const authErrorHandler = vi.fn();
		io.lifecycle.onAuthError(authErrorHandler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "wrong" } }));

		await vi.waitFor(() => expect(authErrorHandler).toHaveBeenCalled());
		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
	});

	it("should timeout authentication when client does not respond in time", async () => {
		const authFn = vi.fn();
		io = new ByteSocket<TestEvents>(app, { auth: authFn, authTimeout: 50, serialization: "json" });
		app.ws("/ws", io.handler);

		const authErrorHandler = vi.fn();
		io.lifecycle.onAuthError(authErrorHandler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));

		await vi.waitFor(() => expect(authErrorHandler).toHaveBeenCalled());
		const ctx = authErrorHandler.mock.calls[0][1];
		expect(ctx).toMatchObject({ phase: "auth", error: expect.any(Error) });
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
		io = new ByteSocket<TestEvents>(app, { auth: authFn, serialization: "json" });
		app.ws("/ws", io.handler);

		const handler = vi.fn();
		io.lifecycle.onceAuthSuccess(handler);

		const client1 = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client1.on("open", r));
		client1.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "secret" } }));
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

		const client2 = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client2.on("open", r));
		client2.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "secret" } }));
		await new Promise((r) => setTimeout(r, 50));
		expect(handler).toHaveBeenCalledTimes(1);

		client1.close();
		client2.close();
	});

	it("should remove auth error listener with offAuthError", async () => {
		const authFn = vi.fn((_socket, _data, cb) => {
			cb(null, new Error("Invalid token"));
		});
		io = new ByteSocket<TestEvents>(app, { auth: authFn, serialization: "json" });
		app.ws("/ws", io.handler);

		const handler = vi.fn();
		io.lifecycle.onAuthError(handler);
		io.lifecycle.offAuthError(handler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));
		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "wrong" } }));

		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
		expect(handler).not.toHaveBeenCalled();
	});

	it("should fail when auth function throws synchronously", async () => {
		const authFn = vi.fn((_socket, _data, _cb) => {
			throw new Error("Sync error");
		});
		io = new ByteSocket<TestEvents>(app, { auth: authFn, serialization: "json" });
		app.ws("/ws", io.handler);

		const authErrorHandler = vi.fn();
		io.lifecycle.onAuthError(authErrorHandler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));
		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "any" } }));

		await vi.waitFor(() => expect(authErrorHandler).toHaveBeenCalled());
		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
	});

	it("should fail when auth callback receives null payload", async () => {
		const authFn = vi.fn((_socket, _data, cb) => {
			cb(null);
		});
		io = new ByteSocket<TestEvents>(app, { auth: authFn, serialization: "json" });
		app.ws("/ws", io.handler);

		const authErrorHandler = vi.fn();
		io.lifecycle.onAuthError(authErrorHandler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));
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
		io = new ByteSocket<TestEvents>(app, { auth: authFn, serialization: "json" });
		app.ws("/ws", io.handler);

		const authSuccessHandler = vi.fn();
		io.lifecycle.onAuthSuccess(authSuccessHandler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "secret" } }));
		await vi.waitFor(() => expect(authSuccessHandler).toHaveBeenCalledTimes(1));

		authFn.mockClear();
		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "secret" } }));
		await new Promise((r) => setTimeout(r, 50));
		expect(authFn).not.toHaveBeenCalled();
		expect(authSuccessHandler).toHaveBeenCalledTimes(1);

		client.close();
	});

	it("should not trigger auth timeout if socket is already closed", async () => {
		const authFn = vi.fn((_socket, _data, _cb) => {});
		io = new ByteSocket<TestEvents>(app, { auth: authFn, authTimeout: 50, serialization: "json" });
		app.ws("/ws", io.handler);

		const authErrorHandler = vi.fn();
		io.lifecycle.onAuthError(authErrorHandler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));
		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));

		client.close();
		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));

		await new Promise((r) => setTimeout(r, 100));
		expect(authErrorHandler).not.toHaveBeenCalled();
	});

	it("should support offAuthSuccess and onceAuthError life-cycle methods", async () => {
		const authFn = vi.fn((_socket, data, cb) => {
			if (data.token === "secret") {
				cb({ userId: 1 });
			} else {
				cb(null, new Error("Invalid token"));
			}
		});
		io = new ByteSocket<TestEvents>(app, { auth: authFn, serialization: "json" });
		app.ws("/ws", io.handler);

		const successHandler = vi.fn();
		io.lifecycle.onAuthSuccess(successHandler);
		io.lifecycle.offAuthSuccess(successHandler);

		const errorHandler = vi.fn();
		io.lifecycle.onceAuthError(errorHandler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "wrong" } }));

		await vi.waitFor(() => expect(errorHandler).toHaveBeenCalledTimes(1));
		expect(successHandler).not.toHaveBeenCalled();

		const client2 = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client2.on("open", r));
		client2.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "wrong" } }));
		await new Promise((r) => setTimeout(r, 50));
		expect(errorHandler).toHaveBeenCalledTimes(1);

		client.close();
		client2.close();
	});

	it("should not send or join rooms while authentication is pending", async () => {
		const authFn = vi.fn((_socket, _data, _cb) => {});
		io = new ByteSocket<TestEvents>(app, {
			auth: authFn,
			authTimeout: 1000,
			serialization: "json",
		});
		app.ws("/ws", io.handler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));
		await new Promise((r) => setTimeout(r, 20));

		const socket = Array.from(io.sockets.values())[0];
		expect(socket.isAuthenticated).toBe(false);
		expect(socket.canSend).toBe(false);

		expect(() => socket.emit("echo", { message: "nope" })).not.toThrow();
		expect(() => socket.send({ event: "echo", data: { message: "nope" } })).not.toThrow();
		expect(() => socket.broadcast("broadcast", { text: "nope" })).not.toThrow();
		expect(() => socket.rooms.join("room")).not.toThrow();

		expect(socket.rooms.list()).not.toContain("room");

		client.close();
	});

	it("should not send, join, or emit to rooms while authentication is pending", async () => {
		const authFn = vi.fn((_socket, _data, _cb) => {});
		io = new ByteSocket<TestEvents>(app, {
			auth: authFn,
			authTimeout: 1000,
			serialization: "json",
		});
		app.ws("/ws", io.handler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		const listener = new WebSocket(`ws://localhost:${port}/ws`);
		await Promise.all([new Promise((r) => client.on("open", r)), new Promise((r) => listener.on("open", r))]);

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));
		await new Promise((r) => setTimeout(r, 20));

		const socket = Array.from(io.sockets.values())[0];
		expect(socket.isAuthenticated).toBe(false);
		expect(socket.canSend).toBe(false);

		const listenerSocket = Array.from(io.sockets.values())[1];
		listenerSocket.rooms.join("test-room");

		const listenerMessages: string[] = [];
		listener.on("message", (data) => listenerMessages.push(JSON.parse(data.toString())));

		socket.rooms.emit("test-room", "echo", { message: "should not send" });
		socket.rooms.bulk.emit(["test-room"], "echo", { message: "bulk nope" });

		await new Promise((r) => setTimeout(r, 50));

		expect(listenerMessages).toEqual([]);

		client.close();
		listener.close();
	});

	it("should log auth timeout warning when debug is enabled", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const authFn = vi.fn((_socket, _data, _cb) => {});
		io = new ByteSocket<TestEvents>(app, {
			auth: authFn,
			authTimeout: 50,
			debug: true,
			serialization: "json",
		});
		app.ws("/ws", io.handler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));
		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "x" } }));

		await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
		warnSpy.mockRestore();
	});

	it("should ignore auth message when no auth is configured (socket already open)", async () => {
		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));
		const socket = Array.from(io.sockets.values())[0];
		expect(socket.isAuthenticated).toBe(true);

		client.send(JSON.stringify({ type: LifecycleTypes.auth, data: { token: "any" } }));

		await new Promise((r) => setTimeout(r, 50));
		expect(socket.isClosed).toBe(false);
		client.close();
	});
});
