import {
	LifecycleTypes,
	type AnyCallback,
	type EventsForRooms,
	type LifecycleMessage,
	type SocketEvents,
	type StringKeys,
	type StringNumberKeys,
	type UserMessage,
} from "@bytesocket/types";
import { SocketBase } from "./socket-base";
import type { EventCallback, IRoomManager, RoomBulkApi, RoomLifecycleApi, RoomState } from "./types";

/**
 * Manages room membership and room-scoped event listeners.
 *
 * You should not instantiate this class directly; it is accessible via
 * `socket.rooms` on a ByteSocket instance.
 *
 * @typeParam TEvents - The event map type (from SocketEvents) defining allowed room events.
 */
export class RoomManager<TEvents extends SocketEvents> extends SocketBase implements IRoomManager<TEvents> {
	readonly lifecycle: RoomLifecycleApi;
	readonly bulk: RoomBulkApi<TEvents>;

	#roomCallbacksMap = new Map<string, Map<string | number, Set<AnyCallback>>>();
	#onceRoomCallbacksMap = new Map<string, Map<string | number, Map<AnyCallback, Set<AnyCallback>>>>();

	#roomStateMap = new Map<string, RoomState>();

	#send: <R extends string, E extends string | number, D>(
		payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
		bypassAuthPending?: boolean,
	) => void;

	/** @internal */
	constructor(
		protected readonly debug: boolean,
		send: <R extends string, E extends string | number, D>(
			payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
			bypassAuthPending?: boolean,
		) => void,
		onOpen: (callback: () => void) => void,
		onClose: (callback: (event: CloseEvent) => void) => void,
	) {
		super();

		this.#send = send;

		this.lifecycle = {
			onJoinSuccess: (callback) => this.onLifecycle(LifecycleTypes.join_room_success, callback),
			offJoinSuccess: (callback) => this.offLifecycle(LifecycleTypes.join_room_success, callback),
			onceJoinSuccess: (callback) => this.onceLifecycle(LifecycleTypes.join_room_success, callback),

			onJoinError: (callback) => this.onLifecycle(LifecycleTypes.join_room_error, callback),
			offJoinError: (callback) => this.offLifecycle(LifecycleTypes.join_room_error, callback),
			onceJoinError: (callback) => this.onceLifecycle(LifecycleTypes.join_room_error, callback),

			onLeaveSuccess: (callback) => this.onLifecycle(LifecycleTypes.leave_room_success, callback),
			offLeaveSuccess: (callback) => this.offLifecycle(LifecycleTypes.leave_room_success, callback),
			onceLeaveSuccess: (callback) => this.onceLifecycle(LifecycleTypes.leave_room_success, callback),

			onLeaveError: (callback) => this.onLifecycle(LifecycleTypes.leave_room_error, callback),
			offLeaveError: (callback) => this.offLifecycle(LifecycleTypes.leave_room_error, callback),
			onceLeaveError: (callback) => this.onceLifecycle(LifecycleTypes.leave_room_error, callback),
		};

		this.bulk = {
			emit: this.#emitMany.bind(this),
			join: this.#joinMany.bind(this),
			leave: this.#leaveMany.bind(this),
			lifecycle: {
				onJoinSuccess: (callback) => this.onLifecycle(LifecycleTypes.join_rooms_success, callback),
				offJoinSuccess: (callback) => this.offLifecycle(LifecycleTypes.join_rooms_success, callback),
				onceJoinSuccess: (callback) => this.onceLifecycle(LifecycleTypes.join_rooms_success, callback),

				onJoinError: (callback) => this.onLifecycle(LifecycleTypes.join_rooms_error, callback),
				offJoinError: (callback) => this.offLifecycle(LifecycleTypes.join_rooms_error, callback),
				onceJoinError: (callback) => this.onceLifecycle(LifecycleTypes.join_rooms_error, callback),

				onLeaveSuccess: (callback) => this.onLifecycle(LifecycleTypes.leave_rooms_success, callback),
				offLeaveSuccess: (callback) => this.offLifecycle(LifecycleTypes.leave_rooms_success, callback),
				onceLeaveSuccess: (callback) => this.onceLifecycle(LifecycleTypes.leave_rooms_success, callback),

				onLeaveError: (callback) => this.onLifecycle(LifecycleTypes.leave_rooms_error, callback),
				offLeaveError: (callback) => this.offLifecycle(LifecycleTypes.leave_rooms_error, callback),
				onceLeaveError: (callback) => this.onceLifecycle(LifecycleTypes.leave_rooms_error, callback),
			},
		};

		onOpen(() => this.#onSocketOpen());
		onClose(() => this.#onSocketClose());
	}

	// ──── Emitters ────────────────────────────────────────────────────────────────────────

	emit<
		R extends StringKeys<TEvents["emitRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["emitRoom"]>[R]>,
		D extends NonNullable<TEvents["emitRoom"]>[R][E],
	>(room: R, event: E, data: D): void {
		this.#send({ room, event, data });
	}

	join(room: string): void {
		const state = this.#getOrCreateRoomState(room);
		if (state.joined || state.pending === "join") {
			return;
		}
		state.wanted = true;
		state.pending = "join";
		this.#send({ type: LifecycleTypes.join_room, room });
	}

	leave(room: string): void {
		const state = this.#getOrCreateRoomState(room);
		if (!state.joined || state.pending === "leave") {
			return;
		}
		state.wanted = false;
		state.pending = "leave";
		this.#send({ type: LifecycleTypes.leave_room, room });
	}

	#emitMany<
		Rs extends NonNullable<TEvents["emitRooms"]>["rooms"],
		E extends StringNumberKeys<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>,
		D extends NonNullable<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>[E],
	>(rooms: Rs, event: E, data: D): void {
		this.#send({ rooms, event, data });
	}

	#joinMany(rooms: string[]): void {
		if (rooms.length === 0) {
			if (this.debug) {
				console.warn("ByteSocket: can't join empty array of rooms - ignored");
			}
			return;
		}
		const toJoin = [];
		for (const room of rooms) {
			const state = this.#getOrCreateRoomState(room);
			if (state.joined || state.pending === "join") {
				continue;
			}
			state.wanted = true;
			state.pending = "join";
			toJoin.push(room);
		}
		if (toJoin.length === 0) {
			if (this.debug) {
				console.warn("ByteSocket: all rooms you requested to join are joined or pending joining already - ignored");
			}
			return;
		}
		this.#send({ type: LifecycleTypes.join_rooms, rooms: toJoin });
	}

	#leaveMany(rooms: string[]): void {
		if (rooms.length === 0) {
			if (this.debug) {
				console.warn("ByteSocket: can't leave empty array of rooms - ignored");
			}
			return;
		}
		const toLeave = [];
		for (const room of rooms) {
			const state = this.#getOrCreateRoomState(room);
			if (!state.joined || state.pending === "leave") {
				continue;
			}
			state.wanted = false;
			state.pending = "leave";
			toLeave.push(room);
		}
		if (toLeave.length === 0) {
			if (this.debug) {
				console.warn("ByteSocket: all rooms you requested to leave are left or pending leaving already - ignored");
			}
			return;
		}
		this.#send({ type: LifecycleTypes.leave_rooms, rooms: toLeave });
	}

	list() {
		return [...this.#roomStateMap].filter(([_room, state]) => state.joined).map(([room]) => room);
	}

	// ──── Listeners ────────────────────────────────────────────────────────────────────────

	on<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: EventCallback<D>): void {
		this.#addRoomCallback(room, event, callback);
	}

	off<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event?: E, callback?: EventCallback<D>): void {
		const roomMap = this.#roomCallbacksMap.get(room);
		if (!roomMap) {
			return;
		}
		if (event === undefined) {
			this.#roomCallbacksMap.delete(room);
			this.#onceRoomCallbacksMap.delete(room);
			return;
		}
		const onceRoomMap = this.#onceRoomCallbacksMap.get(room);
		if (callback === undefined) {
			roomMap.delete(event);
			onceRoomMap?.delete(event);
			if (roomMap.size === 0) {
				this.#roomCallbacksMap.delete(room);
				this.#onceRoomCallbacksMap.delete(room);
			}
			return;
		}
		const onceEventMap = onceRoomMap?.get(event);
		const wrappersSet = onceEventMap?.get(callback);
		if (wrappersSet) {
			for (const wrapper of [...wrappersSet]) {
				this.#deleteRoomCallback(room, event, wrapper);
				this.#deleteOnceRoomCallback(room, event, callback, wrapper);
			}
		}
		this.#deleteRoomCallback(room, event, callback);
	}

	once<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: EventCallback<D>): void {
		const callbackWrapper: EventCallback<D> = (data) => {
			this.#deleteRoomCallback(room, event, callbackWrapper);
			this.#deleteOnceRoomCallback(room, event, callback, callbackWrapper);
			callback(data);
		};
		this.#addOnceRoomCallback(room, event, callback, callbackWrapper);
		this.#addRoomCallback(room, event, callbackWrapper);
	}

	#deleteRoomCallback<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: EventCallback<D>): void {
		const roomMap = this.#roomCallbacksMap.get(room);
		if (roomMap) {
			this.deleteCallback(roomMap, event, callback);
			if (roomMap.size === 0) {
				this.#roomCallbacksMap.delete(room);
			}
		}
	}

	#deleteOnceRoomCallback<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: EventCallback<D>, callbackWrapper: EventCallback<D>): void {
		const onceRoomMap = this.#onceRoomCallbacksMap.get(room);
		if (onceRoomMap) {
			this.deleteOnceCallback(onceRoomMap, event, callback, callbackWrapper);
			if (onceRoomMap?.size === 0) {
				this.#onceRoomCallbacksMap.delete(room);
			}
		}
	}

	#addRoomCallback<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: EventCallback<D>): void {
		let roomMap = this.#roomCallbacksMap.get(room);
		if (!roomMap) {
			roomMap = new Map();
			this.#roomCallbacksMap.set(room, roomMap);
		}
		this.addCallback(roomMap, event, callback);
	}

	#addOnceRoomCallback<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: EventCallback<D>, callbackWrapper: EventCallback<D>): void {
		let onceRoomMap = this.#onceRoomCallbacksMap.get(room);
		if (!onceRoomMap) {
			onceRoomMap = new Map();
			this.#onceRoomCallbacksMap.set(room, onceRoomMap);
		}
		this.addOnceCallback(onceRoomMap, event, callback, callbackWrapper);
	}

	// ──── Message Handling (internal) ────────────────────────────────────────────────────────────────────────

	_handleMessage(payload: UserMessage): boolean {
		if (this.#handleJoinRoomSuccessMessage(payload)) {
			return true;
		}
		if (this.#handleLeaveRoomSuccessMessage(payload)) {
			return true;
		}
		if (this.#handleRoomErrorMessage(payload)) {
			return true;
		}
		if (this.#handleJoinRoomsSuccessMessage(payload)) {
			return true;
		}
		if (this.#handleLeaveRoomsSuccessMessage(payload)) {
			return true;
		}
		if (this.#handleRoomsErrorMessage(payload)) {
			return true;
		}
		if (this.#handleRoomsMessage(payload)) {
			return true;
		}
		if (this.#handleRoomMessage(payload)) {
			return true;
		}
		return false;
	}

	#handleJoinRoomSuccessMessage(payload: UserMessage): boolean {
		if (!("type" in payload) || !("room" in payload) || payload.type !== LifecycleTypes.join_room_success) {
			return false;
		}
		const state = this.#roomStateMap.get(payload.room);
		if (!state) {
			if (this.debug) {
				console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${payload.room}" - ignored`);
			}
			return true;
		}
		state.joined = true;
		state.pending = null;
		this.triggerCallback(this.lifecycleCallbacksMap.get(payload.type), payload.room);
		return true;
	}

	#handleLeaveRoomSuccessMessage(payload: UserMessage): boolean {
		if (!("type" in payload) || !("room" in payload) || payload.type !== LifecycleTypes.leave_room_success) {
			return false;
		}
		const state = this.#roomStateMap.get(payload.room);
		if (!state) {
			if (this.debug) {
				console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${payload.room}" - ignored`);
			}
			return true;
		}
		state.joined = false;
		state.pending = null;
		this.#cleanRoomState(payload.room);
		this.triggerCallback(this.lifecycleCallbacksMap.get(payload.type), payload.room);
		return true;
	}

	#handleRoomErrorMessage(payload: UserMessage): boolean {
		if (
			!("type" in payload) ||
			!("room" in payload) ||
			(payload.type !== LifecycleTypes.join_room_error && payload.type !== LifecycleTypes.leave_room_error)
		) {
			return false;
		}
		const state = this.#roomStateMap.get(payload.room);
		if (!state) {
			if (this.debug) {
				console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${payload.room}" - ignored`);
			}
			return true;
		}
		state.pending = null;
		this.triggerCallback(this.lifecycleCallbacksMap.get(payload.type), payload.room, payload.data);
		return true;
	}

	#handleJoinRoomsSuccessMessage(payload: UserMessage): boolean {
		if (!("type" in payload) || !("rooms" in payload) || payload.type !== LifecycleTypes.join_rooms_success) {
			return false;
		}
		const staleRooms = [];
		const actualRooms = [];
		for (const room of payload.rooms) {
			const state = this.#roomStateMap.get(room);
			if (!state) {
				staleRooms.push(room);
				continue;
			}
			state.joined = true;
			state.pending = null;
			actualRooms.push(room);
		}
		if (this.debug && staleRooms.length) {
			console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${staleRooms.join(", ")}" - ignored`);
		}
		if (actualRooms.length === 0) {
			return true;
		}
		this.triggerCallback(this.lifecycleCallbacksMap.get(payload.type), actualRooms);
		return true;
	}

	#handleLeaveRoomsSuccessMessage(payload: UserMessage): boolean {
		if (!("type" in payload) || !("rooms" in payload) || payload.type !== LifecycleTypes.leave_rooms_success) {
			return false;
		}
		const staleRooms = [];
		const actualRooms = [];
		for (const room of payload.rooms) {
			const state = this.#roomStateMap.get(room);
			if (!state) {
				staleRooms.push(room);
				continue;
			}
			state.joined = false;
			state.pending = null;
			actualRooms.push(room);
			this.#cleanRoomState(room);
		}
		if (this.debug && staleRooms.length) {
			console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${staleRooms.join(", ")}" - ignored`);
		}
		if (actualRooms.length === 0) {
			return true;
		}
		this.triggerCallback(this.lifecycleCallbacksMap.get(payload.type), actualRooms);
		return true;
	}

	#handleRoomsErrorMessage(payload: UserMessage): boolean {
		if (
			!("type" in payload) ||
			!("rooms" in payload) ||
			(payload.type !== LifecycleTypes.join_rooms_error && payload.type !== LifecycleTypes.leave_rooms_error)
		) {
			return false;
		}
		const staleRooms = [];
		const actualRooms = [];
		for (const room of payload.rooms) {
			const state = this.#roomStateMap.get(room);
			if (!state) {
				staleRooms.push(room);
				continue;
			}
			state.pending = null;
			actualRooms.push(room);
		}
		if (this.debug && staleRooms.length) {
			console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${staleRooms.join(", ")}" - ignored`);
		}
		if (actualRooms.length === 0) {
			return true;
		}
		this.triggerCallback(this.lifecycleCallbacksMap.get(payload.type), actualRooms, payload.data);
		return true;
	}

	#handleRoomsMessage(payload: UserMessage): boolean {
		if ("type" in payload || !("rooms" in payload) || payload.rooms == null || payload.event == null) {
			return false;
		}
		for (const room of payload.rooms) {
			this.triggerCallback(this.#roomCallbacksMap.get(room)?.get(payload.event), payload.data);
		}
		return true;
	}

	#handleRoomMessage(payload: UserMessage): boolean {
		if ("type" in payload || !("room" in payload) || payload.room == null || payload.event == null) {
			return false;
		}
		this.triggerCallback(this.#roomCallbacksMap.get(payload.room)?.get(payload.event), payload.data);
		return true;
	}

	// ──── Helpers ────────────────────────────────────────────────────────────────────────

	_clear(): void {
		this.#roomCallbacksMap.clear();
		this.#onceRoomCallbacksMap.clear();

		this.lifecycleCallbacksMap.clear();
		this.onceLifecycleCallbacksMap.clear();

		this.#roomStateMap.clear();
	}

	#getOrCreateRoomState(room: string): RoomState {
		let state = this.#roomStateMap.get(room);
		if (!state) {
			state = { wanted: false, joined: false, pending: null };
			this.#roomStateMap.set(room, state);
		}
		return state;
	}

	#cleanRoomState(room: string): void {
		const state = this.#roomStateMap.get(room);
		if (!state) {
			return;
		}
		if (state.wanted === false && state.joined === false && state.pending === null) {
			this.#roomStateMap.delete(room);
		}
	}

	#onSocketOpen(): void {
		const rooms: string[] = [];
		const toClean: string[] = [];
		for (const [room, state] of this.#roomStateMap) {
			if (state.wanted && !state.joined) {
				state.pending = "join";
				rooms.push(room);
			} else if (!state.wanted && state.joined) {
				state.pending = null;
				state.joined = false;
				toClean.push(room);
			}
		}
		for (const room of toClean) {
			this.#cleanRoomState(room);
		}
		if (rooms.length === 0) {
			return;
		}
		if (rooms.length === 1) {
			this.#send({ type: LifecycleTypes.join_room, room: rooms[0] });
		} else {
			this.#send({ type: LifecycleTypes.join_rooms, rooms });
		}
	}

	#onSocketClose(): void {
		for (const state of this.#roomStateMap.values()) {
			state.joined = false;
			state.pending = null;
		}
	}
}
