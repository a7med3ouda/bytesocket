import type { Options } from "msgpackr";

/**
 * Extracts only the string keys from a type `T`.
 * Useful for strongly typing room names from a user-defined event map.
 *
 * @example
 * type MyEvents = { emitRoom: { chat: { message: string } } };
 * type RoomNames = StringKeys<MyEvents['emitRoom']>; // "chat"
 */
export type StringKeys<T> = Extract<keyof NonNullable<T>, string>;

/**
 * Extracts keys that are either string or number from a type `T`.
 * Typically used for event names (which may be strings or numeric codes).
 *
 * @example
 * type MyEvents = { listen: { "new_message": string; 42: number } };
 * type EventNames = StringNumberKeys<MyEvents['listen']>; // "new_message" | 42
 */
export type StringNumberKeys<T> = Extract<keyof NonNullable<T>, string | number>;

/** Options for the msgpackr serialization library, excluding the internal `useRecords` field must be false. */
export type MsgpackrOptions = Omit<Options, "useRecords">;

/**
 * Enumeration of all lifecycle message types used internally by ByteSocket.
 * These correspond to system-level events like connection open, authentication,
 * room join/leave, and errors.
 */
export enum LifecycleTypes {
	open = 1,
	close = 2,
	error = 3,
	auth = 4,
	auth_success = 5,
	auth_error = 6,
	/** @deprecated We use now a zero‑length byte array instead of custom message */
	ping = 7,
	/** @deprecated We use now a zero‑length byte array instead of custom message */
	pong = 8,
	join_room = 9,
	join_room_success = 10,
	join_room_error = 11,
	leave_room = 12,
	leave_room_success = 13,
	leave_room_error = 14,
	join_rooms = 15,
	join_rooms_success = 16,
	join_rooms_error = 17,
	leave_rooms = 18,
	leave_rooms_success = 19,
	leave_rooms_error = 20,
	queue_full = 21,
	reconnect_failed = 22,
	upgrade = 23,
	message = 24,
}

/** Context object passed to error handlers, providing details about where an error occurred. */
export type ErrorContext = {
	/** The phase or component where the error originated (e.g., "decode", "auth", "middleware") */
	phase: string;
	/** The error object itself, if any */
	error?: unknown;
	/** The event name involved, if applicable */
	event?: string;
	/** Raw message content (stringified) for debugging */
	raw?: string;
	/** WebSocket close code, if applicable */
	code?: number;
	/** Number of bytes received, if applicable */
	bytes?: number;
};

/** Lifecycle message shape for events without additional data. */
export type LifecycleType = {
	type: LifecycleTypes.open | LifecycleTypes.close | LifecycleTypes.auth_success;
};

/** Lifecycle message shape for single-room operations (join/leave request/success). */
export type LifecycleRoomType<R extends string = string> = {
	type: LifecycleTypes.join_room | LifecycleTypes.join_room_success | LifecycleTypes.leave_room | LifecycleTypes.leave_room_success;
	room: R;
};

/** Lifecycle message shape for bulk room operations (join/leave multiple rooms request/success). */
export type LifecycleRoomsType<Rs extends readonly string[] = string[]> = {
	type: LifecycleTypes.join_rooms | LifecycleTypes.join_rooms_success | LifecycleTypes.leave_rooms | LifecycleTypes.leave_rooms_success;
	rooms: Rs;
};

/** Lifecycle message shape for events that carry generic data (error, auth, auth_error). */
export type LifecyclePayload<D = unknown> = {
	type: LifecycleTypes.auth;
	data: D;
};

/** Lifecycle message shape for events that carry generic data (error, auth, auth_error). */
export type LifecycleError = {
	type: LifecycleTypes.error | LifecycleTypes.auth_error;
	data: ErrorContext;
};

/** Lifecycle error message for a single room. */
export type LifecycleRoomError<R extends string = string> = {
	type: LifecycleTypes.join_room_error | LifecycleTypes.leave_room_error;
	room: R;
	data: ErrorContext;
};

/** Lifecycle error message for multiple rooms. */
export type LifecycleRoomsError<Rs extends readonly string[] = string[]> = {
	type: LifecycleTypes.join_rooms_error | LifecycleTypes.leave_rooms_error;
	rooms: Rs;
	data: ErrorContext;
};

/** Union of all possible lifecycle messages that ByteSocket may send or receive. */
export type LifecycleMessage<R extends string = string, D = unknown> =
	| LifecycleType
	| LifecycleRoomType<R>
	| LifecycleRoomsType<R[]>
	| LifecyclePayload<D>
	| LifecycleError
	| LifecycleRoomError<R>
	| LifecycleRoomsError<R[]>;

