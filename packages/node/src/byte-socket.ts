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
import type { IncomingMessage, Server } from "node:http";
import type Stream from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { RoomManager } from "./room-manager";
import { Socket } from "./socket";
import type {
	ByteSocketOptions,
	EventCallback,
	IByteSocket,
	Middleware,
	MiddlewareNext,
	RoomEventMiddleware,
	ServerLifecycleAPI,
	ServerRoomsAPI,
	SocketData,
} from "./types";

type RequiredOptions =
	| "middlewareTimeout"
	| "roomMiddlewareTimeout"
	| "authTimeout"
	| "serialization"
	| "broadcastRoom"
	| "debug"
	| "onMiddlewareError"
	| "onMiddlewareTimeout"
	| "idleTimeout"
	| "sendPingsAutomatically";

/**
 * ByteSocket server instance.
 *
 * Manages WebSocket connections, rooms, middleware, and event routing.
 * Provides a fully typed event system via a user-supplied event map (`TEvents`).
 *
 * @typeParam TEvents - A type extending `SocketEvents` that defines the shape of
 *                      all emit/listen events (global and room-scoped).
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
 * const io = new ByteSocket<MyEvents>({ debug: true });
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
 * const io = new ByteSocket<MyEvents>({ debug: true });
 *
 * // Global emits/listens
 * io.emit('ping', undefined);
 * io.on('client:message', (socket, data) => {
 *   console.log(`${data.sender}: ${data.text}`);
 * });
 *
 * // Room-specific emits/listens
 * io.rooms.emit('chat', 'message', { text: 'Hello everyone' });
 * io.rooms.on('chat', 'message', (socket, data, next) => {
 *   console.log(`${data.sender}: ${data.text}`);
 *   next();
 * });
 * ```
 */
export class ByteSocket<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData> implements IByteSocket<TEvents, SD> {
	// ──── Namespaces ────────────────────────────────────────────────────────────────────────

	readonly lifecycle: ServerLifecycleAPI<this, TEvents, SD>;
	readonly rooms: ServerRoomsAPI<this, TEvents, SD>;
	readonly sockets = new Map<string, Socket<TEvents, SD>>();

	// ──── States ────────────────────────────────────────────────────────────────────────

	readonly #defaultStructures: Array<Array<string>> = [
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
	#paths: Set<string> = new Set();
	#server: Server | undefined;
	#wss: WebSocketServer | undefined;
	#roomManager = new RoomManager<TEvents, SD>();
	#packr: Packr;
	#options: Omit<ByteSocketOptions<TEvents, SD>, RequiredOptions> & Pick<Required<ByteSocketOptions<TEvents, SD>>, RequiredOptions>;
	#middlewares: Middleware<TEvents, SD>[] = [];
	#destroyed = false;

	// ──── Callbacks ────────────────────────────────────────────────────────────────────────

	#callbacksMap = new Map<string | number, Set<AnyCallback>>();
	#onceCallbacksMap = new Map<string | number, Map<AnyCallback, Set<AnyCallback>>>();
	#roomCallbacksMap = new Map<string, Map<string | number, Set<AnyCallback>>>();
	#onceRoomCallbacksMap = new Map<string, Map<string | number, Map<AnyCallback, Set<AnyCallback>>>>();
	#lifecycleCallbacksMap = new Map<string | number, Set<AnyCallback>>();
	#onceLifecycleCallbacksMap = new Map<string | number, Map<AnyCallback, Set<AnyCallback>>>();

	/**
	 * Creates a new ByteSocket server instance.
	 *
	 * @param options - Configuration options.
	 *
	 * @example
	 * import express from 'express';
	 * import http from "node:http";
	 * const app = express()
	 * const server = http.createServer(app);
	 * const io = new ByteSocket({ debug: true });
	 *
	 * // Global middleware (runs before every user message)
	 * io.use((socket, ctx, next) => { ... })
	 *
	 * // Event listener
	 * io.on("event", (socket, data) => { ... })
	 *
	 * io.attach(server, "/socket");
	 * app.listen(3000, () => console.log('Listening'));
	 */
	constructor(options: ByteSocketOptions<TEvents, SD> = {}) {
		const { msgpackrOptions, ...restOptions } = options;

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
			idleTimeout: options.idleTimeout ?? 120,
			sendPingsAutomatically: options.sendPingsAutomatically ?? true,
		};

