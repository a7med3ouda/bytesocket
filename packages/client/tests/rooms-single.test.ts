// packages/client/tests/rooms-single.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { ByteSocket, LifecycleTypes, type SocketEvents } from "../src";

type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;

describe("ByteSocket Client: Single-room Operations", () => {
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

	it("should handle room join success/error lifecycle", async () => {
		const joinSuccess = vi.fn();
		const joinError = vi.fn();

		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					if (msg.room === "fail") {
						ws.send(
							JSON.stringify({
								type: LifecycleTypes.join_room_error,
								room: msg.room,
								data: { reason: "forbidden" },
							}),
						);
					} else {
						ws.send(
							JSON.stringify({
								type: LifecycleTypes.join_room_success,
								room: msg.room,
							}),
						);
					}
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.lifecycle.onJoinSuccess(joinSuccess);
		socket.rooms.lifecycle.onJoinError(joinError);

		socket.rooms.join("lobby");
		await vi.waitFor(() => expect(joinSuccess).toHaveBeenCalledWith("lobby"));
		expect(socket.rooms.list()).toContain("lobby");

		socket.rooms.join("fail");
		await vi.waitFor(() => expect(joinError).toHaveBeenCalledWith("fail", { reason: "forbidden" }));
		expect(socket.rooms.list()).not.toContain("fail");

		socket.close();
	});

	it("should handle single-room leave success/error lifecycle", async () => {
		const leaveSuccess = vi.fn();
		const leaveError = vi.fn();

		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_room_success, room: msg.room }));
				} else if (msg.type === LifecycleTypes.leave_room) {
					if (msg.room === "fail") {
						ws.send(
							JSON.stringify({
								type: LifecycleTypes.leave_room_error,
								room: msg.room,
								data: { reason: "still needed" },
							}),
						);
					} else {
						ws.send(JSON.stringify({ type: LifecycleTypes.leave_room_success, room: msg.room }));
					}
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.join("lobby");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("lobby"));

		socket.rooms.lifecycle.onLeaveSuccess(leaveSuccess);
		socket.rooms.lifecycle.onLeaveError(leaveError);

		socket.rooms.leave("lobby");
		await vi.waitFor(() => expect(leaveSuccess).toHaveBeenCalledWith("lobby"));
		expect(socket.rooms.list()).not.toContain("lobby");

		socket.rooms.join("fail");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("fail"));
		socket.rooms.leave("fail");
		await vi.waitFor(() => expect(leaveError).toHaveBeenCalledWith("fail", { reason: "still needed" }));
		expect(socket.rooms.list()).toContain("fail");

		socket.close();
	});

	it("should ignore duplicate join requests for same room", async () => {
		const joinSent = vi.fn();

		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					joinSent(msg.room);
					ws.send(JSON.stringify({ type: LifecycleTypes.join_room_success, room: msg.room }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.join("lobby");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("lobby"));
		expect(joinSent).toHaveBeenCalledTimes(1);

		socket.rooms.join("lobby");
		await vi.waitFor(() => expect(joinSent).toHaveBeenCalledTimes(1));

		socket.close();
	});

	it("should ignore leaving an unjoined room", async () => {
		const leaveSent = vi.fn();

		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.leave_room) {
					leaveSent(msg.room);
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.leave("unjoined");
		await vi.waitFor(() => expect(leaveSent).not.toHaveBeenCalled());

		socket.close();
	});

	it("should receive room events (on)", async () => {
		const handler = vi.fn();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.on("lobby", "echo", handler);
		const msg = JSON.stringify({ room: "lobby", event: "echo", data: { message: "hi" } });
		for (const ws of wss.clients) {
			ws.send(msg);
		}

		await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ message: "hi" }));
		socket.close();
	});

	it("should call once listener only once", async () => {
		const handler = vi.fn();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.once("lobby", "echo", handler);
		const msg = JSON.stringify({ room: "lobby", event: "echo", data: { message: "first" } });
		for (const ws of wss.clients) {
			ws.send(msg);
		}
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

		for (const ws of wss.clients) {
			ws.send(msg);
		}
		await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
		socket.close();
	});

	it("should remove listeners with off", async () => {
		const handler = vi.fn();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.on("lobby", "echo", handler);
		socket.rooms.off("lobby", "echo", handler);
		const msg = JSON.stringify({ room: "lobby", event: "echo", data: { message: "removed" } });
		for (const ws of wss.clients) {
			ws.send(msg);
		}
		await vi.waitFor(() => expect(handler).not.toHaveBeenCalled());
		socket.close();
	});

	it("should remove all listeners for a room event when no callback given", async () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.on("lobby", "echo", handler1);
		socket.rooms.on("lobby", "echo", handler2);
		socket.rooms.off("lobby", "echo");
		const msg = JSON.stringify({ room: "lobby", event: "echo", data: { message: "test" } });
		for (const ws of wss.clients) {
			ws.send(msg);
		}
		await vi.waitFor(() => expect(handler1).not.toHaveBeenCalled());
		await vi.waitFor(() => expect(handler2).not.toHaveBeenCalled());
		socket.close();
	});

	it("should remove all listeners for a room when no event given", async () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.on("lobby", "echo", handler1);
		socket.rooms.on("lobby", "broadcast", handler2);
		socket.rooms.off("lobby");
		const msg1 = JSON.stringify({ room: "lobby", event: "echo", data: { message: "test" } });
		const msg2 = JSON.stringify({ room: "lobby", event: "broadcast", data: { text: "hi" } });
		for (const ws of wss.clients) {
			ws.send(msg1);
		}
		for (const ws of wss.clients) {
			ws.send(msg2);
		}
		await vi.waitFor(() => expect(handler1).not.toHaveBeenCalled());
		await vi.waitFor(() => expect(handler2).not.toHaveBeenCalled());
		socket.close();
	});

	it("should emit a single-room event to the server", async () => {
		const received: unknown[] = [];
		wss.on("connection", (ws) => {
			ws.on("message", (data) => received.push(JSON.parse(data.toString())));
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.emit("lobby", "echo", { message: "single" });
		await vi.waitFor(() => expect(received.length).toBe(1));
		expect(received[0]).toMatchObject({ room: "lobby", event: "echo", data: { message: "single" } });
		socket.close();
	});

	it("should call onceJoinSuccess only once", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_room_success, room: msg.room }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.rooms.lifecycle.onceJoinSuccess(handler);

		socket.rooms.join("room1");
		await vi.waitFor(() => expect(handler).toHaveBeenCalledWith("room1"));
		socket.rooms.join("room2");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("room2"));
		expect(handler).toHaveBeenCalledTimes(1);
		socket.close();
	});

	it("should remove join success listener with offJoinSuccess", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_room_success, room: msg.room }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.rooms.lifecycle.onJoinSuccess(handler);
		socket.rooms.lifecycle.offJoinSuccess(handler);

		socket.rooms.join("lobby");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("lobby"));
		expect(handler).not.toHaveBeenCalled();
		socket.close();
	});

	it("should handle stale room messages gracefully", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			serialization: "json",
			debug: true,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const rawMsg = JSON.stringify({ type: LifecycleTypes.join_room_success, room: "ghost" });
		for (const ws of wss.clients) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(rawMsg);
			}
		}

		await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("stale")));
		expect(socket.rooms.list()).not.toContain("ghost");
		warnSpy.mockRestore();
		socket.close();
	});

	it("should handle stale leave success message gracefully", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			serialization: "json",
			debug: true,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const msg = JSON.stringify({ type: LifecycleTypes.leave_room_success, room: "ghost" });
		for (const ws of wss.clients) {
			ws.send(msg);
		}

		await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("stale")));
		warnSpy.mockRestore();
		socket.close();
	});

	it("should handle stale room error message gracefully", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			serialization: "json",
			debug: true,
		});
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const msg = JSON.stringify({ type: LifecycleTypes.join_room_error, room: "unknown", data: {} });
		for (const ws of wss.clients) {
			ws.send(msg);
		}

		await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("stale")));
		warnSpy.mockRestore();
		socket.close();
	});

	it("should recover room state after reconnect", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_room_success, room: msg.room }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, {
			serialization: "json",
			reconnection: true,
			reconnectionDelay: 50,
			maxReconnectionAttempts: 2,
		});

		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.join("persistent");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("persistent"));

		const closePromise = new Promise<void>((resolve) => socket.lifecycle.onceClose(() => resolve()));
		for (const ws of wss.clients) {
			ws.terminate();
		}
		await closePromise;

		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN), { timeout: 2000 });
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("persistent"), { timeout: 1000 });

		socket.destroy();
	});

	it("should clear room state on close/destroy", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_room_success, room: msg.room }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.join("testRoom");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("testRoom"));
		socket.destroy();
		expect(socket.rooms.list()).toEqual([]);
	});

	it("should reset room joined states on socket close", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_room_success, room: msg.room }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.join("tempRoom");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("tempRoom"));

		const closePromise = new Promise<void>((resolve) => socket.lifecycle.onceClose(() => resolve()));
		for (const ws of wss.clients) {
			ws.close();
		}
		await closePromise;
		expect(socket.rooms.list()).toEqual([]);
		socket.destroy();
	});

	it("should call onceLeaveSuccess only once", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_room_success, room: msg.room }));
				} else if (msg.type === LifecycleTypes.leave_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.leave_room_success, room: msg.room }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.join("lobby");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("lobby"));

		const handler = vi.fn();
		socket.rooms.lifecycle.onceLeaveSuccess(handler);

		socket.rooms.leave("lobby");
		await vi.waitFor(() => expect(handler).toHaveBeenCalledWith("lobby"));

		socket.rooms.join("lobby");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("lobby"));
		socket.rooms.leave("lobby");
		await vi.waitFor(() => expect(socket.rooms.list()).not.toContain("lobby"));
		expect(handler).toHaveBeenCalledTimes(1);
		socket.close();
	});

	it("should remove join error listener with offJoinError", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_room_error, room: msg.room, data: { reason: "nope" } }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.rooms.lifecycle.onJoinError(handler);
		socket.rooms.lifecycle.offJoinError(handler);

		socket.rooms.join("restricted");
		await vi.waitFor(() => expect(socket.rooms.list()).not.toContain("restricted"));
		await vi.waitFor(() => expect(handler).not.toHaveBeenCalled());
		socket.close();
	});

	it("should call onceLeaveError only once", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_room_success, room: msg.room }));
				} else if (msg.type === LifecycleTypes.leave_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.leave_room_error, room: msg.room, data: { reason: "denied" } }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		socket.rooms.join("sticky");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("sticky"));

		const handler = vi.fn();
		socket.rooms.lifecycle.onceLeaveError(handler);

		socket.rooms.leave("sticky");
		await vi.waitFor(() => expect(handler).toHaveBeenCalledWith("sticky", { reason: "denied" }));
		expect(handler).toHaveBeenCalledTimes(1);

		socket.rooms.leave("sticky");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("sticky"));
		expect(handler).toHaveBeenCalledTimes(1);
		socket.close();
	});

	it("should call onceJoinError only once", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_room_error, room: msg.room, data: { reason: "denied" } }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.rooms.lifecycle.onceJoinError(handler);

		socket.rooms.join("blocked");
		await vi.waitFor(() => expect(handler).toHaveBeenCalledWith("blocked", { reason: "denied" }));
		expect(handler).toHaveBeenCalledTimes(1);

		socket.rooms.join("blocked2");
		await vi.waitFor(() => expect(socket.rooms.list()).not.toContain("blocked2"));
		expect(handler).toHaveBeenCalledTimes(1);
		socket.close();
	});

	it("should remove leave success listener with offLeaveSuccess", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_room_success, room: msg.room }));
				} else if (msg.type === LifecycleTypes.leave_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.leave_room_success, room: msg.room }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.rooms.lifecycle.onLeaveSuccess(handler);
		socket.rooms.lifecycle.offLeaveSuccess(handler);

		socket.rooms.join("lobby");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("lobby"));
		socket.rooms.leave("lobby");
		await vi.waitFor(() => expect(socket.rooms.list()).not.toContain("lobby"));
		expect(handler).not.toHaveBeenCalled();
		socket.close();
	});

	it("should remove leave error listener with offLeaveError", async () => {
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString());
				if (msg.type === LifecycleTypes.join_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.join_room_success, room: msg.room }));
				} else if (msg.type === LifecycleTypes.leave_room) {
					ws.send(JSON.stringify({ type: LifecycleTypes.leave_room_error, room: msg.room, data: { reason: "error" } }));
				}
			});
		});

		const socket = new ByteSocket<TestEvents>(`ws://localhost:${port}`, { serialization: "json" });
		await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.OPEN));

		const handler = vi.fn();
		socket.rooms.lifecycle.onLeaveError(handler);
		socket.rooms.lifecycle.offLeaveError(handler);

		socket.rooms.join("lobby");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("lobby"));
		socket.rooms.leave("lobby");
		await vi.waitFor(() => expect(socket.rooms.list()).toContain("lobby"));
		expect(handler).not.toHaveBeenCalled();
		socket.close();
	});
});
