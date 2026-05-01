// packages/core/tests/byte-socket-base.test.ts
import { LifecycleTypes } from "@bytesocket/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ByteSocketBase } from "../src/byte-socket-base";

class TestSocketBase extends ByteSocketBase {
	debug = false;
}

describe("ByteSocketBase - callbacks (_on, _off, _once)", () => {
	let base: TestSocketBase;

	beforeEach(() => {
		base = new TestSocketBase();
	});

	it("_on adds a callback and triggers it", () => {
		const cb = vi.fn();
		base["_on"]("test", cb);
		base["_triggerCallbacks"](base["_callbacksMap"].get("test"), "hello");
		expect(cb).toHaveBeenCalledWith("hello");
	});

	it("_off with no callback clears the whole event", () => {
		const cb = vi.fn();
		base["_on"]("test", cb);
		base["_off"]("test");
		base["_triggerCallbacks"](base["_callbacksMap"].get("test"), "hello");
		expect(cb).not.toHaveBeenCalled();
		expect(base["_callbacksMap"].has("test")).toBe(false);
		expect(base["_onceCallbacksMap"].has("test")).toBe(false);
	});

	it("_off with a specific callback removes only that one", () => {
		const cb1 = vi.fn();
		const cb2 = vi.fn();
		base["_on"]("test", cb1);
		base["_on"]("test", cb2);
		base["_off"]("test", cb1);
		base["_triggerCallbacks"](base["_callbacksMap"].get("test"), "arg");
		expect(cb1).not.toHaveBeenCalled();
		expect(cb2).toHaveBeenCalledWith("arg");
	});

	it("_off with a callback that has once wrappers removes them all", () => {
		const cb = vi.fn();
		base["_once"]("test", cb);
		base["_once"]("test", cb);
		base["_off"]("test", cb);

		base["_triggerCallbacks"](base["_callbacksMap"].get("test"), "arg");

		expect(cb).not.toHaveBeenCalled();

		expect(base["_callbacksMap"].has("test")).toBe(false);
		expect(base["_onceCallbacksMap"].has("test")).toBe(false);
	});

	it("_once registers a callback that runs only once", () => {
		const cb = vi.fn();
		base["_once"]("test", cb);

		base["_triggerCallbacks"](base["_callbacksMap"].get("test"), "first");
		expect(cb).toHaveBeenCalledTimes(1);
		expect(cb).toHaveBeenCalledWith("first");

		expect(base["_callbacksMap"].has("test")).toBe(false);
		expect(base["_onceCallbacksMap"].has("test")).toBe(false);

		base["_triggerCallbacks"](base["_callbacksMap"].get("test"), "second");
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it("_once callback can be removed before it fires", () => {
		const cb = vi.fn();
		base["_once"]("test", cb);
		base["_off"]("test", cb);

		base["_triggerCallbacks"](base["_callbacksMap"].get("test"), "arg");
		expect(cb).not.toHaveBeenCalled();
	});
});

describe("ByteSocketBase - room callbacks (_onRoom, _offRoom, _onceRoom)", () => {
	let base: TestSocketBase;

	beforeEach(() => {
		base = new TestSocketBase();
	});

	it("_onRoom adds and triggers a room callback", () => {
		const cb = vi.fn();
		base["_onRoom"]("roomA", "ev", cb);
		const roomMap = base["_roomCallbacksMap"].get("roomA");
		base["_triggerCallbacks"](roomMap?.get("ev"), "data");
		expect(cb).toHaveBeenCalledWith("data");
	});

	it("_offRoom with only room clears everything for that room", () => {
		const cb = vi.fn();
		base["_onRoom"]("roomA", "ev", cb);
		base["_offRoom"]("roomA");

		expect(base["_roomCallbacksMap"].has("roomA")).toBe(false);
		expect(base["_onceRoomCallbacksMap"].has("roomA")).toBe(false);
	});

	it("_offRoom with room and event clears only that event", () => {
		const cb1 = vi.fn();
		const cb2 = vi.fn();
		base["_onRoom"]("roomA", "ev1", cb1);
		base["_onRoom"]("roomA", "ev2", cb2);
		base["_offRoom"]("roomA", "ev1");

		const roomMap = base["_roomCallbacksMap"].get("roomA");
		expect(roomMap?.has("ev1")).toBe(false);
		expect(roomMap?.has("ev2")).toBe(true);
	});

	it("_offRoom with room, event and callback removes specific callback", () => {
		const cb1 = vi.fn();
		const cb2 = vi.fn();
		base["_onRoom"]("roomA", "ev", cb1);
		base["_onRoom"]("roomA", "ev", cb2);
		base["_offRoom"]("roomA", "ev", cb1);

		const roomMap = base["_roomCallbacksMap"].get("roomA");
		base["_triggerCallbacks"](roomMap?.get("ev"), "arg");
		expect(cb1).not.toHaveBeenCalled();
		expect(cb2).toHaveBeenCalledWith("arg");
	});

	it("_onceRoom fires only once and cleans up", () => {
		const cb = vi.fn();
		base["_onceRoom"]("roomA", "ev", cb);

		const roomMap = base["_roomCallbacksMap"].get("roomA");
		base["_triggerCallbacks"](roomMap?.get("ev"), "first");
		expect(cb).toHaveBeenCalledTimes(1);
		expect(cb).toHaveBeenCalledWith("first");

		expect(base["_roomCallbacksMap"].has("roomA")).toBe(false);
		expect(base["_onceRoomCallbacksMap"].has("roomA")).toBe(false);
	});

	it("_offRoom with callback removes once wrappers", () => {
		const cb = vi.fn();
		base["_onceRoom"]("roomA", "ev", cb);
		base["_offRoom"]("roomA", "ev", cb);

		expect(base["_roomCallbacksMap"].has("roomA")).toBe(false);
		expect(base["_onceRoomCallbacksMap"].has("roomA")).toBe(false);

		expect(cb).not.toHaveBeenCalled();
	});

	it("_offRoom does nothing when room doesn't exist", () => {
		expect(() => base["_offRoom"]("unknown")).not.toThrow();

		expect(base["_roomCallbacksMap"].size).toBe(0);
		expect(base["_onceRoomCallbacksMap"].size).toBe(0);

		expect(() => base["_offRoom"]("unknown", "ev")).not.toThrow();
		expect(() => base["_offRoom"]("unknown", "ev", vi.fn())).not.toThrow();
	});

	it("_offRoom with room and event deletes the room when last event is removed", () => {
		const cb = vi.fn();
		base["_onRoom"]("roomA", "ev", cb);
		base["_offRoom"]("roomA", "ev");

		expect(base["_roomCallbacksMap"].has("roomA")).toBe(false);
		expect(base["_onceRoomCallbacksMap"].has("roomA")).toBe(false);
	});
});

describe("ByteSocketBase - lifecycle callbacks (_onLifecycle, _offLifecycle, _onceLifecycle)", () => {
	let base: TestSocketBase;

	beforeEach(() => {
		base = new TestSocketBase();
	});

	it("_onLifecycle adds and triggers", () => {
		const cb = vi.fn();
		base["_onLifecycle"](LifecycleTypes.message, cb);
		base["_triggerCallbacks"](base["_lifecycleCallbacksMap"].get(LifecycleTypes.message), "p1", "p2");
		expect(cb).toHaveBeenCalledWith("p1", "p2");
	});

	it("_offLifecycle clears all callbacks for type when no callback given", () => {
		const cb = vi.fn();
		base["_onLifecycle"](LifecycleTypes.message, cb);
		base["_offLifecycle"](LifecycleTypes.message);

		expect(base["_lifecycleCallbacksMap"].has(LifecycleTypes.message)).toBe(false);
		expect(base["_onceLifecycleCallbacksMap"].has(LifecycleTypes.message)).toBe(false);
	});

	it("_offLifecycle with callback removes only that callback and its once wrappers", () => {
		const cb1 = vi.fn();
		const cb2 = vi.fn();
		base["_onceLifecycle"](LifecycleTypes.message, cb1);
		base["_onLifecycle"](LifecycleTypes.message, cb2);
		base["_offLifecycle"](LifecycleTypes.message, cb1);

		base["_triggerCallbacks"](base["_lifecycleCallbacksMap"].get(LifecycleTypes.message), "data");
		expect(cb1).not.toHaveBeenCalled();
		expect(cb2).toHaveBeenCalledWith("data");
	});

	it("_onceLifecycle fires only once (already partially covered)", () => {
		const cb = vi.fn();
		base["_onceLifecycle"](LifecycleTypes.message, cb);
		base["_triggerCallbacks"](base["_lifecycleCallbacksMap"].get(LifecycleTypes.message));
		expect(cb).toHaveBeenCalledTimes(1);

		expect(base["_lifecycleCallbacksMap"].has(LifecycleTypes.message)).toBe(false);
		expect(base["_onceLifecycleCallbacksMap"].has(LifecycleTypes.message)).toBe(false);
	});
});

describe("ByteSocketBase - _triggerCallbacks & _clearCallbacks edge cases", () => {
	let base: TestSocketBase;

	beforeEach(() => {
		base = new TestSocketBase();
	});

	it("does nothing when callbackSet is undefined", () => {
		expect(() => base["_triggerCallbacks"](undefined, "x")).not.toThrow();
	});

	it("catches errors in debug mode (already covered), but silent when debug false", () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		base.debug = false;

		const errorCb = vi.fn(() => {
			throw new Error("silent error");
		});
		base["_addCallback"](base["_lifecycleCallbacksMap"], LifecycleTypes.message, errorCb);
		base["_triggerCallbacks"](base["_lifecycleCallbacksMap"].get(LifecycleTypes.message));

		expect(consoleSpy).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("should log errors when debug is true", () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		base["_debug"] = true;

		const errorCb = vi.fn(() => {
			throw new Error("debug error");
		});
		base["_addCallback"](base["_lifecycleCallbacksMap"], LifecycleTypes.message, errorCb);
		base["_triggerCallbacks"](base["_lifecycleCallbacksMap"].get(LifecycleTypes.message));

		expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
		consoleSpy.mockRestore();
	});

	it("skips callbacks that are removed during iteration", () => {
		const cb1 = vi.fn();
		const cb2 = vi.fn(() => {
			base["_deleteCallback"](base["_lifecycleCallbacksMap"], LifecycleTypes.message, cb3);
		});
		const cb3 = vi.fn();

		base["_addCallback"](base["_lifecycleCallbacksMap"], LifecycleTypes.message, cb1);
		base["_addCallback"](base["_lifecycleCallbacksMap"], LifecycleTypes.message, cb2);
		base["_addCallback"](base["_lifecycleCallbacksMap"], LifecycleTypes.message, cb3);

		base["_triggerCallbacks"](base["_lifecycleCallbacksMap"].get(LifecycleTypes.message));

		expect(cb1).toHaveBeenCalled();
		expect(cb2).toHaveBeenCalled();

		expect(cb3).not.toHaveBeenCalled();
	});

	it("_clearCallbacks empties all callback maps", () => {
		base["_on"]("ev", vi.fn());
		base["_onRoom"]("room1", "ev", vi.fn());
		base["_onLifecycle"](LifecycleTypes.message, vi.fn());

		base["_clearCallbacks"]();

		expect(base["_callbacksMap"].size).toBe(0);
		expect(base["_onceCallbacksMap"].size).toBe(0);
		expect(base["_roomCallbacksMap"].size).toBe(0);
		expect(base["_onceRoomCallbacksMap"].size).toBe(0);
		expect(base["_lifecycleCallbacksMap"].size).toBe(0);
		expect(base["_onceLifecycleCallbacksMap"].size).toBe(0);
	});
});

describe("ByteSocketBase - encode / decode", () => {
	let base: TestSocketBase;

	beforeEach(() => {
		base = new TestSocketBase();
	});

	it("binary encode and decode round-trip", () => {
		const input = { hello: "world", num: 123 };
		const encoded = base.encode(input, "binary") as Uint8Array;
		const decoded = base.decode(encoded);
		expect(decoded).toEqual(input);
	});

	it("JSON encode and decode round-trip", () => {
		const input = { a: 1, b: [2, "three"] };
		const encoded = base.encode(input, "json") as string;
		expect(typeof encoded).toBe("string");
		const decoded = base.decode(encoded);
		expect(decoded).toEqual(input);
	});

	it("decode with isBinary = true on a string throws", () => {
		expect(() => base.decode("some string", true)).toThrow("Received string but expected binary");
	});

	it("decode with isBinary = false on a Uint8Array treats it as text JSON", () => {
		const json = JSON.stringify({ x: 1 });
		const encoded = new TextEncoder().encode(json);
		const result = base.decode(encoded, false);
		expect(result).toEqual({ x: 1 });
	});

	it("decode an array of Uint8Arrays by concatenating them", () => {
		const input = { arr: [1, 2, 3] };
		const full = base.encode(input, "binary") as Uint8Array;
		const part1 = full.slice(0, 2);
		const part2 = full.slice(2);
		const decoded = base.decode([part1, part2]);
		expect(decoded).toEqual(input);
	});

	it("accepts custom msgpackrOptions in constructor", () => {
		const customStructures = [["customKey"]];
		const b = new TestSocketBase({
			msgpackrOptions: { structures: customStructures },
		});

		const packr = b["_msgpackrOptions"];
		expect(packr).toBeDefined();
		expect(packr.useRecords).toBe(false);

		const structures = b["_defaultStructures"];
		expect(structures.some((s: string[]) => s[0] === "type")).toBe(true);
		expect(structures.some((s: string[]) => s[0] === "customKey")).toBe(false);
	});
});

describe("ByteSocketBase - guard functions", () => {
	let base: TestSocketBase;

	beforeEach(() => {
		base = new TestSocketBase();
	});

	it("_isObject", () => {
		expect(base["_isObject"]({})).toBe(true);
		expect(base["_isObject"](null)).toBe(false);
		expect(base["_isObject"](42)).toBe(false);
	});

	it("_isObjectEvent", () => {
		expect(base["_isObjectEvent"]({ event: "foo" })).toBe(true);
		expect(base["_isObjectEvent"]({ event: 123 })).toBe(true);
		expect(base["_isObjectEvent"]({})).toBe(false);
		expect(base["_isObjectEvent"]({ data: 1 })).toBe(false);
	});

	it("_isObjectRoom", () => {
		expect(base["_isObjectRoom"]({ room: "lobby" })).toBe(true);
		expect(base["_isObjectRoom"]({ room: 123 })).toBe(false);
		expect(base["_isObjectRoom"]({})).toBe(false);
	});

	it("_isObjectRooms", () => {
		expect(base["_isObjectRooms"]({ rooms: ["a", "b"] })).toBe(true);
		expect(base["_isObjectRooms"]({ rooms: ["a", 1] })).toBe(false);
		expect(base["_isObjectRooms"]({ rooms: "a" })).toBe(false);
	});

	it("_isObjectLifecycle", () => {
		expect(base["_isObjectLifecycle"]({ type: LifecycleTypes.message })).toBe(true);
		expect(base["_isObjectLifecycle"]({ type: 999 })).toBe(false);
	});

	it("_isLifecycleMessage", () => {
		expect(base["_isLifecycleMessage"](LifecycleTypes.message, { type: LifecycleTypes.message })).toBe(true);
		expect(base["_isLifecycleMessage"](LifecycleTypes.close, { type: LifecycleTypes.message })).toBe(false);
	});

	it("_isLifecyclePayloadMessage", () => {
		expect(
			base["_isLifecyclePayloadMessage"](LifecycleTypes.message, {
				type: LifecycleTypes.message,
				data: 1,
			}),
		).toBe(true);
		expect(
			base["_isLifecyclePayloadMessage"](LifecycleTypes.message, {
				type: LifecycleTypes.message,
			}),
		).toBe(false);
	});

	it("_isLifecycleRoomMessage", () => {
		const obj = { type: LifecycleTypes.join_room, room: "x" };
		expect(base["_isLifecycleRoomMessage"](LifecycleTypes.join_room, obj)).toBe(true);
		expect(base["_isLifecycleRoomMessage"](LifecycleTypes.leave_room, obj)).toBe(false);
	});

	it("_isLifecycleRoomsMessage", () => {
		const obj = { type: LifecycleTypes.join_rooms, rooms: ["x"] };
		expect(base["_isLifecycleRoomsMessage"](LifecycleTypes.join_rooms, obj)).toBe(true);
		expect(base["_isLifecycleRoomsMessage"](LifecycleTypes.join_rooms, { type: LifecycleTypes.join_rooms })).toBe(false);
	});

	it("_isLifecycleRoomErrorMessage", () => {
		const obj = { type: LifecycleTypes.join_room_error, room: "r", data: {} };
		expect(base["_isLifecycleRoomErrorMessage"](obj)).toBe(true);
		expect(base["_isLifecycleRoomErrorMessage"]({ type: LifecycleTypes.join_room_error, room: "r" })).toBe(false);

		const leaveObj = { type: LifecycleTypes.leave_room_error, room: "r", data: {} };
		expect(base["_isLifecycleRoomErrorMessage"](leaveObj)).toBe(true);
	});

	it("_isLifecycleRoomsErrorMessage", () => {
		const obj = { type: LifecycleTypes.join_rooms_error, rooms: ["a"], data: {} };
		expect(base["_isLifecycleRoomsErrorMessage"](obj)).toBe(true);

		const leaveObj = { type: LifecycleTypes.leave_rooms_error, rooms: ["a"], data: {} };
		expect(base["_isLifecycleRoomsErrorMessage"](leaveObj)).toBe(true);
	});

	it("_isEventMessage", () => {
		expect(base["_isEventMessage"]({ event: "ev", data: 1 })).toBe(true);
		expect(base["_isEventMessage"]({ event: "ev" })).toBe(true);
		expect(base["_isEventMessage"]({})).toBe(false);
	});

	it("_isRoomEventMessage", () => {
		expect(base["_isRoomEventMessage"]({ room: "r", event: "e", data: 1 })).toBe(true);
	});

	it("_isRoomsEventMessage", () => {
		expect(base["_isRoomsEventMessage"]({ rooms: ["r1"], event: "e", data: 1 })).toBe(true);
	});
});
