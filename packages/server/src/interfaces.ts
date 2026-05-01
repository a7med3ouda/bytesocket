// packages/server/src/interfaces.ts
import type {
	AnyCallback,
	ErrorContext,
	EventsForRooms,
	IByteSocketBase,
	LifecycleMessage,
	LifecycleTypes,
	SocketEvents,
	StringKeys,
	StringNumberKeys,
	UserMessage,
} from "@bytesocket/core";
import type {
	AuthFunction,
	EventCallback,
	Middleware,
	MiddlewareNext,
	RoomEventMiddleware,
	ServerIncomingData,
	ServerOutgoingData,
	SocketData,
} from "./types";

/** Bulk operations for multiple rooms. */
export interface ISocketRoomsBulk<TEvents extends SocketEvents> {
	/**
	 * Events that can be emitted to multiple rooms at once.
	 *
	 * **Recommended pattern:** Use a union of `{ rooms: R; event: T }` objects:
	 *
	 * @example
	 * interface MyEvents extends SocketEvents {
	 *   emitRooms:
	 *     | { rooms: ['room1', 'room2']; event: { 'alert': { msg: string } } }
	 *     | { rooms: ['roomA', 'roomB']; event: { 'message': { text: string } } };
	 *
	 * socket.rooms.bulk.emit(["room1", "room2"], "alert", { msg: "Hello" });
	 * }
	 */
	emit: <
		Rs extends NonNullable<TEvents["emitRooms"]>["rooms"],
		E extends StringNumberKeys<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>,
		D extends NonNullable<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>[E],
	>(
		rooms: Rs,
		event: E,
		data: D,
	) => this;
	/**
	 * Join multiple rooms.
	 * @example socket.rooms.bulk.join(["lobby", "notifications"]);
	 */
	join: (rooms: string[]) => this;
	/**
	 * Leave multiple rooms.
	 * @example socket.rooms.bulk.leave(["lobby", "notifications"]);
	 */
	leave: (rooms: string[]) => this;
}

/**
 * Room API available on individual socket instances (client-side or server-side socket).
 * Provides methods to join/leave rooms and emit to rooms.
 *
 * @typeParam TEvents - The socket events definition.
 */
