// packages/core/src/byte-socket-base.ts
import { FLOAT32_OPTIONS, Packr, type Options } from "msgpackr";
import { LifecycleTypes } from "./enums";
import type { ByteSocketBaseOptions, IByteSocketBase } from "./interfaces";
import type { AnyCallback, Serialization } from "./types";

export abstract class ByteSocketBase implements IByteSocketBase {
	// ──── States ────────────────────────────────────────────────────────────────────────
	protected _defaultStructures: Array<Array<string>> = [
		["type"],
		["type", "room"],
		["type", "rooms"],
		["type", "data"],
		["type", "room", "data"],
		["type", "rooms", "data"],
		["room", "event", "data"],
		["rooms", "event", "data"],
		["event", "data"],
	];
	protected _packr: Packr;
	protected _msgpackrOptions: Options;
	protected _debug: boolean;
	protected _serialization: Serialization;

	// ──── Callbacks ────────────────────────────────────────────────────────────────────────

	protected _callbacksMap = new Map<string | number, Set<AnyCallback>>();
	protected _onceCallbacksMap = new Map<string | number, Map<AnyCallback, Set<AnyCallback>>>();
	protected _roomCallbacksMap = new Map<string, Map<string | number, Set<AnyCallback>>>();
	protected _onceRoomCallbacksMap = new Map<string, Map<string | number, Map<AnyCallback, Set<AnyCallback>>>>();
	protected _lifecycleCallbacksMap = new Map<string | number, Set<AnyCallback>>();
	protected _onceLifecycleCallbacksMap = new Map<string | number, Map<AnyCallback, Set<AnyCallback>>>();

	constructor(options: ByteSocketBaseOptions = {}) {
		const { debug, msgpackrOptions, serialization } = options;

		this._debug = debug ?? false;
		this._serialization = serialization ?? "binary";
		this._msgpackrOptions = {
			...msgpackrOptions,
			useRecords: false,
			structures: msgpackrOptions?.structures?.length ? [...this._defaultStructures, ...msgpackrOptions.structures] : this._defaultStructures,
			useFloat32: msgpackrOptions?.useFloat32 ?? FLOAT32_OPTIONS.DECIMAL_FIT,
			copyBuffers: msgpackrOptions?.copyBuffers ?? false,
			int64AsType: msgpackrOptions?.int64AsType ?? "bigint",
			bundleStrings: msgpackrOptions?.bundleStrings ?? true,
		};
		this._packr = new Packr(this._msgpackrOptions);
	}

	encode(payload: unknown, serialization = this._serialization): string | Buffer<ArrayBufferLike> {
		if (serialization === "binary") {
			return this._packr.pack(payload);
		} else {
			return JSON.stringify(payload);
		}
	}

	decode(message: string | ArrayBuffer | Uint8Array | Array<Uint8Array>, isBinary?: boolean): unknown {
		if (Array.isArray(message)) {
			let totalLength = 0;
			for (const arr of message) {
				totalLength += arr.length;
			}
			const result = new Uint8Array(totalLength);
			let offset = 0;
			for (const arr of message) {
				result.set(arr, offset);
				offset += arr.length;
			}
			return this.decode(result, isBinary);
		}

		if (typeof message === "string") {
			if (isBinary === true) {
				throw new Error("Received string but expected binary");
			}
			return JSON.parse(message);
		}

		if (isBinary === false) {
			const text = new TextDecoder().decode(message);
			return JSON.parse(text);
		}

		return this._packr.unpack(new Uint8Array(message));
	}

	// ──── Helpers ────────────────────────────────────────────────────────────────────────

	protected _on(event: string | number, callback: AnyCallback): void {
		this._addCallback(this._callbacksMap, event, callback);
	}

	protected _off(event: string | number, callback?: AnyCallback): void {
		if (!callback) {
			this._callbacksMap.delete(event);
			this._onceCallbacksMap.delete(event);
			return;
		}
		const onceEventMap = this._onceCallbacksMap.get(event);
		const wrappersSet = onceEventMap?.get(callback);
		if (wrappersSet) {
			for (const wrapper of [...wrappersSet]) {
				this._deleteCallback(this._callbacksMap, event, wrapper);
				this._deleteOnceCallback(this._onceCallbacksMap, event, callback, wrapper);
			}
		}
		this._deleteCallback(this._callbacksMap, event, callback);
	}

