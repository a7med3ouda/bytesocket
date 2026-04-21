import {
	LifecycleTypes,
	type AnyCallback,
	type ErrorContext,
	type EventsForRooms,
	type LifecycleMessage,
	type SocketEvents,
	type StringKeys,
	type StringNumberKeys,
	type UserMessage,
} from "@bytesocket/types";
import { FLOAT32_OPTIONS, Packr } from "msgpackr";
import { randomUUID } from "node:crypto";
import type { HttpRequest, HttpResponse, RecognizedString, TemplatedApp, us_socket_context_t, WebSocket, WebSocketBehavior } from "uWebSockets.js";
import { Socket } from "./socket";
import type { ByteSocketOptions, EventCallback, Middleware, MiddlewareNext, RoomEventMiddleware, SocketData } from "./types";

type RequiredOptions =
	| "middlewareTimeout"
	| "roomMiddlewareTimeout"
	| "authTimeout"
	| "serialization"
	| "broadcastRoom"
	| "debug"
	| "onMiddlewareError"
	| "onMiddlewareTimeout";

/**
 * ByteSocket server instance.
 *
 * Manages WebSocket connections, rooms, middleware, and event routing.
 * Provides a fully typed event system via a user‑supplied event map (`TEvents`).
 *
 * @typeParam TEvents - A type extending `SocketEvents` that defines the shape of
 *                      all emit/listen events (global and room‑scoped).
 * @typeParam SD      - The socket data type (must extend `SocketData`).
 *
 * @example Symmetric events (most common)
 * ```ts
 * // Define your event map
 * type MyEvents = SocketEvents<{
 *   "chat:message": { text: string };
 *   "user:joined": { userId: string };
 * }>;
 *
 * // Create a typed server instance
 * const io = new ByteSocket<MyEvents>(app, { debug: true });
 *
 * // Use typed methods (emit and listen share the same event map)
 * io.emit('chat:message', { text: 'Server announcement' });
 * io.on('user:joined', (socket, data) => {
 *   console.log(`User ${data.userId} joined`);
 * });
 *
 * io.rooms.emit('lobby', 'chat:message', { text: 'Welcome to the lobby' });
 * io.rooms.on('lobby', 'chat:message', (socket, data, next) => {
 *   console.log(`${socket.id} said: ${data.text}`);
 *   next();
 * });
 * ```
 *
 * @example Asymmetric events (full control via interface extension)
 * ```ts
 * // Extend SocketEvents to differentiate emit/listen/room maps
 * interface MyEvents extends SocketEvents {
 *   emit: {
 *     "server:announce": { message: string };
 *     "ping": void;
 *   };
 *   listen: {
 *     "client:message": { text: string; sender: string };
 *     "pong": number;
 *   };
 *   emitRoom: {
 *     chat: { "message": { text: string } };
 *     game: { "move": { player: string; position: number } };
 *   };
 *   listenRoom: {
 *     chat: { "message": { text: string; sender: string } };
 *   };
 * }
 *
 * const io = new ByteSocket<MyEvents>(app, { debug: true });
 *
 * // Global emits/listens
 * io.emit('ping', undefined);
 * io.on('client:message', (socket, data) => {
 *   console.log(`${data.sender}: ${data.text}`);
 * });
 *
 * // Room‑specific emits/listens
 * io.rooms.emit('chat', 'message', { text: 'Hello everyone' });
 * io.rooms.on('chat', 'message', (socket, data, next) => {
 *   console.log(`${data.sender}: ${data.text}`);
 *   next();
 * });
 * ```
 */
export class ByteSocket<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData> {
	/**
	 * Lifecycle event listeners for connection, authentication, and errors.
	 *
	 * @example
	 * io.lifecycle.onOpen((socket) => console.log('Connected!'));
	 * io.lifecycle.onAuthError((socket, ctx) => console.error('Auth failed', ctx.error));
	 * io.lifecycle.onClose((socket, code, msg) => console.log('Closed', code));
	 */
	readonly lifecycle;

	/**
	 * Room management, room‑scoped event emission, and room lifecycle hooks.
	 *
	 * @example
	 * io.rooms.emit('lobby', 'announcement', { text: 'Welcome!' });
	 * io.rooms.on('chat', 'message', (socket, data, next) => { ... });
	 * io.rooms.lifecycle.onJoin((socket, room, next) => {
	 *   if (room === 'admin') next(new Error('Not allowed'));
	 *   else next();
	 * });
	 */
	readonly rooms;

	#callbacksMap = new Map<string | number, Set<AnyCallback>>();
	#onceCallbacksMap = new Map<string | number, Map<AnyCallback, Set<AnyCallback>>>();
	#roomCallbacksMap = new Map<string, Map<string | number, Set<AnyCallback>>>();
	#onceRoomCallbacksMap = new Map<string, Map<string | number, Map<AnyCallback, Set<AnyCallback>>>>();
	#lifecycleCallbacksMap = new Map<string | number, Set<AnyCallback>>();
	#onceLifecycleCallbacksMap = new Map<string | number, Map<AnyCallback, Set<AnyCallback>>>();
	#middlewares: Middleware<TEvents, SD>[] = [];

	static readonly #DEFAULT_STRUCTURES: Array<Array<string>> = [
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

	readonly #app: TemplatedApp;
	readonly #packr: Packr;
	readonly #options: Omit<ByteSocketOptions<TEvents, SD>, RequiredOptions> & Pick<Required<ByteSocketOptions<TEvents, SD>>, RequiredOptions>;

	/**
	 * Map of all currently connected sockets, keyed by socket ID.
	 *
	 * @example
	 * for (const [id, socket] of io.sockets) {
	 *   socket.emit('ping', undefined);
	 * }
	 */
	readonly sockets = new Map<string, Socket<TEvents, SD>>();
	#destroyed = false;

