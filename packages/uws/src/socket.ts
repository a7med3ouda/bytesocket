import {
	AuthState,
	LifecycleTypes,
	type ErrorContext,
	type EventsForRooms,
	type LifecycleMessage,
	type SocketEvents,
	type StringKeys,
	type StringNumberKeys,
	type UserMessage,
} from "@bytesocket/types";
import type { RecognizedString, WebSocket } from "uWebSockets.js";
import type { AuthFunction, MiddlewareNext, SocketData } from "./types";

/**
 * Represents an individual WebSocket connection.
 *
 * Provides methods for sending messages, joining/leaving rooms, and accessing
 * connection metadata. You receive instances of this class in lifecycle hooks,
 * middleware, and event listeners.
 *
 * @typeParam SD - The socket data type (must extend `SocketData`).
 * @typeParam TEvents - The event map type (from `SocketEvents`) for type‑safe emits.
 *
 * @example
 * io.lifecycle.onOpen((socket) => {
 *   console.log(`Socket ${socket.id} connected`);
 *   socket.rooms.join("lobby");
 *   socket.emit("welcome", { message: "Hello!" });
 * });
 */
export class Socket<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData> {
	/**
	 * Room management and room‑scoped event emission.
	 *
	 * @example
	 * socket.rooms.join("chat");
	 * socket.rooms.emit("chat", "message", { text: "Hello!" });
	 * console.log(socket.rooms.list()); // ["chat", "__bytesocket_broadcast__"]
	 */
	readonly rooms;

	/** Unique identifier for the socket (same as `userData.socketKey`). */
	readonly id: string;

	/**
	 * Payload attached during successful authentication.
	 * Available in middleware and event listeners.
	 */
	payload: any = {};

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
	locals: any = {};

