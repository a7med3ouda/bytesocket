import type {
	ErrorContext,
	EventsForRooms,
	LifecycleMessage,
	MsgpackrOptions,
	SocketEvents,
	StringKeys,
	StringNumberKeys,
	UserMessage,
} from "@bytesocket/types";

/** The data types actually accepted by the browser WebSocket.send() method.
 *  (Excluding Blob to keep queue handling simple.) */
export type ClientSendData = string | BufferSource;

/** Signature of a callback that receives event data. */
export type EventCallback<D> = (data: D) => void;

/** Internal state tracking for a single room. */
export interface RoomState {
	/** Current pending operation (join/leave) or null. */
	pending: "join" | "leave" | null;
	/** Whether the application intends to be in this room. */
	wanted: boolean;
	/** Whether the server has confirmed membership. */
	joined: boolean;
}

/**
 * Authentication configuration.
 * Can be a static object or a function that receives a callback to asynchronously provide auth data.
 *
 * @example
 * // Static auth object (must wrap payload with `data`)
 * const socket = new ByteSocket('ws://localhost:8080', {
 *   auth: { data: { token: 'my-secret' } }
 * });
 *
 * // Async auth callback
 * const socket = new ByteSocket('ws://localhost:8080', {
 *   auth: (callback) => {
 *     fetch('/api/token').then(res => res.json()).then(callback);
 *   }
 * });
 */
export type AuthConfig<D = any> = { data: D } | ((callback: (data: D) => void) => void);

/** Configuration options for ByteSocket. */
export type ByteSocketOptions = {
	/** Automatically call `connect()` in the constructor. @default true */
	autoConnect?: boolean;
	/** Enable automatic reconnection on unexpected close. @default true */
	reconnection?: boolean;
	/** Maximum number of reconnection attempts. @default Infinity */
	maxReconnectionAttempts?: number;
	/** Base delay in milliseconds before first reconnection attempt. @default 1000 */
	reconnectionDelay?: number;
	/** Maximum reconnection delay after exponential backoff. @default 5000 */
	reconnectionDelayMax?: number;
	/**
	 * Whether to attempt reconnection after the server sends a normal closure
	 * (close codes `1000` or `1001`). @default true
	 *
	 * Normal closures are typically graceful shutdowns (e.g., server restart,
	 * idle timeout, load balancer termination). Setting this to `false` will
	 * prevent automatic reconnection in these cases.
	 */
	reconnectOnNormalClosure?: boolean;
	/** Randomization factor for reconnection delay (0 to 1). @default 0.5 */
	randomizationFactor?: number;
	/** WebSocket subprotocols. */
	protocols?: string | string[];
	/** URL path appended to the base URL. */
	path?: string;
	/** Query parameters added to the connection URL. */
	queryParams?: Record<string, string>;
	/** Enable internal ping/pong heartbeat. @default true */
	heartbeatEnabled?: boolean;
	/** Interval between ping messages in ms. @default 25000 */
	pingInterval?: number;
	/** Time to wait for pong response before closing connection. @default 20000 */
	pingTimeout?: number;
	/** Authentication configuration. */
	auth?: AuthConfig;
	/** Timeout for authentication response in ms. @default 5000 */
	authTimeout?: number;
	/** Maximum number of outgoing messages to queue while offline. @default 100 */
	maxQueueSize?: number;
	/** Serialization format: `"json"` or `"binary"` (msgpack). @default "binary" */
	serialization?: "json" | "binary";
	/** Enable debug logging to console. @default false */
	debug?: boolean;
	/** Options passed directly to the underlying msgpackr Packr instance. */
	msgpackrOptions?: MsgpackrOptions;
};

// ──── RoomLifecycleApi ────────────────────────────────────────────────────────────────────────

