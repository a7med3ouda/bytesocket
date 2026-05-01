// packages/client/src/interfaces.ts
import type { ErrorContext, EventsForRooms, LifecycleMessage, SocketEvents, StringKeys, StringNumberKeys, UserMessage } from "@bytesocket/core";
import type { AuthConfig, ClientIncomingData, ClientOutgoingData, EventCallback } from "./types";

export interface IRoomsLifecycle {
	/**
	 * Emitted when a single room join succeeds.
	 * @param callback - Function that receives the room name.
	 */
	onJoinSuccess: (callback: (room: string) => void) => this;
	/**
	 * Removes a join-success listener.
	 * @param callback - The listener to remove.
	 */
	offJoinSuccess: (callback?: (room: string) => void) => this;
	/**
	 * One‑time listener for a single room join success.
	 * @param callback - Function that receives the room name.
	 */
	onceJoinSuccess: (callback: (room: string) => void) => this;
	/**
	 * Emitted when a single room join fails.
	 * @param callback - Function that receives the room and error context.
	 */
	onJoinError: (callback: (room: string, ctx: ErrorContext) => void) => this;
	/**
	 * Removes a join‑error listener.
	 * @param callback - The listener to remove.
	 */
	offJoinError: (callback?: (room: string, ctx: ErrorContext) => void) => this;
	/**
	 * One‑time listener for a single room join error.
	 * @param callback - Function that receives the room and error context.
	 */
	onceJoinError: (callback: (room: string, ctx: ErrorContext) => void) => this;
	/**
	 * Emitted when a single room leave succeeds.
	 * @param callback - Function that receives the room name.
	 */
	onLeaveSuccess: (callback: (room: string) => void) => this;
	/**
	 * Removes a leave‑success listener.
	 * @param callback - The listener to remove.
	 */
	offLeaveSuccess: (callback?: (room: string) => void) => this;
	/**
	 * One‑time listener for a single room leave success.
	 * @param callback - Function that receives the room name.
	 */
	onceLeaveSuccess: (callback: (room: string) => void) => this;
	/**
	 * Emitted when a single room leave fails.
	 * @param callback - Function that receives the room and error context.
	 */
	onLeaveError: (callback: (room: string, ctx: ErrorContext) => void) => this;
	/**
	 * Removes a leave‑error listener.
	 * @param callback - The listener to remove.
	 */
	offLeaveError: (callback?: (room: string, ctx: ErrorContext) => void) => this;
	/**
	 * One‑time listener for a single room leave error.
	 * @param callback - Function that receives the room and error context.
	 */
	onceLeaveError: (callback: (room: string, ctx: ErrorContext) => void) => this;
}

export interface IRoomsBulkLifecycle {
	/**
	 * Emitted when a bulk join succeeds.
	 * @param callback - Function that receives the list of rooms.
	 */
	onJoinSuccess: (callback: (rooms: string[]) => void) => this;
	/**
	 * Removes a bulk join‑success listener.
	 * @param callback - The listener to remove.
	 */
	offJoinSuccess: (callback?: (rooms: string[]) => void) => this;
	/**
	 * One‑time listener for a bulk join success.
	 * @param callback - Function that receives the list of rooms.
	 */
	onceJoinSuccess: (callback: (rooms: string[]) => void) => this;
	/**
	 * Emitted when a bulk join fails.
	 * @param callback - Function that receives the list of rooms and error context.
	 */
	onJoinError: (callback: (rooms: string[], ctx: ErrorContext) => void) => this;
	/**
	 * Removes a bulk join‑error listener.
	 * @param callback - The listener to remove.
	 */
	offJoinError: (callback?: (rooms: string[], ctx: ErrorContext) => void) => this;
	/**
	 * One‑time listener for a bulk join error.
	 * @param callback - Function that receives the list of rooms and error context.
	 */
	onceJoinError: (callback: (rooms: string[], ctx: ErrorContext) => void) => this;
	/**
	 * Emitted when a bulk leave succeeds.
	 * @param callback - Function that receives the list of rooms.
	 */
	onLeaveSuccess: (callback: (rooms: string[]) => void) => this;
	/**
	 * Removes a bulk leave‑success listener.
	 * @param callback - The listener to remove.
	 */
	offLeaveSuccess: (callback?: (rooms: string[]) => void) => this;
	/**
	 * One‑time listener for a bulk leave success.
	 * @param callback - Function that receives the list of rooms.
	 */
	onceLeaveSuccess: (callback: (rooms: string[]) => void) => this;
	/**
	 * Emitted when a bulk leave fails.
	 * @param callback - Function that receives the list of rooms and error context.
	 */
	onLeaveError: (callback: (rooms: string[], ctx: ErrorContext) => void) => this;
	/**
	 * Removes a bulk leave‑error listener.
	 * @param callback - The listener to remove.
	 */
	offLeaveError: (callback?: (rooms: string[], ctx: ErrorContext) => void) => this;
	/**
	 * One‑time listener for a bulk leave error.
	 * @param callback - Function that receives the list of rooms and error context.
	 */
	onceLeaveError: (callback: (rooms: string[], ctx: ErrorContext) => void) => this;
}

