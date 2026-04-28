import type {
	ErrorContext,
	EventsForRooms,
	LifecycleMessage,
	LifecycleTypes,
	MsgpackrOptions,
	SocketEvents,
	StringKeys,
	StringNumberKeys,
	UserMessage,
} from "@bytesocket/types";
import type { UUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type Stream from "node:stream";
import type { ServerOptions, WebSocket, WebSocketServer } from "ws";
import type { Socket } from "./socket";

/**
 * Callback used by the authentication function to return the authentication result.
 * @param payload - The authenticated user data to attach to the socket.
 * @param error - Optional error if authentication failed.
 */
export type AuthCallback = (payload: any, error?: Error) => void;

/**
 * Authentication function signature. Called when a client sends an auth message.
 *
 * @typeParam SD - The socket data type (must extend `SocketData`).
 * @typeParam D - The type of the authentication data sent by the client.
 *
 * @example
 * const auth: AuthFunction = (socket, data, callback) => {
 *   if (data.token === "secret") {
 *     callback({ userId: 1 });
 *   } else {
 *     callback(null, new Error("Invalid token"));
 *   }
 * };
 */
export type AuthFunction<TEvents extends SocketEvents, SD extends SocketData, D = any> = (
	socket: Socket<TEvents, SD>,
	data: D,
	callback: AuthCallback,
) => void;

/**
 * Callback for global event listeners.
 *
 * @typeParam SD - The socket data type.
 * @typeParam D - The type of the event data.
 *
 * @example
 * socket.on("userJoined", (socket, data) => {
 *   console.log(`User ${data.userId} joined`);
 * });
 */
export type EventCallback<TEvents extends SocketEvents, SD extends SocketData, D> = (socket: Socket<TEvents, SD>, data: D) => void;

/**
 * Middleware function for room-scoped events. Can inspect or block the broadcast.
 *
 * @typeParam SD - The socket data type.
 * @typeParam D - The type of the event data.
 *
 * @example
 * io.rooms.on("chat", "message", (socket, data, next) => {
 *   if (data.text.includes("badword")) {
 *     next(new Error("Profanity not allowed"));
 *   } else {
 *     next();
 *   }
 * });
 *
 * // Also supports async functions / Promises
 * io.rooms.on("chat", "message", async (socket, data, next) => {
 *   const isValid = await validateMessage(data);
 *   if (!isValid) {
 * 		return next(new Error("Invalid"));
 *	 }
 *   next();
 * });
 */
export type RoomEventMiddleware<TEvents extends SocketEvents, SD extends SocketData, D> = (
	socket: Socket<TEvents, SD>,
	data: D,
	next: MiddlewareNext,
) => void | Promise<void>;

/** Next function for middleware chains. Call `next()` to proceed, or `next(error)` to abort. */
export type MiddlewareNext = (error?: unknown | null) => void;

/**
 * Global middleware function. Runs before any user message is processed.
 *
 * @typeParam SD - The socket data type.
 *
 * @example
 * io.use((socket, ctx, next) => {
 *   console.log("Received:", ctx);
 *   next();
 * });
 */
export type Middleware<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData> = (
	socket: Socket<TEvents, SD>,
	ctx: UserMessage,
	next: MiddlewareNext,
) => void | Promise<void>;

export interface HeartbeatConfig {
	/** Idle timeout in seconds. 0 = disabled. Default 120. */
	idleTimeout?: number;
	/** Whether to send automatic pings. Default true. */
	sendPingsAutomatically?: boolean;
}

/**
 * Data automatically attached to every socket by the server.
 * Contains HTTP request information available during the WebSocket upgrade.
 */
export interface SocketData {
	/** Unique identifier for the socket (UUID v4). */
	socketKey: UUID;
	/** The url string from the upgrade request. */
	url: string;
	/** The query string from the upgrade request. */
	query: string;
	/** The `Host` header value. */
	host: string;
	/** The `Cookie` header value. */
	cookie: string;
	/** The `User-Agent` header value. */
	userAgent: string;
	/** The `Authorization` header value. */
	authorization: string;
	/** The `X-Forwarded-For` header value. */
	xForwardedFor: string;
}

// Type for the `lifecycle` sub-object
export type ServerLifecycleAPI<TServer, TEvents extends SocketEvents, SD extends SocketData> = {
	/**
	 * Register a listener for the HTTP upgrade phase.
	 *
	 * @param callback - Called with the incoming request, the duplex stream,
	 *                   the upgrade head buffer, the prepared user data, and
	 *                   the underlying WebSocketServer instance.
	 */
	onUpgrade: (
		callback: (req: IncomingMessage, socket: Stream.Duplex, head: Buffer<ArrayBuffer>, userData: SD, context: WebSocketServer) => void,
	) => TServer;
	/** Remove a listener for the HTTP upgrade phase. */
	offUpgrade: (
		callback?: (req: IncomingMessage, socket: Stream.Duplex, head: Buffer<ArrayBuffer>, userData: SD, context: WebSocketServer) => void,
	) => TServer;
	/** Register a one-time listener for the HTTP upgrade phase. */
	onceUpgrade: (
		callback: (req: IncomingMessage, socket: Stream.Duplex, head: Buffer<ArrayBuffer>, userData: SD, context: WebSocketServer) => void,
	) => TServer;

	/** Register a listener for socket open (after successful auth). */
	onOpen: (callback: (socket: Socket<TEvents, SD>) => void) => TServer;
	/** Remove a listener for socket open. */
	offOpen: (callback?: (socket: Socket<TEvents, SD>) => void) => TServer;
	/** Register a one-time listener for socket open. */
	onceOpen: (callback: (socket: Socket<TEvents, SD>) => void) => TServer;

	/** Register a listener for authentication success. */
	onAuthSuccess: (callback: (socket: Socket<TEvents, SD>) => void) => TServer;
	/** Remove a listener for authentication success. */
	offAuthSuccess: (callback?: (socket: Socket<TEvents, SD>) => void) => TServer;
	/** Register a one-time listener for authentication success. */
	onceAuthSuccess: (callback: (socket: Socket<TEvents, SD>) => void) => TServer;

	/** Register a listener for authentication failure. */
	onAuthError: (callback: (socket: Socket<TEvents, SD>, ctx: ErrorContext) => void) => TServer;
	/** Remove a listener for authentication failure. */
	offAuthError: (callback?: (socket: Socket<TEvents, SD>, ctx: ErrorContext) => void) => TServer;
	/** Register a one-time listener for authentication failure. */
	onceAuthError: (callback: (socket: Socket<TEvents, SD>, ctx: ErrorContext) => void) => TServer;

	/** Register a listener for raw incoming messages. */
	onMessage: (callback: (socket: Socket<TEvents, SD>, data: WebSocket.RawData, isBinary: boolean) => void) => TServer;
	/** Remove a listener for raw incoming messages. */
	offMessage: (callback?: (socket: Socket<TEvents, SD>, data: WebSocket.RawData, isBinary: boolean) => void) => TServer;
	/** Register a one-time listener for raw incoming messages. */
	onceMessage: (callback: (socket: Socket<TEvents, SD>, data: WebSocket.RawData, isBinary: boolean) => void) => TServer;

	/** Register a listener for socket close. */
	onClose: (callback: (socket: Socket<TEvents, SD>, code: number, reason: Buffer<ArrayBufferLike>) => void) => TServer;
	/** Remove a listener for socket close. */
	offClose: (callback?: (socket: Socket<TEvents, SD>, code: number, reason: Buffer<ArrayBufferLike>) => void) => TServer;
	/** Register a one-time listener for socket close. */
	onceClose: (callback: (socket: Socket<TEvents, SD>, code: number, reason: Buffer<ArrayBufferLike>) => void) => TServer;

	/** Register a listener for errors. */
	onError: (callback: (socket: Socket<TEvents, SD> | null, ctx: ErrorContext) => void) => TServer;
	/** Remove a listener for errors. */
	offError: (callback?: (socket: Socket<TEvents, SD> | null, ctx: ErrorContext) => void) => TServer;
	/** Register a one-time listener for errors. */
	onceError: (callback: (socket: Socket<TEvents, SD> | null, ctx: ErrorContext) => void) => TServer;
};

// Type for the `rooms` sub-object
export type ServerRoomsAPI<TServer, TEvents extends SocketEvents, SD extends SocketData> = {
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
	publishRaw: (room: string, message: WebSocket.Data, isBinary?: boolean, compress?: boolean) => TServer;
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
	) => TServer;
	/** Register a room event middleware. */
	on: <
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(
		room: R,
		event: E,
		callback: RoomEventMiddleware<TEvents, SD, D>,
	) => TServer;
	/** Remove a room event middleware. */
	off: <
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(
		room: R,
		event?: E,
		callback?: RoomEventMiddleware<TEvents, SD, D>,
	) => TServer;
	/** Register a one-time room event middleware. */
	once: <
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(
		room: R,
		event: E,
		callback: RoomEventMiddleware<TEvents, SD, D>,
	) => TServer;
	/** Lifecycle hooks for room join/leave (single rooms). */
	lifecycle: {
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
		onJoin: (callback: (socket: Socket<TEvents, SD>, room: string, next: MiddlewareNext) => void) => TServer;
		/** Remove a guard for single room join requests. */
		offJoin: (callback?: (socket: Socket<TEvents, SD>, room: string, next: MiddlewareNext) => void) => TServer;
		/** Register a one-time guard for single room join requests. */
		onceJoin: (callback: (socket: Socket<TEvents, SD>, room: string, next: MiddlewareNext) => void) => TServer;

		/** Register a guard for single room leave requests. */
		onLeave: (callback: (socket: Socket<TEvents, SD>, room: string, next: MiddlewareNext) => void) => TServer;
		/** Remove a guard for single room leave requests. */
		offLeave: (callback?: (socket: Socket<TEvents, SD>, room: string, next: MiddlewareNext) => void) => TServer;
		/** Register a one-time guard for single room leave requests. */
		onceLeave: (callback: (socket: Socket<TEvents, SD>, room: string, next: MiddlewareNext) => void) => TServer;
	};
	/** Bulk operations for multiple rooms. */
	bulk: {
		/**
		 * Emit a typed event to multiple rooms at once.
		 *
		 * @typeParam Rs - The array of room names.
		 * @typeParam E - Event name.
		 * @typeParam D - Event data type.
		 *
		 * @example
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
		) => TServer;
		/** Lifecycle hooks for bulk room operations. */
		lifecycle: {
			/** Register a guard for bulk room join requests. */
			onJoin: (callback: (socket: Socket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) => TServer;
			/** Remove a guard for bulk room join requests. */
			offJoin: (callback?: (socket: Socket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) => TServer;
			/** Register a one-time guard for bulk room join requests. */
			onceJoin: (callback: (socket: Socket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) => TServer;

			/** Register a guard for bulk room leave requests. */
			onLeave: (callback: (socket: Socket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) => TServer;
			/** Remove a guard for bulk room leave requests. */
			offLeave: (callback?: (socket: Socket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) => TServer;
			/** Register a one-time guard for bulk room leave requests. */
			onceLeave: (callback: (socket: Socket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) => TServer;
		};
	};
};

export type SocketRoomsAPI<TInstance, TEvents extends SocketEvents> = {
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
	publishRaw: (room: string, message: WebSocket.Data, isBinary?: boolean, compress?: boolean) => TInstance;
	/**
	 * Emit a typed event to a specific room.
	 * @typeParam R - Room name (must be a key in `TEvents['emitRoom']`).
	 * @typeParam E - Event name.
	 * @typeParam D - Event data type.
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
	) => TInstance;
	/**
	 * Join a single room.
	 * @example socket.rooms.join("lobby");
	 */
	join: (room: string) => TInstance;
	/**
	 * Leave a single room.
	 * @example socket.rooms.leave("lobby");
	 */
	leave: (room: string) => TInstance;
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
	bulk: {
		/**
		 * Emit a typed event to multiple rooms at once.
		 * @example socket.rooms.bulk.emit(["room1", "room2"], "alert", { msg: "Hello" });
		 */
		emit: <
			Rs extends NonNullable<TEvents["emitRooms"]>["rooms"],
			E extends StringNumberKeys<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>,
			D extends NonNullable<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>[E],
		>(
			rooms: Rs,
			event: E,
			data: D,
		) => TInstance;
		/**
		 * Join multiple rooms.
		 * @example socket.rooms.bulk.join(["lobby", "notifications"]);
		 */
		join: (rooms: string[]) => TInstance;
		/**
		 * Leave multiple rooms.
		 * @example socket.rooms.bulk.leave(["lobby", "notifications"]);
		 */
		leave: (rooms: string[]) => TInstance;
	};
};

/**
 * Configuration options for the ByteSocket server.
 *
 * @typeParam SD - The socket data type (must extend `SocketData`).
 *
 * @example
 * const io = new ByteSocket({
 *   debug: true,
 *   authTimeout: 10000,
 *   origins: ["https://example.com"],
 *   serialization: "binary",
 *   auth: (socket, data, callback) => {
 *     // validate token
 *     callback({ userId: 1 });
 *   }
 * });
 */
export interface ByteSocketOptions<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData> extends Omit<
	ServerOptions,
	"noServer" | "port" | "server" | "host" | "backlog" | "path"
> {
	/** Enable debug logging to console. @default false */
	debug?: boolean;
	/** Timeout in milliseconds for global middleware execution. @default 5000 */
	middlewareTimeout?: number;
	/** Timeout in milliseconds for room event middleware execution. @default 5000 */
	roomMiddlewareTimeout?: number;
	/** Timeout for authentication response in milliseconds. @default 5000 */
	authTimeout?: number;
	/** List of allowed origins for CORS. If empty, all origins are allowed. */
	origins?: string[];
	/** Serialization format: `"json"` or `"binary"` (msgpack). @default "binary" */
	serialization?: "json" | "binary";
	/** Room name used for global broadcasts. @default "__bytesocket_broadcast__" */
	broadcastRoom?: string;
	/** Options passed directly to the underlying msgpackr Packr instance. */
	msgpackrOptions?: MsgpackrOptions;
	/** Action to take when a global middleware error occurs. @default "ignore" */
	onMiddlewareError?: "ignore" | "close" | ((error: unknown, socket: Socket<TEvents, SD>) => void);
	/** Action to take when a global middleware times out. @default "ignore" */
	onMiddlewareTimeout?: "ignore" | "close" | ((error: unknown, socket: Socket<TEvents, SD>) => void);
	/** Authentication configuration. */
	auth?: AuthFunction<TEvents, SD>;
	/**
	 * Maximum seconds of inactivity (no messages received or pongs) before the connection is closed.
	 * Only effective when `sendPingsAutomatically` is `true`.
	 * Set to `0` to disable.
	 * @default 120
	 */
	idleTimeout?: number;
	/**
	 * Whether the server should automatically send WebSocket ping frames to keep
	 * the connection alive and detect dead clients.
	 * @default true
	 */
	sendPingsAutomatically?: boolean;
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
export interface IByteSocket<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData> {
	/**
	 * Lifecycle event listeners for connection, authentication, and errors.
	 *
	 * @example
	 * io.lifecycle.onOpen((socket) => console.log('Connected!'));
	 * io.lifecycle.onAuthError((socket, ctx) => console.error('Auth failed', ctx.error));
	 * io.lifecycle.onClose((socket, code, msg) => console.log('Closed', code));
	 */
	readonly lifecycle: ServerLifecycleAPI<this, TEvents, SD>;
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
	readonly rooms: ServerRoomsAPI<this, TEvents, SD>;
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
	readonly sockets: Map<string, Socket<TEvents, SD>>;
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
	 * Permanently destroys the ByteSocket instance.
	 *
	 * - Closes all active WebSocket connections.
	 * - Closes the underlying WebSocketServer.
	 * - **Removes the `upgrade` listener** from the attached HTTP server, freeing
	 *   the server to be used with a new ByteSocket instance later.
	 * - Clears all event listeners, middleware, and internal state.
	 *
	 * After calling `destroy()`, the instance **cannot be reused**.
	 *
	 * @example
	 * ```ts
	 * const io = new ByteSocket();
	 * io.attach(server, "/ws");
	 * // ... later, during graceful shutdown:
	 * io.destroy();
	 *
	 * // The HTTP server is now free and can be reused:
	 * const io2 = new ByteSocket();
	 * io2.attach(server, "/ws");  // works without conflict
	 * ```
	 */
	destroy(): void;
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
	/**
	 * Attaches the ByteSocket instance to a Node.js HTTP server on the given path.
	 *
	 * You can call `attach` multiple times on the same server with different paths --
	 * they will all share a single WebSocket server and a single `upgrade` listener.
	 *
	 * **Note:** On the first call, the method registers an `upgrade` listener on the
	 * HTTP server. That listener is automatically removed when you call
	 * {@link destroy}, so you can later attach a new ByteSocket instance to the same
	 * server.
	 *
	 * @param server - The Node.js HTTP(S) server (e.g. from `http.createServer()`).
	 * @param path   - The URL path to handle WebSocket upgrades on (e.g. `"/ws"`).
	 * @returns This instance (for chaining).
	 *
	 * @example
	 * ```ts
	 * const server = http.createServer(app);
	 * const io = new ByteSocket();
	 *
	 * // Single path
	 * io.attach(server, "/ws");
	 *
	 * // Multiple paths on the same server
	 * io.attach(server, "/chat");
	 * io.attach(server, "/notifications");
	 * ```
	 */
	attach(server: Server, path: string): this;
	/**
	 * Encode a structured payload into a format suitable for sending over the WebSocket.
	 *
	 * **Advanced usage only.** Prefer `emit()` or `send()` for type‑safe communication.
	 *
	 * @param payload - A lifecycle message or user event object.
	 * @param serialization - Serialization format: `"json"` or `"binary"` (defaults to the server's configured format).
	 * @returns Encoded `string` (JSON) or `Buffer` (MessagePack).
	 *
	 * @example
	 * const encoded = io.encode({ event: 'chat', data: { text: 'Hello' } });
	 */
	encode<R extends string, E extends string | number, D>(
		payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
		serialization?: "json" | "binary",
	): string | Buffer<ArrayBufferLike>;

	/**
	 * Decode a raw WebSocket message into a structured payload.
	 * Automatically detects JSON or MessagePack based on the binary flag and message content.
	 *
	 * **Advanced usage only.** Normally you should use `on()` listeners to receive typed data.
	 *
	 * @param message - Raw `string` (JSON) or `ArrayBuffer` (MessagePack).
	 * @param isBinary - Whether the message is binary. If omitted, format is detected from the message type.
	 * @returns Decoded lifecycle or user message object.
	 */
	decode<M extends WebSocket.RawData = WebSocket.RawData, D = unknown>(message: M, isBinary?: boolean): D;
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
	readonly rooms: SocketRoomsAPI<this, TEvents>;
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
	 * console.log(socket.url);
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
	sendRaw(message: WebSocket.Data, isBinary?: boolean, compress?: boolean): this;
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
	 * Mark the socket as closed and clear any active timers.
	 *
	 * @internal
	 */
	_markClosed(): void;
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
