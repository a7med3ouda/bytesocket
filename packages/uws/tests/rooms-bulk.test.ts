// packages/uws/tests/rooms-bulk.test.ts
import uWS from "uWebSockets.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { ByteSocket, LifecycleTypes, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket uws: Rooms bulk operations", () => {
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

	it("should handle bulk join and leave via client messages", async () => {
		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		client.send(JSON.stringify({ type: LifecycleTypes.join_rooms, rooms: ["a", "b"] }));

		const joinSuccess = vi.fn();
		client.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.type === LifecycleTypes.join_rooms_success) {
				joinSuccess(msg);
			}
		});
		await vi.waitFor(() => expect(joinSuccess).toHaveBeenCalled());
		expect(socket.rooms.list()).toEqual(expect.arrayContaining(["a", "b"]));

		const leaveSuccess = vi.fn();
		client.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.type === LifecycleTypes.leave_rooms_success) {
				leaveSuccess(msg);
			}
		});
		client.send(JSON.stringify({ type: LifecycleTypes.leave_rooms, rooms: ["a", "b"] }));
		await vi.waitFor(() => expect(leaveSuccess).toHaveBeenCalled());
		expect(socket.rooms.list()).toEqual([]);

		client.close();
	});

	it("should block bulk join when guard calls next(error)", async () => {
		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		io.rooms.bulk.lifecycle.onJoin((_socket, _rooms, next) => {
			next(new Error("Bulk join denied"));
		});

		const errorCb = vi.fn();
		client.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.type === LifecycleTypes.join_rooms_error) {
				errorCb(msg);
			}
		});

		client.send(JSON.stringify({ type: LifecycleTypes.join_rooms, rooms: ["x", "y"] }));
		await vi.waitFor(() => expect(errorCb).toHaveBeenCalled());
		expect(socket.rooms.list()).not.toContain("x");
		client.close();
	});

	it("should block bulk leave when guard calls next(error)", async () => {
		const client = await createClient();
		const socket = Array.from(io.sockets.values())[0];

		client.send(JSON.stringify({ type: LifecycleTypes.join_rooms, rooms: ["x", "y"] }));
		await vi.waitFor(() => expect(socket.rooms.list()).toEqual(expect.arrayContaining(["x", "y"])));

		io.rooms.bulk.lifecycle.onLeave((_socket, _rooms, next) => {
			next(new Error("Bulk leave denied"));
		});

		const errorCb = vi.fn();
		client.on("message", (data) => {
			const msg = JSON.parse(data.toString());
			if (msg.type === LifecycleTypes.leave_rooms_error) {
				errorCb(msg);
			}
		});

		client.send(JSON.stringify({ type: LifecycleTypes.leave_rooms, rooms: ["x", "y"] }));
		await vi.waitFor(() => expect(errorCb).toHaveBeenCalled());
		expect(socket.rooms.list()).toEqual(expect.arrayContaining(["x", "y"]));

		client.close();
	});

	it("should call bulk onceJoin guard only once", async () => {
		const guard = vi.fn((_s, _r, n) => n());
		io.rooms.bulk.lifecycle.onceJoin(guard);

		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_rooms, rooms: ["a", "b"] }));
		await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(1));

		client.send(JSON.stringify({ type: LifecycleTypes.join_rooms, rooms: ["c", "d"] }));
		await new Promise((r) => setTimeout(r, 50));
		expect(guard).toHaveBeenCalledTimes(1);
		client.close();
	});

	it("should call bulk onceLeave guard only once", async () => {
		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_rooms, rooms: ["a", "b"] }));
		await new Promise((r) => setTimeout(r, 30));

		const guard = vi.fn((_s, _r, n) => n());
		io.rooms.bulk.lifecycle.onceLeave(guard);

		client.send(JSON.stringify({ type: LifecycleTypes.leave_rooms, rooms: ["a", "b"] }));
		await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(1));

		client.send(JSON.stringify({ type: LifecycleTypes.join_rooms, rooms: ["a", "b"] }));
		await new Promise((r) => setTimeout(r, 30));
		client.send(JSON.stringify({ type: LifecycleTypes.leave_rooms, rooms: ["a", "b"] }));
		await new Promise((r) => setTimeout(r, 50));
		expect(guard).toHaveBeenCalledTimes(1);
		client.close();
	});

	it("should remove a bulk join guard with offJoin", async () => {
		const guard = vi.fn((_s, _r, n) => n());
		io.rooms.bulk.lifecycle.onJoin(guard);
		io.rooms.bulk.lifecycle.offJoin(guard);

		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_rooms, rooms: ["x", "y"] }));
		await new Promise((r) => setTimeout(r, 50));
		expect(guard).not.toHaveBeenCalled();
		client.close();
	});

	it("should remove a bulk leave guard with offLeave", async () => {
		const guard = vi.fn((_s, _r, n) => n());
		io.rooms.bulk.lifecycle.onLeave(guard);
		io.rooms.bulk.lifecycle.offLeave(guard);

		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_rooms, rooms: ["x"] }));
		await new Promise((r) => setTimeout(r, 30));
		client.send(JSON.stringify({ type: LifecycleTypes.leave_rooms, rooms: ["x"] }));
		await new Promise((r) => setTimeout(r, 50));
		expect(guard).not.toHaveBeenCalled();
		client.close();
	});

	it("should call multi-room middleware when client sends rooms message", async () => {
		const client = await createClient();
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "a" }));
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "b" }));
		await new Promise((r) => setTimeout(r, 30));

		const middleware = vi.fn((_socket, _data, next) => next());
		io.rooms.on("a", "echo", middleware);
		io.rooms.on("b", "echo", middleware);

		client.send(JSON.stringify({ rooms: ["a", "b"], event: "echo", data: { message: "bulk" } }));

		await vi.waitFor(() => expect(middleware).toHaveBeenCalledTimes(2));
		client.close();
	});

	it("should bulk emit to multiple rooms", async () => {
		const client = await createClient();

		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "room1" }));
		client.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "room2" }));
		await new Promise((r) => setTimeout(r, 30));

		const received: string[] = [];
		client.on("message", (data) => received.push(JSON.parse(data.toString())));

		io.rooms.bulk.emit(["room1", "room2"], "echo", { message: "bulk" });

		await vi.waitFor(() => expect(received.length).toBe(2));
		expect(received[0]).toEqual({ rooms: ["room1", "room2"], event: "echo", data: { message: "bulk" } });
		client.close();
	});

	it("should not broadcast to rooms where middleware calls next(error)", async () => {
		const client1 = await createClient();
		const client2 = await createClient();

		client1.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "roomA" }));
		client1.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "roomB" }));

		client2.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "roomA" }));
		client2.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "roomB" }));

		await new Promise((r) => setTimeout(r, 30));

		io.rooms.on("roomA", "echo", (_socket, _data, next) => {
			next(new Error("roomA blocked"));
		});
		io.rooms.on("roomB", "echo", (_socket, _data, next) => {
			next();
		});

		const errorSpy = vi.fn();
		io.lifecycle.onError(errorSpy);

		const messages1: string[] = [];
		client1.on("message", (data) => messages1.push(JSON.parse(data.toString())));

		const messages2: string[] = [];
		client2.on("message", (data) => messages2.push(JSON.parse(data.toString())));

		client1.send(JSON.stringify({ rooms: ["roomA", "roomB"], event: "echo", data: { message: "bulk" } }));

		await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());

		expect(messages1.length).toBe(0);
		expect(messages1[0]).toBeUndefined();

		expect(messages2.length).toBe(1);
		expect(messages2[0]).toEqual({
			rooms: ["roomA", "roomB"],
			event: "echo",
			data: { message: "bulk" },
		});

		client1.close();
		client2.close();
	});

	it("should bulk emit from socket to multiple rooms", async () => {
		const sender = await createClient();
		const listener = await createClient();

		await new Promise<void>((resolve) => {
			let count = 0;
			const check = () => {
				if (++count === 4) {
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
			sender.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "roomX" }));
			sender.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "roomY" }));
			listener.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "roomX" }));
			listener.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "roomY" }));
		});

		const senderSocket = Array.from(io.sockets.values())[0];
		const listenerMessages: string[] = [];
		const senderMessages: string[] = [];
		listener.on("message", (data) => listenerMessages.push(JSON.parse(data.toString())));
		sender.on("message", (data) => senderMessages.push(JSON.parse(data.toString())));

		senderSocket.rooms.bulk.emit(["roomX", "roomY"], "echo", { message: "bulk from socket" });

		await vi.waitFor(() => expect(listenerMessages.length).toBe(2));
		expect(listenerMessages[0]).toEqual({
			rooms: ["roomX", "roomY"],
			event: "echo",
			data: { message: "bulk from socket" },
		});
		expect(listenerMessages[1]).toEqual({
			rooms: ["roomX", "roomY"],
			event: "echo",
			data: { message: "bulk from socket" },
		});

		expect(senderMessages).toEqual([]);

		sender.close();
		listener.close();
	});

	it("should deliver multi-room messages to other clients (no middleware)", async () => {
		const sender = await createClient();
		const listener = await createClient();

		await new Promise<void>((resolve) => {
			let count = 0;
			const check = () => {
				if (++count === 4) {
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
			sender.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "roomA" }));
			sender.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "roomB" }));
			listener.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "roomA" }));
			listener.send(JSON.stringify({ type: LifecycleTypes.join_room, room: "roomB" }));
		});

		const listenerMessages: string[] = [];
		listener.on("message", (data) => listenerMessages.push(JSON.parse(data.toString())));

		sender.send(JSON.stringify({ rooms: ["roomA", "roomB"], event: "echo", data: { message: "all rooms" } }));

		await vi.waitFor(() => expect(listenerMessages.length).toBe(2));
		expect(listenerMessages[0]).toEqual({
			rooms: ["roomA", "roomB"],
			event: "echo",
			data: { message: "all rooms" },
		});
		expect(listenerMessages[1]).toEqual({
			rooms: ["roomA", "roomB"],
			event: "echo",
			data: { message: "all rooms" },
		});

		sender.close();
		listener.close();
	});

	it("should do nothing when rooms.bulk.emit is called after server is destroyed", () => {
		io.destroy();
		expect(() => io.rooms.bulk.emit(["room1"], "echo", { message: "test" })).not.toThrow();
	});
});
