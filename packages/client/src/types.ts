import { Options } from "msgpackr";

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

/**
 * Options for the msgpackr serialization library, excluding the internal `structures` field.
 */
export type MsgpackrOptions = Omit<Options, "structures">;

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
	ping = 7,
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
}

/**
 * Lifecycle message shape for events without additional data.
 */
export type LifecycleType = {
	type: LifecycleTypes.open | LifecycleTypes.close | LifecycleTypes.ping | LifecycleTypes.pong | LifecycleTypes.auth_success;
};

/**
 * Lifecycle message shape for single-room operations (join/leave request/success).
 */
export type RoomType<R extends string> = {
	type: LifecycleTypes.join_room | LifecycleTypes.join_room_success | LifecycleTypes.leave_room | LifecycleTypes.leave_room_success;
	room: R;
};

/**
 * Lifecycle message shape for bulk room operations (join/leave multiple rooms request/success).
 */
export type RoomsType<Rs extends readonly string[]> = {
	type: LifecycleTypes.join_rooms | LifecycleTypes.join_rooms_success | LifecycleTypes.leave_rooms | LifecycleTypes.leave_rooms_success;
	rooms: Rs;
};

/**
 * Lifecycle message shape for events that carry generic data (error, auth, auth_error).
 */
export type LifecyclePayload<D = unknown> = {
	type: LifecycleTypes.error | LifecycleTypes.auth | LifecycleTypes.auth_error;
	data: D;
};

/**
 * Lifecycle error message for a single room.
 */
export type RoomPayload<R extends string, D = unknown> = {
	type: LifecycleTypes.join_room_error | LifecycleTypes.leave_room_error;
	room: R;
	data: D;
};

/**
 * Lifecycle error message for multiple rooms.
 */
export type RoomsPayload<Rs extends readonly string[], D = unknown> = {
	type: LifecycleTypes.join_rooms_error | LifecycleTypes.leave_rooms_error;
	rooms: Rs;
	data: D;
};

/**
 * Union of all possible lifecycle messages that ByteSocket may send or receive.
 */
export type LifecycleMessage<R extends string, D = unknown> =
	| LifecycleType
	| RoomType<R>
	| RoomsType<R[]>
	| LifecyclePayload<D>
	| RoomPayload<R, D>
	| RoomsPayload<R[], D>;

/**
 * User‑defined event sent to a specific room.
 */
export type RoomEvent<R extends string, E extends string | number, D = unknown> = {
	room: R;
	event: E;
	data: D;
};

/**
 * User‑defined event sent to multiple rooms simultaneously.
 */
export type RoomsEvent<Rs extends readonly string[], E extends string | number, D = unknown> = {
	rooms: Rs;
	event: E;
	data: D;
};

/**
 * User‑defined event sent globally (no room context).
 */
export type GeneralEvent<E extends string | number, D = unknown> = {
	event: E;
	data: D;
};

/**
 * Union of all possible user messages that can be emitted or listened to.
 */
export type UserMessage<R extends string, E extends string | number, D = unknown> = GeneralEvent<E, D> | RoomEvent<R, E, D> | RoomsEvent<R[], E, D>;

/**
 * Signature of a callback that receives event data.
 */
export type EventCallback<D = unknown> = (data: D) => void;

/**
 * Internal state tracking for a single room.
 */
export interface RoomState {
	/** Current pending operation (join/leave) or null. */
	pending: "join" | "leave" | null;
	/** Whether the application intends to be in this room. */
	wanted: boolean;
	/** Whether the server has confirmed membership. */
	joined: boolean;
}

/**
 * Generic callback type used internally.
 */
export type AnyCallback = (...args: any[]) => void;

/**
 * Authentication configuration.
 * Can be a static object or a function that receives a callback to asynchronously provide auth data.
 *
 * @example
 * // Static auth object
 * const socket = new ByteSocket('ws://localhost:8080', {
 *   auth: { token: 'my-secret' }
 * });
 *
 * // Async auth callback
 * const socket = new ByteSocket('ws://localhost:8080', {
 *   auth: (cb) => {
 *     fetch('/api/token').then(res => res.json()).then(cb);
 *   }
 * });
 */
