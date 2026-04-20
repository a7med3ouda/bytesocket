import {
	LifecycleTypes,
	type AnyCallback,
	type EventsForRooms,
	type LifecycleMessage,
	type StringKeys,
	type StringNumberKeys,
	type SymmetricEvents,
	type UserMessage,
} from "@bytesocket/types";
import { SocketBase } from "./socket-base";
import type { EventCallback, RoomState } from "./types";

/**
 * Manages room membership and room‑scoped event listeners.
 *
 * You should not instantiate this class directly; it is accessible via
 * `socket.rooms` on a ByteSocket instance.
 *
 * @typeParam TEvents - The event map type (from SymmetricEvents) defining allowed room events.
 */
export class RoomManager<TEvents extends SymmetricEvents> extends SocketBase {
	/**
	 * Lifecycle event listeners for single‑room operations.
	 *
	 * @example
	 * socket.rooms.lifecycle.onJoinSuccess((room) => {
	 *   console.log(`Joined room ${room}`);
	 * });
	 */
	readonly lifecycle;

	/**
	 * Bulk operations (join/leave/emit multiple rooms) and their lifecycle listeners.
	 *
	 * @example
	 * socket.rooms.bulk.join(['room1', 'room2']);
	 * socket.rooms.bulk.emit(['room1', 'room2'], 'message', { text: 'Hi all' });
	 */
	readonly bulk;

	#roomCallbacksMap = new Map<string, Map<string | number, Set<AnyCallback>>>();
	#onceRoomCallbacksMap = new Map<string, Map<string | number, Map<AnyCallback, Set<AnyCallback>>>>();

	#roomStateMap = new Map<string, RoomState>();