export interface RoomLifecycleApi {
	/**
	 * Emitted when a single room join succeeds.
	 * @param callback - Function that receives the room name.
	 */
	onJoinSuccess: (callback: (room: string) => void) => void;
	/**
	 * Removes a join-success listener.
	 * @param callback - The listener to remove.
	 */
	offJoinSuccess: (callback?: (room: string) => void) => void;
	/**
	 * One‑time listener for a single room join success.
	 * @param callback - Function that receives the room name.
	 */
	onceJoinSuccess: (callback: (room: string) => void) => void;
	/**
	 * Emitted when a single room join fails.
	 * @param callback - Function that receives the room and error context.
	 */
	onJoinError: (callback: (room: string, ctx: ErrorContext) => void) => void;
	/**
	 * Removes a join‑error listener.
	 * @param callback - The listener to remove.
	 */
	offJoinError: (callback?: (room: string, ctx: ErrorContext) => void) => void;
	/**
	 * One‑time listener for a single room join error.
	 * @param callback - Function that receives the room and error context.
	 */
	onceJoinError: (callback: (room: string, ctx: ErrorContext) => void) => void;
	/**
	 * Emitted when a single room leave succeeds.
	 * @param callback - Function that receives the room name.
	 */
	onLeaveSuccess: (callback: (room: string) => void) => void;
	/**
	 * Removes a leave‑success listener.
	 * @param callback - The listener to remove.
	 */
	offLeaveSuccess: (callback?: (room: string) => void) => void;
	/**
	 * One‑time listener for a single room leave success.
	 * @param callback - Function that receives the room name.
	 */
	onceLeaveSuccess: (callback: (room: string) => void) => void;
	/**
	 * Emitted when a single room leave fails.
	 * @param callback - Function that receives the room and error context.
	 */
	onLeaveError: (callback: (room: string, ctx: ErrorContext) => void) => void;
	/**
	 * Removes a leave‑error listener.
	 * @param callback - The listener to remove.
	 */
	offLeaveError: (callback?: (room: string, ctx: ErrorContext) => void) => void;
	/**
	 * One‑time listener for a single room leave error.
	 * @param callback - Function that receives the room and error context.
	 */
	onceLeaveError: (callback: (room: string, ctx: ErrorContext) => void) => void;
}

// ──── RoomBulkApi ────────────────────────────────────────────────────────────────────────

export interface RoomBulkApi<TEvents extends SocketEvents> {
	/**
	 * Emit an event to multiple rooms at once.
	 *
	 * @typeParam Rs -- The array of room names.
	 * @typeParam E  -- The event name.
	 * @typeParam D  -- The event data type.
	 * @param rooms - Array of room names.
	 * @param event - Name of the event to emit.
	 * @param data  - Event payload.
	 *
	 * @example
	 * // Assuming emitRooms: { rooms: ['roomA','roomB']; event: { message: string } }
	 * socket.rooms.bulk.emit(['roomA', 'roomB'], 'message', { text: 'Hello both!' });
	 */
	emit<
		Rs extends NonNullable<TEvents["emitRooms"]>["rooms"],
		E extends StringNumberKeys<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>,
		D extends NonNullable<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>[E],
	>(
		rooms: Rs,
		event: E,
		data: D,
	): void;
	/**
	 * Request to join multiple rooms.
	 * Only rooms not already joined or pending will be sent.
	 *
	 * @param rooms - Array of room names to join.
	 *
	 * @example
	 * socket.rooms.bulk.join(['lobby', 'notifications']);
	 */
	join(rooms: string[]): void;
	/**
	 * Request to leave multiple rooms.
	 * Only rooms currently joined will be sent.
	 *
	 * @param rooms - Array of room names to leave.
	 *
	 * @example
	 * socket.rooms.bulk.leave(['lobby', 'notifications']);
	 */
	leave(rooms: string[]): void;
	/** Bulk lifecycle hooks. */
	readonly lifecycle: {
		/**
		 * Emitted when a bulk join succeeds.
		 * @param callback - Function that receives the list of rooms.
		 */
		onJoinSuccess: (callback: (rooms: string[]) => void) => void;
		/**
		 * Removes a bulk join‑success listener.
		 * @param callback - The listener to remove.
		 */
		offJoinSuccess: (callback?: (rooms: string[]) => void) => void;
		/**
		 * One‑time listener for a bulk join success.
		 * @param callback - Function that receives the list of rooms.
		 */
		onceJoinSuccess: (callback: (rooms: string[]) => void) => void;
		/**
		 * Emitted when a bulk join fails.
		 * @param callback - Function that receives the list of rooms and error context.
		 */
		onJoinError: (callback: (rooms: string[], ctx: ErrorContext) => void) => void;
		/**
		 * Removes a bulk join‑error listener.
		 * @param callback - The listener to remove.
		 */
		offJoinError: (callback?: (rooms: string[], ctx: ErrorContext) => void) => void;
		/**
		 * One‑time listener for a bulk join error.
		 * @param callback - Function that receives the list of rooms and error context.
		 */
		onceJoinError: (callback: (rooms: string[], ctx: ErrorContext) => void) => void;
		/**
		 * Emitted when a bulk leave succeeds.
		 * @param callback - Function that receives the list of rooms.
		 */
		onLeaveSuccess: (callback: (rooms: string[]) => void) => void;
		/**
		 * Removes a bulk leave‑success listener.
		 * @param callback - The listener to remove.
		 */
		offLeaveSuccess: (callback?: (rooms: string[]) => void) => void;
		/**
		 * One‑time listener for a bulk leave success.
		 * @param callback - Function that receives the list of rooms.
		 */
		onceLeaveSuccess: (callback: (rooms: string[]) => void) => void;
		/**
		 * Emitted when a bulk leave fails.
		 * @param callback - Function that receives the list of rooms and error context.
		 */
		onLeaveError: (callback: (rooms: string[], ctx: ErrorContext) => void) => void;
		/**
		 * Removes a bulk leave‑error listener.
		 * @param callback - The listener to remove.
		 */
		offLeaveError: (callback?: (rooms: string[], ctx: ErrorContext) => void) => void;
		/**
		 * One‑time listener for a bulk leave error.
		 * @param callback - Function that receives the list of rooms and error context.
		 */
		onceLeaveError: (callback: (rooms: string[], ctx: ErrorContext) => void) => void;
	};
}

