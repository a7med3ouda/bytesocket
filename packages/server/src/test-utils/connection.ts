// packages/server/src/test-utils/connection.ts
import type * as vitest from "vitest";
import WebSocket from "ws";
import { createClient, type CreateByteSocketServerResponse, type TestEvents } from ".";
import type { ByteSocketServerBase } from "../byte-socket-server-base";
import type { ByteSocketOptionsBase } from "../types";

export function serverConnectionTest<B extends ByteSocketServerBase<TestEvents> = ByteSocketServerBase<TestEvents>>(
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

	it("should accept connections and trigger onOpen", async () => {
		const openHandler = vi.fn();
		obj.io.lifecycle.onOpen(openHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		await vi.waitFor(() => expect(openHandler).toHaveBeenCalled());
		expect(obj.io.sockets.size).toBe(1);

		client.close();
	});

	it("should trigger onClose when client disconnects", async () => {
		const closeHandler = vi.fn();
		obj.io.lifecycle.onClose(closeHandler);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(1));

		client.close();

		await vi.waitFor(() => expect(closeHandler).toHaveBeenCalled());
		expect(obj.io.sockets.size).toBe(0);
	});

	it("should reject connections from disallowed origins", async () => {
		obj.io = createByteSocket({ origins: ["https://example.com"] });

		obj.io.attach(obj.server, "/ws");

		const client = new WebSocket(`ws://localhost:${obj.port}/ws`, {
			headers: { Origin: "https://evil.com" },
		});

		const errorPromise = new Promise((resolve) => client.on("error", resolve));
		const closePromise = new Promise((resolve) => client.on("close", resolve));

		await Promise.race([errorPromise, closePromise]);
		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
	});

	it("should reject upgrade with 503 when obj.server is destroyed", async () => {
		obj.io.attach(obj.server, "/ws");

		obj.io.destroy();

		const ws = new WebSocket(`ws://localhost:${obj.port}/ws`);
		const closeOrError = new Promise<void>((resolve) => {
			ws.on("close", () => resolve());
			ws.on("error", () => resolve());
		});
		await closeOrError;
		expect(ws.readyState).toBe(WebSocket.CLOSED);
	});

	it("should end the socket immediately when obj.server is destroyed during open", async () => {
		obj.io = createByteSocket({ serialization: "json" });

		obj.io.lifecycle.onUpgrade(() => {
			obj.io.destroy();
		});

		obj.io.attach(obj.server, "/ws");

		const client = new WebSocket(`ws://localhost:${obj.port}/ws`);
		const closePromise = new Promise<void>((resolve) => {
			client.on("close", resolve);
			client.on("error", () => {});
		});
		await closePromise;
		expect(client.readyState).toBe(WebSocket.CLOSED);
	});

	it("should call onUpgrade listener and allow upgrade", async () => {
		const onUpgrade = vi.fn((_res, _req, _data, _ctx) => {});
		obj.io.lifecycle.onUpgrade(onUpgrade);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		expect(onUpgrade).toHaveBeenCalledTimes(1);
		client.close();
	});

	it("should call onUpgrade listener and reject upgrade with error", async () => {
		const onUpgrade = vi.fn((_res, _req, _data, _ctx) => {
			throw new Error("Rejected upgrade");
		});
		obj.io.lifecycle.onUpgrade(onUpgrade);

		obj.io.attach(obj.server, "/ws");

		const client = new WebSocket(`ws://localhost:${obj.port}/ws`);
		const closeOrError = new Promise<void>((resolve) => {
			client.on("close", () => resolve());
			client.on("error", () => resolve());
		});
		await closeOrError;
		expect(client.readyState).toBe(WebSocket.CLOSED);
		expect(onUpgrade).toHaveBeenCalled();
	});

	it("should expose all request header getters", async () => {
		obj.io.attach(obj.server, "/ws");

		const ws = await createClient(obj.port, `ws://localhost:${obj.port}/ws`, {
			headers: {
				cookie: "session=123",
				authorization: "Bearer token",
				"user-agent": "Vitest/1.0",
				host: "test.com",
				"x-forwarded-for": "10.0.0.1",
			},
		});
		const socket = Array.from(obj.io.sockets.values())[0];

		expect(socket.cookie).toBe("session=123");
		expect(socket.authorization).toBe("Bearer token");
		expect(socket.userAgent).toBe("Vitest/1.0");
		expect(socket.host).toBe("test.com");
		expect(socket.xForwardedFor).toBe("10.0.0.1");

		ws.close();
	});

	it("should expose the query string from the URL", async () => {
		obj.io.attach(obj.server, "/ws");

		const ws = await createClient(obj.port, `ws://localhost:${obj.port}/ws?room=lobby&token=abc`);
		const socket = Array.from(obj.io.sockets.values())[0];

		expect(socket.query).toBe("room=lobby&token=abc");
		expect(socket.url).toBe("/ws");

		ws.close();
	});

	it("should close the client connection when socket.close() is called", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

		const closePromise = new Promise<void>((resolve) => client.on("close", resolve));
		socket.close(4000, "test close");

		await closePromise;
		expect(client.readyState).toBe(WebSocket.CLOSED);
	});

	it("should allow connections when origins are set but no Origin header is present", async () => {
		obj.io = createByteSocket({ origins: ["https://example.com"], serialization: "json" });

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		expect(client.readyState).toBe(WebSocket.OPEN);
		client.close();
	});
}