export interface ISocketRooms<TEvents extends SocketEvents> {
	/**
	 * Publishes a raw message to a specific room without applying any serialization or encoding.
	 *
	 * This method is useful for sending custom protocol messages or pre-encoded data directly
	 * to all sockets subscribed to the given room. It bypasses the built-in serialization layer,
	 * so you are responsible for ensuring that the message format matches what the clients expect.
	 *
	 * If the socket has been closed, this method does nothing.
	 *
	 * @param room - The name of the room to publish the message to.
	 * @param message - The raw message to send. Can be a `string` (UTF-8 text) or an `ArrayBuffer` / `Buffer` (binary data).
	 * @param isBinary - Optional. If `true`, the message is sent as a binary WebSocket frame.
	 *                   If `false` or omitted, the frame type is inferred from the type of `message`
	 *                   (`string` → text frame, `ArrayBuffer`/`Buffer` → binary frame).
	 * @param compress - Optional. If `true`, the message will be compressed using the WebSocket
	 *                   permessage-deflate extension (if negotiated with the client).
	 *
	 * @example
	 * // Send a JSON string to all sockets in the "lobby" room
	 * socket.rooms.publishRaw("lobby", JSON.stringify({ type: "announcement", text: "Hello!" }));
	 *
	 * @example
	 * // Send pre-encoded binary data (e.g., MessagePack) to the "game" room
	 * const packedData = msgpack.encode({ event: "move", x: 10, y: 20 });
	 * socket.rooms.publishRaw("game", packedData, true);
	 */
	publishRaw: (room: string, message: ServerOutgoingData, isBinary?: boolean, compress?: boolean) => this;
	/**
	 * Emit a typed event to a specific room (server-side publish).
	 *
	 * @typeParam R - Room name (must be a key in `TEvents['emitRoom']`).
	 * @typeParam E - Event name.
	 * @typeParam D - Event data type.
	 * @param room  - The target room.
	 * @param event - The event name.
	 * @param data  - The event payload.
	 * @returns This server instance (for chaining).
	 *
	 * @example socket.rooms.emit("chat", "message", { text: "Hi" });
	 */
	emit: <
		R extends StringKeys<TEvents["emitRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["emitRoom"]>[R]>,
		D extends NonNullable<TEvents["emitRoom"]>[R][E],
	>(
		room: R,
		event: E,
		data: D,
	) => this;
	/**
	 * Join a single room.
	 * @example socket.rooms.join("lobby");
	 */
	join: (room: string) => this;
	/**
	 * Leave a single room.
	 * @example socket.rooms.leave("lobby");
	 */
	leave: (room: string) => this;
	/**
	 * Get a list of rooms this socket is currently subscribed to.
	 * By default, the internal broadcast room is excluded.
	 *
	 * @param includeBroadcast - If `true`, includes the broadcast room in the result.
	 * @returns Array of room names.
	 *
	 * @example
	 * socket.rooms.list(); // ['chat', 'lobby']
	 * socket.rooms.list(true); // ['chat', 'lobby', '__bytesocket_broadcast__']
	 */
	list: (includeBroadcast?: boolean) => string[];
	/** Bulk operations for multiple rooms. */
	bulk: ISocketRoomsBulk<TEvents>;
}

/**
 * Public API of an individual WebSocket connection.
 *
 * @typeParam TEvents - Event map type.
 * @typeParam SD      - Socket data type (extends `SocketData`).
 */
export interface ISocket<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData> {
	/**
	 * Room management and room-scoped event emission.
	 *
	 * @example
	 * socket.rooms.join("chat");
	 * socket.rooms.emit("chat", "message", { text: "Hello!" });
	 * console.log(socket.rooms.list()); // ["chat"]
	 */
	readonly rooms: ISocketRooms<TEvents>;
	/** Unique identifier for the socket (same as `userData.socketKey`). */
	readonly id: string;
	/**
	 * Payload attached during successful authentication.
	 * Available in middleware and event listeners.
	 *
	 * @example
	 * io.on("chat", (socket, data) => {
	 *   console.log(`Message from ${socket.payload.username}`);
	 * });
	 */
	payload: any;
	/**
	 * Mutable object for storing arbitrary data during the socket's lifetime.
	 * Useful for passing data between middleware and event handlers.
	 *
	 * @example
	 * io.use((socket, ctx, next) => {
	 *   socket.locals.requestId = randomUUID();
	 *   next();
	 * });
	 */
	locals: any;
	/**
	 * Whether the socket has completed authentication (or auth is disabled).
	 * Returns `true` if no auth is configured, or if authentication succeeded.
	 */
	readonly isAuthenticated: boolean;
	/** Whether the socket has been closed. */
	readonly isClosed: boolean;
	/**
	 * Whether the socket is currently able to send messages.
	 * Returns `true` if the WebSocket is open and authentication (if configured) has succeeded.
	 * Useful for checking readiness before calling `sendRaw()` or `rooms.publishRaw()`.
	 * No need to use it with `emit()` or `send()` because they already use it under the hood.
	 *
	 * @example
	 * if (socket.canSend) {
	 *   socket.sendRaw('PROTOCOL: custom-v1');
	 * }
	 */
	readonly canSend: boolean;
	/**
	 * The user data object attached during the WebSocket upgrade.
	 * Contains HTTP request headers and other metadata.
	 *
	 * @example
	 * console.log(socket.userData.socketKey);
	 */
	readonly userData: SD;
	/**
	 * The path component of the URL requested by the client during the
	 * WebSocket upgrade.
	 *
	 * @example
	 * // If the client connected to `wss://example.com/socket?room=lobby`,
	 * // this will be `"/socket"`.
	 */
	readonly url: string;
	/**
	 * The raw query string from the WebSocket upgrade request.
	 *
	 * @example
	 * // If the client connected to `wss://example.com/socket?room=lobby&token=abc`,
	 * // this will be `"room=lobby&token=abc"`.
	 * const query = socket.query;
	 * const params = new URLSearchParams(socket.query);
	 * console.log(params.get('room')); // "lobby"
	 */
	readonly query: string;
	/**
	 * The `Cookie` header from the WebSocket upgrade request.
	 *
	 * @example
	 * // Useful for session handling when not using the Authorization header.
	 * const cookies = socket.cookie;
	 * const sessionId = parseCookies(cookies)?.sessionId;
	 */
	readonly cookie: string;
	/**
	 * The `Authorization` header from the WebSocket upgrade request.
	 * Typically contains a Bearer token or Basic auth credentials.
	 *
	 * @example
	 * const authHeader = socket.authorization;
	 * if (authHeader?.startsWith('Bearer ')) {
	 *   const token = authHeader.slice(7);
	 *   // validate token...
	 * }
	 */
	readonly authorization: string;
	/**
	 * The `User-Agent` header from the WebSocket upgrade request.
	 *
	 * @example
	 * console.log(`Client: ${socket.userAgent}`);
	 * // "Client: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ..."
	 */
	readonly userAgent: string;
	/**
	 * The `Host` header from the WebSocket upgrade request.
	 * Includes the domain and (optionally) port the client used to connect.
	 *
	 * @example
	 * console.log(socket.host); // "api.example.com"
	 */
	readonly host: string;
	/**
	 * The `X-Forwarded-For` header from the WebSocket upgrade request.
	 * Contains the originating client IP when behind a proxy or load balancer.
	 *
	 * @example
	 * const clientIp = socket.xForwardedFor?.split(',')[0].trim() || 'unknown';
	 * console.log(`Client IP: ${clientIp}`);
	 */
	readonly xForwardedFor: string;
	/**
	 * Emit a typed global event to this socket only.
	 *
	 * @typeParam E - Event name (must be a key in `TEvents['emit']`).
	 * @typeParam D - Event data type.
	 * @param event - The event name.
	 * @param data - The event payload.
	 * @returns This socket instance (for chaining).
	 *
	 * @example
	 * socket.emit("privateMessage", { from: "server", text: "Hello" });
	 */
	emit<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): this;
	/**
	 * Send a raw message (string or binary) directly to this socket.
	 * Bypasses serialization. Useful for custom protocols.
	 *
	 * @param message - The message to send.
	 * @param isBinary - Whether to send as binary frame.
	 * @default true `if message is not a string`.
	 * @param compress - Whether to use permessage-deflate compression.
	 * @returns This socket instance.
	 *
	 * @example
	 * socket.sendRaw(JSON.stringify({ custom: "data" }));
	 */
	sendRaw(message: ServerOutgoingData, isBinary?: boolean, compress?: boolean): this;
	/**
	 * Send any lifecycle or user message to this socket.
	 * Automatically encodes according to the configured serialization.
	 * You typically use `emit()` or `broadcast()` instead.
	 *
	 * @param payload - The message to send (user message or lifecycle message).
	 * @returns This socket instance.
	 *
	 * @example
	 * socket.send({ event: "echo", data: { message: "hello" } });
	 */
	send<R extends string, E extends string | number, D>(payload: LifecycleMessage<R, D> | UserMessage<R, E, D>): this;
	/**
	 * Broadcast a global event to all **other** connected sockets.
	 * The publishing socket does **not** receive the message.
	 *
	 * @typeParam E - Event name.
	 * @typeParam D - Event data type.
	 * @param event - The event name.
	 * @param data - The event payload.
	 * @returns This socket instance.
	 *
	 * @example
	 * socket.broadcast("userJoined", { userId: socket.id });
	 */
	broadcast<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): this;
	/**
	 * Close the WebSocket connection gracefully.
	 *
	 * @param code - WebSocket close code. @default 1000
	 * @param reason - Close reason string. @default "normal"
	 *
	 * @example
	 * socket.close(1008, "Policy violation");
	 */
	close(code?: number, reason?: string): void;
	/**
	 * Handle an incoming auth message. Sets up timeout, calls user-provided auth function,
	 * and manages the success/failure lifecycle.
	 *
	 * @internal
	 */
	_handleAuth<D>(
		parsed: { type: LifecycleTypes.auth; data: D } | null,
		auth: AuthFunction<TEvents, SD, D> | undefined,
		authTimeout: number,
		next: MiddlewareNext,
	): void;
}