// ──── IRoomManager ────────────────────────────────────────────────────────────────────────

/**
 * Public API for room management on a ByteSocket client.
 *
 * @typeParam TEvents -- The event map type (from `SocketEvents`) that defines allowed room event names and payloads.
 */
export interface IRoomManager<TEvents extends SocketEvents> {
	/**
	 * Lifecycle event listeners for single-room join/leave operations.
	 *
	 * @example
	 * socket.rooms.lifecycle.onJoinSuccess((room) => {
	 *   console.log(`Joined room ${room}`);
	 * });
	 */
	readonly lifecycle: RoomLifecycleApi;
	/**
	 * Bulk operations (join/leave/emit multiple rooms) and their lifecycle listeners.
	 *
	 * @example
	 * socket.rooms.bulk.join(['room1', 'room2']);
	 * socket.rooms.bulk.emit(['room1', 'room2'], 'message', { text: 'Hi all' });
	 */
	readonly bulk: RoomBulkApi<TEvents>;
	/**
	 * Emit an event to a specific room.
	 *
	 * @typeParam R - The room name (must be a key in `TEvents['emitRoom']`).
	 * @typeParam E - The event name.
	 * @typeParam D - The event data type.
	 * @param room  - Room to emit the event to.
	 * @param event - Name of the event to emit.
	 * @param data  - Event payload.
	 *
	 * @example
	 * // Assuming event map defines emitRoom: { chat: { message: string } }
	 * socket.rooms.emit('chat', 'message', { text: 'Hello!' });
	 */
	emit<
		R extends StringKeys<TEvents["emitRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["emitRoom"]>[R]>,
		D extends NonNullable<TEvents["emitRoom"]>[R][E],
	>(
		room: R,
		event: E,
		data: D,
	): void;
	/**
	 * Request to join a single room.
	 * Idempotent - calling multiple times for the same room has no extra effect.
	 *
	 * @param room - Name of the room to join.
	 *
	 * @example
	 * socket.rooms.join('chat');
	 */
	join(room: string): void;
	/**
	 * Request to leave a single room.
	 *
	 * @param room - Name of the room to leave.
	 *
	 * @example
	 * socket.rooms.leave('chat');
	 */
	leave(room: string): void;
	/**
	 * Get a list of rooms this socket is currently subscribed to.
	 * The internal broadcast room is excluded.
	 *
	 * @returns Array of room names.
	 *
	 * @example
	 * socket.rooms.list(); // ['chat', 'lobby']
	 */
	list(): string[];
	/**
	 * Register a permanent listener for events on a specific room.
	 *
	 * @typeParam R - Room name (must be a key in `TEvents['listenRoom']`).
	 * @typeParam E - Event name.
	 * @param room     - Name of the room.
	 * @param event    - Name of the event to listen for.
	 * @param callback - Function to call when the event is received.
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
	>(
		room: R,
		event: E,
		callback: EventCallback<D>,
	): void;
	/**
	 * Remove a listener for room events.
	 * If no event is provided, all listeners for that room are removed.
	 * If no callback is provided, all listeners for that event in the room are removed.
	 *
	 * @param room     - Name of the room.
	 * @param event    - (optional) Name of the event.
	 * @param callback - (optional) The specific listener to remove.
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
	>(
		room: R,
		event?: E,
		callback?: EventCallback<D>,
	): void;
	/**
	 * Register a one-time listener for an event on a specific room.
	 * The callback is removed after its first invocation.
	 *
	 * @param room     - Name of the room.
	 * @param event    - Name of the event to listen for.
	 * @param callback - Function to call once when the event is received.
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
	>(
		room: R,
		event: E,
		callback: EventCallback<D>,
	): void;
	/**
	 * @internal
	 * Process an incoming message and dispatch to appropriate room handlers.
	 * @returns `true` if the message was handled, otherwise `false`.
	 */
	_handleMessage(payload: UserMessage): boolean;
	/**
	 * @internal
	 * Clears all internal state. Called when the parent socket is destroyed.
	 */
	_clear(): void;
}

// ──── LifecycleApi ────────────────────────────────────────────────────────────────────────

export interface LifecycleApi {
	/**
	 * Register a listener for the socket opens (after successful authentication).
	 * @param callback - Function to call when the socket opens.
	 */
	onOpen: (callback: () => void) => void;
	/**
	 * Remove a listener for socket open.
	 * @param callback - The listener to remove.
	 */
	offOpen: (callback?: () => void) => void;
	/**
	 * Register a one-time listener for socket open.
	 * @param callback - Function to call once when the socket opens.
	 */
	onceOpen: (callback: () => void) => void;