	protected _once(event: string | number, callback: AnyCallback): void {
		const callbackWrapper: AnyCallback = (...args) => {
			this._deleteCallback(this._callbacksMap, event, callbackWrapper);
			this._deleteOnceCallback(this._onceCallbacksMap, event, callback, callbackWrapper);
			callback(...args);
		};
		this._addOnceCallback(this._onceCallbacksMap, event, callback, callbackWrapper);
		this._addCallback(this._callbacksMap, event, callbackWrapper);
	}

	protected _clearCallbacks() {
		this._callbacksMap.clear();
		this._onceCallbacksMap.clear();
		this._roomCallbacksMap.clear();
		this._onceRoomCallbacksMap.clear();
		this._lifecycleCallbacksMap.clear();
		this._onceLifecycleCallbacksMap.clear();
	}

	protected _onRoom(room: string, event: string | number, callback: AnyCallback): void {
		this._addRoomCallback(room, event, callback);
	}

	protected _offRoom(room: string, event?: string | number, callback?: AnyCallback): void {
		const roomMap = this._roomCallbacksMap.get(room);
		if (!roomMap) {
			return;
		}
		if (event === undefined) {
			this._roomCallbacksMap.delete(room);
			this._onceRoomCallbacksMap.delete(room);
			return;
		}
		const onceRoomMap = this._onceRoomCallbacksMap.get(room);
		if (callback === undefined) {
			roomMap.delete(event);
			onceRoomMap?.delete(event);
			if (roomMap.size === 0) {
				this._roomCallbacksMap.delete(room);
				this._onceRoomCallbacksMap.delete(room);
			}
			return;
		}
		const onceEventMap = onceRoomMap?.get(event);
		const wrappersSet = onceEventMap?.get(callback);
		if (wrappersSet) {
			for (const wrapper of [...wrappersSet]) {
				this._deleteRoomCallback(room, event, wrapper);
				this._deleteOnceRoomCallback(room, event, callback, wrapper);
			}
		}
		this._deleteRoomCallback(room, event, callback);
	}

	protected _onceRoom(room: string, event: string | number, callback: AnyCallback): void {
		const callbackWrapper: AnyCallback = (...args) => {
			this._deleteRoomCallback(room, event, callbackWrapper);
			this._deleteOnceRoomCallback(room, event, callback, callbackWrapper);
			callback(...args);
		};
		this._addOnceRoomCallback(room, event, callback, callbackWrapper);
		this._addRoomCallback(room, event, callbackWrapper);
	}

	protected _onLifecycle<T extends LifecycleTypes>(type: T, callback: AnyCallback): void {
		this._addCallback(this._lifecycleCallbacksMap, type, callback);
	}

	protected _offLifecycle<T extends LifecycleTypes>(type: T, callback?: AnyCallback): void {
		if (!callback) {
			this._lifecycleCallbacksMap.delete(type);
			this._onceLifecycleCallbacksMap.delete(type);
			return;
		}
		const onceTypeMap = this._onceLifecycleCallbacksMap.get(type);
		const wrappersSet = onceTypeMap?.get(callback);
		if (wrappersSet) {
			for (const wrapper of [...wrappersSet]) {
				this._deleteCallback(this._lifecycleCallbacksMap, type, wrapper);
				this._deleteOnceCallback(this._onceLifecycleCallbacksMap, type, callback, wrapper);
			}
		}
		this._deleteCallback(this._lifecycleCallbacksMap, type, callback);
	}

	protected _onceLifecycle<T extends LifecycleTypes>(type: T, callback: AnyCallback): void {
		const callbackWrapper = <Args extends Array<unknown>>(...args: Args) => {
			this._deleteCallback(this._lifecycleCallbacksMap, type, callbackWrapper);
			this._deleteOnceCallback(this._onceLifecycleCallbacksMap, type, callback, callbackWrapper);
			callback(...args);
		};
		this._addOnceCallback(this._onceLifecycleCallbacksMap, type, callback, callbackWrapper);
		this._addCallback(this._lifecycleCallbacksMap, type, callbackWrapper);
	}