/**
 * Lifecycle event API available on the ByteSocket server instance.
 * Allows listening to connection, authentication, message, close, and error events.
 *
 * @typeParam TEvents - The socket events definition.
 * @typeParam SD - The socket data type.
 */
export interface ILifecycleServer<TEvents extends SocketEvents, SD extends SocketData, UpgradeCallback extends AnyCallback> {
	/** Register a listener for the HTTP upgrade phase. */
	onUpgrade: (callback: UpgradeCallback) => this;
	/** Remove a listener for the HTTP upgrade phase. */
	offUpgrade: (callback?: UpgradeCallback) => this;
	/** Register a one-time listener for the HTTP upgrade phase. */
	onceUpgrade: (callback: UpgradeCallback) => this;

	/** Register a listener for socket open (after successful auth). */
	onOpen: (callback: (socket: ISocket<TEvents, SD>) => void) => this;
	/** Remove a listener for socket open. */
	offOpen: (callback?: (socket: ISocket<TEvents, SD>) => void) => this;
	/** Register a one-time listener for socket open. */
	onceOpen: (callback: (socket: ISocket<TEvents, SD>) => void) => this;

	/** Register a listener for authentication success. */
	onAuthSuccess: (callback: (socket: ISocket<TEvents, SD>) => void) => this;
	/** Remove a listener for authentication success. */
	offAuthSuccess: (callback?: (socket: ISocket<TEvents, SD>) => void) => this;
	/** Register a one-time listener for authentication success. */
	onceAuthSuccess: (callback: (socket: ISocket<TEvents, SD>) => void) => this;