export interface IRoomsBulk<TEvents extends SocketEvents> {
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
	): this;
	/**
	 * Request to join multiple rooms.
	 * Only rooms not already joined or pending will be sent.
	 *
	 * @param rooms - Array of room names to join.
	 *
	 * @example
	 * socket.rooms.bulk.join(['lobby', 'notifications']);
	 */
	join(rooms: string[]): this;
	/**
	 * Request to leave multiple rooms.
	 * Only rooms currently joined will be sent.
	 *
	 * @param rooms - Array of room names to leave.
	 *
	 * @example
	 * socket.rooms.bulk.leave(['lobby', 'notifications']);
	 */
	leave(rooms: string[]): this;
	/** Bulk lifecycle hooks. */
	readonly lifecycle: IRoomsBulkLifecycle;
}

/**
 * Public API for room management on a ByteSocket client.
 *
 * @typeParam TEvents -- The event map type (from `SocketEvents`) that defines allowed room event names and payloads.
 */
export interface IRooms<TEvents extends SocketEvents> {
	/**
	 * Lifecycle event listeners for single-room join/leave operations.
	 *
	 * @example
	 * socket.rooms.lifecycle.onJoinSuccess((room) => {
	 *   console.log(`Joined room ${room}`);
	 * });
	 */
	readonly lifecycle: IRoomsLifecycle;
	/**
	 * Bulk operations (join/leave/emit multiple rooms) and their lifecycle listeners.
	 *
	 * @example
	 * socket.rooms.bulk.join(['room1', 'room2']);
	 * socket.rooms.bulk.emit(['room1', 'room2'], 'message', { text: 'Hi all' });
	 */
	readonly bulk: IRoomsBulk<TEvents>;
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
	): this;
	/**
	 * Request to join a single room.
	 * Idempotent - calling multiple times for the same room has no extra effect.
	 *
	 * @param room - Name of the room to join.
	 *
	 * @example
	 * socket.rooms.join('chat');
	 */
	join(room: string): this;
	/**
	 * Request to leave a single room.
	 *
	 * @param room - Name of the room to leave.
	 *
	 * @example
	 * socket.rooms.leave('chat');
	 */
	leave(room: string): this;
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
	): this;
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
	): this;
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
	): this;
}

export interface ILifecycle {
	/**
	 * Register a listener for the socket opens (after successful authentication).
	 * @param callback - Function to call when the socket opens.
	 */
	onOpen: (callback: () => void) => this;
	/**
	 * Remove a listener for socket open.
	 * @param callback - The listener to remove.
	 */
	offOpen: (callback?: () => void) => this;
	/**
	 * Register a one-time listener for socket open.
	 * @param callback - Function to call once when the socket opens.
	 */
	onceOpen: (callback: () => void) => this;

	/**
	 * Listen for raw incoming WebSocket messages **after** internal heartbeat filtering.
	 * Receive `string` (JSON) or `ArrayBuffer` (binary).
	 * @param callback - Function that receives the raw message data.
	 */
	onMessage: (callback: (data: ClientIncomingData) => void) => this;
	/**
	 * Remove a listener for raw messages.
	 * @param callback - The listener to remove.
	 */
	offMessage: (callback?: (data: ClientIncomingData) => void) => this;
	/**
	 * Register a one-time listener for raw incoming WebSocket messages.
	 * @param callback - Function to call once with the raw data.
	 */
	onceMessage: (callback: (data: ClientIncomingData) => void) => this;

	/**
	 * Register a listener for the socket closes.
	 * @param callback - Function that receives the `CloseEvent`.
	 */
	onClose: (callback: (event: CloseEvent) => void) => this;
	/**
	 * Remove a listener for socket close.
	 * @param callback - The listener to remove.
	 */
	offClose: (callback?: (event: CloseEvent) => void) => this;
	/**
	 * Register a one-time listener for socket close.
	 * @param callback - Function to call once when the socket closes.
	 */
	onceClose: (callback: (event: CloseEvent) => void) => this;