	protected _addCallback(callbacksMap: Map<string | number, Set<AnyCallback>>, event: string | number, callback: AnyCallback) {
		let eventCallbackSet = callbacksMap.get(event);
		if (!eventCallbackSet) {
			eventCallbackSet = new Set();
			callbacksMap.set(event, eventCallbackSet);
		}
		eventCallbackSet.add(callback);
	}

	protected _addOnceCallback(
		onceCallbacksMap: Map<string | number, Map<AnyCallback, Set<AnyCallback>>>,
		event: string | number,
		callback: AnyCallback,
		callbackWrapper: AnyCallback,
	) {
		let onceEventMap = onceCallbacksMap.get(event);
		if (!onceEventMap) {
			onceEventMap = new Map();
			onceCallbacksMap.set(event, onceEventMap);
		}
		let wrappersSet = onceEventMap.get(callback);
		if (!wrappersSet) {
			wrappersSet = new Set();
			onceEventMap.set(callback, wrappersSet);
		}
		wrappersSet.add(callbackWrapper);
	}

	protected _deleteCallback(callbacksMap: Map<string | number, Set<AnyCallback>>, event: string | number, callbackWrapper: AnyCallback) {
		const eventCallbackSet = callbacksMap.get(event);
		if (eventCallbackSet) {
			eventCallbackSet.delete(callbackWrapper);
			if (eventCallbackSet.size === 0) {
				callbacksMap.delete(event);
			}
		}
	}

	protected _deleteOnceCallback(
		onceCallbacksMap: Map<string | number, Map<AnyCallback, Set<AnyCallback>>>,
		event: string | number,
		callback: AnyCallback,
		callbackWrapper: AnyCallback,
	) {
		const onceEventMap = onceCallbacksMap.get(event);
		const wrappersSet = onceEventMap?.get(callback);
		if (wrappersSet) {
			wrappersSet.delete(callbackWrapper);
			if (wrappersSet.size === 0) {
				onceEventMap?.delete(callback);
				if (onceEventMap?.size === 0) {
					onceCallbacksMap.delete(event);
				}
			}
		}
	}

	protected _deleteRoomCallback(room: string, event: string | number, callback: AnyCallback): void {
		const roomMap = this._roomCallbacksMap.get(room);
		if (roomMap) {
			this._deleteCallback(roomMap, event, callback);
			if (roomMap.size === 0) {
				this._roomCallbacksMap.delete(room);
			}
		}
	}

	protected _addRoomCallback(room: string, event: string | number, callback: AnyCallback): void {
		let roomMap = this._roomCallbacksMap.get(room);
		if (!roomMap) {
			roomMap = new Map();
			this._roomCallbacksMap.set(room, roomMap);
		}
		this._addCallback(roomMap, event, callback);
	}

	protected _addOnceRoomCallback(room: string, event: string | number, callback: AnyCallback, callbackWrapper: AnyCallback): void {
		let onceRoomMap = this._onceRoomCallbacksMap.get(room);
		if (!onceRoomMap) {
			onceRoomMap = new Map();
			this._onceRoomCallbacksMap.set(room, onceRoomMap);
		}
		this._addOnceCallback(onceRoomMap, event, callback, callbackWrapper);
	}

	protected _deleteOnceRoomCallback(room: string, event: string | number, callback: AnyCallback, callbackWrapper: AnyCallback): void {
		const onceRoomMap = this._onceRoomCallbacksMap.get(room);
		if (onceRoomMap) {
			this._deleteOnceCallback(onceRoomMap, event, callback, callbackWrapper);
			if (onceRoomMap?.size === 0) {
				this._onceRoomCallbacksMap.delete(room);
			}
		}
	}

	protected _triggerCallbacks<Args extends Array<unknown>>(callbackSet?: Set<AnyCallback>, ...args: Args): void {
		if (!callbackSet) {
			return;
		}
		const callbacks = Array.from(callbackSet);
		for (const callback of callbacks) {
			if (!callbackSet.has(callback)) {
				continue;
			}
			try {
				callback(...args);
			} catch (error) {
				if (this._debug) {
					console.error(error);
				}
			}
		}
	}