/**
 * User-defined event sent to a specific room.
 *
 * @example
 * // Emitting to room "chat" with event "message"
 * socket.rooms.emit("chat", "message", { text: "Hello!" });
 */
export type RoomEvent<R extends string = string, E extends string | number = string | number, D = unknown> = {
	room: R;
	event: E;
	data: D;
};

/**
 * User-defined event sent to multiple rooms simultaneously.
 *
 * @example
 * // Emitting to rooms ["lobby", "announcements"]
 * socket.rooms.bulk.emit(["lobby", "announcements"], "alert", { msg: "Server restart in 5m" });
 */
export type RoomsEvent<Rs extends readonly string[] = string[], E extends string | number = string | number, D = unknown> = {
	rooms: Rs;
	event: E;
	data: D;
};

/**
 * User-defined event sent globally (no room context).
 *
 * @example
 * socket.emit("userJoined", { userId: "abc123" });
 */
export type GeneralEvent<E extends string | number = string | number, D = unknown> = {
	event: E;
	data: D;
};

/** Union of all possible user messages that can be emitted or listened to. */
export type UserMessage<R extends string = string, E extends string | number = string | number, D = unknown> =
	| GeneralEvent<E, D>
	| RoomEvent<R, E, D>
	| RoomsEvent<R[], E, D>;

/**
 * Generic callback type used internally.
 * @internal
 */
export type AnyCallback = (...args: any[]) => Promise<void> | void;

/** Authentication state of a socket. */
export enum AuthState {
	/** Initial state before any connection attempt. */
	idle = 1,
	/** No authentication required / not configured. */
	none = 2,
	/** Authentication request sent, awaiting server response. */
	pending = 3,
	/** Authentication successful. */
	success = 4,
	/** Authentication failed permanently. */
	failed = 5,
}

/**
 * Defines the shape of event maps for a type-safe ByteSocket instance.
 *
 * This type supports two usage patterns:
 *
 * 1. **Symmetric events (direct generic):** Provide a single event map where
 *    emit and listen share the same event names and payloads.
 *
 * 2. **Asymmetric events (interface extension):** Extend this type and override
 *    individual properties to define different maps for emit, listen, rooms, etc.
 *
 * @typeParam T - A map of event names to their payload types.
 * @default Record<string, unknown>
 *
 * @example Symmetric usage (most common)
 * ```ts
 * type MyEvents = SocketEvents<{
 *   "chat:message": { text: string };
 *   "user:joined": { userId: string };
 * }>;
 *
 * const socket = new ByteSocket<MyEvents>('ws://...');
 *
 * socket.emit('chat:message', { text: 'Hello' });          // ✅ typed
 * socket.on('user:joined', (data) => console.log(data.userId)); // ✅ typed
 * socket.rooms.emit('lobby', 'chat:message', { text: 'Hi' }); // ✅ typed
 * ```
 *
 * @example Asymmetric usage (full control)
 * ```ts
 * interface MyEvents extends SocketEvents {
 *   emit: {
 *     "message:send": { text: string };
 *     "room:create": { name: string };
 *   };
 *   listen: {
 *     "message:receive": { text: string; sender: string };
 *     "user:joined": { userId: string; name: string };
 *   };
 *   emitRoom: {
 *     chat: { "message": { text: string } };
 *     dm:   { "message": { text: string; recipient: string } };
 *   };
 *   listenRoom: {
 *     chat: { "message": { text: string; sender: string } };
 *   };
 * }
 *
 * const socket = new ByteSocket<MyEvents>('ws://...');
 *
 * socket.emit('room:create', { name: 'general' });				// ✅ global emit
 * socket.on('message:receive', (data) => data.sender);			// ✅ global listen
 * socket.rooms.emit('chat', 'message', { text: 'Hello' });		// ✅ room emit
 * ```
 */
export type SocketEvents<T extends { [event: string | number]: unknown } = { [event: string | number]: unknown }> = {
	/** Events that can be emitted globally. */
	emit?: T;
	/** Events that can be listened to globally. */
	listen?: T;
	/** Events that can be emitted to a specific room, keyed by room name. */
	emitRoom?: { [room: string]: T };
	/** Events that can be listened to on a specific room, keyed by room name. */
	listenRoom?: { [room: string]: T };
	/** Events that can be emitted to multiple rooms at once. */
	emitRooms?: { rooms: string[]; event: T };
};

/** Extracts the event map for a specific set of rooms from `emitRooms`. */
export type EventsForRooms<T extends NonNullable<SocketEvents["emitRooms"]>, R> = Extract<T, { rooms: R }>["event"];