	/** Register a listener for authentication failure. */
	onAuthError: (callback: (socket: ISocket<TEvents, SD>, ctx: ErrorContext) => void) => this;
	/** Remove a listener for authentication failure. */
	offAuthError: (callback?: (socket: ISocket<TEvents, SD>, ctx: ErrorContext) => void) => this;
	/** Register a one-time listener for authentication failure. */
	onceAuthError: (callback: (socket: ISocket<TEvents, SD>, ctx: ErrorContext) => void) => this;

	/** Register a listener for raw incoming messages. */
	onMessage: (callback: (socket: ISocket<TEvents, SD>, data: ServerIncomingData, isBinary: boolean) => void) => this;
	/** Remove a listener for raw incoming messages. */
	offMessage: (callback?: (socket: ISocket<TEvents, SD>, data: ServerIncomingData, isBinary: boolean) => void) => this;
	/** Register a one-time listener for raw incoming messages. */
	onceMessage: (callback: (socket: ISocket<TEvents, SD>, data: ServerIncomingData, isBinary: boolean) => void) => this;

	/** Register a listener for socket close. */
	onClose: (callback: (socket: ISocket<TEvents, SD>, code: number, reason: ServerIncomingData) => void) => this;
	/** Remove a listener for socket close. */
	offClose: (callback?: (socket: ISocket<TEvents, SD>, code: number, reason: ServerIncomingData) => void) => this;
	/** Register a one-time listener for socket close. */
	onceClose: (callback: (socket: ISocket<TEvents, SD>, code: number, reason: ServerIncomingData) => void) => this;

