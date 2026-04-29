// packages/client/tests/rooms-bulk.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { ByteSocket, LifecycleTypes, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket Client: Bulk-room Operations", () => {
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

	it("should handle bulk join and leave", async () => {
		const bulkJoinSuccess = vi.fn();
		const bulkLeaveSuccess = vi.fn();

		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_rooms_success, rooms: msg.rooms }));
				} else if (msg.type === LifecycleTypes.leave_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.leave_rooms_success, rooms: msg.rooms }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.bulk.lifecycle.onJoinSuccess(bulkJoinSuccess);
		socket.rooms.bulk.lifecycle.onLeaveSuccess(bulkLeaveSuccess);

		socket.rooms.bulk.join(["roomA", "roomB"]);
		await vi.waitFor(() => expect(bulkJoinSuccess).toHaveBeenCalledWith(["roomA", "roomB"]));
		expect(socket.rooms.list()).toEqual(expect.arrayContaining(["roomA", "roomB"]));

		socket.rooms.bulk.leave(["roomA", "roomB"]);
		await vi.waitFor(() => expect(bulkLeaveSuccess).toHaveBeenCalledWith(["roomA", "roomB"]));
		expect(socket.rooms.list()).not.toContain("roomA");
		expect(socket.rooms.list()).not.toContain("roomB");

		socket.close();
	});

	it("should handle bulk join and leave errors", async () => {
		const bulkJoinError = vi.fn();
		const bulkLeaveError = vi.fn();

		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_rooms_error, rooms: msg.rooms, data: { reason: "no capacity" } }));
				} else if (msg.type === LifecycleTypes.leave_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.leave_rooms_error, rooms: msg.rooms, data: { reason: "cannot leave" } }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.bulk.lifecycle.onJoinError(bulkJoinError);
		socket.rooms.bulk.lifecycle.onLeaveError(bulkLeaveError);

		socket.rooms.bulk.join(["roomX", "roomY"]);
		await vi.waitFor(() => expect(bulkJoinError).toHaveBeenCalledWith(["roomX", "roomY"], { reason: "no capacity" }));
		expect(socket.rooms.list()).not.toContain("roomX");

		socket.close();
	});

	it("should handle bulk leave error after successful join", async () => {
		const bulkLeaveError = vi.fn();

		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_rooms_success, rooms: msg.rooms }));
				} else if (msg.type === LifecycleTypes.leave_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.leave_rooms_error, rooms: msg.rooms, data: { reason: "required" } }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.bulk.join(["roomA", "roomB"]);
		await vi.waitFor(() => expect(socket.rooms.list()).toEqual(expect.arrayContaining(["roomA", "roomB"])));

		socket.rooms.bulk.lifecycle.onLeaveError(bulkLeaveError);

		socket.rooms.bulk.leave(["roomA", "roomB"]);
		await vi.waitFor(() => expect(bulkLeaveError).toHaveBeenCalledWith(["roomA", "roomB"], { reason: "required" }));
		expect(socket.rooms.list()).toEqual(expect.arrayContaining(["roomA", "roomB"]));

		socket.close();
	});

	it("should bulk emit to multiple rooms", async () => {
		const received: Array<{ room: string; data: unknown }> = [];
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if ("rooms" in msg && !("type" in msg)) {
					received.push({ room: "", data: msg });
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.bulk.emit(["roomA", "roomB"], "echo", { message: "bulk" });

		await vi.waitFor(() => expect(received.length).toBeGreaterThanOrEqual(1));
		const sent = received[0]?.data;
		expect(sent).toMatchObject({
			rooms: ["roomA", "roomB"],
			event: "echo",
			data: { message: "bulk" },
		});
		socket.close();
	});

	it("should handle server message targeting multiple rooms", async () => {
		const handlerA = vi.fn();
		const handlerB = vi.fn();

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.on("roomA", "echo", handlerA);
		socket.rooms.on("roomB", "echo", handlerB);

		const msg = JSON.stringify({ rooms: ["roomA", "roomB"], event: "echo", data: { message: "multi" } });
		for (const ws of wss.clients) {
			ws.send(msg);
		}

		await vi.waitFor(() => {
			expect(handlerA).toHaveBeenCalledWith({ message: "multi" });
			expect(handlerB).toHaveBeenCalledWith({ message: "multi" });
		});
		socket.close();
	});

	it("should warn on empty arrays in bulk join/leave", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			serialization: "json",
			debug: true,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.bulk.join([]);
		await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("can't join empty array")));

		socket.rooms.bulk.leave([]);
		await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("can't leave empty array")));

		warnSpy.mockRestore();
		socket.close();
	});

	it("should handle stale bulk join success gracefully", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { debug: true, serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const msg = JSON.stringify({ type: LifecycleTypes.join_rooms_success, rooms: ["ghostA", "ghostB"] });
		for (const ws of wss.clients) {
			ws.send(msg);
		}

		await vi.waitFor(() => {
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("stale"));
		});
		warnSpy.mockRestore();
		socket.close();
	});

	it("should call bulk onceJoinSuccess only once", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_rooms_success, rooms: msg.rooms }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.rooms.bulk.lifecycle.onceJoinSuccess(handler);

		socket.rooms.bulk.join(["a", "b"]);
		await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(["a", "b"]));

		socket.rooms.bulk.join(["c", "d"]);
		await vi.waitFor(() => expect(socket.rooms.list()).toEqual(expect.arrayContaining(["c", "d"])));
		expect(handler).toHaveBeenCalledTimes(1);
		socket.close();
	});

	it("should remove bulk join success listener with offJoinSuccess", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_rooms_success, rooms: msg.rooms }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.rooms.bulk.lifecycle.onJoinSuccess(handler);
		socket.rooms.bulk.lifecycle.offJoinSuccess(handler);

		socket.rooms.bulk.join(["x", "y"]);
		await vi.waitFor(() => expect(socket.rooms.list()).toEqual(expect.arrayContaining(["x", "y"])));
		expect(handler).not.toHaveBeenCalled();
		socket.close();
	});

	it("should call bulk onceLeaveSuccess only once", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_rooms_success, rooms: msg.rooms }));
				} else if (msg.type === LifecycleTypes.leave_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.leave_rooms_success, rooms: msg.rooms }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.bulk.join(["roomA", "roomB"]);
		await vi.waitFor(() => expect(socket.rooms.list()).toEqual(expect.arrayContaining(["roomA", "roomB"])));

		const handler = vi.fn();
		socket.rooms.bulk.lifecycle.onceLeaveSuccess(handler);

		socket.rooms.bulk.leave(["roomA"]);
		await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(["roomA"]));
		expect(handler).toHaveBeenCalledTimes(1);

		socket.rooms.bulk.leave(["roomB"]);
		await vi.waitFor(() => expect(socket.rooms.list()).toEqual([]));
		expect(handler).toHaveBeenCalledTimes(1);

		socket.close();
	});

	it("should call onceLeaveError (bulk) only once", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_rooms_success, rooms: msg.rooms }));
				} else if (msg.type === LifecycleTypes.leave_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.leave_rooms_error, rooms: msg.rooms, data: { reason: "cannot" } }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.bulk.join(["roomA", "roomB"]);
		await vi.waitFor(() => expect(socket.rooms.list()).toEqual(expect.arrayContaining(["roomA", "roomB"])));

		const handler = vi.fn();
		socket.rooms.bulk.lifecycle.onceLeaveError(handler);

		socket.rooms.bulk.leave(["roomA"]);
		await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(["roomA"], { reason: "cannot" }));
		expect(handler).toHaveBeenCalledTimes(1);

		socket.rooms.bulk.leave(["roomB"]);
		await vi.waitFor(() => expect(socket.rooms.list()).toEqual(expect.arrayContaining(["roomA", "roomB"])));
		expect(handler).toHaveBeenCalledTimes(1);
		socket.close();
	});

	it("should remove bulk leave success listener with offLeaveSuccess", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_rooms_success, rooms: msg.rooms }));
				} else if (msg.type === LifecycleTypes.leave_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.leave_rooms_success, rooms: msg.rooms }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.rooms.bulk.lifecycle.onLeaveSuccess(handler);
		socket.rooms.bulk.lifecycle.offLeaveSuccess(handler);

		socket.rooms.bulk.join(["x", "y"]);
		await vi.waitFor(() => expect(socket.rooms.list()).toEqual(expect.arrayContaining(["x", "y"])));

		socket.rooms.bulk.leave(["x", "y"]);
		await vi.waitFor(() => expect(socket.rooms.list()).toEqual([]));
		expect(handler).not.toHaveBeenCalled();
		socket.close();
	});

	it("should warn when all requested rooms are already joined in bulk join", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_room_success, room: msg.room }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { debug: true, serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.join("lobby");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("lobby"));

		socket.rooms.bulk.join(["lobby"]);
		await vi.waitFor(() =>
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("all rooms you requested to join are joined or pending joining already")),
		);
		warnSpy.mockRestore();
		socket.close();
	});

	it("should warn when all requested rooms are already left in bulk leave", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { debug: true, serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.bulk.leave(["unjoined"]);
		await vi.waitFor(() =>
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("all rooms you requested to leave are left or pending leaving already")),
		);
		warnSpy.mockRestore();
		socket.close();
	});

	it("should handle stale bulk leave success gracefully", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { debug: true, serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const msg = JSON.stringify({ type: LifecycleTypes.leave_rooms_success, rooms: ["ghost1", "ghost2"] });
		for (const ws of wss.clients) {
			ws.send(msg);
		}

		await vi.waitFor(() => {
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("stale"));
		});
		warnSpy.mockRestore();
		socket.close();
	});

	it("should handle stale bulk error message gracefully", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { debug: true, serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const msg = JSON.stringify({ type: LifecycleTypes.join_rooms_error, rooms: ["unknown"], data: {} });
		for (const ws of wss.clients) {
			ws.send(msg);
		}

		await vi.waitFor(() => {
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("stale"));
		});
		warnSpy.mockRestore();
		socket.close();
	});

	it("should call onceJoinError (bulk) only once", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_rooms_error, rooms: msg.rooms, data: { reason: "no-entry" } }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.rooms.bulk.lifecycle.onceJoinError(handler);

		socket.rooms.bulk.join(["room1", "room2"]);
		await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(["room1", "room2"], { reason: "no-entry" }));
		expect(handler).toHaveBeenCalledTimes(1);

		socket.rooms.bulk.join(["room3"]);
		await vi.waitFor(() => expect(socket.rooms.list()).not.toContain("room3"));
		expect(handler).toHaveBeenCalledTimes(1);
		socket.close();
	});

	it("should remove bulk join error listener with offJoinError", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_rooms_error, rooms: msg.rooms, data: { reason: "blocked" } }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.rooms.bulk.lifecycle.onJoinError(handler);
		socket.rooms.bulk.lifecycle.offJoinError(handler);

		socket.rooms.bulk.join(["badRoom"]);
		await vi.waitFor(() => expect(socket.rooms.list()).not.toContain("badRoom"));
		await vi.waitFor(() => expect(handler).not.toHaveBeenCalled());
		socket.close();
	});

	it("should remove bulk leave error listener with offLeaveError", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_rooms_success, rooms: msg.rooms }));
				} else if (msg.type === LifecycleTypes.leave_rooms) {
					ws.send(JSON.stringify({ type: LifecycleTypes.leave_rooms_error, rooms: msg.rooms, data: { reason: "keep" } }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.rooms.bulk.lifecycle.onLeaveError(handler);
		socket.rooms.bulk.lifecycle.offLeaveError(handler);

		socket.rooms.bulk.join(["stayRoom"]);
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("stayRoom"));
		socket.rooms.bulk.leave(["stayRoom"]);
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("stayRoom"));
		await vi.waitFor(() => expect(handler).not.toHaveBeenCalled());
		socket.close();
	});
});