	// ──── Guards ────────────────────────────────────────────────────────────────────────

	protected _isObject(obj: unknown) {
		return typeof obj === "object" && obj !== null;
	}

	protected _isObjectEvent(obj: object): obj is { event: string | number; data: unknown } {
		return "event" in obj && (typeof obj.event === "string" || typeof obj.event === "number");
	}

	protected _isObjectRoom(obj: object): obj is { room: string } {
		return "room" in obj && typeof obj.room === "string";
	}

	protected _isObjectRooms(obj: object): obj is { rooms: string[] } {
		return "rooms" in obj && Array.isArray(obj.rooms) && !obj.rooms.some((x) => typeof x !== "string");
	}

	protected _isObjectLifecycle(obj: object): obj is { type: LifecycleTypes } {
		return "type" in obj && typeof obj.type === "number" && LifecycleTypes[obj.type] != null;
	}

	protected _isLifecycleMessage<T extends LifecycleTypes>(lifecycleType: T, obj: unknown): obj is { type: T } {
		return this._isObject(obj) && this._isObjectLifecycle(obj) && lifecycleType === obj.type;
	}

	protected _isLifecyclePayloadMessage<T extends LifecycleTypes>(lifecycleType: T, obj: unknown): obj is { type: T; data: unknown } {
		return this._isLifecycleMessage(lifecycleType, obj) && "data" in obj;
	}

	protected _isLifecycleRoomMessage<
		T extends
			| LifecycleTypes.join_room
			| LifecycleTypes.join_room_success
			| LifecycleTypes.join_room_error
			| LifecycleTypes.leave_room
			| LifecycleTypes.leave_room_success
			| LifecycleTypes.leave_room_error,
	>(lifecycleType: T, obj: unknown): obj is { type: T; room: string } {
		return this._isLifecycleMessage(lifecycleType, obj) && this._isObjectRoom(obj);
	}

	protected _isLifecycleRoomsMessage<
		T extends
			| LifecycleTypes.join_rooms
			| LifecycleTypes.join_rooms_success
			| LifecycleTypes.join_rooms_error
			| LifecycleTypes.leave_rooms
			| LifecycleTypes.leave_rooms_success
			| LifecycleTypes.leave_rooms_error,
	>(lifecycleType: T, obj: unknown): obj is { type: T; rooms: string[] } {
		return this._isLifecycleMessage(lifecycleType, obj) && this._isObjectRooms(obj);
	}

	protected _isLifecycleRoomErrorMessage(
		obj: unknown,
	): obj is { type: LifecycleTypes.join_room_error | LifecycleTypes.leave_room_error; room: string; data: unknown } {
		return (
			(this._isLifecycleMessage(LifecycleTypes.join_room_error, obj) || this._isLifecycleMessage(LifecycleTypes.leave_room_error, obj)) &&
			this._isObjectRoom(obj) &&
			"data" in obj
		);
	}

	protected _isLifecycleRoomsErrorMessage(
		obj: unknown,
	): obj is { type: LifecycleTypes.join_rooms_error | LifecycleTypes.leave_rooms_error; rooms: string[]; data: unknown } {
		return (
			(this._isLifecycleMessage(LifecycleTypes.join_rooms_error, obj) || this._isLifecycleMessage(LifecycleTypes.leave_rooms_error, obj)) &&
			this._isObjectRooms(obj) &&
			"data" in obj
		);
	}

	protected _isEventMessage(obj: unknown): obj is { event: string | number; data: unknown } {
		return this._isObject(obj) && this._isObjectEvent(obj);
	}

	protected _isRoomEventMessage(obj: unknown): obj is { room: string; event: string | number; data: unknown } {
		return this._isEventMessage(obj) && this._isObjectRoom(obj);
	}

	protected _isRoomsEventMessage(obj: unknown): obj is { rooms: string[]; event: string | number; data: unknown } {
		return this._isEventMessage(obj) && this._isObjectRooms(obj);
	}
}