	#send: <R extends string, E extends string | number, D>(
		payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
		bypassAuthPending?: boolean,
	) => void;

	/**
	 * @internal
	 */
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
			/**
			 * Register a listener for successful single‑room join.
			 * @param callback - Function invoked with the room name.
			 */
			onJoinSuccess: (callback: (room: string) => void) => this.onLifecycle(LifecycleTypes.join_room_success, callback),

			/**
			 * Remove a listener for successful single‑room join.
			 * @param callback - Optional; if omitted, all listeners are removed.
			 */
			offJoinSuccess: (callback?: (room: string) => void) => this.offLifecycle(LifecycleTypes.join_room_success, callback),

			/**
			 * Register a one‑time listener for successful single‑room join.
			 * @param callback - Function invoked once with the room name.
			 */
			onceJoinSuccess: (callback: (room: string) => void) => this.onceLifecycle(LifecycleTypes.join_room_success, callback),

			/**
			 * Register a listener for single‑room join errors.
			 * @param callback - Function invoked with the room name and error data.
			 */
			onJoinError: (callback: <D>(room: string, data: D) => void) => this.onLifecycle(LifecycleTypes.join_room_error, callback),

			/**
			 * Remove a listener for single‑room join errors.
			 * @param callback - Optional; if omitted, all listeners are removed.
			 */
			offJoinError: (callback?: <D>(room: string, data: D) => void) => this.offLifecycle(LifecycleTypes.join_room_error, callback),

			/**
			 * Register a one‑time listener for single‑room join errors.
			 * @param callback - Function invoked once with the room name and error data.
			 */
			onceJoinError: (callback: <D>(room: string, data: D) => void) => this.onceLifecycle(LifecycleTypes.join_room_error, callback),

			/**
			 * Register a listener for successful single‑room leave.
			 * @param callback - Function invoked with the room name.
			 */
			onLeaveSuccess: (callback: (room: string) => void) => this.onLifecycle(LifecycleTypes.leave_room_success, callback),

			/**
			 * Remove a listener for successful single‑room leave.
			 * @param callback - Optional; if omitted, all listeners are removed.
			 */
			offLeaveSuccess: (callback?: (room: string) => void) => this.offLifecycle(LifecycleTypes.leave_room_success, callback),

			/**
			 * Register a one‑time listener for successful single‑room leave.
			 * @param callback - Function invoked once with the room name.
			 */
			onceLeaveSuccess: (callback: (room: string) => void) => this.onceLifecycle(LifecycleTypes.leave_room_success, callback),

			/**
			 * Register a listener for single‑room leave errors.
			 * @param callback - Function invoked with the room name and error data.
			 */
			onLeaveError: (callback: <D>(room: string, data: D) => void) => this.onLifecycle(LifecycleTypes.leave_room_error, callback),

			/**
			 * Remove a listener for single‑room leave errors.
			 * @param callback - Optional; if omitted, all listeners are removed.
			 */
			offLeaveError: (callback?: <D>(room: string, data: D) => void) => this.offLifecycle(LifecycleTypes.leave_room_error, callback),

			/**
			 * Register a one‑time listener for single‑room leave errors.
			 * @param callback - Function invoked once with the room name and error data.
			 */
			onceLeaveError: (callback: <D>(room: string, data: D) => void) => this.onceLifecycle(LifecycleTypes.leave_room_error, callback),
		};

		this.bulk = {
			/**
			 * Emit an event to multiple rooms at once.
			 *
			 * @typeParam Rs - The array of room names.
			 * @typeParam E - The event name.
			 * @typeParam D - The event data type.
			 *
			 * @example
			 * socket.rooms.bulk.emit(['roomA', 'roomB'], 'message', { text: 'Hello both!' });
			 */
			emit: this.#emitMany.bind(this),

			/**
			 * Request to join multiple rooms.
			 * Only rooms not already joined or pending will be sent.
			 *
			 * @example
			 * socket.rooms.bulk.join(['lobby', 'notifications']);
			 */
			join: this.#joinMany.bind(this),

			/**
			 * Request to leave multiple rooms.
			 * Only rooms currently joined will be sent.
			 *
			 * @example
			 * socket.rooms.bulk.leave(['lobby', 'notifications']);
			 */
			leave: this.#leaveMany.bind(this),

			lifecycle: {
				/**
				 * Register a listener for successful bulk join.
				 * @param callback - Function invoked with the array of room names.
				 */
				onJoinSuccess: (callback: (rooms: string[]) => void) => this.onLifecycle(LifecycleTypes.join_rooms_success, callback),

				/**
				 * Remove a listener for successful bulk join.
				 * @param callback - Optional; if omitted, all listeners are removed.
				 */
				offJoinSuccess: (callback?: (rooms: string[]) => void) => this.offLifecycle(LifecycleTypes.join_rooms_success, callback),

				/**
				 * Register a one‑time listener for successful bulk join.
				 * @param callback - Function invoked once with the array of room names.
				 */
				onceJoinSuccess: (callback: (rooms: string[]) => void) => this.onceLifecycle(LifecycleTypes.join_rooms_success, callback),

				/**
				 * Register a listener for bulk join errors.
				 * @param callback - Function invoked with the array of room names and error data.
				 */
				onJoinError: (callback: <D>(rooms: string[], data: D) => void) => this.onLifecycle(LifecycleTypes.join_rooms_error, callback),

				/**
				 * Remove a listener for bulk join errors.
				 * @param callback - Optional; if omitted, all listeners are removed.
				 */
				offJoinError: (callback?: <D>(rooms: string[], data: D) => void) => this.offLifecycle(LifecycleTypes.join_rooms_error, callback),

				/**
				 * Register a one‑time listener for bulk join errors.
				 * @param callback - Function invoked once with the array of room names and error data.
				 */
				onceJoinError: (callback: <D>(rooms: string[], data: D) => void) => this.onceLifecycle(LifecycleTypes.join_rooms_error, callback),

				/**
				 * Register a listener for successful bulk leave.
				 * @param callback - Function invoked with the array of room names.
				 */
				onLeaveSuccess: (callback: (rooms: string[]) => void) => this.onLifecycle(LifecycleTypes.leave_rooms_success, callback),

				/**
				 * Remove a listener for successful bulk leave.
				 * @param callback - Optional; if omitted, all listeners are removed.
				 */
				offLeaveSuccess: (callback?: (rooms: string[]) => void) => this.offLifecycle(LifecycleTypes.leave_rooms_success, callback),

				/**
				 * Register a one‑time listener for successful bulk leave.
				 * @param callback - Function invoked once with the array of room names.
				 */
				onceLeaveSuccess: (callback: (rooms: string[]) => void) => this.onceLifecycle(LifecycleTypes.leave_rooms_success, callback),

				/**
				 * Register a listener for bulk leave errors.
				 * @param callback - Function invoked with the array of room names and error data.
				 */
				onLeaveError: (callback: <D>(rooms: string[], data: D) => void) => this.onLifecycle(LifecycleTypes.leave_rooms_error, callback),

				/**
				 * Remove a listener for bulk leave errors.
				 * @param callback - Optional; if omitted, all listeners are removed.
				 */
				offLeaveError: (callback?: <D>(rooms: string[], data: D) => void) => this.offLifecycle(LifecycleTypes.leave_rooms_error, callback),

				/**
				 * Register a one‑time listener for bulk leave errors.
				 * @param callback - Function invoked once with the array of room names and error data.
				 */
				onceLeaveError: (callback: <D>(rooms: string[], data: D) => void) => this.onceLifecycle(LifecycleTypes.leave_rooms_error, callback),
			},
		};

		onOpen(() => this.#onSocketOpen());
		onClose(() => this.#onSocketClose());
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Emitters
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * Emit an event to a specific room.
	 *
	 * @typeParam R - The room name (must be a key in `TEvents['emitRoom']`).
	 * @typeParam E - The event name.
	 * @typeParam D - The event data type.
	 *
	 * @example
	 * // Assuming event map defines emitRoom: { chat: { message: string } }
	 * socket.rooms.emit('chat', 'message', { text: 'Hello!' });
	 */
	emit<
		R extends StringKeys<TEvents["emitRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["emitRoom"]>[R]>,
		D extends NonNullable<NonNullable<TEvents["emitRoom"]>[R]>[E],
	>(room: R, event: E, data: D): void {
		this.#send({ room, event, data });
	}

	/**
	 * Request to join a single room.
	 * Idempotent – calling multiple times for the same room has no extra effect.
	 *
	 * @example
	 * socket.rooms.join('chat');
	 */
	join(room: string): void {
		const state = this.#getOrCreateRoomState(room);
		if (state.joined || state.pending === "join") return;
		state.wanted = true;
		state.pending = "join";
		this.#send({ type: LifecycleTypes.join_room, room });
	}

	/**
	 * Request to leave a single room.
	 *
	 * @example
	 * socket.rooms.leave('chat');
	 */
	leave(room: string): void {
		const state = this.#getOrCreateRoomState(room);
		if (!state.joined || state.pending === "leave") return;
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
			if (this.debug) console.warn("ByteSocket: can't join empty array of rooms - ignored");
			return;
		}
		const toJoin = [];
		for (const room of rooms) {
			const state = this.#getOrCreateRoomState(room);
			if (state.joined || state.pending === "join") continue;
			state.wanted = true;
			state.pending = "join";
			toJoin.push(room);
		}
		if (toJoin.length === 0) {
			if (this.debug) console.warn("ByteSocket: all rooms you requested to join are joined or pending joining already - ignored");
			return;
		}
		this.#send({ type: LifecycleTypes.join_rooms, rooms: toJoin });
	}

	#leaveMany(rooms: string[]): void {
		if (rooms.length === 0) {
			if (this.debug) console.warn("ByteSocket: can't leave empty array of rooms - ignored");
			return;
		}
		const toLeave = [];
		for (const room of rooms) {
			const state = this.#getOrCreateRoomState(room);
			if (!state.joined || state.pending === "leave") continue;
			state.wanted = false;
			state.pending = "leave";
			toLeave.push(room);
		}
		if (toLeave.length === 0) {
			if (this.debug) console.warn("ByteSocket: all rooms you requested to leave are left or pending leaving already - ignored");
			return;
		}
		this.#send({ type: LifecycleTypes.leave_rooms, rooms: toLeave });
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Listeners
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * Register a permanent listener for events on a specific room.
	 *
	 * @typeParam R - Room name (must be a key in `TEvents['listenRoom']`).
	 * @typeParam E - Event name.
	 *
	 * @example
	 * // Assuming event map defines listenRoom: { chat: { message: string } }
	 * socket.rooms.on('chat', 'message', (data) => {
	 *   console.log('New message:', data);
	 * });
	 */
	on<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: EventCallback<D>): void {
		this.#addRoomCallback(room, event, callback);
	}

	/**
	 * Remove a listener for room events.
	 * If no event is provided, all listeners for that room are removed.
	 * If no callback is provided, all listeners for that event in the room are removed.
	 *
	 * @example
	 * // Remove specific callback
	 * socket.rooms.off('chat', 'message', myCallback);
	 * // Remove all 'message' listeners in 'chat'
	 * socket.rooms.off('chat', 'message');
	 * // Remove all listeners for 'chat' room
	 * socket.rooms.off('chat');
	 */
	off<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event?: E, callback?: EventCallback<D>): void {
		const roomMap = this.#roomCallbacksMap.get(room);
		if (!roomMap) return;
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
			wrappersSet.forEach((wrapper) => {
				this.#deleteRoomCallback(room, event, wrapper);
				this.#deleteOnceRoomCallback(room, event, callback, wrapper);
			});
		}
		this.#deleteRoomCallback(room, event, callback);
	}

	/**
	 * Register a one‑time listener for an event on a specific room.
	 * The callback is removed after its first invocation.
	 *
	 * @example
	 * socket.rooms.once('chat', 'message', (data) => {
	 *   console.log('First message only:', data);
	 * });
	 */
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
			if (roomMap.size === 0) this.#roomCallbacksMap.delete(room);
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
			if (onceRoomMap?.size === 0) this.#onceRoomCallbacksMap.delete(room);
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

	// ────────────────────────────────────────────────────────────────────────────
	// Message Handling (internal)
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * @internal
	 * Process an incoming message and dispatch to appropriate room handlers.
	 * @returns `true` if the message was handled, otherwise `false`.
	 */
	_handleMessage(payload: any): boolean {
		if (this.#handleJoinRoomSuccessMessage(payload)) return true;
		if (this.#handleLeaveRoomSuccessMessage(payload)) return true;
		if (this.#handleRoomErrorMessage(payload)) return true;
		if (this.#handleJoinRoomsSuccessMessage(payload)) return true;
		if (this.#handleLeaveRoomsSuccessMessage(payload)) return true;
		if (this.#handleRoomsErrorMessage(payload)) return true;
		if (this.#handleRoomsMessage(payload)) return true;
		if (this.#handleRoomMessage(payload)) return true;
		return false;
	}

	#handleJoinRoomSuccessMessage(payload: any): boolean {
		if (payload.type !== LifecycleTypes.join_room_success) return false;
		const state = this.#roomStateMap.get(payload.room);
		if (!state) {
			if (this.debug) console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${payload.room}" - ignored`);
			return true;
		}
		state.joined = true;
		state.pending = null;
		this.triggerCallback(this.lifecycleCallbacksMap.get(payload.type), payload.room, payload.data);
		return true;
	}

	#handleLeaveRoomSuccessMessage(payload: any): boolean {
		if (payload.type !== LifecycleTypes.leave_room_success) return false;
		const state = this.#roomStateMap.get(payload.room);
		if (!state) {
			if (this.debug) console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${payload.room}" - ignored`);
			return true;
		}
		state.joined = false;
		state.pending = null;
		this.#cleanRoomState(payload.room);
		this.triggerCallback(this.lifecycleCallbacksMap.get(payload.type), payload.room, payload.data);
		return true;
	}

	#handleRoomErrorMessage(payload: any): boolean {
		if (payload.type !== LifecycleTypes.join_room_error && payload.type !== LifecycleTypes.leave_room_error) return false;
		const state = this.#roomStateMap.get(payload.room);
		if (!state) {
			if (this.debug) console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${payload.room}" - ignored`);
			return true;
		}
		state.pending = null;
		this.triggerCallback(this.lifecycleCallbacksMap.get(payload.type), payload.room, payload.data);
		return true;
	}

	#handleJoinRoomsSuccessMessage(payload: any): boolean {
		if (payload.type !== LifecycleTypes.join_rooms_success) return false;
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
		if (this.debug && staleRooms.length)
			console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${staleRooms.join(", ")}" - ignored`);
		if (actualRooms.length === 0) return true;
		this.triggerCallback(this.lifecycleCallbacksMap.get(payload.type), actualRooms, payload.data);
		return true;
	}

	#handleLeaveRoomsSuccessMessage(payload: any): boolean {
		if (payload.type !== LifecycleTypes.leave_rooms_success) return false;
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
		if (this.debug && staleRooms.length)
			console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${staleRooms.join(", ")}" - ignored`);
		if (actualRooms.length === 0) return true;
		this.triggerCallback(this.lifecycleCallbacksMap.get(payload.type), actualRooms, payload.data);
		return true;
	}

	#handleRoomsErrorMessage(payload: any): boolean {
		if (payload.type !== LifecycleTypes.join_rooms_error && payload.type !== LifecycleTypes.leave_rooms_error) return false;
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
		if (this.debug && staleRooms.length)
			console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${staleRooms.join(", ")}" - ignored`);
		if (actualRooms.length === 0) return true;
		this.triggerCallback(this.lifecycleCallbacksMap.get(payload.type), actualRooms, payload.data);
		return true;
	}

	#handleRoomsMessage(payload: any): boolean {
		if (payload.rooms == null || payload.event == null) return false;
		for (const room of payload.rooms) {
			this.triggerCallback(this.#roomCallbacksMap.get(room)?.get(payload.event), payload.data);
		}
		return true;
	}

	#handleRoomMessage(payload: any): boolean {
		if (payload.room == null || payload.event == null) return false;
		this.triggerCallback(this.#roomCallbacksMap.get(payload.room)?.get(payload.event), payload.data);
		return true;
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Helpers
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * @internal
	 * Clears all internal state. Called when the parent socket is destroyed.
	 */
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
		if (!state) return;
		if (state.wanted === false && state.joined === false && state.pending === null) this.#roomStateMap.delete(room);
	}

	#onSocketOpen(): void {
		const rooms: string[] = [];
		const toClean: string[] = [];
		this.#roomStateMap.forEach((state, room) => {
			if (state.wanted && !state.joined) {
				state.pending = "join";
				rooms.push(room);
			} else if (!state.wanted && state.joined) {
				state.pending = null;
				state.joined = false;
				toClean.push(room);
			}
		});
		for (const room of toClean) this.#cleanRoomState(room);
		if (rooms.length === 0) return;
		if (rooms.length === 1) {
			this.#send({ type: LifecycleTypes.join_room, room: rooms[0] });
		} else {
			this.#send({ type: LifecycleTypes.join_rooms, rooms });
		}
	}

	#onSocketClose(): void {
		this.#roomStateMap.forEach((state) => {
			state.joined = false;
			state.pending = null;
		});
	}
}
