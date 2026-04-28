// packages/client/tests/auth.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { ByteSocket, LifecycleTypes, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket Client: Auth", () => {
	let wss: WebSocketServer;
	let port: number;

	beforeEach(async () => {
		wss = new WebSocketServer({ port: 0 });
		port = (wss.address() as WebSocket.AddressInfo).port;
	});

	afterEach(() => {
		wss.close();
		vi.useRealTimers();
	});

	it("should handle static auth success", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			autoConnect: false,
			serialization: "json",
			auth: { data: { token: "secret" } },
		});

		const authSuccessHandler = vi.fn();
		socket.lifecycle.onAuthSuccess(authSuccessHandler);

		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.auth) {
					ws.send(JSON.stringify({ type: LifecycleTypes.auth_success }));
				}
			});
		});

		socket.connect();
		await vi.waitFor(() => expect(authSuccessHandler).toHaveBeenCalled());
		socket.close();
	});

	it("should handle auth timeout", async () => {
		vi.useFakeTimers();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			auth: { data: { token: "secret" } },
			authTimeout: 100,
		});

		const authErrorHandler = vi.fn();
		socket.lifecycle.onAuthError(authErrorHandler);

		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		vi.advanceTimersByTime(150);

		expect(authErrorHandler).toHaveBeenCalled();
		expect(socket.readyState).toBe(WebSocket.CLOSING);
		socket.destroy();
	});

	it("should handle async auth callback", async () => {
		const authData = { token: "async-secret" };
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			autoConnect: false,
			serialization: "json",
			auth: (send) => {
				setTimeout(() => {
					send(authData);
				}, 10);
			},
		});

		const authSuccessHandler = vi.fn();
		socket.lifecycle.onAuthSuccess(authSuccessHandler);

		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.auth) {
					expect(msg.data).toEqual(authData);
					ws.send(JSON.stringify({ type: LifecycleTypes.auth_success }));
				}
			});
		});

		socket.connect();
		await vi.waitFor(() => expect(authSuccessHandler).toHaveBeenCalled());
		socket.close();
	});

	it("should throw when setAuth is called after connect", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			autoConnect: true,
			serialization: "json",
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));
		expect(() => socket.setAuth({ data: { token: "late" } })).toThrow(/cannot be changed after connect/);
		socket.close();
	});

	it("should throw when setAuth is called after destroy", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`);
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));
		socket.destroy();
		expect(() => socket.setAuth({ data: { token: "late" } })).toThrow(/after destroy/);
	});

	it("should call onAuthError when server sends auth_error", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			autoConnect: false,
			serialization: "json",
			auth: { data: { token: "secret" } },
		});

		const authErrorHandler = vi.fn();
		socket.lifecycle.onAuthError(authErrorHandler);

		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.auth) {
					ws.send(JSON.stringify({ type: LifecycleTypes.auth_error, data: { reason: "bad" } }));
				}
			});
		});

		socket.connect();
		await vi.waitFor(() => expect(authErrorHandler).toHaveBeenCalled());
		socket.close();
	});

	it("should call onceAuthSuccess only once", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			autoConnect: false,
			serialization: "json",
			auth: { data: { token: "secret" } },
		});

		const handler = vi.fn();
		socket.lifecycle.onceAuthSuccess(handler);

		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.auth) {
					ws.send(JSON.stringify({ type: LifecycleTypes.auth_success }));
				}
			});
		});

		socket.connect();
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

		socket.close();
		socket.connect();
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
		socket.close();
	});

	it("should remove auth error listener with offAuthError", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			autoConnect: false,
			serialization: "json",
			auth: { data: { token: "secret" } },
			authTimeout: 50,
		});

		const handler = vi.fn();
		socket.lifecycle.onAuthError(handler);
		socket.lifecycle.offAuthError(handler);

		socket.connect();
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		vi.useFakeTimers();
		vi.advanceTimersByTime(100);
		expect(handler).not.toHaveBeenCalled();
		vi.useRealTimers();
		socket.destroy();
	});

	it("should handle auth function config that throws synchronously", async () => {
		const authFn = () => {
			throw new Error("Boom");
		};
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			autoConnect: false,
			serialization: "json",
			auth: authFn,
		});
		const authErrorHandler = vi.fn();
		socket.lifecycle.onAuthError(authErrorHandler);
		socket.connect();
		await vi.waitFor(() => expect(authErrorHandler).toHaveBeenCalled());
		socket.close();
	});

	it("should NOT try to reconnect after auth failure", async () => {
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			serialization: "json",
			auth: { data: { token: "bad" } },
			reconnection: true,
			reconnectionDelay: 50,
			debug: true,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		for (const ws of wss.clients) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: LifecycleTypes.auth_error, data: { reason: "bad" } }));
			}
		}

		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.CLOSED));

		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.CLOSED));
		socket.destroy();
	});

	it("should handle auth send failure and trigger onAuthError", async () => {
		const sendSpy = vi.spyOn(globalThis.WebSocket.prototype, "send").mockImplementation(() => {
			throw new Error("fake send error");
		});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			autoConnect: false,
			serialization: "json",
			auth: { data: { token: "secret" } },
			debug: true,
		});
		const authErrorHandler = vi.fn();
		socket.lifecycle.onAuthError(authErrorHandler);

		socket.connect();

		await vi.waitFor(() => expect(authErrorHandler).toHaveBeenCalled());

		expect(warnSpy).toHaveBeenCalledWith("ByteSocket: auth send failed");

		sendSpy.mockRestore();
		warnSpy.mockRestore();
		socket.destroy();
	});
});
