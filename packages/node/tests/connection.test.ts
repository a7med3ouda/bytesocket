// packages/node/tests/connection.test.ts
import { createServer, Server, type ClientRequestArgs } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket, { type AddressInfo } from "ws";
import { ByteSocket, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket node: Connection", () => {
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

	const createClient = (url = `ws://localhost:${port}/ws`, options?: WebSocket.ClientOptions | ClientRequestArgs): Promise<WebSocket> => {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(url, options);
			ws.on("open", () => resolve(ws));
			ws.on("error", reject);
		});
	};

	it("should accept connections and trigger onOpen", async () => {
		const openHandler = vi.fn();
		io.lifecycle.onOpen(openHandler);

		io.attach(server, "/ws");

		const client = await createClient();

		await vi.waitFor(() => expect(openHandler).toHaveBeenCalled());
		expect(io.sockets.size).toBe(1);

		client.close();
	});

	it("should trigger onClose when client disconnects", async () => {
		const closeHandler = vi.fn();
		io.lifecycle.onClose(closeHandler);

		io.attach(server, "/ws");

		const client = await createClient();
		await vi.waitFor(() => expect(io.sockets.size).toBe(1));

		client.close();

		await vi.waitFor(() => expect(closeHandler).toHaveBeenCalled());
		expect(io.sockets.size).toBe(0);
	});

	it("should reject connections from disallowed origins", async () => {
		io = new ByteSocket<TestEvents>({ origins: ["https://example.com"] });

		io.attach(server, "/ws");

		const client = new WebSocket(`ws://localhost:${port}/ws`, {
			headers: { Origin: "https://evil.com" },
		});

		const errorPromise = new Promise((resolve) => client.on("error", resolve));
		const closePromise = new Promise((resolve) => client.on("close", resolve));

		await Promise.race([errorPromise, closePromise]);
		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
	});

	it("should reject upgrade with 503 when server is destroyed", async () => {
		io.attach(server, "/ws");

		io.destroy();

		const ws = new WebSocket(`ws://localhost:${port}/ws`);
		const closeOrError = new Promise<void>((resolve) => {
			ws.on("close", () => resolve());
			ws.on("error", () => resolve());
		});
		await closeOrError;
		expect(ws.readyState).toBe(WebSocket.CLOSED);
	});

	it("should end the socket immediately when server is destroyed during open", async () => {
		io = new ByteSocket<TestEvents>({ serialization: "json" });

		io.lifecycle.onUpgrade((_res, _req, _data, _ctx) => {
			io.destroy();
		});

		io.attach(server, "/ws");

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		const closePromise = new Promise<void>((resolve) => {
			client.on("close", resolve);
			client.on("error", () => {});
		});
		await closePromise;
		expect(client.readyState).toBe(WebSocket.CLOSED);
	});

	it("should call onUpgrade listener and allow upgrade", async () => {
		const onUpgrade = vi.fn((_res, _req, _data, _ctx) => {});
		io.lifecycle.onUpgrade(onUpgrade);

		io.attach(server, "/ws");

		const client = await createClient();

		expect(onUpgrade).toHaveBeenCalledTimes(1);
		client.close();
	});

	it("should call onUpgrade listener and reject upgrade with error", async () => {
		const onUpgrade = vi.fn((_res, _req, _data, _ctx) => {
			throw new Error("Rejected upgrade");
		});
		io.lifecycle.onUpgrade(onUpgrade);

		io.attach(server, "/ws");

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		const closeOrError = new Promise<void>((resolve) => {
			client.on("close", () => resolve());
			client.on("error", () => resolve());
		});
		await closeOrError;
		expect(client.readyState).toBe(WebSocket.CLOSED);
		expect(onUpgrade).toHaveBeenCalled();
	});

	it("should expose all request header getters", async () => {
		io.attach(server, "/ws");

		const ws = await createClient(`ws://localhost:${port}/ws`, {
			headers: {
				cookie: "session=123",
				authorization: "Bearer token",
				"user-agent": "Vitest/1.0",
				host: "test.com",
				"x-forwarded-for": "10.0.0.1",
			},
		});
		const socket = Array.from(io.sockets.values())[0];

		expect(socket.cookie).toBe("session=123");
		expect(socket.authorization).toBe("Bearer token");
		expect(socket.userAgent).toBe("Vitest/1.0");
		expect(socket.host).toBe("test.com");
		expect(socket.xForwardedFor).toBe("10.0.0.1");

		ws.close();
	});

	it("should expose the query string from the URL", async () => {
		io.attach(server, "/ws");

		const ws = await createClient(`ws://localhost:${port}/ws?room=lobby&token=abc`);
		const socket = Array.from(io.sockets.values())[0];

		expect(socket.query).toBe("room=lobby&token=abc");
		expect(socket.url).toBe("/ws");

		ws.close();
	});

	it("should close the client connection when socket.close() is called", async () => {
		io.attach(server, "/ws");

		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		const closePromise = new Promise<void>((resolve) => client.on("close", resolve));
		socket.close(4000, "test close");

		await closePromise;
		expect(client.readyState).toBe(WebSocket.CLOSED);
	});

	it("should allow connections when origins are set but no Origin header is present", async () => {
		io = new ByteSocket<TestEvents>({ origins: ["https://example.com"], serialization: "json" });

		io.attach(server, "/ws");

		const client = await createClient();
		expect(client.readyState).toBe(WebSocket.OPEN);
		client.close();
	});
});