	/** Register a listener for errors. */
	onError: (callback: (socket: ISocket<TEvents, SD> | null, ctx: ErrorContext) => void) => this;
	/** Remove a listener for errors. */
	offError: (callback?: (socket: ISocket<TEvents, SD> | null, ctx: ErrorContext) => void) => this;
	/** Register a one-time listener for errors. */
	onceError: (callback: (socket: ISocket<TEvents, SD> | null, ctx: ErrorContext) => void) => this;
}

/** Lifecycle hooks for room join/leave (single rooms). */
export interface IRoomsLifecycleServer<TEvents extends SocketEvents, SD extends SocketData> {
	/**
	 * Register a guard for single room join requests.
	 * Call `next()` to allow, `next(error)` to reject.
	 *
	 * @example
	 * io.rooms.lifecycle.onJoin((socket, room, next) => {
	 *   if (room === 'admin' && !socket.payload?.isAdmin) {
	 *     next(new Error('Not authorized'));
	 *   } else {
	 *     next();
	 *   }
	 * });
	 */
	onJoin: (callback: (socket: ISocket<TEvents, SD>, room: string, next: MiddlewareNext) => void) => this;
	/** Remove a guard for single room join requests. */
	offJoin: (callback?: (socket: ISocket<TEvents, SD>, room: string, next: MiddlewareNext) => void) => this;
	/** Register a one-time guard for single room join requests. */
	onceJoin: (callback: (socket: ISocket<TEvents, SD>, room: string, next: MiddlewareNext) => void) => this;

	/** Register a guard for single room leave requests. */
	onLeave: (callback: (socket: ISocket<TEvents, SD>, room: string, next: MiddlewareNext) => void) => this;
	/** Remove a guard for single room leave requests. */
	offLeave: (callback?: (socket: ISocket<TEvents, SD>, room: string, next: MiddlewareNext) => void) => this;
	/** Register a one-time guard for single room leave requests. */
	onceLeave: (callback: (socket: ISocket<TEvents, SD>, room: string, next: MiddlewareNext) => void) => this;
}