export type AuthConfig<D extends object = object> = D | ((cb: (data: D) => void) => void);

/**
 * Authentication state of the socket.
 */
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
 * Defines the shape of event maps for a type‑safe ByteSocket instance.
 *
 * @typeParam T - A map of event names to their payload types.
 *
 * @example
 * interface MyEvents extends SymmetricEvents<{
 *   emit: {
 *     message: { text: string };
 *     'user:typing': { userId: string };
 *   };
 *   listen: {
 *     message: { text: string; sender: string };
 *     connected: { userId: string };
 *   };
 *   emitRoom: {
 *     chat: { message: string };
 *     private: { whisper: string };
 *   };
 *   listenRoom: {
 *     chat: { message: string; sender: string };
 *   };
 * }> {}
 *
 * const socket = new ByteSocket<MyEvents>('ws://...');
 * socket.emit('message', { text: 'hello' });          // typed
 * socket.emit('chat', { message: 'hi' });             // typed room emit
 * socket.on('message', (data) => { data.sender });    // typed
 * socket.rooms.on('chat', 'message', (data) => {});   // typed room listen
 */
export type SymmetricEvents<
	T extends { [event: string | number]: unknown } = {
		[event: string | number]: unknown;
	},
> = {
	/** Events that can be emitted globally. */
	emit?: T;
	/** Events that can be listened to globally. */
	listen?: T;
	/** Events that can be emitted to a specific room, keyed by room name. */
	emitRoom?: { [room: string]: T };
	/** Events that can be listened to on a specific room, keyed by room name. */
	listenRoom?: { [room: string]: T };
	/** Events that can be emitted to multiple rooms at once. */
	emitRooms?: { rooms: string[]; events: T };
};

/**
 * Extracts the event map for a specific set of rooms from `emitRooms`.
 */
export type EventsForRooms<T extends NonNullable<SymmetricEvents["emitRooms"]>, R> = Extract<T, { rooms: R }>["events"];

/**
 * Configuration options for ByteSocket.
 */
export type ByteSocketOptions = {
	/** Automatically call `connect()` in the constructor. Default `true`. */
	autoConnect?: boolean;
	/** Enable automatic reconnection on unexpected close. Default `true`. */
	reconnection?: boolean;
	/** Maximum number of reconnection attempts. Default `Infinity`. */
	maxReconnectionAttempts?: number;
	/** Base delay in milliseconds before first reconnection attempt. Default `1000`. */
	reconnectionDelay?: number;
	/** Maximum reconnection delay after exponential backoff. Default `5000`. */
	reconnectionDelayMax?: number;
	/** Randomization factor for reconnection delay (0 to 1). Default `0.5`. */
	randomizationFactor?: number;
	/** WebSocket subprotocols. */
	protocols?: string | string[];
	/** URL path appended to the base URL. */
	path?: string;
	/** Query parameters added to the connection URL. */
	queryParams?: Record<string, string>;
	/** Enable internal ping/pong heartbeat. Default `true`. */
	heartbeatEnabled?: boolean;
	/** Interval between ping messages in ms. Default `25000`. */
	pingInterval?: number;
	/** Time to wait for pong response before closing connection. Default `20000`. */
	pingTimeout?: number;
	/** Authentication configuration. */
	auth?: AuthConfig;
	/** Timeout for authentication response in ms. Default `5000`. */
	authTimeout?: number;
	/** Maximum number of outgoing messages to queue while offline. Default `100`. */
	maxQueueSize?: number;
	/** Serialization format: `"json"` or `"binary"` (msgpack). Default `"binary"`. */
	serialization?: "json" | "binary";
	/** Enable debug logging to console. Default `false`. */
	debug?: boolean;
	/** Options passed directly to the underlying msgpackr Packr instance. */
	msgpackrOptions?: MsgpackrOptions;
};