	/**
	 * Listen for raw incoming WebSocket messages **after** internal heartbeat filtering.
	 * Receive `string` (JSON) or `ArrayBuffer` (binary).
	 * @param callback - Function that receives the raw message data.
	 */
	onMessage: (callback: (data: string | ArrayBuffer) => void) => void;
	/**
	 * Remove a listener for raw messages.
	 * @param callback - The listener to remove.
	 */
	offMessage: (callback?: (data: string | ArrayBuffer) => void) => void;
	/**
	 * Register a one-time listener for raw incoming WebSocket messages.
	 * @param callback - Function to call once with the raw data.
	 */
	onceMessage: (callback: (data: string | ArrayBuffer) => void) => void;

	/**
	 * Register a listener for the socket closes.
	 * @param callback - Function that receives the `CloseEvent`.
	 */
	onClose: (callback: (event: CloseEvent) => void) => void;
	/**
	 * Remove a listener for socket close.
	 * @param callback - The listener to remove.
	 */
	offClose: (callback?: (event: CloseEvent) => void) => void;
	/**
	 * Register a one-time listener for socket close.
	 * @param callback - Function to call once when the socket closes.
	 */
	onceClose: (callback: (event: CloseEvent) => void) => void;

	/**
	 * Emitted on WebSocket errors.
	 * @param callback - Function that receives the error context.
	 */
	onError: (callback: (ctx: ErrorContext) => void) => void;
	/**
	 * Remove a listener for WebSocket errors.
	 * @param callback - The listener to remove.
	 */
	offError: (callback?: (ctx: ErrorContext) => void) => void;
	/**
	 * Register a one-time listener for WebSocket errors.
	 * @param callback - Function to call once on error.
	 */
	onceError: (callback: (ctx: ErrorContext) => void) => void;

	/**
	 * Emitted after successful authentication.
	 * @param callback - Function to call when authentication succeeds.
	 */
	onAuthSuccess: (callback: () => void) => void;
	/**
	 * Remove a listener for authentication success.
	 * @param callback - The listener to remove.
	 */
	offAuthSuccess: (callback?: () => void) => void;
	/**
	 * Register a one-time listener for authentication success.
	 * @param callback - Function to call once on auth success.
	 */
	onceAuthSuccess: (callback: () => void) => void;

	/**
	 * Register a listener for authentication fails.
	 * @param callback - Function that receives the error context.
	 */
	onAuthError: (callback: (ctx: ErrorContext) => void) => void;
	/**
	 * Remove a listener for authentication errors.
	 * @param callback - The listener to remove.
	 */
	offAuthError: (callback?: (ctx: ErrorContext) => void) => void;
	/**
	 * Register a one-time listener for authentication errors.
	 * @param callback - Function to call once on auth error.
	 */
	onceAuthError: (callback: (ctx: ErrorContext) => void) => void;