	/**
	 * Creates a new ByteSocket server instance.
	 *
	 * @param app - The uWebSockets.js TemplatedApp instance.
	 * @param options - Configuration options.
	 *
	 * @example
	 * import uWS from 'uWebSockets.js';
	 * const app = uWS.App();
	 * const io = new ByteSocket(app, { debug: true });
	 * app.ws("/socket", io.handler);
	 * app.listen(3000, (token) => { if (token) console.log('Listening'); });
	 */
	constructor(app: TemplatedApp, options: ByteSocketOptions<TEvents, SD> = {}) {
		const { msgpackrOptions, ...restOptions } = options;

		this.#app = app;
		this.#options = {
			...restOptions,
			middlewareTimeout: options.middlewareTimeout ?? 5000,
			roomMiddlewareTimeout: options.roomMiddlewareTimeout ?? 5000,
			authTimeout: options.authTimeout ?? 5000,
			serialization: options.serialization ?? "binary",
			broadcastRoom: options.broadcastRoom ?? "__bytesocket_broadcast__",
			debug: options.debug ?? false,
			onMiddlewareError: options.onMiddlewareError ?? "ignore",
			onMiddlewareTimeout: options.onMiddlewareTimeout ?? "ignore",
		};

		this.#packr = new Packr({
			...msgpackrOptions,
			useRecords: false,
			structures: msgpackrOptions?.structures?.length
				? [...ByteSocket.#DEFAULT_STRUCTURES, ...msgpackrOptions.structures]
				: ByteSocket.#DEFAULT_STRUCTURES,
			useFloat32: msgpackrOptions?.useFloat32 ?? FLOAT32_OPTIONS.DECIMAL_FIT,
			copyBuffers: msgpackrOptions?.copyBuffers ?? false,
			int64AsType: msgpackrOptions?.int64AsType ?? "bigint",
			bundleStrings: msgpackrOptions?.bundleStrings ?? true,
		});

		this.lifecycle = {
			/** Register a listener for the HTTP upgrade phase. */
			onUpgrade: (callback: (res: HttpResponse, req: HttpRequest, userData: SD, context: us_socket_context_t) => void) =>
				this.#onLifecycle(LifecycleTypes.upgrade, callback),
			/** Remove a listener for the HTTP upgrade phase. */
			offUpgrade: (callback?: (res: HttpResponse, req: HttpRequest, userData: SD, context: us_socket_context_t) => void) =>
				this.#offLifecycle(LifecycleTypes.upgrade, callback),
			/** Register a one‑time listener for the HTTP upgrade phase. */
			onceUpgrade: (callback: (res: HttpResponse, req: HttpRequest, userData: SD, context: us_socket_context_t) => void) =>
				this.#onceLifecycle(LifecycleTypes.upgrade, callback),
			/** Register a listener for socket open (after successful auth). */
			onOpen: (callback: (socket: Socket<TEvents, SD>) => void) => this.#onLifecycle(LifecycleTypes.open, callback),
			/** Remove a listener for socket open. */
			offOpen: (callback?: (socket: Socket<TEvents, SD>) => void) => this.#offLifecycle(LifecycleTypes.open, callback),
			/** Register a one‑time listener for socket open. */
			onceOpen: (callback: (socket: Socket<TEvents, SD>) => void) => this.#onceLifecycle(LifecycleTypes.open, callback),
			/** Register a listener for authentication success. */
			onAuthSuccess: (callback: (socket: Socket<TEvents, SD>) => void) => this.#onLifecycle(LifecycleTypes.auth_success, callback),
			/** Remove a listener for authentication success. */
			offAuthSuccess: (callback?: (socket: Socket<TEvents, SD>) => void) => this.#offLifecycle(LifecycleTypes.auth_success, callback),
			/** Register a one‑time listener for authentication success. */
			onceAuthSuccess: (callback: (socket: Socket<TEvents, SD>) => void) => this.#onceLifecycle(LifecycleTypes.auth_success, callback),
			/** Register a listener for authentication failure. */
			onAuthError: (callback: (socket: Socket<TEvents, SD>, ctx: ErrorContext) => void) =>
				this.#onLifecycle(LifecycleTypes.auth_error, callback),
			/** Remove a listener for authentication failure. */
			offAuthError: (callback?: (socket: Socket<TEvents, SD>, ctx: ErrorContext) => void) =>
				this.#offLifecycle(LifecycleTypes.auth_error, callback),
			/** Register a one‑time listener for authentication failure. */
			onceAuthError: (callback: (socket: Socket<TEvents, SD>, ctx: ErrorContext) => void) =>
				this.#onceLifecycle(LifecycleTypes.auth_error, callback),
			/** Register a listener for raw incoming messages. */
			onMessage: (callback: (socket: Socket<TEvents, SD>, message: ArrayBuffer, isBinary: boolean) => void) =>
				this.#onLifecycle(LifecycleTypes.message, callback),
			/** Remove a listener for raw incoming messages. */
			offMessage: (callback?: (socket: Socket<TEvents, SD>, message: ArrayBuffer, isBinary: boolean) => void) =>
				this.#offLifecycle(LifecycleTypes.message, callback),
			/** Register a one‑time listener for raw incoming messages. */
			onceMessage: (callback: (socket: Socket<TEvents, SD>, message: ArrayBuffer, isBinary: boolean) => void) =>
				this.#onceLifecycle(LifecycleTypes.message, callback),
			/** Register a listener for socket close. */
			onClose: (callback: (socket: Socket<TEvents, SD>, code: number, message: ArrayBuffer) => void) =>
				this.#onLifecycle(LifecycleTypes.close, callback),
			/** Remove a listener for socket close. */
			offClose: (callback?: (socket: Socket<TEvents, SD>, code: number, message: ArrayBuffer) => void) =>
				this.#offLifecycle(LifecycleTypes.close, callback),
			/** Register a one‑time listener for socket close. */
			onceClose: (callback: (socket: Socket<TEvents, SD>, code: number, message: ArrayBuffer) => void) =>
				this.#onceLifecycle(LifecycleTypes.close, callback),
			/** Register a listener for errors. */
			onError: (callback: (socket: Socket<TEvents, SD> | null, ctx: ErrorContext) => void) => this.#onLifecycle(LifecycleTypes.error, callback),
			/** Remove a listener for errors. */
			offError: (callback?: (socket: Socket<TEvents, SD> | null, ctx: ErrorContext) => void) =>
				this.#offLifecycle(LifecycleTypes.error, callback),
			/** Register a one‑time listener for errors. */
			onceError: (callback: (socket: Socket<TEvents, SD> | null, ctx: ErrorContext) => void) =>
				this.#onceLifecycle(LifecycleTypes.error, callback),
		};

		this.rooms = {
			/**
			 * Publishes a raw message to all sockets subscribed to the given room.
			 *
			 * This method sends data directly to uWebSockets.js's publish system **without** applying
			 * any encoding, serialization, or lifecycle processing. It is useful for broadcasting
			 * custom‑formatted messages, pre‑encoded payloads, or implementing custom protocols.
			 *
			 * If the server instance has been destroyed, this method does nothing.
			 *
			 * @param room - The room name to publish the message to. All sockets that have joined this
			 *               room (including the global broadcast room) will receive the message.
			 * @param message - The raw data to send. Accepts a `string` (sent as a UTF‑8 text frame) or
			 *                  an `ArrayBuffer` / `Buffer` (sent as a binary frame).
			 * @param isBinary - Optional. If `true`, forces the message to be sent as a binary WebSocket
			 *                   frame. If `false` or omitted, the frame type is inferred from the type of
			 *                   `message` (`string` → text, `ArrayBuffer`/`Buffer` → binary).
			 * @param compress - Optional. If `true`, the message will be compressed using the WebSocket
			 *                   permessage‑deflate extension (if negotiated with the clients).
			 *
			 * @example
			 * // Broadcast a JSON string to the "lobby" room
			 * io.rooms.publishRaw("lobby", JSON.stringify({ type: "announcement", text: "Server restart in 5m" }));
			 *
			 * @example
			 * // Broadcast pre‑encoded MessagePack data to the global room
			 * const packed = msgpack.encode({ event: "system", status: "ok" });
			 * io.rooms.publishRaw(io.options.broadcastRoom, packed, true);
			 *
			 * @example
			 * // Send compressed binary data
			 * const buffer = new Uint8Array([1, 2, 3]);
			 * io.rooms.publishRaw("updates", buffer, true, true);
			 */
			publishRaw: this.#publishRaw.bind(this),
			/**
			 * Emit a typed event to a specific room (server‑side publish).
			 *
			 * @typeParam R - Room name (must be a key in `TEvents['emitRoom']`).
			 * @typeParam E - Event name.
			 * @typeParam D - Event data type.
			 *
			 * @example
			 * io.rooms.emit('chat', 'message', { text: 'Hello everyone' });
			 */
			emit: this.#publish.bind(this),
			/** Register a room event middleware. */
			on: this.#onRoom.bind(this),
			/** Remove a room event middleware. */
			off: this.#offRoom.bind(this),
			/** Register a one‑time room event middleware. */
			once: this.#onceRoom.bind(this),
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
				onJoin: (callback: (socket: Socket<TEvents, SD>, room: string, next: MiddlewareNext) => void) =>
					this.#onLifecycle(LifecycleTypes.join_room, callback),
				/** Remove a guard for single room join requests. */
				offJoin: (callback?: (socket: Socket<TEvents, SD>, room: string, next: MiddlewareNext) => void) =>
					this.#offLifecycle(LifecycleTypes.join_room, callback),
				/** Register a one‑time guard for single room join requests. */
				onceJoin: (callback: (socket: Socket<TEvents, SD>, room: string, next: MiddlewareNext) => void) =>
					this.#onceLifecycle(LifecycleTypes.join_room, callback),
				/** Register a guard for single room leave requests. */
				onLeave: (callback: (socket: Socket<TEvents, SD>, room: string, next: MiddlewareNext) => void) =>
					this.#onLifecycle(LifecycleTypes.leave_room, callback),
				/** Remove a guard for single room leave requests. */
				offLeave: (callback?: (socket: Socket<TEvents, SD>, room: string, next: MiddlewareNext) => void) =>
					this.#offLifecycle(LifecycleTypes.leave_room, callback),
				/** Register a one‑time guard for single room leave requests. */
				onceLeave: (callback: (socket: Socket<TEvents, SD>, room: string, next: MiddlewareNext) => void) =>
					this.#onceLifecycle(LifecycleTypes.leave_room, callback),
			},
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
				emit: this.#publishMany.bind(this),
				/** Lifecycle hooks for bulk room operations. */
				lifecycle: {
					/** Register a guard for bulk room join requests. */
					onJoin: (callback: (socket: Socket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) =>
						this.#onLifecycle(LifecycleTypes.join_rooms, callback),
					/** Remove a guard for bulk room join requests. */
					offJoin: (callback?: (socket: Socket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) =>
						this.#offLifecycle(LifecycleTypes.join_rooms, callback),
					/** Register a one‑time guard for bulk room join requests. */
					onceJoin: (callback: (socket: Socket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) =>
						this.#onceLifecycle(LifecycleTypes.join_rooms, callback),
					/** Register a guard for bulk room leave requests. */
					onLeave: (callback: (socket: Socket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) =>
						this.#onLifecycle(LifecycleTypes.leave_rooms, callback),
					/** Remove a guard for bulk room leave requests. */
					offLeave: (callback?: (socket: Socket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) =>
						this.#offLifecycle(LifecycleTypes.leave_rooms, callback),
					/** Register a one‑time guard for bulk room leave requests. */
					onceLeave: (callback: (socket: Socket<TEvents, SD>, rooms: string[], next: MiddlewareNext) => void) =>
						this.#onceLifecycle(LifecycleTypes.leave_rooms, callback),
				},
			},
		};
	}

	/**
	 * Permanently destroy the server instance, closing all connections and
	 * cleaning up resources. The instance cannot be reused.
	 */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;

		for (const socket of this.sockets.values()) {
			if (!socket.isClosed) socket.close(1001, "server destroy");
		}
		this.sockets.clear();

		this.#callbacksMap.clear();
		this.#onceCallbacksMap.clear();
		this.#roomCallbacksMap.clear();
		this.#onceRoomCallbacksMap.clear();
		this.#lifecycleCallbacksMap.clear();
		this.#onceLifecycleCallbacksMap.clear();
		this.#middlewares = [];
	}

	#publishRaw(room: string, message: RecognizedString, isBinary: boolean = typeof message !== "string", compress?: boolean): void {
		if (this.#destroyed) return;
		this.#app.publish(room, message, isBinary, compress);
	}

	/**
	 * Emit a global event to all connected sockets.
	 *
	 * @typeParam E - Event name (must be a key in `TEvents['emit']`).
	 * @typeParam D - Event data type.
	 *
	 * @example io.emit('userJoined', { userId: '123' });
	 */
	emit<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): void {
		if (this.#destroyed) return;
		const room = this.#options.broadcastRoom;
		const message = this.encode({ event, data });
		this.#publishRaw(room, message);
	}

	#publish<
		R extends StringKeys<TEvents["emitRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["emitRoom"]>[R]>,
		D extends NonNullable<TEvents["emitRoom"]>[R][E],
	>(room: R, event: E, data: D) {
		if (this.#destroyed) return;
		const message = this.encode({ room, event, data });
		this.#publishRaw(room, message);
	}

	#publishMany<
		Rs extends NonNullable<TEvents["emitRooms"]>["rooms"],
		E extends StringNumberKeys<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>,
		D extends NonNullable<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>[E],
	>(rooms: Rs, event: E, data: D): void {
		if (this.#destroyed) return;
		const message = this.encode({ rooms, event, data });
		for (const room of rooms) {
			this.#publishRaw(room, message);
		}
	}

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
	): void {
		this.#addCallback(this.#callbacksMap, event, callback);
	}

	/**
	 * Remove a listener for global events.
	 * If no callback is provided, all listeners for that event are removed.
	 *
	 * @example io.off('userJoined', myCallback);
	 */
	off<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(
		event: E,
		callback?: EventCallback<TEvents, SD, D>,
	): void {
		if (!callback) {
			this.#callbacksMap.delete(event);
			this.#onceCallbacksMap.delete(event);
			return;
		}
		const onceEventMap = this.#onceCallbacksMap.get(event);
		const wrappersSet = onceEventMap?.get(callback);
		if (wrappersSet) {
			wrappersSet.forEach((wrapper) => {
				this.#deleteCallback(this.#callbacksMap, event, wrapper);
				this.#deleteOnceCallback(this.#onceCallbacksMap, event, callback, wrapper);
			});
		}
		this.#deleteCallback(this.#callbacksMap, event, callback);
	}

	/**
	 * Register a one‑time listener for a global event.
	 * The callback is removed after the first invocation.
	 *
	 * @example io.once('userJoined', (socket, data) => { console.log('First join'); });
	 */
	once<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(
		event: E,
		callback: EventCallback<TEvents, SD, D>,
	): void {
		const callbackWrapper: EventCallback<TEvents, SD, D> = (...args) => {
			this.#deleteCallback(this.#callbacksMap, event, callbackWrapper);
			this.#deleteOnceCallback(this.#onceCallbacksMap, event, callback, callbackWrapper);
			callback(...args);
		};
		this.#addOnceCallback(this.#onceCallbacksMap, event, callback, callbackWrapper);
		this.#addCallback(this.#callbacksMap, event, callbackWrapper);
	}

	#onRoom<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: RoomEventMiddleware<TEvents, SD, D>): void {
		this.#addRoomCallback(room, event, callback);
	}

	#offRoom<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event?: E, callback?: RoomEventMiddleware<TEvents, SD, D>): void {
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

	#onceRoom<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: RoomEventMiddleware<TEvents, SD, D>): void {
		const callbackWrapper: RoomEventMiddleware<TEvents, SD, D> = (...args) => {
			this.#deleteRoomCallback(room, event, callbackWrapper);
			this.#deleteOnceRoomCallback(room, event, callback, callbackWrapper);
			callback(...args);
		};
		this.#addOnceRoomCallback(room, event, callback, callbackWrapper);
		this.#addRoomCallback(room, event, callbackWrapper);
	}

	#deleteRoomCallback<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: RoomEventMiddleware<TEvents, SD, D>): void {
		const roomMap = this.#roomCallbacksMap.get(room);
		if (roomMap) {
			this.#deleteCallback(roomMap, event, callback);
			if (roomMap.size === 0) this.#roomCallbacksMap.delete(room);
		}
	}

	#deleteOnceRoomCallback<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: RoomEventMiddleware<TEvents, SD, D>, callbackWrapper: RoomEventMiddleware<TEvents, SD, D>): void {
		const onceRoomMap = this.#onceRoomCallbacksMap.get(room);
		if (onceRoomMap) {
			this.#deleteOnceCallback(onceRoomMap, event, callback, callbackWrapper);
			if (onceRoomMap?.size === 0) this.#onceRoomCallbacksMap.delete(room);
		}
	}

	#addRoomCallback<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: RoomEventMiddleware<TEvents, SD, D>): void {
		let roomMap = this.#roomCallbacksMap.get(room);
		if (!roomMap) {
			roomMap = new Map();
			this.#roomCallbacksMap.set(room, roomMap);
		}
		this.#addCallback(roomMap, event, callback);
	}

	#addOnceRoomCallback<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: RoomEventMiddleware<TEvents, SD, D>, callbackWrapper: RoomEventMiddleware<TEvents, SD, D>): void {
		let onceRoomMap = this.#onceRoomCallbacksMap.get(room);
		if (!onceRoomMap) {
			onceRoomMap = new Map();
			this.#onceRoomCallbacksMap.set(room, onceRoomMap);
		}
		this.#addOnceCallback(onceRoomMap, event, callback, callbackWrapper);
	}

	/**
	 * Register a global middleware function.
	 * Middleware runs before any user message is processed.
	 *
	 * @example
	 * io.use((socket, ctx, next) => {
	 *   console.log('Message received:', ctx);
	 *   next();
	 * });
	 */
	use(fn: Middleware<TEvents, SD>): void {
		this.#middlewares.push(fn);
	}

	#runMiddlewares<R extends string, E extends string | number, D>(
		socket: Socket<TEvents, SD>,
		ctx: UserMessage<R, E, D>,
		finalCallback: () => void,
	): void {
		let index = 0;
		let aborted = false;

		const stack = Array.from(this.#middlewares);

		const next: MiddlewareNext = (error) => {
			if (aborted) return;
			if (error) {
				aborted = true;
				const isTimeout = error instanceof Error && error.name === "TimeoutError";
				const phase = isTimeout ? "middlewareTimeout" : "middleware";
				this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase, error });

				const option = isTimeout ? this.#options.onMiddlewareTimeout : this.#options.onMiddlewareError;
				if (option === "close") {
					socket.close(1011, error instanceof Error ? error.message : String(error));
				} else if (typeof option === "function") {
					option(error, socket);
				}
				return;
			}

			if (index >= stack.length) {
				try {
					return finalCallback();
				} catch (err) {
					this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "finalCallback", error: err });
					return;
				}
			}

			const middleware = stack[index++];
			let called = false;
			let timeoutId: ReturnType<typeof setTimeout> | null = null;

			const execution = new Promise<void>((resolve, reject) => {
				try {
					const result = middleware(socket, ctx, (err) => {
						if (called) return;
						called = true;
						if (err) reject(err);
						else resolve();
					});

					if (result instanceof Promise) {
						result.then(
							() => {
								if (!called) {
									called = true;
									resolve();
								}
							},
							(err) => {
								if (!called) {
									called = true;
									reject(err);
								}
							},
						);
					}
				} catch (syncErr) {
					if (!called) {
						called = true;
						reject(syncErr);
					}
				}
			});

			const timeout = new Promise<void>((_, reject) => {
				timeoutId = setTimeout(() => {
					if (!called) {
						called = true;
						const timeoutError = new Error(`Middleware timeout after ${this.#options.middlewareTimeout}ms`);
						timeoutError.name = "TimeoutError";
						reject(timeoutError);
					}
				}, this.#options.middlewareTimeout);
			});

			Promise.race([execution, timeout])
				.then(() => next())
				.catch((err) => next(err))
				.finally(() => {
					if (timeoutId) clearTimeout(timeoutId);
				});
		};

		next();
	}

	/**
	 * Returns the WebSocketBehavior object to be passed to uWebSockets.js
	 * `app.ws(path, behavior)`.
	 *
	 * @example
	 * app.ws('/socket', io.handler);
	 */
	get handler(): WebSocketBehavior<SD> {
		return {
			...this.#options,
			upgrade: this.#upgrade.bind(this),
			open: this.#open.bind(this),
			message: this.#message.bind(this),
			close: this.#close.bind(this),
		};
	}

	#upgrade(res: HttpResponse, req: HttpRequest, context: us_socket_context_t) {
		if (this.#destroyed) {
			res.writeStatus("503 Service Unavailable");
			res.end("Server is shutting down");
			return;
		}
		if (this.#options.origins?.length) {
			const origin = req.getHeader("origin");
			if (origin) {
				const normalized = origin.toLowerCase();
				const allowed = this.#options.origins.some((o) => o.toLowerCase() === normalized);
				if (!allowed) {
					res.writeStatus("403 Forbidden");
					res.end("Origin not allowed");
					return;
				}
			}
		}
		const userData = {
			socketKey: randomUUID(),
			query: req.getQuery(),
			host: req.getHeader("host"),
			cookie: req.getHeader("cookie"),
			userAgent: req.getHeader("user-agent"),
			authorization: req.getHeader("authorization"),
			xForwardedFor: req.getHeader("x-forwarded-for"),
		} as SD;

		this.#runSyncHooks(this.#lifecycleCallbacksMap.get(LifecycleTypes.upgrade), [res, req, userData, context], (error) => {
			if (error == null) {
				res.upgrade(
					userData,
					req.getHeader("sec-websocket-key"),
					req.getHeader("sec-websocket-protocol"),
					req.getHeader("sec-websocket-extensions"),
					context,
				);
			} else {
				res.writeStatus("500 Internal Server Error");
				res.end("Upgrade rejected");
				this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), null, { phase: "onUpgrade", error });
			}
		});
	}

	#open(ws: WebSocket<SD>) {
		if (this.#destroyed) {
			ws.end(1001, "server destroyed");
			return;
		}
		const socketKey = ws.getUserData().socketKey;
		const socket = new Socket<TEvents, SD>(socketKey, ws, this.#options.broadcastRoom, this.encode.bind(this));
		if (!this.#options.auth)
			socket._handleAuth(null, this.#options.auth, this.#options.authTimeout, this.#options.broadcastRoom, (err) => {
				if (err == null)
					this.#runSyncHooks(this.#lifecycleCallbacksMap.get(LifecycleTypes.open), [socket], (error) => {
						if (error != null)
							this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onOpen", error });
					});
			});
		this.sockets.set(socketKey, socket);
	}

	#message(ws: WebSocket<SD>, message: ArrayBuffer, isBinary: boolean) {
		const socketKey = ws.getUserData().socketKey;
		const socket = this.sockets.get(socketKey);
		if (!socket || socket.isClosed) return;

		this.#runSyncHooks(this.#lifecycleCallbacksMap.get(LifecycleTypes.message), [socket, message, isBinary], (error) => {
			if (error != null) this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onMessage", error });
		});

		let parsed;
		try {
			parsed = this.decode(message, isBinary);
		} catch (error) {
			const raw = isBinary ? message.byteLength.toString() : Buffer.from(message).toString("utf8");
			this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "decode", raw, error });
			socket.close(1008, "decode error");
			return;
		}

		if (parsed == null || typeof parsed !== "object") {
			const error = new Error("Message must be an object");
			this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, {
				phase: "validation",
				raw: JSON.stringify(parsed),
				error,
			});
			socket.close(1008, "bad format");
			return;
		}

		if (this.#handleAuthMessage(socket, parsed)) return;
		if (!socket.isAuthenticated) return;
		if (this.#handlePingMessage(socket, parsed)) return;
		if (this.#handleJoinRoomMessage(socket, parsed)) return;
		if (this.#handleLeaveRoomMessage(socket, parsed)) return;
		if (this.#handleJoinRoomsMessage(socket, parsed)) return;
		if (this.#handleLeaveRoomsMessage(socket, parsed)) return;
		this.#runMiddlewares(socket, parsed, () => {
			if (this.#handleRoomsMessage(socket, parsed)) return;
			if (this.#handleRoomMessage(socket, parsed)) return;
			if (this.#handleMessage(socket, parsed)) return;
		});
	}

	#close(ws: WebSocket<SD>, code: number, message: ArrayBuffer) {
		const socketKey = ws.getUserData().socketKey;
		if (this.#options.debug && code === 4008) console.warn(`Auth timeout for socket ${socketKey}`);
		const socket = this.sockets.get(socketKey);
		if (!socket) return;

		this.sockets.delete(socketKey);
		socket._markClosed();
		this.#runSyncHooks(this.#lifecycleCallbacksMap.get(LifecycleTypes.close), [socket, code, message], (error) => {
			if (error != null) {
				this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onClose", error });
			}
		});
	}

	/**
	 * Encode a structured payload into a format suitable for sending over the WebSocket.
	 * Uses the configured serialization (`"json"` or `"binary"`).
	 *
	 * **Advanced usage only.** Prefer `emit()` or `send()` for type‑safe communication.
	 *
	 * @param payload - A lifecycle message or user event object.
	 * @returns Encoded string (JSON) or Buffer (MessagePack).
	 *
	 * @example
	 * // Pre‑encode a payload for repeated use
	 * const encoded = socket.encode({ event: 'chat', data: { text: 'Hello' } });
	 * socket.sendRaw(encoded);
	 */
	encode<R extends string, E extends string | number, D>(payload: LifecycleMessage<R, D> | UserMessage<R, E, D>) {
		if (this.#options.serialization === "binary") {
			return this.#packr.pack(payload);
		} else {
			return JSON.stringify(payload);
		}
	}

	/**
	 * Decode a raw WebSocket message into a structured payload.
	 * Automatically detects JSON or MessagePack based on the binary flag and message content.
	 *
	 * **Advanced usage only.** Normally you should use `on()` listeners to receive typed data.
	 *
	 * @param message - Raw string (JSON), ArrayBuffer, or Buffer (MessagePack).
	 * @param isBinary - Whether the message is binary. If omitted, format is detected from the message type.
	 * @returns Decoded lifecycle or user message object.
	 */
	decode(message: string | ArrayBuffer | Buffer, isBinary?: boolean) {
		if (typeof message === "string" && (isBinary === false || isBinary === undefined)) return JSON.parse(message);

		if (typeof message !== "string" && (isBinary === true || isBinary === undefined)) return this.#packr.unpack(new Uint8Array(message));

		if (isBinary === true) throw new Error("Received string data but isBinary flag is true — expected binary data");

		if (isBinary === false) throw new Error("Received binary data but isBinary flag is false — expected text message");

		throw new Error("Decode failed: unexpected message type or isBinary combination");
	}

	#handleAuthMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isAuthMessage(parsed)) return false;
		socket._handleAuth(parsed, this.#options.auth, this.#options.authTimeout, this.#options.broadcastRoom, (err) => {
			if (err == null) {
				this.#runSyncHooks(this.#lifecycleCallbacksMap.get(LifecycleTypes.open), [socket], (error) => {
					if (error != null)
						this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onOpen", error });
				});
			}
		});
		return true;
	}

	#handlePingMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isPingMessage(parsed)) return false;
		socket.send({ type: LifecycleTypes.pong });
		return true;
	}

	#handleJoinRoomMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isJoinRoomMessage(parsed)) return false;
		this.#runAsyncHooksOrNext(this.#lifecycleCallbacksMap.get(LifecycleTypes.join_room), [socket, parsed.room], (error) => {
			if (error == null) {
				socket.rooms.join(parsed.room);
				socket.send({ type: LifecycleTypes.join_room_success, room: parsed.room });
			} else {
				socket.send({ type: LifecycleTypes.join_room_error, room: parsed.room, data: { phase: "joinRoom", error } });
			}
		});
		return true;
	}

	#handleLeaveRoomMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isLeaveRoomMessage(parsed)) return false;
		this.#runAsyncHooksOrNext(this.#lifecycleCallbacksMap.get(LifecycleTypes.leave_room), [socket, parsed.room], (error) => {
			if (error == null) {
				socket.rooms.leave(parsed.room);
				socket.send({ type: LifecycleTypes.leave_room_success, room: parsed.room });
			} else {
				socket.send({ type: LifecycleTypes.leave_room_error, room: parsed.room, data: { phase: "leaveRoom", error } });
			}
		});
		return true;
	}

	#handleJoinRoomsMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isJoinRoomsMessage(parsed)) return false;
		this.#runAsyncHooksOrNext(this.#lifecycleCallbacksMap.get(LifecycleTypes.join_rooms), [socket, parsed.rooms], (error) => {
			if (error == null) {
				socket.rooms.bulk.join(parsed.rooms);
				socket.send({ type: LifecycleTypes.join_rooms_success, rooms: parsed.rooms });
			} else {
				socket.send({ type: LifecycleTypes.join_rooms_error, rooms: parsed.rooms, data: { phase: "joinRooms", error } });
			}
		});
		return true;
	}

	#handleLeaveRoomsMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isLeaveRoomsMessage(parsed)) return false;
		this.#runAsyncHooksOrNext(this.#lifecycleCallbacksMap.get(LifecycleTypes.leave_rooms), [socket, parsed.rooms], (error) => {
			if (error == null) {
				socket.rooms.bulk.leave(parsed.rooms);
				socket.send({ type: LifecycleTypes.leave_rooms_success, rooms: parsed.rooms });
			} else {
				socket.send({ type: LifecycleTypes.leave_rooms_error, rooms: parsed.rooms, data: { phase: "leaveRooms", error } });
			}
		});
		return true;
	}

	#handleRoomsMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isRoomsMessage(parsed)) return false;
		const message = this.encode({ rooms: parsed.rooms, event: parsed.event, data: parsed.data });
		for (const room of parsed.rooms) {
			this.#runAsyncHooksOrNext(this.#roomCallbacksMap.get(room)?.get(parsed.event), [socket, parsed.data], (error) => {
				if (error == null) {
					socket.rooms.publishRaw(room, message);
				} else {
					this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, {
						phase: "rooms message",
						raw: JSON.stringify(parsed),
						error,
					});
				}
			});
		}
		return true;
	}

	#handleRoomMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isRoomMessage(parsed)) return false;
		this.#runAsyncHooksOrNext(this.#roomCallbacksMap.get(parsed.room)?.get(parsed.event), [socket, parsed.data], (error) => {
			if (error == null) {
				socket.rooms.emit(parsed.room, parsed.event, parsed.data);
			} else {
				this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, {
					phase: "room message",
					raw: JSON.stringify(parsed),
					error,
				});
			}
		});
		return true;
	}

	#handleMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isMessage(parsed)) return false;
		this.#triggerCallbacks(this.#callbacksMap.get(parsed.event), socket, parsed.data);
		return true;
	}

	// --- Callback Helpers ---
	#addCallback<E extends string | number>(callbacksMap: Map<string | number, Set<AnyCallback>>, event: E, callback: AnyCallback) {
		let eventCallbackSet = callbacksMap.get(event);
		if (!eventCallbackSet) {
			eventCallbackSet = new Set();
			callbacksMap.set(event, eventCallbackSet);
		}
		eventCallbackSet.add(callback);
	}

	#addOnceCallback<E extends string | number>(
		onceCallbacksMap: Map<string | number, Map<AnyCallback, Set<AnyCallback>>>,
		event: E,
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

	#deleteCallback<E extends string | number>(callbacksMap: Map<string | number, Set<AnyCallback>>, event: E, callbackWrapper: AnyCallback) {
		const eventCallbackSet = callbacksMap.get(event);
		if (eventCallbackSet) {
			eventCallbackSet.delete(callbackWrapper);
			if (eventCallbackSet.size === 0) {
				callbacksMap.delete(event);
			}
		}
	}

	#deleteOnceCallback<E extends string | number>(
		onceCallbacksMap: Map<string | number, Map<AnyCallback, Set<AnyCallback>>>,
		event: E,
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

	#onLifecycle<T extends LifecycleTypes>(type: T, callback: AnyCallback) {
		this.#addCallback(this.#lifecycleCallbacksMap, type, callback);
	}

	#offLifecycle<T extends LifecycleTypes>(type: T, callback?: AnyCallback) {
		if (!callback) {
			this.#lifecycleCallbacksMap.delete(type);
			this.#onceLifecycleCallbacksMap.delete(type);
			return;
		}
		const onceTypeMap = this.#onceLifecycleCallbacksMap.get(type);
		const wrappersSet = onceTypeMap?.get(callback);
		if (wrappersSet) {
			wrappersSet.forEach((wrapper) => {
				this.#deleteCallback(this.#lifecycleCallbacksMap, type, wrapper);
				this.#deleteOnceCallback(this.#onceLifecycleCallbacksMap, type, callback, wrapper);
			});
		}
		this.#deleteCallback(this.#lifecycleCallbacksMap, type, callback);
	}

	#onceLifecycle<T extends LifecycleTypes>(type: T, callback: AnyCallback) {
		const callbackWrapper = <Args extends Array<unknown>>(...args: Args) => {
			this.#deleteCallback(this.#lifecycleCallbacksMap, type, callbackWrapper);
			this.#deleteOnceCallback(this.#onceLifecycleCallbacksMap, type, callback, callbackWrapper);
			callback(...args);
		};
		this.#addOnceCallback(this.#onceLifecycleCallbacksMap, type, callback, callbackWrapper);
		this.#addCallback(this.#lifecycleCallbacksMap, type, callbackWrapper);
	}

	#triggerCallbacks<Args extends Array<unknown>>(callbackSet?: Set<AnyCallback>, ...args: Args): void {
		if (!callbackSet) return;
		const callbacks = Array.from(callbackSet);
		for (const callback of callbacks) {
			if (!callbackSet.has(callback)) continue;
			try {
				callback(...args);
			} catch (error) {
				if (this.#options.debug) console.error(error);
			}
		}
	}

	#runSyncHooks<Args extends Array<unknown>>(callbackSet: Set<AnyCallback> | undefined, args: Args, next: MiddlewareNext): void {
		if (!callbackSet) return next();
		let firstError: unknown = null;
		for (const callback of callbackSet) {
			try {
				callback(...args);
			} catch (err) {
				if (this.#options.debug) console.error(err);
				firstError = firstError ?? err;
			}
		}
		next(firstError);
	}

	#runAsyncHooksOrNext<Args extends Array<unknown>>(callbacks: Set<AnyCallback> | undefined, args: Args, finalCallback: MiddlewareNext): void {
		if (!callbacks || callbacks.size === 0) {
			try {
				finalCallback();
			} catch (err) {
				const socket = args[0] instanceof Socket ? args[0] : undefined;
				this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "asyncHookFinal", error: err });
			}
			return;
		}

		const stack = Array.from(callbacks);
		let index = 0;

		const next: MiddlewareNext = (error) => {
			if (error) {
				return finalCallback(error);
			}
			if (index >= stack.length) {
				try {
					return finalCallback();
				} catch (err) {
					const socket = args[0] instanceof Socket ? args[0] : undefined;
					this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "asyncHookFinal", error: err });
					return;
				}
			}

			const callback = stack[index++];
			let called = false;
			let timeoutId: ReturnType<typeof setTimeout> | null = null;

			const execution = new Promise<void>((resolve, reject) => {
				try {
					const result = callback(...args, (err?: unknown) => {
						if (called) return;
						called = true;
						if (err) reject(err);
						else resolve();
					});

					if (result instanceof Promise) {
						result.then(
							() => {
								if (!called) {
									called = true;
									resolve();
								}
							},
							(err) => {
								if (!called) {
									called = true;
									reject(err);
								}
							},
						);
					}
				} catch (syncErr) {
					if (!called) {
						called = true;
						reject(syncErr);
					}
				}
			});

			const timeout = new Promise<void>((_, reject) => {
				timeoutId = setTimeout(() => {
					if (!called) {
						called = true;
						const timeoutError = new Error(`Room middleware timeout after ${this.#options.roomMiddlewareTimeout}ms`);
						timeoutError.name = "TimeoutError";
						reject(timeoutError);
					}
				}, this.#options.roomMiddlewareTimeout);
			});

			Promise.race([execution, timeout])
				.then(() => next())
				.catch((err) => next(err))
				.finally(() => {
					if (timeoutId) clearTimeout(timeoutId);
				});
		};

		next();
	}

	// --- Type Guards ---
	#isObject(obj: unknown) {
		return typeof obj === "object" && obj !== null;
	}

	#isLifecycleMessage<T extends LifecycleTypes>(obj: unknown): obj is { type: T } {
		return this.#isObject(obj) && "type" in obj && typeof obj.type === "number" && LifecycleTypes[obj.type] != null;
	}

	#isAuthMessage<D>(obj: unknown): obj is { type: LifecycleTypes.auth; data: D } {
		return this.#isLifecycleMessage(obj) && obj.type === LifecycleTypes.auth;
	}

	#isPingMessage(obj?: unknown): obj is { type: LifecycleTypes.ping } {
		return this.#isLifecycleMessage(obj) && obj.type === LifecycleTypes.ping;
	}

	#isJoinRoomMessage(obj: unknown): obj is { type: LifecycleTypes.join_room; room: string } {
		return this.#isLifecycleMessage(obj) && obj.type === LifecycleTypes.join_room && "room" in obj && typeof obj.room === "string";
	}

	#isLeaveRoomMessage(obj: unknown): obj is { type: LifecycleTypes.leave_room; room: string } {
		return this.#isLifecycleMessage(obj) && obj.type === LifecycleTypes.leave_room && "room" in obj && typeof obj.room === "string";
	}

	#isJoinRoomsMessage(obj: unknown): obj is { type: LifecycleTypes.join_rooms; rooms: string[] } {
		return (
			this.#isLifecycleMessage(obj) &&
			obj.type === LifecycleTypes.join_rooms &&
			"rooms" in obj &&
			Array.isArray(obj.rooms) &&
			!obj.rooms.some((x) => typeof x !== "string")
		);
	}

	#isLeaveRoomsMessage(obj: unknown): obj is { type: LifecycleTypes.leave_rooms; rooms: string[] } {
		return (
			this.#isLifecycleMessage(obj) &&
			obj.type === LifecycleTypes.leave_rooms &&
			"rooms" in obj &&
			Array.isArray(obj.rooms) &&
			!obj.rooms.some((x) => typeof x !== "string")
		);
	}

	#isMessage<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(
		obj: unknown,
	): obj is { event: E; data: D } {
		return this.#isObject(obj) && "event" in obj && (typeof obj.event === "string" || typeof obj.event === "number") && "data" in obj;
	}

	#isRoomMessage<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(obj: unknown): obj is { room: R; event: E; data: D } {
		return this.#isMessage(obj) && "room" in obj && typeof obj.room === "string";
	}

	#isRoomsMessage<Rs extends string[], E extends string | number, D>(obj: unknown): obj is { rooms: Rs; event: E; data: D } {
		return this.#isMessage(obj) && "rooms" in obj && Array.isArray(obj.rooms) && !obj.rooms.some((x) => typeof x !== "string");
	}
}
