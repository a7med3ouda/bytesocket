import {
	AuthState,
	LifecycleTypes,
	type EventsForRooms,
	type LifecycleMessage,
	type StringKeys,
	type StringNumberKeys,
	type SymmetricEvents,
	type UserMessage,
} from "@bytesocket/types";
import type { RecognizedString, WebSocket } from "uWebSockets.js";
import type { AuthFunction, ErrorContext, SocketData } from "./types";

/**
 * Represents an individual WebSocket connection.
 *
 * Provides methods for sending messages, joining/leaving rooms, and accessing
 * connection metadata. You receive instances of this class in lifecycle hooks,
 * middleware, and event listeners.
 *
 * @typeParam SD - The socket data type (must extend `SocketData`).
 * @typeParam TEvents - The event map type (from `SymmetricEvents`) for type‑safe emits.
 *
 * @example
 * io.lifecycle.onOpen((socket) => {
 *   console.log(`Socket ${socket.id} connected`);
 *   socket.rooms.join("lobby");
 *   socket.emit("welcome", { message: "Hello!" });
 * });
 */
export class Socket<SD extends SocketData = SocketData, TEvents extends SymmetricEvents = SymmetricEvents> {
	/**
	 * Room management and room‑scoped event emission.
	 *
	 * @example
	 * socket.rooms.join("chat");
	 * socket.rooms.emit("chat", "message", { text: "Hello!" });
	 * console.log(socket.rooms.list()); // ["chat", "__bytesocket_broadcast__"]
	 */
	readonly rooms: {
		/**
		 * Send a raw message (already encoded) to a specific room.
		 * @param room - The room name.
		 * @param message - The raw string or binary data.
		 */
		emitRaw: (room: string, message: RecognizedString) => void;
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
			D extends NonNullable<NonNullable<TEvents["emitRoom"]>[R]>[E],
		>(
			room: R,
			event: E,
			data: D,
		) => void;
		/**
		 * Join a single room.
		 * @example socket.rooms.join("lobby");
		 */
		join: (room: string) => void;
		/**
		 * Leave a single room.
		 * @example socket.rooms.leave("lobby");
		 */
		leave: (room: string) => void;
		/**
		 * Get a list of rooms this socket is currently subscribed to.
		 * @returns Array of room names.
		 */
		list: () => string[];
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
			) => void;
			/**
			 * Join multiple rooms.
			 * @example socket.rooms.bulk.join(["lobby", "notifications"]);
			 */
			join: (rooms: string[]) => void;
			/**
			 * Leave multiple rooms.
			 * @example socket.rooms.bulk.leave(["lobby", "notifications"]);
			 */
			leave: (rooms: string[]) => void;
		};
	};

	/** Unique identifier for the socket (same as `userData.socketKey`). */
	readonly id: string;

	/**
	 * Payload attached during successful authentication.
	 * Available in middleware and event listeners.
	 */
	payload: unknown = null;

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
	locals: Record<string | number, unknown> = {};

	readonly #ws: WebSocket<SD>;
	readonly #broadcastRoom: string;
	readonly #encode: <R extends string, E extends string | number, D = unknown>(
		payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
	) => string | Buffer<ArrayBufferLike>;
	#authState: AuthState = AuthState.idle;
	#authTimer: ReturnType<typeof setTimeout> | null = null;
	#closed: boolean = false;

	/**
	 * Whether the socket has completed authentication (or auth is disabled).
	 */
	get isAuthenticated(): boolean {
		return this.#authState === AuthState.none || this.#authState === AuthState.success;
	}

	/**
	 * Whether the socket has been closed.
	 */
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

	/** @internal */
	constructor(
		id: string,
		ws: WebSocket<SD>,
		broadcastRoom: string,
		encode: <R extends string, E extends string | number, D = unknown>(
			payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
		) => string | Buffer<ArrayBufferLike>,
	) {
		this.id = id;
		this.#ws = ws;
		this.#broadcastRoom = broadcastRoom;
		this.#encode = encode;

		this.rooms = {
			emitRaw: this.#publishRaw.bind(this),
			emit: this.#publish.bind(this),
			join: this.#joinRoom.bind(this),
			leave: this.#leaveRoom.bind(this),
			list: () => this.#ws.getTopics(),

			bulk: {
				emit: this.#publishMany.bind(this),
				join: this.#joinRooms.bind(this),
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
	sendRaw(payload: RecognizedString): void {
		if (this.#closed) return;
		this.#ws.send(payload);
	}

	/**
	 * Send any lifecycle or user message to this socket.
	 * Automatically encodes according to the configured serialization.
	 *
	 * @internal You typically use `emit()` or `broadcast()` instead.
	 */
	send<R extends string, E extends string | number, D = unknown>(payload: LifecycleMessage<R, D> | UserMessage<R, E, D>) {
		if (this.#closed) return;
		const message = this.#encode(payload);
		this.#ws.send(message);
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
		const isBinary = typeof message !== "string";
		this.#ws.publish(this.#broadcastRoom, message, isBinary);
	}

	#publishRaw(room: string, message: RecognizedString): void {
		const isBinary = typeof message !== "string";
		this.#ws.publish(room, message, isBinary);
	}

	#publish<
		R extends StringKeys<TEvents["emitRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["emitRoom"]>[R]>,
		D extends NonNullable<NonNullable<TEvents["emitRoom"]>[R]>[E],
	>(room: R, event: E, data: D): void {
		if (this.#closed) return;
		const message = this.#encode({ room, event, data });
		const isBinary = typeof message !== "string";
		this.#ws.publish(room, message, isBinary);
	}

	#publishMany<
		Rs extends NonNullable<TEvents["emitRooms"]>["rooms"],
		E extends StringNumberKeys<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>,
		D extends NonNullable<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>[E],
	>(rooms: Rs, event: E, data: D): void {
		if (this.#closed) return;
		const message = this.#encode({ rooms, event, data });
		const isBinary = typeof message !== "string";
		for (const room of rooms) {
			this.#ws.publish(room, message, isBinary);
		}
	}

	/**
	 * Close the WebSocket connection gracefully.
	 *
	 * @param code - WebSocket close code (default `1000`).
	 * @param reason - Close reason string (default `"normal"`).
	 */
	close(code: number = 1000, reason: string = "normal"): void {
		if (this.#closed) return;
		this.#clearAuthTimer();
		this.#closed = true;
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
	_handleAuth<T extends { type: LifecycleTypes.auth; data: unknown } | null>(
		parsed: T,
		auth: AuthFunction<SD> | undefined,
		authTimeout: number,
		broadcastRoom: string,
	) {
		if (auth && parsed !== null) {
			if (this.#authState !== AuthState.idle) return;
			this.#authState = AuthState.pending;
			this.#authTimer = setTimeout(() => {
				if (!this.isClosed && !this.isAuthenticated) this.#setAuthFailed({ phase: "auth", error: new Error("Auth timeout"), code: 4008 });
			}, authTimeout);
			try {
				auth(this, parsed.data, (payload, error) => {
					if (error || payload == null) {
						this.#setAuthFailed({ phase: "auth", error: error || new Error("Auth failed"), code: 4003 });
						return;
					}
					this.rooms.join(broadcastRoom);
					this.#setAuthSuccess(payload);
				});
			} catch (err) {
				this.#setAuthFailed({ phase: "auth", error: err, code: 4003 });
			}
		} else {
			this.#handleNoAuth(broadcastRoom);
		}
	}

	#handleNoAuth(broadcastRoom: string) {
		if (this.#closed) return;
		if (this.#authState !== AuthState.idle) return;
		this.#authState = AuthState.none;
		this.rooms.join(broadcastRoom);
	}

	#setAuthSuccess(payload: unknown): void {
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
		this.send({ type: LifecycleTypes.auth_error, data: ctx.error });
		this.close(ctx.code, ctx.phase);
	}

	#clearAuthTimer(): void {
		if (this.#authTimer) {
			clearTimeout(this.#authTimer);
			this.#authTimer = null;
		}
	}
}