	/**
	 * Emitted on WebSocket errors.
	 * @param callback - Function that receives the error context.
	 */
	onError: (callback: (ctx: ErrorContext) => void) => this;
	/**
	 * Remove a listener for WebSocket errors.
	 * @param callback - The listener to remove.
	 */
	offError: (callback?: (ctx: ErrorContext) => void) => this;
	/**
	 * Register a one-time listener for WebSocket errors.
	 * @param callback - Function to call once on error.
	 */
	onceError: (callback: (ctx: ErrorContext) => void) => this;

	/**
	 * Emitted after successful authentication.
	 * @param callback - Function to call when authentication succeeds.
	 */
	onAuthSuccess: (callback: () => void) => this;
	/**
	 * Remove a listener for authentication success.
	 * @param callback - The listener to remove.
	 */
	offAuthSuccess: (callback?: () => void) => this;
	/**
	 * Register a one-time listener for authentication success.
	 * @param callback - Function to call once on auth success.
	 */
	onceAuthSuccess: (callback: () => void) => this;

	/**
	 * Register a listener for authentication fails.
	 * @param callback - Function that receives the error context.
	 */
	onAuthError: (callback: (ctx: ErrorContext) => void) => this;
	/**
	 * Remove a listener for authentication errors.
	 * @param callback - The listener to remove.
	 */
	offAuthError: (callback?: (ctx: ErrorContext) => void) => this;
	/**
	 * Register a one-time listener for authentication errors.
	 * @param callback - Function to call once on auth error.
	 */
	onceAuthError: (callback: (ctx: ErrorContext) => void) => this;

	/**
	 * Register a listener for the outgoing message queue is full and a message is dropped.
	 * @param callback - Function to call when the queue overflows.
	 */
	onQueueFull: (callback: () => void) => this;
	/**
	 * Remove a listener for queue-full events.
	 * @param callback - The listener to remove.
	 */
	offQueueFull: (callback?: () => void) => this;
	/**
	 * Register a one-time listener for queue-full events.
	 * @param callback - Function to call once when the queue is full.
	 */
	onceQueueFull: (callback: () => void) => this;

	/**
	 * Register a listener for when reconnection fails after all attempts.
	 * @param callback - Function to call when reconnection is exhausted.
	 */
	onReconnectFailed: (callback: () => void) => this;
	/**
	 * Remove a listener for reconnect-failed events.
	 * @param callback - The listener to remove.
	 */
	offReconnectFailed: (callback?: () => void) => this;
	/**
	 * Register a one-time listener for reconnect-failed events.
	 * @param callback - Function to call once when reconnection fails.
	 */
	onceReconnectFailed: (callback: () => void) => this;
}

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
	readonly lifecycle: ILifecycle;
	/**
	 * Room management and room-scoped events.
	 *
	 * @example
	 * socket.rooms.join('lobby');
	 * socket.rooms.on('lobby', 'chat', (msg) => { ... });
	 */
	readonly rooms: IRooms<TEvents>;
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
	decode(message: ClientIncomingData, isBinary?: boolean): unknown;
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
	send<R extends string, E extends string | number, D>(payload: LifecycleMessage<R, D> | UserMessage<R, E, D>): this;
	/**
	 * Send a raw message (string or binary) directly over the WebSocket.
	 * Bypasses serialisation and auth checks. If the socket is not open, the message
	 * is queued and sent when possible.
	 *
	 * @param message -- The raw data to send (`string`, `ArrayBuffer`, or any typed array).
	 */
	sendRaw(message: ClientOutgoingData): this;
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
	emit<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): this;
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
	on<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback: EventCallback<D>): this;
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
	off<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback?: EventCallback<D>): this;
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
	once<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback: EventCallback<D>): this;
	/**
	 * Opens the WebSocket connection. Called automatically if `autoConnect` is `true`.
	 * Can be called manually after a previous `close()`.
	 */
	connect(): this;
	/**
	 * Force an immediate reconnection, resetting the current connection and re-establishing.
	 * Useful when you suspect the connection is stale but hasn't closed yet.
	 */
	reconnect(): this;
	/**
	 * Gracefully close the WebSocket connection.
	 * Automatic reconnection is disabled after a manual close.
	 *
	 * @param code - Close code. @default undefined
	 * @param reason - Close reason. @default undefined
	 */
	close(code?: number, reason?: string): this;
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
	setAuth<D>(config: AuthConfig<D> | undefined): this;
}
