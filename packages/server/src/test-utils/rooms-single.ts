// packages/server/src/test-utils/rooms-single.ts
import { LifecycleTypes, type LifecycleRoomError } from "@bytesocket/core";
import type * as vitest from "vitest";
import { createClient, type CreateByteSocketServerResponse, type TestEvents } from ".";
import type { ByteSocketServerBase } from "../byte-socket-server-base";
import type { ByteSocketOptionsBase } from "../types";

export function serverRoomsSingleTest<B extends ByteSocketServerBase<TestEvents> = ByteSocketServerBase<TestEvents>>(
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

	it("should allow clients to join and leave rooms (guard pass)", async () => {
		const joinGuard = vi.fn((_socket, _room, next) => next());
		const leaveGuard = vi.fn((_socket, _room, next) => next());

		obj.io.rooms.lifecycle.onJoin(joinGuard);
		obj.io.rooms.lifecycle.onLeave(leaveGuard);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await vi.waitFor(() => expect(joinGuard).toHaveBeenCalledWith(expect.anything(), "lobby", expect.any(Function)));
		expect(socket.rooms.list()).toContain("lobby");

		client.send(JSON.stringify({ type: LifecycleTypes.leave_room, room: "lobby" }));
		await vi.waitFor(() => expect(leaveGuard).toHaveBeenCalledWith(expect.anything(), "lobby", expect.any(Function)));
		expect(socket.rooms.list()).not.toContain("lobby");

		client.close();
	});

	it("should block join when guard calls next(error)", async () => {
		obj.io.rooms.lifecycle.onJoin((_socket, _room, next) => {
			next(new Error("Not allowed"));
		});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

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
		obj.io.rooms.lifecycle.onJoin((_socket, _room, next) => next());

		obj.io.rooms.lifecycle.onLeave((_socket, _room, next) => {
			next(new Error("Can't leave"));
		});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "sticky" }));
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("sticky"));

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
		obj.io.rooms.lifecycle.onceJoin(guard);

		obj.io.attach(obj.server, "/ws");

		const client1 = await createClient(obj.port);
		client1.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "first" }));
		await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(1));

		const client2 = await createClient(obj.port);
		client2.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "second" }));
		await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(1));

		client1.close();
		client2.close();
	});

	it("should call once leave guard only once", async () => {
		const guard = vi.fn((_socket, _room, next) => next());
		obj.io.rooms.lifecycle.onceLeave(guard);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));

		client.send(JSON.stringify({ type: LifecycleTypes.leave_room, room: "lobby" }));
		await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(1));

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		client.send(JSON.stringify({ type: LifecycleTypes.leave_room, room: "lobby" }));
		await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(1));

		client.close();
	});

	it("should remove a single join guard with offJoin", async () => {
		const guard = vi.fn((_s, _r, n) => n());
		obj.io.rooms.lifecycle.onJoin(guard);
		obj.io.rooms.lifecycle.offJoin(guard);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "x" }));
		await vi.waitFor(() => expect(guard).not.toHaveBeenCalled());
		client.close();
	});

	it("should remove a single leave guard with offLeave", async () => {
		const guard = vi.fn((_s, _r, n) => n());
		obj.io.rooms.lifecycle.onLeave(guard);
		obj.io.rooms.lifecycle.offLeave(guard);

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "x" }));
		client.send(JSON.stringify({ type: LifecycleTypes.leave_room, room: "x" }));
		await vi.waitFor(() => expect(guard).not.toHaveBeenCalled());
		client.close();
	});

	it("should call room middleware when client sends a room message", async () => {
		const middleware = vi.fn((_socket, _data, next) => next());
		obj.io.rooms.on("lobby", "echo", middleware);

		obj.io.attach(obj.server, "/ws");

		const sender = await createClient(obj.port);
		const listener = await createClient(obj.port);

		const senderJoinSuccess = vi.fn();
		const listenerJoinSuccess = vi.fn();
		sender.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.type === LifecycleTypes.join_room_success && msg.room === "lobby") {
				senderJoinSuccess();
			}
		});
		listener.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.type === LifecycleTypes.join_room_success && msg.room === "lobby") {
				listenerJoinSuccess();
			}
		});

		sender.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		listener.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));

		await vi.waitFor(() => expect(senderJoinSuccess).toHaveBeenCalled());
		await vi.waitFor(() => expect(listenerJoinSuccess).toHaveBeenCalled());

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
		obj.io.attach(obj.server, "/ws");

		obj.io.rooms.on("lobby", "echo", (_socket, _data, next) => {
			next(new Error("Blocked"));
		});

		const errorSpy = vi.fn();
		obj.io.lifecycle.onError(errorSpy);

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));

		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "fail" } }));
		await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());

		const received: string[] = [];
		client.on("message", (data) => received.push(JSON.parse(data.toString())));
		await vi.waitFor(() => expect(received).toEqual([]));

		client.close();
	});

	it("should call once middleware only once", async () => {
		obj.io.attach(obj.server, "/ws");

		const middleware = vi.fn((_socket, _data, next) => next());
		obj.io.rooms.once("lobby", "echo", middleware);

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));

		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "first" } }));
		await vi.waitFor(() => expect(middleware).toHaveBeenCalledTimes(1));

		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "second" } }));
		await vi.waitFor(() => expect(middleware).toHaveBeenCalledTimes(1));

		client.close();
	});

	it("should remove room middleware with off", async () => {
		obj.io.attach(obj.server, "/ws");

		const middleware = vi.fn((_socket, _data, next) => next());
		obj.io.rooms.on("lobby", "echo", middleware);
		obj.io.rooms.off("lobby", "echo", middleware);

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "ignored" } }));
		await vi.waitFor(() => expect(middleware).not.toHaveBeenCalled());

		client.close();
	});

	it("should remove all room middleware with off(room)", async () => {
		obj.io.attach(obj.server, "/ws");

		const mw1 = vi.fn((_s, _d, n) => n());
		const mw2 = vi.fn((_s, _d, n) => n());
		obj.io.rooms.on("lobby", "echo", mw1);
		obj.io.rooms.on("lobby", "broadcast", mw2);
		obj.io.rooms.off("lobby");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "x" } }));
		client.send(JSON.stringify({ room: "lobby", event: "broadcast", data: { text: "y" } }));

		await vi.waitFor(() => expect(mw1).not.toHaveBeenCalled());
		await vi.waitFor(() => expect(mw2).not.toHaveBeenCalled());

		client.close();
	});

	it("should remove all room middleware for an event with off(room, event)", async () => {
		obj.io.attach(obj.server, "/ws");

		const mw1 = vi.fn((_s, _d, n) => n());
		const mw2 = vi.fn((_s, _d, n) => n());
		obj.io.rooms.on("lobby", "echo", mw1);
		obj.io.rooms.on("lobby", "echo", mw2);
		obj.io.rooms.off("lobby", "echo");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "x" } }));

		await vi.waitFor(() => expect(mw1).not.toHaveBeenCalled());
		await vi.waitFor(() => expect(mw2).not.toHaveBeenCalled());
		client.close();
	});

	it("should broadcast to a room via obj.io.rooms.emit", async () => {
		obj.io.attach(obj.server, "/ws");

		const client1 = await createClient(obj.port);
		const client2 = await createClient(obj.port);

		const joinSuccess = vi.fn();
		client1.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.type === LifecycleTypes.join_room_success && msg.room === "lobby") {
				joinSuccess();
			}
		});
		client1.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await vi.waitFor(() => expect(joinSuccess).toHaveBeenCalled());

		const messages: string[] = [];
		client1.on("message", (data) => messages.push(JSON.parse(data.toString())));
		client2.on("message", (data) => messages.push(JSON.parse(data.toString())));

		obj.io.rooms.emit("lobby", "echo", { message: "room broadcast" });

		await vi.waitFor(() => expect(messages.length).toBe(1));
		await vi.waitFor(() => expect(messages[0]).toEqual({ room: "lobby", event: "echo", data: { message: "room broadcast" } }));

		client1.close();
		client2.close();
	});

	it("should publish raw data to a room (server-side)", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		const onJoinSuccess = (data: Buffer | ArrayBuffer | Buffer[]) => {
			try {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room_success && msg.room === "raw-room") {
					joinSuccess();
				}
			} catch {
				//
			}
		};
		const joinSuccess = vi.fn();
		client.on("message", onJoinSuccess);

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "raw-room" }));
		await vi.waitFor(() => expect(joinSuccess).toHaveBeenCalled());

		client.off("message", onJoinSuccess);

		const received: string[] = [];
		client.on("message", (data) => received.push(data.toString()));

		obj.io.rooms.publishRaw("raw-room", "RAW_PAYLOAD");

		await vi.waitFor(() => expect(received).toContain("RAW_PAYLOAD"));
		client.close();
	});

	it("should list rooms excluding broadcast by default", async () => {
		obj.io.attach(obj.server, "/ws");

		const ws = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

		await vi.waitFor(() => expect(socket.rooms.list()).not.toContain("__bytesocket_broadcast__"));

		socket.rooms.join("lobby");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("lobby"));

		await vi.waitFor(() => expect(socket.rooms.list(true)).toContain("__bytesocket_broadcast__"));

		ws.close();
	});

	it("should ignore duplicate join requests for the same room", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("lobby"));

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("lobby"));

		client.close();
	});

	it("should ignore leave requests for unjoined rooms", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

		client.send(JSON.stringify({ type: LifecycleTypes.leave_room, room: "ghost" }));
		await vi.waitFor(() => expect(socket.rooms.list()).not.toContain("ghost"));

		client.close();
	});

	it("should list rooms from local state after the socket is closed", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

		socket.rooms.join("lobby");
		client.close();
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(0));

		expect(socket.isClosed).toBe(true);
		expect(socket.rooms.list()).toContain("lobby");
	});

	it("should publish raw data from a socket to a specific room", async () => {
		obj.io.attach(obj.server, "/ws");

		const client1 = await createClient(obj.port);
		const client2 = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];

		const join1 = vi.fn();
		const join2 = vi.fn();
		const onJoin1 = (data: Buffer) => {
			try {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room_success && msg.room === "raw-socket") {
					join1();
				}
			} catch {
				//
			}
		};
		const onJoin2 = (data: Buffer) => {
			try {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room_success && msg.room === "raw-socket") {
					join2();
				}
			} catch {
				//
			}
		};
		client1.on("message", onJoin1);
		client2.on("message", onJoin2);

		client1.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "raw-socket" }));
		client2.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "raw-socket" }));
		await vi.waitFor(() => expect(join1).toHaveBeenCalled());
		await vi.waitFor(() => expect(join2).toHaveBeenCalled());

		client1.off("message", onJoin1);
		client2.off("message", onJoin2);

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
		obj.io = createByteSocket({
			serialization: "json",
			roomMiddlewareTimeout: 50,
		});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));

		const errorSpy = vi.fn();
		obj.io.lifecycle.onError(errorSpy);

		obj.io.rooms.on("lobby", "echo", (_socket, _data, _next) => {});

		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "timeout" } }));

		await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
		client.close();
	});

	it("should timeout single join guard when next() is never called", async () => {
		obj.io = createByteSocket({
			serialization: "json",
			roomMiddlewareTimeout: 50,
		});

		obj.io.rooms.lifecycle.onJoin((_socket, _room, _next) => {});
		obj.io.lifecycle.onError(() => {});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "timeout-room" }));

		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.OPEN));
		client.close();
	});

	it("should timeout single leave guard when next() is never called", async () => {
		obj.io = createByteSocket({
			serialization: "json",
			roomMiddlewareTimeout: 50,
		});

		obj.io.rooms.lifecycle.onLeave((_socket, _room, _next) => {});
		obj.io.lifecycle.onError(() => {});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "can-leave" }));
		client.send(JSON.stringify({ type: LifecycleTypes.leave_room, room: "can-leave" }));

		await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.OPEN));
		client.close();
	});

	it("should reject join when guard throws synchronously", async () => {
		obj.io.rooms.lifecycle.onJoin((_socket, _room, _next) => {
			throw new Error("Guard throw");
		});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
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
		const socket = Array.from(obj.io.sockets.values())[0];
		expect(socket.rooms.list()).not.toContain("throw-room");
		client.close();
	});

	it("should deliver room messages without any middleware", async () => {
		obj.io.attach(obj.server, "/ws");

		const sender = await createClient(obj.port);
		const listener = await createClient(obj.port);

		const senderJoinOk = vi.fn();
		const listenerJoinOk = vi.fn();
		sender.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.type === LifecycleTypes.join_room_success && msg.room === "lobby") {
				senderJoinOk();
			}
		});
		listener.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.type === LifecycleTypes.join_room_success && msg.room === "lobby") {
				listenerJoinOk();
			}
		});

		sender.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		listener.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));

		await vi.waitFor(() => expect(senderJoinOk).toHaveBeenCalled());
		await vi.waitFor(() => expect(listenerJoinOk).toHaveBeenCalled());

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
		obj.io.attach(obj.server, "/ws");

		const middleware = vi.fn((_s, _d, n) => n());
		obj.io.rooms.once("lobby", "echo", middleware);
		obj.io.rooms.off("lobby", "echo", middleware);

		const client = await createClient(obj.port);

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "lobby" }));
		client.send(JSON.stringify({ room: "lobby", event: "echo", data: { message: "ignored" } }));

		await vi.waitFor(() => expect(middleware).not.toHaveBeenCalled());
		client.close();
	});

	it("should do nothing when publishRaw is called after server is destroyed", () => {
		obj.io.attach(obj.server, "/ws");

		obj.io.destroy();
		expect(() => obj.io.rooms.publishRaw("any", "data")).not.toThrow();
	});

	it("should allow join when guard returns a resolved promise", async () => {
		obj.io.rooms.lifecycle.onJoin((_socket, _room, _next) => {
			return Promise.resolve();
		});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
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
		const socket = Array.from(obj.io.sockets.values())[0];
		expect(socket.rooms.list()).toContain("promise-room");
		client.close();
	});

	it("should reject join when guard returns a rejected promise without calling next", async () => {
		obj.io.rooms.lifecycle.onJoin((_socket, _room, _next) => {
			return Promise.reject(new Error("Promise rejection"));
		});

		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const messages: LifecycleRoomError[] = [];
		client.on("message", (data) => messages.push(JSON.parse(data.toString())));

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "reject-room" }));

		const socket = Array.from(obj.io.sockets.values())[0];
		await vi.waitFor(() => expect(socket.rooms.list()).not.toContain("reject-room"));

		await vi.waitFor(() => expect(messages[0].type).toBe(LifecycleTypes.join_room_error));

		client.close();
	});

	it("should do nothing when socket.rooms.publishRaw is called on a closed socket", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = await createClient(obj.port);
		const socket = Array.from(obj.io.sockets.values())[0];
		client.close();
		await vi.waitFor(() => expect(obj.io.sockets.size).toBe(0));

		expect(() => socket.rooms.publishRaw("test", "data")).not.toThrow();
	});

	it("should do nothing when rooms.emit is called after server is destroyed", () => {
		obj.io.attach(obj.server, "/ws");

		obj.io.destroy();
		expect(() => obj.io.rooms.emit("lobby", "echo", { message: "test" })).not.toThrow();
	});
}
