// packages/uws/tests/rooms-single.test.ts
import uWS from "uWebSockets.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { ByteSocket, LifecycleTypes, type LifecycleRoomError, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket uws: Rooms single operations", () => {
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

	it("should allow clients to join and leave rooms (guard pass)", async () => {
		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		const joinGuard = vi.fn((_socket, _room, next) => next());
		const leaveGuard = vi.fn((_socket, _room, next) => next());

		io.rooms.lifecycle.onJoin(joinGuard);
		io.rooms.lifecycle.onLeave(leaveGuard);

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await vi.waitFor(() => expect(joinGuard).toHaveBeenCalledWith(expect.anything(), "lobby", expect.any(Function)));
		expect(socket.rooms.list()).toContain("lobby");

		client.send(JSON.stringify({ type: LifecycleTypes.leave_room, room: "lobby" }));
		await vi.waitFor(() => expect(leaveGuard).toHaveBeenCalledWith(expect.anything(), "lobby", expect.any(Function)));
		expect(socket.rooms.list()).not.toContain("lobby");

		client.close();
	});

	it("should block join when guard calls next(error)", async () => {
		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		io.rooms.lifecycle.onJoin((_socket, _room, next) => {
			next(new Error("Not allowed"));
		});

		const errorCb = vi.fn();
		client.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.type === LifecycleTypes.join_room_error) {
				errorCb(msg);
			}
		});

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "restricted" }));
		await vi.waitFor(() => expect(errorCb).toHaveBeenCalled());
		expect(socket.rooms.list()).not.toContain("restricted");
		client.close();
	});

	it("should block leave when guard calls next(error)", async () => {
		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		io.rooms.lifecycle.onJoin((_socket, _room, next) => next());
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "sticky" }));
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("sticky"));

		io.rooms.lifecycle.onLeave((_socket, _room, next) => {
			next(new Error("Can't leave"));
		});

		const errorCb = vi.fn();
		client.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.type === LifecycleTypes.leave_room_error) {
				errorCb(msg);
			}
		});

		client.send(JSON.stringify({ type: LifecycleTypes.leave_room, room: "sticky" }));
		await vi.waitFor(() => expect(errorCb).toHaveBeenCalled());
		expect(socket.rooms.list()).toContain("sticky");
		client.close();
	});

	it("should call once join guard only once", async () => {
		const guard = vi.fn((_socket, _room, next) => next());
		io.rooms.lifecycle.onceJoin(guard);

		const client1 = await createClient();
		client1.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "first" }));
		await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(1));

		const client2 = await createClient();
		client2.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "second" }));
		await new Promise((r) => setTimeout(r, 50));
		expect(guard).toHaveBeenCalledTimes(1);

		client1.close();
		client2.close();
	});

	it("should call once leave guard only once", async () => {
		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await new Promise((r) => setTimeout(r, 30));

		const guard = vi.fn((_socket, _room, next) => next());
		io.rooms.lifecycle.onceLeave(guard);

		client.send(JSON.stringify({ type: LifecycleTypes.leave_room, room: "lobby" }));
		await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(1));

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await new Promise((r) => setTimeout(r, 30));
		client.send(JSON.stringify({ type: LifecycleTypes.leave_room, room: "lobby" }));
		await new Promise((r) => setTimeout(r, 50));
		expect(guard).toHaveBeenCalledTimes(1);

		client.close();
	});

	it("should remove a single join guard with offJoin", async () => {
		const guard = vi.fn((_s, _r, n) => n());
		io.rooms.lifecycle.onJoin(guard);
		io.rooms.lifecycle.offJoin(guard);

		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "x" }));
		await new Promise((r) => setTimeout(r, 50));
		expect(guard).not.toHaveBeenCalled();
		client.close();
	});

	it("should remove a single leave guard with offLeave", async () => {
		const guard = vi.fn((_s, _r, n) => n());
		io.rooms.lifecycle.onLeave(guard);
		io.rooms.lifecycle.offLeave(guard);

		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "x" }));
		await new Promise((r) => setTimeout(r, 30));
		client.send(JSON.stringify({ type: LifecycleTypes.leave_room, room: "x" }));
		await new Promise((r) => setTimeout(r, 50));
		expect(guard).not.toHaveBeenCalled();
		client.close();
	});

	it("should call room middleware when client sends a room message", async () => {
		const sender = await createClient();
		const listener = await createClient();

		sender.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		listener.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await new Promise((r) => setTimeout(r, 50));

		const middleware = vi.fn((_socket, _data, next) => next());
		io.rooms.on("lobby", "echo", middleware);

		const listenerMessages: string[] = [];
		const senderMessages: string[] = [];
		listener.on("message", (data) => listenerMessages.push(JSON.parse(data.toString())));
		sender.on("message", (data) => senderMessages.push(JSON.parse(data.toString())));

		sender.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "mid" } }));

		await vi.waitFor(() => expect(middleware).toHaveBeenCalled());
		await vi.waitFor(() => expect(senderMessages[0]).toBeUndefined());
		await vi.waitFor(() =>
			expect(listenerMessages).toEqual(
				expect.arrayContaining([expect.objectContaining({ room: "lobby", event: "echo", data: { message: "mid" } })]),
			),
		);

		sender.close();
		listener.close();
	});

	it("should block room message when middleware calls next(error)", async () => {
		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await new Promise((r) => setTimeout(r, 30));

		io.rooms.on("lobby", "echo", (_socket, _data, next) => {
			next(new Error("Blocked"));
		});

		const errorSpy = vi.fn();
		io.lifecycle.onError(errorSpy);

		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "fail" } }));
		await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());

		const received: string[] = [];
		client.on("message", (data) => received.push(JSON.parse(data.toString())));
		await new Promise((r) => setTimeout(r, 50));
		expect(received).toEqual([]);

		client.close();
	});

	it("should call once middleware only once", async () => {
		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await new Promise((r) => setTimeout(r, 30));

		const middleware = vi.fn((_socket, _data, next) => next());
		io.rooms.once("lobby", "echo", middleware);

		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "first" } }));
		await vi.waitFor(() => expect(middleware).toHaveBeenCalledTimes(1));

		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "second" } }));
		await new Promise((r) => setTimeout(r, 50));
		expect(middleware).toHaveBeenCalledTimes(1);

		client.close();
	});

	it("should remove room middleware with off", async () => {
		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await new Promise((r) => setTimeout(r, 30));

		const middleware = vi.fn((_socket, _data, next) => next());
		io.rooms.on("lobby", "echo", middleware);
		io.rooms.off("lobby", "echo", middleware);

		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "ignored" } }));
		await new Promise((r) => setTimeout(r, 50));
		expect(middleware).not.toHaveBeenCalled();

		client.close();
	});

	it("should remove all room middleware with off(room)", async () => {
		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await new Promise((r) => setTimeout(r, 30));

		const mw1 = vi.fn((_s, _d, n) => n());
		const mw2 = vi.fn((_s, _d, n) => n());
		io.rooms.on("lobby", "echo", mw1);
		io.rooms.on("lobby", "broadcast", mw2);
		io.rooms.off("lobby");

		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "x" } }));
		client.send(JSON.stringify({ room: "lobby", event: "broadcast", data: { text: "y" } }));
		await new Promise((r) => setTimeout(r, 50));
		expect(mw1).not.toHaveBeenCalled();
		expect(mw2).not.toHaveBeenCalled();
		client.close();
	});

	it("should remove all room middleware for an event with off(room, event)", async () => {
		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await new Promise((r) => setTimeout(r, 30));

		const mw1 = vi.fn((_s, _d, n) => n());
		const mw2 = vi.fn((_s, _d, n) => n());
		io.rooms.on("lobby", "echo", mw1);
		io.rooms.on("lobby", "echo", mw2);
		io.rooms.off("lobby", "echo");

		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "x" } }));
		await new Promise((r) => setTimeout(r, 50));
		expect(mw1).not.toHaveBeenCalled();
		expect(mw2).not.toHaveBeenCalled();
		client.close();
	});

	it("should broadcast to a room via io.rooms.emit", async () => {
		const client1 = await createClient();
		const client2 = await createClient();

		client1.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await new Promise((resolve) => setTimeout(resolve, 50));

		const messages: string[] = [];
		client1.on("message", (data) => messages.push(JSON.parse(data.toString())));
		client2.on("message", (data) => messages.push(JSON.parse(data.toString())));

		io.rooms.emit("lobby", "echo", { message: "room broadcast" });

		await vi.waitFor(() => expect(messages.length).toBe(1));
		expect(messages[0]).toEqual({ room: "lobby", event: "echo", data: { message: "room broadcast" } });

		client1.close();
		client2.close();
	});

	it("should publish raw data to a room (server-side)", async () => {
		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "raw-room" }));
		await new Promise((r) => setTimeout(r, 30));

		const received: string[] = [];
		client.on("message", (data) => received.push(data.toString()));

		io.rooms.publishRaw("raw-room", "RAW_PAYLOAD");

		await vi.waitFor(() => expect(received).toContain("RAW_PAYLOAD"));
		client.close();
	});

	it("should list rooms excluding broadcast by default", async () => {
		const ws = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => ws.on("open", r));
		const socket = Array.from(io.sockets.values())[0];

		expect(socket.rooms.list()).not.toContain("__bytesocket_broadcast__");

		socket.rooms.join("lobby");
		expect(socket.rooms.list()).toContain("lobby");

		expect(socket.rooms.list(true)).toContain("__bytesocket_broadcast__");

		ws.close();
	});

	it("should ignore duplicate join requests for the same room", async () => {
		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("lobby"));

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await new Promise((r) => setTimeout(r, 30));
		expect(socket.rooms.list()).toContain("lobby");

		client.close();
	});

	it("should ignore leave requests for unjoined rooms", async () => {
		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		client.send(JSON.stringify({ type: LifecycleTypes.leave_room, room: "ghost" }));
		await new Promise((r) => setTimeout(r, 30));
		expect(socket.rooms.list()).not.toContain("ghost");

		client.close();
	});

	it("should list rooms from local state after the socket is closed", async () => {
		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		socket.rooms.join("lobby");
		client.close();
		await vi.waitFor(() => expect(io.sockets.size).toBe(0));

		expect(socket.isClosed).toBe(true);
		expect(socket.rooms.list()).toContain("lobby");
	});

	it("should publish raw data from a socket to a specific room", async () => {
		const client1 = await createClient();
		const client2 = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		client1.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "raw-socket" }));
		client2.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "raw-socket" }));
		await new Promise((r) => setTimeout(r, 30));

		const received1: string[] = [];
		client1.on("message", (data) => received1.push(data.toString()));
		const received2: string[] = [];
		client2.on("message", (data) => received2.push(data.toString()));

		socket.rooms.publishRaw("raw-socket", "FROM_SOCKET");

		await vi.waitFor(() => expect(received1[0]).toBeUndefined());
		await vi.waitFor(() => expect(received2[0]).toBe("FROM_SOCKET"));
		client1.close();
		client2.close();
	});

	it("should timeout room middleware when next() is never called", async () => {
		io = new ByteSocket<TestEvents>(app, {
			serialization: "json",
			roomMiddlewareTimeout: 50,
		});
		app.ws("/ws", io.handler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await new Promise((r) => setTimeout(r, 30));

		const errorSpy = vi.fn();
		io.lifecycle.onError(errorSpy);

		io.rooms.on("lobby", "echo", (_socket, _data, _next) => {});

		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "timeout" } }));

		await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
		client.close();
	});

	it("should timeout single join guard when next() is never called", async () => {
		io = new ByteSocket<TestEvents>(app, {
			serialization: "json",
			roomMiddlewareTimeout: 50,
		});
		app.ws("/ws", io.handler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));

		io.rooms.lifecycle.onJoin((_socket, _room, _next) => {});
		io.lifecycle.onError(() => {});

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "timeout-room" }));

		await new Promise((r) => setTimeout(r, 100));
		expect(client.readyState).toBe(WebSocket.OPEN);
		client.close();
	});

	it("should timeout single leave guard when next() is never called", async () => {
		io = new ByteSocket<TestEvents>(app, {
			serialization: "json",
			roomMiddlewareTimeout: 50,
		});
		app.ws("/ws", io.handler);

		const client = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((r) => client.on("open", r));
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "can-leave" }));
		await new Promise((r) => setTimeout(r, 30));

		io.rooms.lifecycle.onLeave((_socket, _room, _next) => {});
		io.lifecycle.onError(() => {});

		client.send(JSON.stringify({ type: LifecycleTypes.leave_room, room: "can-leave" }));

		await new Promise((r) => setTimeout(r, 100));
		expect(client.readyState).toBe(WebSocket.OPEN);
		client.close();
	});

	it("should reject join when guard throws synchronously", async () => {
		io.rooms.lifecycle.onJoin((_socket, _room, _next) => {
			throw new Error("Guard throw");
		});

		const client = await createClient();
		const joinError = new Promise((resolve) => {
			client.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room_error) {
					resolve(msg);
				}
			});
		});
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "throw-room" }));

		const errorMsg = await joinError;
		expect(errorMsg).toMatchObject({
			type: LifecycleTypes.join_room_error,
			room: "throw-room",
		});
		const socket = Array.from(io.sockets.values())[0];
		expect(socket.rooms.list()).not.toContain("throw-room");
		client.close();
	});

	it("should deliver room messages without any middleware", async () => {
		const sender = await createClient();
		const listener = await createClient();

		await new Promise<void>((resolve) => {
			let count = 0;
			const check = () => {
				if (++count === 2) {
					resolve();
				}
			};
			sender.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room_success) {
					check();
				}
			});
			listener.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room_success) {
					check();
				}
			});
			sender.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
			listener.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		});

		const listenerMessages: string[] = [];
		listener.on("message", (data) => listenerMessages.push(JSON.parse(data.toString())));

		sender.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "no mw" } }));

		await vi.waitFor(() => expect(listenerMessages.length).toBe(1));
		expect(listenerMessages[0]).toEqual({
			room: "lobby",
			event: "echo",
			data: { message: "no mw" },
		});

		sender.close();
		listener.close();
	});

	it("should remove once room middleware with off", async () => {
		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await new Promise((r) => setTimeout(r, 30));

		const middleware = vi.fn((_s, _d, n) => n());
		io.rooms.once("lobby", "echo", middleware);
		io.rooms.off("lobby", "echo", middleware);

		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "ignored" } }));
		await new Promise((r) => setTimeout(r, 50));
		expect(middleware).not.toHaveBeenCalled();
		client.close();
	});

	it("should do nothing when publishRaw is called after server is destroyed", () => {
		io.destroy();
		expect(() => io.rooms.publishRaw("any", "data")).not.toThrow();
	});

	it("should allow join when guard returns a resolved promise", async () => {
		io.rooms.lifecycle.onJoin((_socket, _room, _next) => {
			return Promise.resolve(); // resolves, not calling next
		});

		const client = await createClient();
		const joinSuccess = new Promise<string>((resolve) => {
			client.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room_success) {
					resolve(msg.room);
				}
			});
		});
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "promise-room" }));

		const room = await joinSuccess;
		expect(room).toBe("promise-room");
		const socket = Array.from(io.sockets.values())[0];
		expect(socket.rooms.list()).toContain("promise-room");
		client.close();
	});

	it("should reject join when guard returns a rejected promise without calling next", async () => {
		io.rooms.lifecycle.onJoin((_socket, _room, _next) => {
			return Promise.reject(new Error("Promise rejection"));
		});

		const client = await createClient();
		const messages: LifecycleRoomError[] = [];
		client.on("message", (data) => messages.push(JSON.parse(data.toString())));

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "reject-room" }));

		await new Promise((r) => setTimeout(r, 100));

		const socket = Array.from(io.sockets.values())[0];
		expect(socket.rooms.list()).not.toContain("reject-room");

		expect(messages[0].type).toBe(LifecycleTypes.join_room_error);

		client.close();
	});

	it("should do nothing when socket.rooms.publishRaw is called on a closed socket", async () => {
		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];
		client.close();
		await vi.waitFor(() => expect(io.sockets.size).toBe(0));

		expect(() => socket.rooms.publishRaw("test", "data")).not.toThrow();
	});

	it("should do nothing when rooms.emit is called after server is destroyed", () => {
		io.destroy();
		expect(() => io.rooms.emit("lobby", "echo", { message: "test" })).not.toThrow();
	});
});