	readonly #ws: WebSocket<SD>;
	readonly #broadcastRoom: string;
	readonly #encode: <R extends string, E extends string | number, D>(
		payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
	) => string | Buffer<ArrayBufferLike>;
	#authState: AuthState = AuthState.idle;
	#authTimer: ReturnType<typeof setTimeout> | null = null;
	#closed: boolean = false;

	/** Whether the socket has completed authentication (or auth is disabled). */
	get isAuthenticated(): boolean {
		return this.#authState === AuthState.none || this.#authState === AuthState.success;
	}

	/** Whether the socket has been closed. */
	get isClosed(): boolean {
		return this.#closed;
	}

	/**
	 * The user data object attached during the WebSocket upgrade.
	 * Contains HTTP request headers and other metadata.
	 */
	get userData(): SD {
		return this.#ws.getUserData();
	}

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
	get query(): string {
		return this.userData.query;
	}

	/**
	 * The `Cookie` header from the WebSocket upgrade request.
	 *
	 * @example
	 * // Useful for session handling when not using the Authorization header.
	 * const cookies = socket.cookie;
	 * const sessionId = parseCookies(cookies)?.sessionId;
	 */
	get cookie(): string {
		return this.userData.cookie;
	}

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
	get authorization(): string {
		return this.userData.authorization;
	}

	/**
	 * The `User-Agent` header from the WebSocket upgrade request.
	 *
	 * @example
	 * console.log(`Client: ${socket.userAgent}`);
	 * // "Client: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ..."
	 */
	get userAgent(): string {
		return this.userData.userAgent;
	}

	/**
	 * The `Host` header from the WebSocket upgrade request.
	 * Includes the domain and (optionally) port the client used to connect.
	 *
	 * @example
	 * console.log(socket.host); // "api.example.com"
	 */
	get host(): string {
		return this.userData.host;
	}

	/**
	 * The `X-Forwarded-For` header from the WebSocket upgrade request.
	 * Contains the originating client IP when behind a proxy or load balancer.
	 *
	 * @example
	 * const clientIp = socket.xForwardedFor?.split(',')[0].trim() || 'unknown';
	 * console.log(`Client IP: ${clientIp}`);
	 */
	get xForwardedFor(): string {
		return this.userData.xForwardedFor;
	}

	/** @internal */
	constructor(
		id: string,
		ws: WebSocket<SD>,
		broadcastRoom: string,
		encode: <R extends string, E extends string | number, D>(
			payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
		) => string | Buffer<ArrayBufferLike>,
	) {
		this.id = id;
		this.#ws = ws;
		this.#broadcastRoom = broadcastRoom;
		this.#encode = encode;

		this.rooms = {
			/**
			 * Publishes a raw message to a specific room without applying any serialization or encoding.
			 *
			 * This method is useful for sending custom protocol messages or pre-encoded data directly
			 * to all sockets subscribed to the given room. It bypasses the built‑in serialization layer,
			 * so you are responsible for ensuring that the message format matches what the clients expect.
			 *
			 * If the socket has been closed, this method does nothing.
			 *
			 * @param room - The name of the room to publish the message to.
			 * @param message - The raw message to send. Can be a `string` (UTF‑8 text) or an `ArrayBuffer` / `Buffer` (binary data).
			 * @param isBinary - Optional. If `true`, the message is sent as a binary WebSocket frame.
			 *                   If `false` or omitted, the frame type is inferred from the type of `message`
			 *                   (`string` → text frame, `ArrayBuffer`/`Buffer` → binary frame).
			 * @param compress - Optional. If `true`, the message will be compressed using the WebSocket
			 *                   permessage‑deflate extension (if negotiated with the client).
			 *
			 * @example
			 * // Send a JSON string to all sockets in the "lobby" room
			 * socket.rooms.publishRaw("lobby", JSON.stringify({ type: "announcement", text: "Hello!" }));
			 *
			 * @example
			 * // Send pre‑encoded binary data (e.g., MessagePack) to the "game" room
			 * const packedData = msgpack.encode({ event: "move", x: 10, y: 20 });
			 * socket.rooms.publishRaw("game", packedData, true);
			 */
			publishRaw: this.#publishRaw.bind(this),
			/**
			 * Emit a typed event to a specific room.
			 * @typeParam R - Room name (must be a key in `TEvents['emitRoom']`).
			 * @typeParam E - Event name.
			 * @typeParam D - Event data type.
			 * @example socket.rooms.emit("chat", "message", { text: "Hi" });
			 */
			emit: this.#publish.bind(this),
			/**
			 * Join a single room.
			 * @example socket.rooms.join("lobby");
			 */
			join: this.#joinRoom.bind(this),
			/**
			 * Leave a single room.
			 * @example socket.rooms.leave("lobby");
			 */
			leave: this.#leaveRoom.bind(this),
			/**
			 * Get a list of rooms this socket is currently subscribed to.
			 * @returns Array of room names.
			 */
			list: this.#ws.getTopics.bind(this),
			/** Bulk operations for multiple rooms. */
			bulk: {
				/**
				 * Emit a typed event to multiple rooms at once.
				 * @example socket.rooms.bulk.emit(["room1", "room2"], "alert", { msg: "Hello" });
				 */
				emit: this.#publishMany.bind(this),
				/**
				 * Join multiple rooms.
				 * @example socket.rooms.bulk.join(["lobby", "notifications"]);
				 */
				join: this.#joinRooms.bind(this),
				/**
				 * Leave multiple rooms.
				 * @example socket.rooms.bulk.leave(["lobby", "notifications"]);
				 */
				leave: this.#leaveRooms.bind(this),
			},
		};
	}

	/**
	 * Emit a typed global event to this socket only.
	 *
	 * @example socket.emit("privateMessage", { from: "server", text: "Hello" });
	 */
	emit<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): void {
		this.send({ event, data });
	}

	/**
	 * Send a raw message (string or binary) directly to this socket.
	 * Bypasses serialization. Useful for custom protocols.
	 *
	 * @example socket.sendRaw(JSON.stringify({ custom: "data" }));
	 */
	sendRaw(message: RecognizedString, isBinary: boolean = typeof message !== "string", compress?: boolean): void {
		if (this.#closed) return;
		this.#ws.send(message, isBinary, compress);
	}

	/**
	 * Send any lifecycle or user message to this socket.
	 * Automatically encodes according to the configured serialization.
	 *
	 * You typically use `emit()` or `broadcast()` instead.
	 */
	send<R extends string, E extends string | number, D>(payload: LifecycleMessage<R, D> | UserMessage<R, E, D>) {
		if (this.#closed) return;
		const message = this.#encode(payload);
		this.sendRaw(message);
	}

	/**
	 * Broadcast a global event to all connected sockets (including this one).
	 * This is a convenience method equivalent to publishing to the broadcast room.
	 *
	 * @example socket.broadcast("userJoined", { userId: socket.id });
	 */
	broadcast<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): void {
		if (this.#closed) return;
		const message = this.#encode({ event, data });
		this.#publishRaw(this.#broadcastRoom, message);
	}

	#publishRaw(room: string, message: RecognizedString, isBinary: boolean = typeof message !== "string", compress?: boolean): void {
		if (this.#closed) return;
		this.#ws.publish(room, message, isBinary, compress);
	}

	#publish<
		R extends StringKeys<TEvents["emitRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["emitRoom"]>[R]>,
		D extends NonNullable<TEvents["emitRoom"]>[R][E],
	>(room: R, event: E, data: D): void {
		if (this.#closed) return;
		const message = this.#encode({ room, event, data });
		this.#publishRaw(room, message);
	}

	#publishMany<
		Rs extends NonNullable<TEvents["emitRooms"]>["rooms"],
		E extends StringNumberKeys<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>,
		D extends NonNullable<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>[E],
	>(rooms: Rs, event: E, data: D): void {
		if (this.#closed) return;
		const message = this.#encode({ rooms, event, data });
		for (const room of rooms) {
			this.#publishRaw(room, message);
		}
	}

	/** @internal */
	_markClosed(): void {
		this.#closed = true;
		this.#clearAuthTimer();
	}

	/**
	 * Close the WebSocket connection gracefully.
	 *
	 * @param code - WebSocket close code. @default 1000
	 * @param reason - Close reason string. @default "normal"
	 */
	close(code: number = 1000, reason: string = "normal"): void {
		if (this.#closed) return;
		this._markClosed();
		this.#ws.end(code, reason);
	}

	#joinRoom(room: string) {
		if (this.#ws.isSubscribed(room)) return;
		this.#ws.subscribe(room);
	}

	#leaveRoom(room: string) {
		if (!this.#ws.isSubscribed(room)) return;
		this.#ws.unsubscribe(room);
	}

	#joinRooms(rooms: string[]) {
		for (const room of rooms) {
			this.#joinRoom(room);
		}
	}

	#leaveRooms(rooms: string[]) {
		for (const room of rooms) {
			this.#leaveRoom(room);
		}
	}

	/** @internal */
	_handleAuth<D>(
		parsed: { type: LifecycleTypes.auth; data: D } | null,
		auth: AuthFunction<TEvents, SD, D> | undefined,
		authTimeout: number,
		broadcastRoom: string,
		next: MiddlewareNext,
	) {
		if (auth && parsed !== null) {
			if (this.#authState !== AuthState.idle) return;
			this.#authState = AuthState.pending;
			this.#authTimer = setTimeout(() => {
				if (!this.isClosed && !this.isAuthenticated) {
					const err = new Error("Auth timeout");
					this.#setAuthFailed({ phase: "auth", error: err, code: 4008 });
					next(err);
				}
			}, authTimeout);
			try {
				auth(this, parsed.data, (payload, error) => {
					if (error || payload == null) {
						const err = error || new Error("Auth failed");
						this.#setAuthFailed({ phase: "auth", error: err, code: 4003 });
						next(err);
						return;
					}
					this.rooms.join(broadcastRoom);
					this.#setAuthSuccess(payload);
					next();
				});
			} catch (err) {
				this.#setAuthFailed({ phase: "auth", error: err, code: 4003 });
				next(err);
			}
		} else {
			this.#handleNoAuth(broadcastRoom);
			next();
		}
	}

	#handleNoAuth(broadcastRoom: string) {
		if (this.#closed) return;
		if (this.#authState !== AuthState.idle) return;
		this.#authState = AuthState.none;
		this.rooms.join(broadcastRoom);
	}

	#setAuthSuccess<P>(payload: P): void {
		if (this.#closed) return;
		if (this.#authState !== AuthState.pending) return;
		this.#clearAuthTimer();
		this.#authState = AuthState.success;
		this.payload = payload;
		this.send({ type: LifecycleTypes.auth_success });
	}

	#setAuthFailed(ctx: ErrorContext): void {
		if (this.#closed) return;
		if (this.#authState !== AuthState.pending) return;
		this.#clearAuthTimer();
		this.#authState = AuthState.failed;
		this.send({ type: LifecycleTypes.auth_error, data: ctx });
		this.close(ctx.code, ctx.phase);
	}

	#clearAuthTimer(): void {
		if (this.#authTimer) {
			clearTimeout(this.#authTimer);
			this.#authTimer = null;
		}
	}
}