/** Lifecycle hooks for bulk room operations. */
export interface IRoomsBulkLifecycleServer<TEvents extends SocketEvents, SD extends SocketData> {
	/** Register a guard for bulk room join requests. */
	onJoin: (callback: (socket: ISocket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) => this;
	/** Remove a guard for bulk room join requests. */
	offJoin: (callback?: (socket: ISocket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) => this;
	/** Register a one-time guard for bulk room join requests. */
	onceJoin: (callback: (socket: ISocket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) => this;

	/** Register a guard for bulk room leave requests. */
	onLeave: (callback: (socket: ISocket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) => this;
	/** Remove a guard for bulk room leave requests. */
	offLeave: (callback?: (socket: ISocket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) => this;
	/** Register a one-time guard for bulk room leave requests. */
	onceLeave: (callback: (socket: ISocket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) => this;
}

export interface IRoomsBulkServer<TEvents extends SocketEvents, SD extends SocketData> {
	/**
	 * Emit a typed event to multiple rooms at once.
	 *
	 * @typeParam Rs - The array of room names.
	 * @typeParam E - Event name.
	 * @typeParam D - Event data type.
	 *
	 * @example
	 * interface MyEvents extends SocketEvents {
	 *   emitRooms:
	 *     | { rooms: ['room1', 'room2']; event: { 'alert': { msg: string } } }
	 *     | { rooms: ['roomA', 'roomB']; event: { 'message': { text: string } } };
	 *
	 * io.rooms.bulk.emit(['room1', 'room2'], 'alert', { msg: 'Hello both!' });
	 */
	emit: <
		Rs extends NonNullable<TEvents["emitRooms"]>["rooms"],
		E extends StringNumberKeys<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>,
		D extends NonNullable<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>[E],
	>(
		rooms: Rs,
		event: E,
		data: D,
	) => this;
	/** Lifecycle hooks for bulk room operations. */
	lifecycle: IRoomsBulkLifecycleServer<TEvents, SD>;
}

/**
 * Room management API available on the ByteSocket server instance.
 * Provides methods to emit to rooms, publish raw data, and attach room-level middleware.
 *
 * @typeParam TEvents - The socket events definition.
 * @typeParam SD - The socket data type.
 */
export interface IRoomsServer<TEvents extends SocketEvents, SD extends SocketData> {
	/**
	 * Publishes a raw message to all sockets subscribed to the given room.
	 *
	 * This method broadcasts the data directly to all connected sockets in the room
	 * using the underlying `ws` server, **without** applying any encoding,
	 * serialization, or lifecycle processing. It is useful for broadcasting
	 * custom-formatted messages, pre-encoded payloads, or implementing custom protocols.
	 *
	 * If the server instance has been destroyed, this method does nothing.
	 *
	 * @param room - The room name to publish the message to. All sockets that have joined this
	 *               room (including the global broadcast room) will receive the message.
	 * @param message - The raw data to send. Accepts a `string` (sent as a UTF-8 text frame) or
	 *                  an `ArrayBuffer` / `Buffer` (sent as a binary frame).
	 * @param isBinary - Optional. If `true`, forces the message to be sent as a binary WebSocket
	 *                   frame. If `false` or omitted, the frame type is inferred from the type of
	 *                   `message` (`string` → text, `ArrayBuffer`/`Buffer` → binary).
	 * @param compress - Optional. If `true`, the message will be compressed using the WebSocket
	 *                   permessage-deflate extension (if negotiated with the clients).
	 *
	 * @example
	 * // Broadcast a JSON string to the "lobby" room
	 * io.rooms.publishRaw("lobby", JSON.stringify({ type: "announcement", text: "Server restart in 5m" }));
	 *
	 * @example
	 * // Broadcast pre-encoded MessagePack data to the "lobby" room
	 * const packed = msgpack.encode({ event: "system", status: "ok" });
	 * io.rooms.publishRaw("lobby", packed, true);
	 *
	 * @example
	 * // Send compressed binary data
	 * const buffer = new Uint8Array([1, 2, 3]);
	 * io.rooms.publishRaw("updates", buffer, true, true);
	 */
	publishRaw: (room: string, message: ServerOutgoingData, isBinary?: boolean, compress?: boolean) => this;
	/**
	 * Emit a typed event to a specific room (server-side publish).
	 *
	 * @typeParam R - Room name (must be a key in `TEvents['emitRoom']`).
	 * @typeParam E - Event name.
	 * @typeParam D - Event data type.
	 *
	 * @example
	 * io.rooms.emit('chat', 'message', { text: 'Hello everyone' });
	 */
	emit: <
		R extends StringKeys<TEvents["emitRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["emitRoom"]>[R]>,
		D extends NonNullable<TEvents["emitRoom"]>[R][E],
	>(
		room: R,
		event: E,
		data: D,
	) => this;
	/** Register a room event middleware. */
	on: <
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(
		room: R,
		event: E,
		callback: RoomEventMiddleware<TEvents, SD, D>,
	) => this;
	/** Remove a room event middleware. */
	off: <
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(
		room: R,
		event?: E,
		callback?: RoomEventMiddleware<TEvents, SD, D>,
	) => this;
	/** Register a one-time room event middleware. */
	once: <
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(
		room: R,
		event: E,
		callback: RoomEventMiddleware<TEvents, SD, D>,
	) => this;
	/** Lifecycle hooks for room join/leave (single rooms). */
	lifecycle: IRoomsLifecycleServer<TEvents, SD>;
	/** Bulk operations for multiple rooms. */
	bulk: IRoomsBulkServer<TEvents, SD>;
}

/**
 * Public API of a ByteSocket server instance.
 *
 * Manages WebSocket connections, rooms, middleware, and event routing.
 * The implementation class {@link ByteSocket} should `implement` this interface.
 *
 * @typeParam TEvents - Event map (extends `SocketEvents`) defining the shape of
 *                      all emit/listen events (global and room‑scoped).
 * @typeParam SD      - Socket data type that extends `SocketData`.
 */
export interface IByteSocket<
	TEvents extends SocketEvents = SocketEvents,
	SD extends SocketData = SocketData,
	UpgradeCallback extends AnyCallback = AnyCallback,
> extends IByteSocketBase {
	/**
	 * Lifecycle event listeners for connection, authentication, and errors.
	 *
	 * @example
	 * io.lifecycle.onOpen((socket) => console.log('Connected!'));
	 * io.lifecycle.onAuthError((socket, ctx) => console.error('Auth failed', ctx.error));
	 * io.lifecycle.onClose((socket, code, msg) => console.log('Closed', code));
	 */
	readonly lifecycle: ILifecycleServer<TEvents, SD, UpgradeCallback>;
	/**
	 * Room management, room-scoped event emission, and room lifecycle hooks.
	 *
	 * @example
	 * io.rooms.emit('lobby', 'announcement', { text: 'Welcome!' });
	 * io.rooms.on('chat', 'message', (socket, data, next) => { ... });
	 * io.rooms.lifecycle.onJoin((socket, room, next) => {
	 *   if (room === 'admin') next(new Error('Not allowed'));
	 *   else next();
	 * });
	 */
	readonly rooms: IRoomsServer<TEvents, SD>;
	/**
	 * Map of all currently connected sockets, keyed by socket ID.
	 *
	 * **Do not modify this map directly** - it is managed internally.
	 *
	 * @example
	 * for (const [id, socket] of io.sockets) {
	 *   socket.emit('ping', undefined);
	 * }
	 */
	readonly sockets: Map<string, ISocket<TEvents, SD>>;
	/**
	 * Indicates whether the server instance has been permanently destroyed.
	 *
	 * Once `true`, the instance cannot be reused; all connections have been closed and
	 * internal resources released. Use {@link destroy} to initiate shutdown.
	 *
	 * @example
	 * if (io.destroyed) {
	 *   console.log('Server is shut down');
	 * }
	 */
	readonly destroyed: boolean;
	/**
	 * Emit a global event to all connected sockets.
	 *
	 * @typeParam E - Event name (must be a key in `TEvents['emit']`).
	 * @typeParam D - Event data type.
	 *
	 * @example io.emit('userJoined', { userId: '123' });
	 */
	emit<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): this;
	/**
	 * Register a permanent listener for global events.
	 *
	 * @typeParam E - Event name (must be a key in `TEvents['listen']`).
	 *
	 * @example io.on('userJoined', (socket, data) => { console.log(data.userId); });
	 */
	on<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(
		event: E,
		callback: EventCallback<TEvents, SD, D>,
	): this;
	/**
	 * Remove a listener for global events.
	 * If no callback is provided, **all** listeners for that event are removed.
	 *
	 * @example io.off('userJoined', myCallback);
	 */
	off<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(
		event: E,
		callback?: EventCallback<TEvents, SD, D>,
	): this;
	/**
	 * Register a one-time listener for a global event.
	 * The callback is removed after the first invocation.
	 *
	 * @example io.once('userJoined', (socket, data) => { console.log('First join'); });
	 */
	once<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(
		event: E,
		callback: EventCallback<TEvents, SD, D>,
	): this;
	/**
	 * Register a global middleware function.
	 * Middleware runs **before** any user message is processed.
	 *
	 * @example
	 * io.use((socket, ctx, next) => {
	 *   console.log('Message received:', ctx);
	 *   next();
	 * });
	 */
	use(fn: Middleware<TEvents, SD>): this;
	attach(server: unknown, path: string): this;
	destroy(): void;
}