	/**
	 * Register a listener for the outgoing message queue is full and a message is dropped.
	 * @param callback - Function to call when the queue overflows.
	 */
	onQueueFull: (callback: () => void) => void;
	/**
	 * Remove a listener for queue-full events.
	 * @param callback - The listener to remove.
	 */
	offQueueFull: (callback?: () => void) => void;
	/**
	 * Register a one-time listener for queue-full events.
	 * @param callback - Function to call once when the queue is full.
	 */
	onceQueueFull: (callback: () => void) => void;

	/**
	 * Register a listener for when reconnection fails after all attempts.
	 * @param callback - Function to call when reconnection is exhausted.
	 */
	onReconnectFailed: (callback: () => void) => void;
	/**
	 * Remove a listener for reconnect-failed events.
	 * @param callback - The listener to remove.
	 */
	offReconnectFailed: (callback?: () => void) => void;
	/**
	 * Register a one-time listener for reconnect-failed events.
	 * @param callback - Function to call once when reconnection fails.
	 */
	onceReconnectFailed: (callback: () => void) => void;
}

// ──── IByteSocket ────────────────────────────────────────────────────────────────────────

/**
 * Public API of the ByteSocket WebSocket client.
 *
 * @typeParam TEvents -- The event map type (from `SocketEvents`) that defines allowed event names and payloads.
 */
export interface IByteSocket<TEvents extends SocketEvents = SocketEvents> {
	/**
	 * Lifecycle event listeners for connection, authentication, and errors.
	 *
	 * @example
	 * socket.lifecycle.onOpen(() => console.log('Connected!'));
	 * socket.lifecycle.onAuthError((err) => console.error('Auth failed', err));
	 * socket.lifecycle.onQueueFull(() => console.warn('Message queue full'));
	 */
	readonly lifecycle: LifecycleApi;
	/**
	 * Room management and room-scoped events.
	 *
	 * @example
	 * socket.rooms.join('lobby');
	 * socket.rooms.on('lobby', 'chat', (msg) => { ... });
	 */
	readonly rooms: IRoomManager<TEvents>;
	/**
	 * Current WebSocket `readyState` (CONNECTING, OPEN, CLOSING, CLOSED).
	 * Returns `WebSocket.CLOSED` if no socket exists.
	 *
	 * @returns The current readyState constant.
	 */
	readonly readyState: number;
	/**
	 * Whether the socket is currently able to send messages.
	 * Returns `true` if the WebSocket is open and authentication (if configured) has succeeded.
	 * Useful for checking readiness before calling `sendRaw()`
	 * No need to use it with `emit()` or `send()` because they already use it under the hood.
	 *
	 * @returns `true` if ready to send, otherwise `false`.
	 *
	 * @example
	 * if (socket.canSend) {
	 *   socket.sendRaw('PROTOCOL: custom-v1');
	 * }
	 */
	readonly canSend: boolean;
	/**
	 * Whether the socket has been manually closed or permanently destroyed.
	 * Returns `true` after `close()` or `destroy()` has been called.
	 *
	 * @returns `true` if closed/destroyed, otherwise `false`.
	 */
	readonly isClosed: boolean;
	/**
	 * Whether the underlying WebSocket connection is currently open.
	 *
	 * @returns `true` if the connection is open, otherwise `false`.
	 */
	readonly isConnected: boolean;
	/**
	 * Encode a structured payload into a format suitable for sending over the WebSocket.
	 *
	 * **Advanced usage only.** Prefer `emit()` or `send()` for type-safe communication.
	 *
	 * @param payload - A lifecycle message or user event object.
	 * @param serialization - Serialization format: "json" or "binary".
	 * @returns Encoded string (JSON) or Uint8Array<ArrayBuffer> (MessagePack).
	 *
	 * @example
	 * // Pre-encode a payload for repeated use
	 * const encoded = socket.encode({ event: 'chat', data: { text: 'Hello' } });
	 * socket.sendRaw(encoded);
	 */
	encode<R extends string, E extends string | number, D>(
		payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
		serialization?: "json" | "binary",
	): string | Uint8Array<ArrayBuffer>;
	/**
	 * Decode a raw WebSocket message into a structured payload.
	 * Automatically detects JSON or MessagePack based on the binary flag and message content.
	 *
	 * **Advanced usage only.** Normally you should use `on()` listeners to receive typed data.
	 *
	 * @param message - Raw string (JSON) or ArrayBuffer (MessagePack).
	 * @param isBinary - Whether the message is binary. If omitted, format is detected from the message type.
	 * @returns Decoded lifecycle or user message object.
	 */
	decode(message: string | ArrayBuffer, isBinary?: boolean): unknown;
	/**
	 * Send a payload (LifecycleMessage or UserMessage) to be serialized and sent over the WebSocket.
	 * If the socket is not ready, the payload is queued and sent when the connection
	 * becomes operational and authentication (if required) has succeeded.
	 *
	 * @param payload - The structured payload to encode and send.
	 *
	 * @example
	 * // Send a custom lifecycle message (advanced)
	 * socket.send({ type: LifecycleTypes.ping });
	 *
	 * @example
	 * // Send a raw user event (equivalent to socket.emit('chat', data))
	 * socket.send({ event: 'chat', data: { text: 'Hello' } });
	 */
	send<R extends string, E extends string | number, D>(payload: LifecycleMessage<R, D> | UserMessage<R, E, D>): void;
	/**
	 * Send a raw message (string or binary) directly over the WebSocket.
	 * Bypasses serialisation and auth checks. If the socket is not open, the message
	 * is queued and sent when possible.
	 *
	 * @param message -- The raw data to send (`string`, `ArrayBuffer`, or any typed array).
	 */
	sendRaw(message: ClientSendData): void;
	/**
	 * Emit a global event.
	 *
	 * @typeParam E - Event name (must be a key in `TEvents['emit']`).
	 * @typeParam D - Event data type.
	 * @param event - Name of the event to emit.
	 * @param data  - Event payload.
	 *
	 * @example
	 * // Assuming event map defines emit: { 'user:typing': { userId: string } }
	 * socket.emit('user:typing', { userId: '123' });
	 */
	emit<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): void;
	/**
	 * Register a permanent listener for global events.
	 *
	 * @typeParam E - Event name (must be a key in `TEvents['listen']`).
	 * @param event    - Name of the event to listen for.
	 * @param callback - Function to call when the event is received.
	 *
	 * @example
	 * // Assuming event map defines listen: { 'user:joined': { userId: string } }
	 * socket.on('user:joined', (data) => {
	 *   console.log(`User ${data.userId} joined`);
	 * });
	 */
	on<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback: EventCallback<D>): void;
	/**
	 * Remove a listener for global events.
	 * If no callback is provided, all listeners for that event are removed.
	 *
	 * @param event    - Name of the event.
	 * @param callback - (optional) The specific listener to remove.
	 *
	 * @example
	 * // Remove specific callback
	 * socket.off('user:joined', myCallback);
	 * // Remove all listeners for 'user:joined'
	 * socket.off('user:joined');
	 */
	off<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback?: EventCallback<D>): void;
	/**
	 * Register a one-time listener for a global event.
	 * The callback is removed after the first invocation.
	 *
	 * @param event    - Name of the event.
	 * @param callback - Function to call once when the event occurs.
	 *
	 * @example
	 * socket.once('user:joined', (data) => {
	 *   console.log('First join event:', data);
	 * });
	 */
	once<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback: EventCallback<D>): void;
	/**
	 * Opens the WebSocket connection. Called automatically if `autoConnect` is `true`.
	 * Can be called manually after a previous `close()`.
	 */
	connect(): void;
	/**
	 * Force an immediate reconnection, resetting the current connection and re-establishing.
	 * Useful when you suspect the connection is stale but hasn't closed yet.
	 */
	reconnect(): void;
	/**
	 * Gracefully close the WebSocket connection.
	 * Automatic reconnection is disabled after a manual close.
	 *
	 * @param code - Close code. @default undefined
	 * @param reason - Close reason. @default undefined
	 */
	close(code?: number, reason?: string): void;
	/**
	 * Permanently destroy the socket instance, cleaning up all resources,
	 * timers, and callbacks. The instance cannot be reused.
	 */
	destroy(): void;
	/**
	 * Update the authentication configuration before connecting.
	 * Must be called before `connect()` (or auto-connect).
	 *
	 * @param config - New auth config (static object or async callback).
	 *
	 * @throws {Error} If called after `destroy()` or after the socket is already connecting/open.
	 */
	setAuth<D>(config: AuthConfig<D> | undefined): void;
}