		this.#packr = new Packr({
			...msgpackrOptions,
			useRecords: false,
			structures: msgpackrOptions?.structures?.length ? [...this.#defaultStructures, ...msgpackrOptions.structures] : this.#defaultStructures,
			useFloat32: msgpackrOptions?.useFloat32 ?? FLOAT32_OPTIONS.DECIMAL_FIT,
			copyBuffers: msgpackrOptions?.copyBuffers ?? false,
			int64AsType: msgpackrOptions?.int64AsType ?? "bigint",
			bundleStrings: msgpackrOptions?.bundleStrings ?? true,
		});

		this.lifecycle = {
			onUpgrade: (callback) => this.#onLifecycle(LifecycleTypes.upgrade, callback),
			offUpgrade: (callback) => this.#offLifecycle(LifecycleTypes.upgrade, callback),
			onceUpgrade: (callback) => this.#onceLifecycle(LifecycleTypes.upgrade, callback),

			onOpen: (callback) => this.#onLifecycle(LifecycleTypes.open, callback),
			offOpen: (callback) => this.#offLifecycle(LifecycleTypes.open, callback),
			onceOpen: (callback) => this.#onceLifecycle(LifecycleTypes.open, callback),

			onAuthSuccess: (callback) => this.#onLifecycle(LifecycleTypes.auth_success, callback),
			offAuthSuccess: (callback) => this.#offLifecycle(LifecycleTypes.auth_success, callback),
			onceAuthSuccess: (callback) => this.#onceLifecycle(LifecycleTypes.auth_success, callback),

			onAuthError: (callback) => this.#onLifecycle(LifecycleTypes.auth_error, callback),
			offAuthError: (callback) => this.#offLifecycle(LifecycleTypes.auth_error, callback),
			onceAuthError: (callback) => this.#onceLifecycle(LifecycleTypes.auth_error, callback),

			onMessage: (callback) => this.#onLifecycle(LifecycleTypes.message, callback),
			offMessage: (callback) => this.#offLifecycle(LifecycleTypes.message, callback),
			onceMessage: (callback) => this.#onceLifecycle(LifecycleTypes.message, callback),

			onClose: (callback) => this.#onLifecycle(LifecycleTypes.close, callback),
			offClose: (callback) => this.#offLifecycle(LifecycleTypes.close, callback),
			onceClose: (callback) => this.#onceLifecycle(LifecycleTypes.close, callback),

			onError: (callback) => this.#onLifecycle(LifecycleTypes.error, callback),
			offError: (callback) => this.#offLifecycle(LifecycleTypes.error, callback),
			onceError: (callback) => this.#onceLifecycle(LifecycleTypes.error, callback),
		};

		this.rooms = {
			publishRaw: this.#publishRaw.bind(this),
			emit: this.#publish.bind(this),
			on: this.#onRoom.bind(this),
			off: this.#offRoom.bind(this),
			once: this.#onceRoom.bind(this),
			lifecycle: {
				onJoin: (callback) => this.#onLifecycle(LifecycleTypes.join_room, callback),
				offJoin: (callback) => this.#offLifecycle(LifecycleTypes.join_room, callback),
				onceJoin: (callback) => this.#onceLifecycle(LifecycleTypes.join_room, callback),

				onLeave: (callback) => this.#onLifecycle(LifecycleTypes.leave_room, callback),
				offLeave: (callback) => this.#offLifecycle(LifecycleTypes.leave_room, callback),
				onceLeave: (callback) => this.#onceLifecycle(LifecycleTypes.leave_room, callback),
			},
			bulk: {
				emit: this.#publishMany.bind(this),
				lifecycle: {
					onJoin: (callback) => this.#onLifecycle(LifecycleTypes.join_rooms, callback),
					offJoin: (callback) => this.#offLifecycle(LifecycleTypes.join_rooms, callback),
					onceJoin: (callback) => this.#onceLifecycle(LifecycleTypes.join_rooms, callback),

					onLeave: (callback) => this.#onLifecycle(LifecycleTypes.leave_rooms, callback),
					offLeave: (callback) => this.#offLifecycle(LifecycleTypes.leave_rooms, callback),
					onceLeave: (callback) => this.#onceLifecycle(LifecycleTypes.leave_rooms, callback),
				},
			},
		};
	}

	destroy(): void {
		if (this.#destroyed) {
			return;
		}
		this.#destroyed = true;

		for (const socket of this.sockets.values()) {
			if (!socket.isClosed) {
				socket.close(1001, "server destroy");
			}
		}
		this.sockets.clear();

		this.#wss?.close();

		this.#paths.clear();

		this.#callbacksMap.clear();
		this.#onceCallbacksMap.clear();
		this.#roomCallbacksMap.clear();
		this.#onceRoomCallbacksMap.clear();
		this.#lifecycleCallbacksMap.clear();
		this.#onceLifecycleCallbacksMap.clear();
		this.#middlewares = [];

		this.#wss = undefined;
		this.#server = undefined;
	}

	#publishRaw(room: string, message: WebSocket.Data, isBinary: boolean = typeof message !== "string", compress?: boolean): this {
		if (!this.#wss || this.#destroyed) {
			return this;
		}
		this.#roomManager.publishServer(room, message, isBinary, compress);
		return this;
	}

	emit<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): this {
		if (!this.#wss || this.#destroyed) {
			return this;
		}
		const message = this.encode({ event, data });
		this.#publishRaw(this.#options.broadcastRoom, message);
		return this;
	}

	#publish<
		R extends StringKeys<TEvents["emitRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["emitRoom"]>[R]>,
		D extends NonNullable<TEvents["emitRoom"]>[R][E],
	>(room: R, event: E, data: D): this {
		if (!this.#wss || this.#destroyed) {
			return this;
		}
		const message = this.encode({ room, event, data });
		this.#publishRaw(room, message);
		return this;
	}

	#publishMany<
		Rs extends NonNullable<TEvents["emitRooms"]>["rooms"],
		E extends StringNumberKeys<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>,
		D extends NonNullable<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>[E],
	>(rooms: Rs, event: E, data: D): this {
		if (!this.#wss || this.#destroyed) {
			return this;
		}
		const message = this.encode({ rooms, event, data });
		for (const room of rooms) {
			this.#publishRaw(room, message);
		}
		return this;
	}

	on<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(
		event: E,
		callback: EventCallback<TEvents, SD, D>,
	): this {
		this.#addCallback(this.#callbacksMap, event, callback);
		return this;
	}

	off<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(
		event: E,
		callback?: EventCallback<TEvents, SD, D>,
	): this {
		if (!callback) {
			this.#callbacksMap.delete(event);
			this.#onceCallbacksMap.delete(event);
			return this;
		}
		const onceEventMap = this.#onceCallbacksMap.get(event);
		const wrappersSet = onceEventMap?.get(callback);
		if (wrappersSet) {
			for (const wrapper of [...wrappersSet]) {
				this.#deleteCallback(this.#callbacksMap, event, wrapper);
				this.#deleteOnceCallback(this.#onceCallbacksMap, event, callback, wrapper);
			}
		}
		this.#deleteCallback(this.#callbacksMap, event, callback);
		return this;
	}

	once<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(
		event: E,
		callback: EventCallback<TEvents, SD, D>,
	): this {
		const callbackWrapper: EventCallback<TEvents, SD, D> = (...args) => {
			this.#deleteCallback(this.#callbacksMap, event, callbackWrapper);
			this.#deleteOnceCallback(this.#onceCallbacksMap, event, callback, callbackWrapper);
			callback(...args);
		};
		this.#addOnceCallback(this.#onceCallbacksMap, event, callback, callbackWrapper);
		this.#addCallback(this.#callbacksMap, event, callbackWrapper);
		return this;
	}

	#onRoom<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: RoomEventMiddleware<TEvents, SD, D>): this {
		this.#addRoomCallback(room, event, callback);
		return this;
	}

	#offRoom<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event?: E, callback?: RoomEventMiddleware<TEvents, SD, D>): this {
		const roomMap = this.#roomCallbacksMap.get(room);
		if (!roomMap) {
			return this;
		}
		if (event === undefined) {
			this.#roomCallbacksMap.delete(room);
			this.#onceRoomCallbacksMap.delete(room);
			return this;
		}
		const onceRoomMap = this.#onceRoomCallbacksMap.get(room);
		if (callback === undefined) {
			roomMap.delete(event);
			onceRoomMap?.delete(event);
			if (roomMap.size === 0) {
				this.#roomCallbacksMap.delete(room);
				this.#onceRoomCallbacksMap.delete(room);
			}
			return this;
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
		return this;
	}

	#onceRoom<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: RoomEventMiddleware<TEvents, SD, D>): this {
		const callbackWrapper: RoomEventMiddleware<TEvents, SD, D> = (...args) => {
			this.#deleteRoomCallback(room, event, callbackWrapper);
			this.#deleteOnceRoomCallback(room, event, callback, callbackWrapper);
			callback(...args);
		};
		this.#addOnceRoomCallback(room, event, callback, callbackWrapper);
		this.#addRoomCallback(room, event, callbackWrapper);
		return this;
	}

	#deleteRoomCallback<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: RoomEventMiddleware<TEvents, SD, D>): void {
		const roomMap = this.#roomCallbacksMap.get(room);
		if (roomMap) {
			this.#deleteCallback(roomMap, event, callback);
			if (roomMap.size === 0) {
				this.#roomCallbacksMap.delete(room);
			}
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
			if (onceRoomMap?.size === 0) {
				this.#onceRoomCallbacksMap.delete(room);
			}
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

	use(fn: Middleware<TEvents, SD>): this {
		this.#middlewares.push(fn);
		return this;
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
			if (aborted) {
				return;
			}
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
						if (called) {
							return;
						}
						called = true;
						if (err) {
							reject(err);
						} else {
							resolve();
						}
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
					if (timeoutId) {
						clearTimeout(timeoutId);
					}
				});
		};

		next();
	}

	get destroyed(): boolean {
		return this.#destroyed;
	}

	attach(server: Server, path: string): this {
		if (!this.#wss) {
			this.#wss = new WebSocketServer({ ...this.#options, noServer: true });
		}

		if (this.#paths.has(path)) {
			return this;
		}
		this.#paths.add(path);

		if (this.#server !== server) {
			if (this.#server && this.#upgrade) {
				this.#server.off("upgrade", this.#upgrade);
			}
			this.#server = server;
			this.#upgrade = (req, streamSocket, head) => this.#handleUpgrade(req, streamSocket, head);
			server.on("upgrade", this.#upgrade);
		}

		return this;
	}

	#upgrade: ((req: IncomingMessage, socket: Stream.Duplex, head: Buffer<ArrayBuffer>) => void) | undefined;

	#handleUpgrade(req: IncomingMessage, streamSocket: Stream.Duplex, head: Buffer) {
		if (this.#destroyed) {
			streamSocket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
			streamSocket.destroy();
			return;
		}

		const urlObj = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);

		if (!this.#paths.has(urlObj.pathname)) {
			streamSocket.destroy();
			return;
		}

		if (this.#options.origins?.length) {
			const origin = req.headers.origin;
			if (origin && !this.#options.origins.some((o) => o.toLowerCase() === origin.toLowerCase())) {
				streamSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
				streamSocket.destroy();
				return;
			}
		}

		const socketData: SD = {
			socketKey: randomUUID(),
			url: urlObj.pathname,
			query: urlObj.search.startsWith("?") ? urlObj.search.slice(1) : urlObj.search,
			host: req.headers.host ?? "",
			cookie: req.headers.cookie ?? "",
			userAgent: req.headers["user-agent"] ?? "",
			authorization: req.headers.authorization ?? "",
			xForwardedFor: req.headers["x-forwarded-for"] ?? "",
		} as SD;

		this.#runSyncHooks(this.#lifecycleCallbacksMap.get(LifecycleTypes.upgrade), [req, streamSocket, head, socketData, this.#wss], (error) => {
			if (error == null) {
				if (this.#destroyed || !this.#wss) {
					streamSocket.destroy();
					return;
				}
				this.#wss.handleUpgrade(req, streamSocket, head, (ws) => {
					if (!this.#wss || this.#destroyed) {
						ws.close(1001, "server destroyed");
						return;
					}
					const socket = new Socket<TEvents, SD>(ws, socketData, this.#options.broadcastRoom, this.#roomManager, this.encode.bind(this), {
						idleTimeout: this.#options.idleTimeout,
						sendPingsAutomatically: this.#options.sendPingsAutomatically,
					});
					this.sockets.set(socket.id, socket);
					if (!this.#options.auth) {
						socket._handleAuth(null, this.#options.auth, this.#options.authTimeout, (err) => {
							if (err == null) {
								this.#runSyncHooks(this.#lifecycleCallbacksMap.get(LifecycleTypes.open), [socket], (error) => {
									if (error != null) {
										this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, {
											phase: "onOpen",
											error,
										});
									}
								});
							}
						});
					}
					ws.on("message", (data, isBinary) => this.#message(socket, data, isBinary));
					ws.on("close", (code, reason) => this.#close(socket, code, reason));
				});
			} else {
				if (this.#options.debug) {
					console.error(error);
				}
				streamSocket.destroy();
				this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), null, { phase: "onUpgrade", error });
			}
		});
	}

	#rawMessageDescription(message: WebSocket.RawData, isBinary: boolean): string {
		if (Array.isArray(message)) {
			const total = message.reduce((s, b) => s + b.length, 0);
			return `fragmented (${message.length} parts, ${total} bytes)`;
		}
		if (isBinary) {
			const len = Buffer.isBuffer(message) ? message.length : message.byteLength;
			return `binary (${len} bytes)`;
		}
		return typeof message === "string" ? message : new TextDecoder().decode(message);
	}

	#message(socket: Socket<TEvents, SD>, message: WebSocket.RawData, isBinary: boolean) {
		if (!socket || socket.isClosed) {
			return;
		}

		this.#runSyncHooks(this.#lifecycleCallbacksMap.get(LifecycleTypes.message), [socket, message, isBinary], (error) => {
			if (error != null) {
				this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onMessage", error });
			}
		});

		if (isBinary && message instanceof Buffer && message.length === 0) {
			socket.sendRaw(Buffer.alloc(0), true);
			return;
		}

		let parsed;
		try {
			parsed = this.decode(message, isBinary);
		} catch (error) {
			const raw = this.#rawMessageDescription(message, isBinary);
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

		if (this.#handleAuthMessage(socket, parsed)) {
			return;
		}
		if (!socket.isAuthenticated) {
			return;
		}
		if (this.#handleJoinRoomMessage(socket, parsed)) {
			return;
		}
		if (this.#handleLeaveRoomMessage(socket, parsed)) {
			return;
		}
		if (this.#handleJoinRoomsMessage(socket, parsed)) {
			return;
		}
		if (this.#handleLeaveRoomsMessage(socket, parsed)) {
			return;
		}
		this.#runMiddlewares(socket, parsed as UserMessage, () => {
			if (this.#handleRoomsMessage(socket, parsed)) {
				return;
			}
			if (this.#handleRoomMessage(socket, parsed)) {
				return;
			}
			if (this.#handleMessage(socket, parsed)) {
				return;
			}
		});
	}

	#close(socket: Socket<TEvents, SD>, code: number, reason: Buffer<ArrayBufferLike>) {
		if (this.#options.debug && code === 4008) {
			console.warn(`Auth timeout for socket ${socket.id}`);
		}
		this.sockets.delete(socket.id);
		socket._markClosed();
		this.#runSyncHooks(this.#lifecycleCallbacksMap.get(LifecycleTypes.close), [socket, code, reason], (error) => {
			if (error != null) {
				this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onClose", error });
			}
		});
	}

	encode<R extends string, E extends string | number, D>(
		payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
		serialization = this.#options.serialization,
	) {
		if (serialization === "binary") {
			return this.#packr.pack(payload);
		} else {
			return JSON.stringify(payload);
		}
	}

	decode<M extends WebSocket.RawData = WebSocket.RawData, D = unknown>(message: M, isBinary?: boolean): D {
		if (Array.isArray(message)) {
			const combined = Buffer.concat(message as Buffer[]);
			return this.decode(combined, isBinary);
		}

		if (typeof message === "string") {
			if (isBinary === true) {
				throw new Error("Received string but expected binary");
			}
			return JSON.parse(message);
		}

		if (isBinary === false) {
			const text = Buffer.isBuffer(message) ? message.toString("utf8") : Buffer.from(message).toString("utf8");
			return JSON.parse(text);
		}

		if (Buffer.isBuffer(message)) {
			return this.#packr.unpack(new Uint8Array(message.buffer, message.byteOffset, message.byteLength));
		}

		return this.#packr.unpack(new Uint8Array(message as ArrayBuffer));
	}

	#handleAuthMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isAuthMessage(parsed)) {
			return false;
		}
		socket._handleAuth(parsed, this.#options.auth, this.#options.authTimeout, (err) => {
			if (err == null) {
				this.#runSyncHooks(this.#lifecycleCallbacksMap.get(LifecycleTypes.auth_success), [socket], (error) => {
					if (error != null) {
						this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onAuthSuccess", error });
					}
				});
				this.#runSyncHooks(this.#lifecycleCallbacksMap.get(LifecycleTypes.open), [socket], (error) => {
					if (error != null) {
						this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onOpen", error });
					}
				});
			} else {
				const ctx: ErrorContext = {
					phase: "auth",
					error: err instanceof Error ? err : new Error(String(err)),
					code: 4003,
				};
				this.#runSyncHooks(this.#lifecycleCallbacksMap.get(LifecycleTypes.auth_error), [socket, ctx], (error) => {
					if (error != null) {
						this.#triggerCallbacks(this.#lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onAuthError", error });
					}
				});
			}
		});
		return true;
	}

	#handleJoinRoomMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isJoinRoomMessage(parsed)) {
			return false;
		}
		this.#runAsyncHooksOrNext(this.#lifecycleCallbacksMap.get(LifecycleTypes.join_room), [socket, parsed.room], (error) => {
			if (error == null) {
				socket.rooms.join(parsed.room);
				socket.send({ type: LifecycleTypes.join_room_success, room: parsed.room });
			} else {
				socket.send({ type: LifecycleTypes.join_room_error, room: parsed.room, data: { phase: "onJoinRoom", error } });
			}
		});
		return true;
	}

	#handleLeaveRoomMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isLeaveRoomMessage(parsed)) {
			return false;
		}
		this.#runAsyncHooksOrNext(this.#lifecycleCallbacksMap.get(LifecycleTypes.leave_room), [socket, parsed.room], (error) => {
			if (error == null) {
				socket.rooms.leave(parsed.room);
				socket.send({ type: LifecycleTypes.leave_room_success, room: parsed.room });
			} else {
				socket.send({ type: LifecycleTypes.leave_room_error, room: parsed.room, data: { phase: "onLeaveRoom", error } });
			}
		});
		return true;
	}

	#handleJoinRoomsMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isJoinRoomsMessage(parsed)) {
			return false;
		}
		this.#runAsyncHooksOrNext(this.#lifecycleCallbacksMap.get(LifecycleTypes.join_rooms), [socket, parsed.rooms], (error) => {
			if (error == null) {
				socket.rooms.bulk.join(parsed.rooms);
				socket.send({ type: LifecycleTypes.join_rooms_success, rooms: parsed.rooms });
			} else {
				socket.send({ type: LifecycleTypes.join_rooms_error, rooms: parsed.rooms, data: { phase: "onJoinRooms", error } });
			}
		});
		return true;
	}

	#handleLeaveRoomsMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isLeaveRoomsMessage(parsed)) {
			return false;
		}
		this.#runAsyncHooksOrNext(this.#lifecycleCallbacksMap.get(LifecycleTypes.leave_rooms), [socket, parsed.rooms], (error) => {
			if (error == null) {
				socket.rooms.bulk.leave(parsed.rooms);
				socket.send({ type: LifecycleTypes.leave_rooms_success, rooms: parsed.rooms });
			} else {
				socket.send({ type: LifecycleTypes.leave_rooms_error, rooms: parsed.rooms, data: { phase: "onLeaveRooms", error } });
			}
		});
		return true;
	}

	#handleRoomsMessage<T extends object>(socket: Socket<TEvents, SD>, parsed: T): boolean {
		if (!this.#isRoomsMessage(parsed)) {
			return false;
		}
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
		if (!this.#isRoomMessage(parsed)) {
			return false;
		}
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
		if (!this.#isMessage(parsed)) {
			return false;
		}
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

	#onLifecycle<T extends LifecycleTypes>(type: T, callback: AnyCallback): this {
		this.#addCallback(this.#lifecycleCallbacksMap, type, callback);
		return this;
	}

	#offLifecycle<T extends LifecycleTypes>(type: T, callback?: AnyCallback): this {
		if (!callback) {
			this.#lifecycleCallbacksMap.delete(type);
			this.#onceLifecycleCallbacksMap.delete(type);
			return this;
		}
		const onceTypeMap = this.#onceLifecycleCallbacksMap.get(type);
		const wrappersSet = onceTypeMap?.get(callback);
		if (wrappersSet) {
			for (const wrapper of [...wrappersSet]) {
				this.#deleteCallback(this.#lifecycleCallbacksMap, type, wrapper);
				this.#deleteOnceCallback(this.#onceLifecycleCallbacksMap, type, callback, wrapper);
			}
		}
		this.#deleteCallback(this.#lifecycleCallbacksMap, type, callback);
		return this;
	}

	#onceLifecycle<T extends LifecycleTypes>(type: T, callback: AnyCallback): this {
		const callbackWrapper = <Args extends Array<unknown>>(...args: Args) => {
			this.#deleteCallback(this.#lifecycleCallbacksMap, type, callbackWrapper);
			this.#deleteOnceCallback(this.#onceLifecycleCallbacksMap, type, callback, callbackWrapper);
			callback(...args);
		};
		this.#addOnceCallback(this.#onceLifecycleCallbacksMap, type, callback, callbackWrapper);
		this.#addCallback(this.#lifecycleCallbacksMap, type, callbackWrapper);
		return this;
	}

	#triggerCallbacks<Args extends Array<unknown>>(callbackSet?: Set<AnyCallback>, ...args: Args): void {
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
				if (this.#options.debug) {
					console.error(error);
				}
			}
		}
	}

	#runSyncHooks<Args extends Array<unknown>>(callbackSet: Set<AnyCallback> | undefined, args: Args, next: MiddlewareNext): void {
		if (!callbackSet) {
			return next();
		}
		let firstError: unknown = null;
		for (const callback of callbackSet) {
			try {
				callback(...args);
			} catch (err) {
				if (this.#options.debug) {
					console.error(err);
				}
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
						if (called) {
							return;
						}
						called = true;
						if (err) {
							reject(err);
						} else {
							resolve();
						}
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
					if (timeoutId) {
						clearTimeout(timeoutId);
					}
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
