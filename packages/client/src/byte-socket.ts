// packages/client/src/byte-socket.ts
import {
	AuthState,
	ByteSocketBase,
	LifecycleTypes,
	type ErrorContext,
	type EventsForRooms,
	type LifecycleMessage,
	type SocketEvents,
	type StringKeys,
	type StringNumberKeys,
	type UserMessage,
} from "@bytesocket/core";
import type { IByteSocket, ILifecycle, IRooms, IRoomsBulkLifecycle, IRoomsLifecycle } from "./interfaces";
import type { AuthConfig, ByteSocketOptions, ClientIncomingData, ClientOutgoingData, EventCallback, RoomState } from "./types";

type OptionalOptions = "auth" | "path" | "protocols" | "queryParams";

/**
 * ByteSocket is a WebSocket client with automatic reconnection, room management,
 * authentication, heartbeat, and pluggable serialization (JSON or MessagePack).
 *
 * It provides a fully typed event system via a user-supplied event map (`TEvents`).
 *
 * @typeParam TEvents - A type extending `SocketEvents` that defines the shape of
 *                      all emit/listen events (global and room-scoped).
 *
 * @example Symmetric events (most common)
 * ```ts
 * // Define your event map
 * type MyEvents = SocketEvents<{
 *   "chat:message": { text: string };
 *   "user:joined": { userId: string };
 * }>;
 *
 * // Create a typed socket instance
 * const socket = new ByteSocket<MyEvents>('wss://example.com/socket', {
 *   debug: true,
 *   auth: { data: { token: 'abc123' } }
 * });
 *
 * // Use typed methods (emit and listen share the same event map)
 * socket.emit('chat:message', { text: 'Hello!' });
 * socket.on('user:joined', (data) => console.log(data.userId));
 *
 * socket.rooms.join('lobby');
 * socket.rooms.emit('lobby', 'chat:message', { text: 'Hi everyone' });
 * socket.rooms.on('lobby', 'chat:message', (data) => {
 *   console.log(`Message: ${data.text}`);
 * });
 * ```
 *
 * @example Asymmetric events (full control via interface extension)
 * ```ts
 * // Extend SocketEvents to differentiate emit/listen/room maps
 * interface MyEvents extends SocketEvents {
 *   emit: {
 *     "message:send": { text: string };
 *     "ping": void;
 *   };
 *   listen: {
 *     "message:receive": { text: string; sender: string };
 *     "pong": number;
 *   };
 *   emitRoom: {
 *     chat: { "message": { text: string } };
 *     dm:   { "message": { text: string; recipient: string } };
 *   };
 *   listenRoom: {
 *     chat: { "message": { text: string; sender: string } };
 *   };
 *   emitRooms:
 *     | { rooms: ['lobby', 'announcements']; event: { 'alert': string } }
 *     | { rooms: ['roomA', 'roomB']; event: { 'message': { text: string } } };
 * }
 *
 * const socket = new ByteSocket<MyEvents>('wss://example.com/socket', {
 *   debug: true,
 *   auth: { data: { token: 'abc123' } }
 * });
 *
 * // Global emits/listens
 * socket.emit('ping', undefined);
 * socket.on('message:receive', (data) => console.log(`${data.sender}: ${data.text}`));
 *
 * // Room-specific emits/listens
 * socket.rooms.join('chat');
 * socket.rooms.emit('chat', 'message', { text: 'Hello!' });
 * socket.rooms.on('chat', 'message', (data) => {
 *   console.log(`${data.sender}: ${data.text}`);
 * });
 * ```
 */
export class ByteSocket<TEvents extends SocketEvents = SocketEvents> extends ByteSocketBase implements IByteSocket<TEvents> {
	// ──── Namespaces ────────────────────────────────────────────────────────────────────────

	readonly lifecycle: ILifecycle;
	readonly rooms: IRooms<TEvents>;

	// ──── States ────────────────────────────────────────────────────────────────────────

	#baseUrl: string;
	#options: Omit<Required<ByteSocketOptions>, OptionalOptions | "debug" | "serialization" | "msgpackrOptions"> &
		Pick<ByteSocketOptions, OptionalOptions>;
	#ws: WebSocket | null = null;
	#authState: AuthState = AuthState.idle;
	#messageQueue: Array<ClientOutgoingData> = [];
	#reconnectAttempts: number = 0;
	#flushFailures: number = 0;
	#roomStateMap = new Map<string, RoomState>();

	// ──── Flags ────────────────────────────────────────────────────────────────────────

	#manuallyClosed: boolean = false;
	#flushing: boolean = false;
	#destroyed: boolean = false;
	#reconnecting: boolean = false;
	#reconnectExhausted: boolean = false;

	// ──── Timers ────────────────────────────────────────────────────────────────────────

	#authTimer: ReturnType<typeof setTimeout> | null = null;
	#pingTimer: ReturnType<typeof setInterval> | null = null;
	#pongTimer: ReturnType<typeof setTimeout> | null = null;
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Creates a new ByteSocket instance.
	 *
	 * @param baseUrl - WebSocket URL (e.g., `wss://example.com/socket` or relative `"/socket"`).
	 * @param options - Configuration options.
	 */
	constructor(baseUrl: string, options: ByteSocketOptions = {}) {
		super(options);

		this.#baseUrl = baseUrl;

		this.#options = {
			...options,
			autoConnect: options.autoConnect ?? true,
			reconnection: options.reconnection ?? true,
			maxReconnectionAttempts: options.maxReconnectionAttempts ?? Infinity,
			reconnectionDelay: options.reconnectionDelay ?? 1000,
			reconnectionDelayMax: options.reconnectionDelayMax ?? 5000,
			reconnectOnNormalClosure: options.reconnectOnNormalClosure ?? true,
			authTimeout: options.authTimeout ?? 5000,
			maxQueueSize: options.maxQueueSize ?? 100,
			randomizationFactor: options.randomizationFactor != null ? Math.max(0, Math.min(1, options.randomizationFactor)) : 0.5,
			pingInterval: options.pingInterval ?? 50000,
			pingTimeout: options.pingTimeout ?? 40000,
			heartbeatEnabled: options.heartbeatEnabled ?? true,
		};

		if (this.#options.pingTimeout >= this.#options.pingInterval) {
			if (this._debug) {
				console.warn(
					`ByteSocket: pingTimeout (${this.#options.pingTimeout}ms) should be less than pingInterval (${this.#options.pingInterval}ms).`,
				);
			}
		} else if (this.#options.pingTimeout > this.#options.pingInterval * 0.8) {
			if (this._debug) {
				console.warn(
					`ByteSocket: pingTimeout (${this.#options.pingTimeout}ms) is close to pingInterval (${this.#options.pingInterval}ms). ` +
						`Consider a larger gap to avoid overlapping timers.`,
				);
			}
		}

		const lifecycle: ILifecycle = {
			onOpen: (callback) => {
				this._onLifecycle(LifecycleTypes.open, callback);
				return lifecycle;
			},
			offOpen: (callback) => {
				this._offLifecycle(LifecycleTypes.open, callback);
				return lifecycle;
			},
			onceOpen: (callback) => {
				this._onceLifecycle(LifecycleTypes.open, callback);
				return lifecycle;
			},

			onMessage: (callback) => {
				this._onLifecycle(LifecycleTypes.message, callback);
				return lifecycle;
			},
			offMessage: (callback) => {
				this._offLifecycle(LifecycleTypes.message, callback);
				return lifecycle;
			},
			onceMessage: (callback) => {
				this._onceLifecycle(LifecycleTypes.message, callback);
				return lifecycle;
			},

			onClose: (callback) => {
				this._onLifecycle(LifecycleTypes.close, callback);
				return lifecycle;
			},
			offClose: (callback) => {
				this._offLifecycle(LifecycleTypes.close, callback);
				return lifecycle;
			},
			onceClose: (callback) => {
				this._onceLifecycle(LifecycleTypes.close, callback);
				return lifecycle;
			},

			onError: (callback) => {
				this._onLifecycle(LifecycleTypes.error, callback);
				return lifecycle;
			},
			offError: (callback) => {
				this._offLifecycle(LifecycleTypes.error, callback);
				return lifecycle;
			},
			onceError: (callback) => {
				this._onceLifecycle(LifecycleTypes.error, callback);
				return lifecycle;
			},

			onAuthSuccess: (callback) => {
				this._onLifecycle(LifecycleTypes.auth_success, callback);
				return lifecycle;
			},
			offAuthSuccess: (callback) => {
				this._offLifecycle(LifecycleTypes.auth_success, callback);
				return lifecycle;
			},
			onceAuthSuccess: (callback) => {
				this._onceLifecycle(LifecycleTypes.auth_success, callback);
				return lifecycle;
			},

			onAuthError: (callback) => {
				this._onLifecycle(LifecycleTypes.auth_error, callback);
				return lifecycle;
			},
			offAuthError: (callback) => {
				this._offLifecycle(LifecycleTypes.auth_error, callback);
				return lifecycle;
			},
			onceAuthError: (callback) => {
				this._onceLifecycle(LifecycleTypes.auth_error, callback);
				return lifecycle;
			},

			onQueueFull: (callback) => {
				this._onLifecycle(LifecycleTypes.queue_full, callback);
				return lifecycle;
			},
			offQueueFull: (callback) => {
				this._offLifecycle(LifecycleTypes.queue_full, callback);
				return lifecycle;
			},
			onceQueueFull: (callback) => {
				this._onceLifecycle(LifecycleTypes.queue_full, callback);
				return lifecycle;
			},

			onReconnectFailed: (callback) => {
				this._onLifecycle(LifecycleTypes.reconnect_failed, callback);
				return lifecycle;
			},
			offReconnectFailed: (callback) => {
				this._offLifecycle(LifecycleTypes.reconnect_failed, callback);
				return lifecycle;
			},
			onceReconnectFailed: (callback) => {
				this._onceLifecycle(LifecycleTypes.reconnect_failed, callback);
				return lifecycle;
			},
		};

		this.lifecycle = lifecycle;

		const roomsLifecycle: IRoomsLifecycle = {
			onJoinSuccess: (callback) => {
				this._onLifecycle(LifecycleTypes.join_room_success, callback);
				return roomsLifecycle;
			},
			offJoinSuccess: (callback) => {
				this._offLifecycle(LifecycleTypes.join_room_success, callback);
				return roomsLifecycle;
			},
			onceJoinSuccess: (callback) => {
				this._onceLifecycle(LifecycleTypes.join_room_success, callback);
				return roomsLifecycle;
			},

			onJoinError: (callback) => {
				this._onLifecycle(LifecycleTypes.join_room_error, callback);
				return roomsLifecycle;
			},
			offJoinError: (callback) => {
				this._offLifecycle(LifecycleTypes.join_room_error, callback);
				return roomsLifecycle;
			},
			onceJoinError: (callback) => {
				this._onceLifecycle(LifecycleTypes.join_room_error, callback);
				return roomsLifecycle;
			},

			onLeaveSuccess: (callback) => {
				this._onLifecycle(LifecycleTypes.leave_room_success, callback);
				return roomsLifecycle;
			},
			offLeaveSuccess: (callback) => {
				this._offLifecycle(LifecycleTypes.leave_room_success, callback);
				return roomsLifecycle;
			},
			onceLeaveSuccess: (callback) => {
				this._onceLifecycle(LifecycleTypes.leave_room_success, callback);
				return roomsLifecycle;
			},

			onLeaveError: (callback) => {
				this._onLifecycle(LifecycleTypes.leave_room_error, callback);
				return roomsLifecycle;
			},
			offLeaveError: (callback) => {
				this._offLifecycle(LifecycleTypes.leave_room_error, callback);
				return roomsLifecycle;
			},
			onceLeaveError: (callback) => {
				this._onceLifecycle(LifecycleTypes.leave_room_error, callback);
				return roomsLifecycle;
			},
		};

		const roomsBulkLifecycle: IRoomsBulkLifecycle = {
			onJoinSuccess: (callback) => {
				this._onLifecycle(LifecycleTypes.join_rooms_success, callback);
				return roomsBulkLifecycle;
			},
			offJoinSuccess: (callback) => {
				this._offLifecycle(LifecycleTypes.join_rooms_success, callback);
				return roomsBulkLifecycle;
			},
			onceJoinSuccess: (callback) => {
				this._onceLifecycle(LifecycleTypes.join_rooms_success, callback);
				return roomsBulkLifecycle;
			},

			onJoinError: (callback) => {
				this._onLifecycle(LifecycleTypes.join_rooms_error, callback);
				return roomsBulkLifecycle;
			},
			offJoinError: (callback) => {
				this._offLifecycle(LifecycleTypes.join_rooms_error, callback);
				return roomsBulkLifecycle;
			},
			onceJoinError: (callback) => {
				this._onceLifecycle(LifecycleTypes.join_rooms_error, callback);
				return roomsBulkLifecycle;
			},

			onLeaveSuccess: (callback) => {
				this._onLifecycle(LifecycleTypes.leave_rooms_success, callback);
				return roomsBulkLifecycle;
			},
			offLeaveSuccess: (callback) => {
				this._offLifecycle(LifecycleTypes.leave_rooms_success, callback);
				return roomsBulkLifecycle;
			},
			onceLeaveSuccess: (callback) => {
				this._onceLifecycle(LifecycleTypes.leave_rooms_success, callback);
				return roomsBulkLifecycle;
			},

			onLeaveError: (callback) => {
				this._onLifecycle(LifecycleTypes.leave_rooms_error, callback);
				return roomsBulkLifecycle;
			},
			offLeaveError: (callback) => {
				this._offLifecycle(LifecycleTypes.leave_rooms_error, callback);
				return roomsBulkLifecycle;
			},
			onceLeaveError: (callback) => {
				this._onceLifecycle(LifecycleTypes.leave_rooms_error, callback);
				return roomsBulkLifecycle;
			},
		};

		this.rooms = {
			list: this.#listRooms.bind(this),
			emit: this.#emitRoom.bind(this),
			join: this.#joinRoom.bind(this),
			leave: this.#leaveRoom.bind(this),
			on: this.#onRoom.bind(this),
			off: this.#offRoom.bind(this),
			once: this.#onceRoom.bind(this),
			lifecycle: roomsLifecycle,

			bulk: {
				emit: this.#emitRooms.bind(this),
				join: this.#joinRooms.bind(this),
				leave: this.#leaveRooms.bind(this),
				lifecycle: roomsBulkLifecycle,
			},
		};

		if (this.#options.autoConnect) {
			this.connect();
		}
	}

	// ──── Getters ────────────────────────────────────────────────────────────────────────

	get readyState(): number {
		return this.#ws?.readyState ?? WebSocket.CLOSED;
	}

	get canSend(): boolean {
		return this.readyState === WebSocket.OPEN && (this.#authState === AuthState.none || this.#authState === AuthState.success);
	}
	get isClosed(): boolean {
		return this.#manuallyClosed || this.#destroyed || this.#reconnectExhausted;
	}
	get isConnected(): boolean {
		return this.readyState === WebSocket.OPEN;
	}

	// ──── Emits ────────────────────────────────────────────────────────────────────────

	#trySend(message: ClientOutgoingData): boolean {
		if (!this.#ws || this.readyState !== WebSocket.OPEN) {
			return false;
		}
		try {
			this.#ws.send(message);
			return true;
		} catch (err) {
			if (this._debug) {
				console.warn("ByteSocket: send failed", err);
			}
			return false;
		}
	}

	#enqueue(message: ClientOutgoingData): void {
		if (this.#messageQueue.length < this.#options.maxQueueSize) {
			this.#messageQueue.push(message);
		} else {
			if (this._debug) {
				console.warn(`ByteSocket: message queue full (${this.#options.maxQueueSize}), dropping message`);
			}
			this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.queue_full));
		}
	}

	#sendOrQueue(message: ClientOutgoingData): void {
		if (this.canSend && !this.#flushing) {
			const sent = this.#trySend(message);
			if (sent) {
				return;
			}
		}
		this.#enqueue(message);
	}

	send<R extends string, E extends string | number, D>(payload: LifecycleMessage<R, D> | UserMessage<R, E, D>): this {
		if (!this.#isOperational()) {
			return this;
		}
		const message = this.encode(payload);
		this.#sendOrQueue(message);
		return this;
	}

	sendRaw(message: ClientOutgoingData): this {
		if (!this.#isOperational()) {
			return this;
		}
		if (this.readyState === WebSocket.OPEN && !this.#flushing) {
			const sent = this.#trySend(message);
			if (sent) {
				return this;
			}
		}
		this.#enqueue(message);
		return this;
	}

	emit<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): this {
		this.send({ event, data });
		return this;
	}

	#sendAuthPayload(data: unknown): void {
		if (this.readyState !== WebSocket.OPEN) {
			if (this._debug) {
				console.warn("ByteSocket: cannot send auth, socket not open");
			}
			this.#handleAuthError(new Error("Auth failed: socket not open"), false);
			return;
		}
		const message = this.encode({ type: LifecycleTypes.auth, data });
		const sent = this.#trySend(message);
		if (!sent) {
			if (this._debug) {
				console.warn("ByteSocket: auth send failed");
			}
			this.#handleAuthError(new Error("Auth send failed"), false);
		} else {
			if (this._debug) {
				console.log("ByteSocket: auth payload sent");
			}
		}
	}

	// ──── Queue Flushing ────────────────────────────────────────────────────────────────────────

	#flushQueue(): void {
		if (this.#flushing) {
			return;
		}
		this.#flushing = true;
		try {
			while (this.#messageQueue.length > 0 && this.canSend && this.#isOperational()) {
				const message = this.#messageQueue.shift();
				if (message !== undefined) {
					const sent = this.#trySend(message);
					if (!sent) {
						this.#messageQueue.unshift(message);
						break;
					}
					this.#flushFailures = 0;
				}
			}
		} finally {
			this.#flushing = false;
			if (this.#messageQueue.length > 0 && this.canSend && this.#isOperational()) {
				queueMicrotask(() => {
					if (this.#flushFailures++ > 10) {
						this.#flushFailures = 0;
						return;
					}
					this.#flushQueue();
				});
			} else {
				this.#flushFailures = 0;
			}
		}
	}

	// ──── Listeners ────────────────────────────────────────────────────────────────────────

	on<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback: EventCallback<D>): this {
		this._on(event, callback);
		return this;
	}

	off<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback?: EventCallback<D>): this {
		this._off(event, callback);
		return this;
	}

	once<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback: EventCallback<D>): this {
		this._once(event, callback);
		return this;
	}

	// ──── Helpers ────────────────────────────────────────────────────────────────────────

	#isOperational(): boolean {
		if (this.#destroyed) {
			return false;
		}
		if (this.#manuallyClosed) {
			if (this._debug) {
				console.warn("ByteSocket: send() called after close() -- message dropped");
			}
			return false;
		}
		if (this.#authState === AuthState.failed) {
			if (this._debug) {
				console.warn("ByteSocket: send() called after auth_failed -- message dropped");
			}
			return false;
		}
		return true;
	}

	// ──── URL Building ────────────────────────────────────────────────────────────────────────

	#buildUrlBase(): string {
		let base = this.#baseUrl;
		if (base.startsWith("/")) {
			const origin = globalThis?.location?.origin;
			if (typeof origin === "string") {
				base = origin + base;
			} else {
				throw new Error(
					"ByteSocket: Relative URLs (starting with '/') are only supported in browser environments. " +
						"Provide a full URL like ws:// or wss://.",
				);
			}
		}
		return base;
	}

	#buildUrlProtocol(base: string): string {
		const hasWsProtocol = base.startsWith("ws://") || base.startsWith("wss://");
		if (!hasWsProtocol) {
			if (base.startsWith("http://") || base.startsWith("https://")) {
				base = base.replace(/^http/, "ws");
			} else {
				throw new Error(
					`ByteSocket: Invalid base URL "${base}". ` + `Must start with ws://, wss://, or (in browser) a relative path like "/socket".`,
				);
			}
		}
		return base;
	}

	#buildUrlPathname(url: URL): URL {
		if (this.#options.path) {
			url.pathname = url.pathname.replace(/\/$/, "") + "/" + this.#options.path.replace(/^\/+/, "");
		}
		return url;
	}

	#buildUrlQueryParams(url: URL): URL {
		if (this.#options.queryParams) {
			for (const [key, value] of Object.entries(this.#options.queryParams)) {
				url.searchParams.set(key, value);
			}
		}
		return url;
	}

	#buildFullUrl(): string {
		let base = this.#buildUrlBase();
		base = this.#buildUrlProtocol(base);
		let url = new URL(base);
		url = this.#buildUrlPathname(url);
		url = this.#buildUrlQueryParams(url);
		return url.toString();
	}

	// ──── Auth ────────────────────────────────────────────────────────────────────────

	setAuth<D>(config: AuthConfig<D> | undefined): this {
		if (this.#destroyed) {
			throw new Error("ByteSocket: cannot call setAuth() after destroy().");
		}
		if (this.#ws !== null && this.readyState !== WebSocket.CLOSED) {
			throw new Error("ByteSocket: auth cannot be changed after connect() has been called.");
		}
		this.#options.auth = config;
		return this;
	}

	#startAuthTimeout(): void {
		this.#authTimer = setTimeout(() => {
			if (this.#authState === AuthState.pending && this.readyState === WebSocket.OPEN) {
				if (this._debug) {
					console.warn("ByteSocket: auth timeout");
				}
				this.#authState = AuthState.failed;
				this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.auth_error), { reason: "timeout" });
				this.#ws?.close(4002, "Auth timeout");
			}
		}, this.#options.authTimeout);
	}

	#clearAuthTimeout(): void {
		if (this.#authTimer) {
			clearTimeout(this.#authTimer);
			this.#authTimer = null;
		}
	}

	#handleAuthSuccess(): void {
		this.#authState = AuthState.success;
		this.#clearAuthTimeout();
		this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.auth_success));
		this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.open));
		this.#onRoomsOpen();
		this.#startHeartbeat();
		this.#flushQueue();
	}

	#handleAuthError<T>(err: T, permanent = true): void {
		this.#clearAuthTimeout();
		if (permanent) {
			this.#messageQueue = [];
			this.#authState = AuthState.failed;
			this.#ws?.close(4001, "Authentication failed");
		} else {
			this.#authState = AuthState.idle;
		}
		this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.auth_error), err);
	}

	#authenticate<D>(config: AuthConfig<D>): void {
		this.#authState = AuthState.pending;
		this.#startAuthTimeout();
		if (typeof config === "function") {
			try {
				config((data) => {
					try {
						this.#sendAuthPayload(data);
					} catch (error) {
						this.#handleAuthError(error);
					}
				});
			} catch (error) {
				this.#handleAuthError(error);
			}
		} else {
			this.#sendAuthPayload(config.data);
		}
	}

	// ──── Rooms ────────────────────────────────────────────────────────────────────────

	#emitRoom<
		R extends StringKeys<TEvents["emitRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["emitRoom"]>[R]>,
		D extends NonNullable<TEvents["emitRoom"]>[R][E],
	>(room: R, event: E, data: D): typeof this.rooms {
		this.send({ room, event, data });
		return this.rooms;
	}

	#joinRoom(room: string): typeof this.rooms {
		const state = this.#getOrCreateRoomState(room);
		if (state.joined || state.pending === "join") {
			return this.rooms;
		}
		state.wanted = true;
		state.pending = "join";
		this.send({ type: LifecycleTypes.join_room, room });
		return this.rooms;
	}

	#leaveRoom(room: string): typeof this.rooms {
		const state = this.#getOrCreateRoomState(room);
		if (!state.joined || state.pending === "leave") {
			return this.rooms;
		}
		state.wanted = false;
		state.pending = "leave";
		this.send({ type: LifecycleTypes.leave_room, room });
		return this.rooms;
	}

	#emitRooms<
		Rs extends NonNullable<TEvents["emitRooms"]>["rooms"],
		E extends StringNumberKeys<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>,
		D extends NonNullable<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>[E],
	>(rooms: Rs, event: E, data: D): typeof this.rooms.bulk {
		this.send({ rooms, event, data });
		return this.rooms.bulk;
	}

	#joinRooms(rooms: string[]): typeof this.rooms.bulk {
		if (rooms.length === 0) {
			if (this._debug) {
				console.warn("ByteSocket: can't join empty array of rooms - ignored");
			}
			return this.rooms.bulk;
		}
		const toJoin = [];
		for (const room of rooms) {
			const state = this.#getOrCreateRoomState(room);
			if (state.joined || state.pending === "join") {
				continue;
			}
			state.wanted = true;
			state.pending = "join";
			toJoin.push(room);
		}
		if (toJoin.length === 0) {
			if (this._debug) {
				console.warn("ByteSocket: all rooms you requested to join are joined or pending joining already - ignored");
			}
			return this.rooms.bulk;
		}
		this.send({ type: LifecycleTypes.join_rooms, rooms: toJoin });
		return this.rooms.bulk;
	}

	#leaveRooms(rooms: string[]): typeof this.rooms.bulk {
		if (rooms.length === 0) {
			if (this._debug) {
				console.warn("ByteSocket: can't leave empty array of rooms - ignored");
			}
			return this.rooms.bulk;
		}
		const toLeave = [];
		for (const room of rooms) {
			const state = this.#getOrCreateRoomState(room);
			if (!state.joined || state.pending === "leave") {
				continue;
			}
			state.wanted = false;
			state.pending = "leave";
			toLeave.push(room);
		}
		if (toLeave.length === 0) {
			if (this._debug) {
				console.warn("ByteSocket: all rooms you requested to leave are left or pending leaving already - ignored");
			}
			return this.rooms.bulk;
		}
		this.send({ type: LifecycleTypes.leave_rooms, rooms: toLeave });
		return this.rooms.bulk;
	}

	#listRooms() {
		return [...this.#roomStateMap].filter(([_room, state]) => state.joined).map(([room]) => room);
	}

	#onRoom<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: EventCallback<D>): typeof this.rooms {
		this._onRoom(room, event, callback);
		return this.rooms;
	}

	#offRoom<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event?: E, callback?: EventCallback<D>): typeof this.rooms {
		this._offRoom(room, event, callback);
		return this.rooms;
	}

	#onceRoom<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: EventCallback<D>): typeof this.rooms {
		this._onceRoom(room, event, callback);
		return this.rooms;
	}

	#getOrCreateRoomState(room: string): RoomState {
		let state = this.#roomStateMap.get(room);
		if (!state) {
			state = { wanted: false, joined: false, pending: null };
			this.#roomStateMap.set(room, state);
		}
		return state;
	}

	#cleanRoomState(room: string): void {
		const state = this.#roomStateMap.get(room);
		if (!state) {
			return;
		}
		if (state.wanted === false && state.joined === false && state.pending === null) {
			this.#roomStateMap.delete(room);
		}
	}

	#onRoomsOpen(): void {
		const rooms: string[] = [];
		const toClean: string[] = [];
		for (const [room, state] of this.#roomStateMap) {
			if (state.wanted && !state.joined) {
				state.pending = "join";
				rooms.push(room);
			} else if (!state.wanted && state.joined) {
				state.pending = null;
				state.joined = false;
				toClean.push(room);
			}
		}
		for (const room of toClean) {
			this.#cleanRoomState(room);
		}
		if (rooms.length === 0) {
			return;
		}
		if (rooms.length === 1) {
			this.send({ type: LifecycleTypes.join_room, room: rooms[0] });
		} else {
			this.send({ type: LifecycleTypes.join_rooms, rooms });
		}
	}

	#onRoomsClose(): void {
		for (const state of this.#roomStateMap.values()) {
			state.joined = false;
			state.pending = null;
		}
	}

	// ──── Heartbeat ────────────────────────────────────────────────────────────────────────

	#startHeartbeat(): void {
		if (!this.#options.heartbeatEnabled) {
			return;
		}
		if (this._debug) {
			console.log("ByteSocket: start heartbeat");
		}
		this.#clearPongTimeout();
		this.#startPingInterval();
	}

	#stopHeartbeat(): void {
		if (this._debug) {
			console.log("ByteSocket: stop heartbeat");
		}
		this.#clearPingInterval();
		this.#clearPongTimeout();
	}

	#startPingInterval() {
		if (this.#pingTimer) {
			clearInterval(this.#pingTimer);
		}
		this.#pingTimer = setInterval(() => {
			if (this.canSend) {
				this.#ws?.send(new Uint8Array(0));
				if (this._debug) {
					console.log("ByteSocket: ping sent");
				}
				this.#startPongTimeout();
			}
		}, this.#options.pingInterval);
	}

	#clearPingInterval() {
		if (this.#pingTimer) {
			clearInterval(this.#pingTimer);
			this.#pingTimer = null;
		}
	}

	#startPongTimeout() {
		if (this.#pongTimer) {
			clearTimeout(this.#pongTimer);
		}
		this.#pongTimer = setTimeout(() => {
			if (this._debug) {
				console.warn("ByteSocket: pong timeout, closing connection");
			}
			if (this.readyState === WebSocket.OPEN) {
				this.#ws?.close(4003, "Pong timeout");
			}
		}, this.#options.pingTimeout);
	}

	#clearPongTimeout() {
		if (this.#pongTimer) {
			clearTimeout(this.#pongTimer);
			this.#pongTimer = null;
		}
	}

	// ──── Connection Lifecycle ────────────────────────────────────────────────────────────────────────

	connect(): this {
		if (this.#destroyed) {
			if (this._debug) {
				console.warn("ByteSocket: connect() called after destroy()");
			}
			return this;
		}
		if (this.readyState === WebSocket.OPEN || this.readyState === WebSocket.CONNECTING) {
			if (this._debug) {
				console.warn("ByteSocket: already connected or connecting");
			}
			return this;
		}
		this.#cleanupConnection(true);
		this.#authState = AuthState.idle;
		this.#manuallyClosed = false;
		this.#createSocket();
		return this;
	}

	#createSocket(): void {
		const url = this.#buildFullUrl();
		this.#ws = new WebSocket(url, this.#options.protocols);
		this.#ws.binaryType = "arraybuffer";

		this.#ws.onopen = this.#onopen.bind(this);
		this.#ws.onmessage = this.#onmessage.bind(this);
		this.#ws.onclose = this.#onclose.bind(this);
		this.#ws.onerror = this.#onerror.bind(this);
	}

	#onopen(): void {
		if (this._debug) {
			console.log("ByteSocket: connected");
		}
		this.#reconnecting = false;
		this.#reconnectAttempts = 0;
		this.#authState = AuthState.idle;
		if (this.#options.auth) {
			this.#authenticate(this.#options.auth);
		} else {
			this.#authState = AuthState.none;
			this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.open));
			this.#onRoomsOpen();
			this.#startHeartbeat();
			this.#flushQueue();
		}
	}

	// ──── Message Handling ────────────────────────────────────────────────────────────────────────

	#parseMessage(message: MessageEvent): { success: true; payload: unknown } | { success: false; payload?: never } {
		if (message.data instanceof Blob) {
			if (this._debug) {
				console.warn("ByteSocket: received unexpected Blob message. Ensure binaryType is 'arraybuffer'.");
			}
			return { success: false };
		}
		try {
			const payload = this.decode(message.data);
			return { success: true, payload };
		} catch (error) {
			if (this._debug) {
				console.error("ByteSocket: decode error", error);
			}
			this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), error);
			return { success: false };
		}
	}

	#handleAuthSuccessMessage(payload: unknown): boolean {
		if (!this._isLifecycleMessage(LifecycleTypes.auth_success, payload)) {
			return false;
		}
		if (this._debug) {
			console.log("ByteSocket: auth success");
		}
		this.#handleAuthSuccess();
		return true;
	}

	#handleErrorMessage(payload: unknown): boolean {
		if (!this._isLifecyclePayloadMessage(LifecycleTypes.error, payload)) {
			return false;
		}
		if (this._debug) {
			console.warn("ByteSocket: error", payload.data);
		}
		this._triggerCallbacks(this._lifecycleCallbacksMap.get(payload.type), payload.data);
		return true;
	}

	#handleAuthErrorMessage(payload: unknown): boolean {
		if (!this._isLifecyclePayloadMessage(LifecycleTypes.auth_error, payload)) {
			return false;
		}
		if (this._debug) {
			console.warn("ByteSocket: auth error", payload.data);
		}
		this.#handleAuthError(payload.data);
		return true;
	}

	#handleJoinRoomSuccessMessage(payload: unknown): boolean {
		if (!this._isLifecycleRoomMessage(LifecycleTypes.join_room_success, payload)) {
			return false;
		}
		const state = this.#roomStateMap.get(payload.room);
		if (!state) {
			if (this._debug) {
				console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${payload.room}" - ignored`);
			}
			return true;
		}
		state.joined = true;
		state.pending = null;
		this._triggerCallbacks(this._lifecycleCallbacksMap.get(payload.type), payload.room);
		return true;
	}

	#handleLeaveRoomSuccessMessage(payload: unknown): boolean {
		if (!this._isLifecycleRoomMessage(LifecycleTypes.leave_room_success, payload)) {
			return false;
		}
		const state = this.#roomStateMap.get(payload.room);
		if (!state) {
			if (this._debug) {
				console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${payload.room}" - ignored`);
			}
			return true;
		}
		state.joined = false;
		state.pending = null;
		this.#cleanRoomState(payload.room);
		this._triggerCallbacks(this._lifecycleCallbacksMap.get(payload.type), payload.room);
		return true;
	}

	#handleRoomErrorMessage(payload: unknown): boolean {
		if (!this._isLifecycleRoomErrorMessage(payload)) {
			return false;
		}
		const state = this.#roomStateMap.get(payload.room);
		if (!state) {
			if (this._debug) {
				console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${payload.room}" - ignored`);
			}
			return true;
		}
		state.pending = null;
		this._triggerCallbacks(this._lifecycleCallbacksMap.get(payload.type), payload.room, payload.data);
		return true;
	}

	#handleJoinRoomsSuccessMessage(payload: unknown): boolean {
		if (!this._isLifecycleRoomsMessage(LifecycleTypes.join_rooms_success, payload)) {
			return false;
		}
		const staleRooms = [];
		const actualRooms = [];
		for (const room of payload.rooms) {
			const state = this.#roomStateMap.get(room);
			if (!state) {
				staleRooms.push(room);
				continue;
			}
			state.joined = true;
			state.pending = null;
			actualRooms.push(room);
		}
		if (this._debug && staleRooms.length) {
			console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${staleRooms.join(", ")}" - ignored`);
		}
		if (actualRooms.length === 0) {
			return true;
		}
		this._triggerCallbacks(this._lifecycleCallbacksMap.get(payload.type), actualRooms);
		return true;
	}

	#handleLeaveRoomsSuccessMessage(payload: unknown): boolean {
		if (!this._isLifecycleRoomsMessage(LifecycleTypes.leave_rooms_success, payload)) {
			return false;
		}
		const staleRooms = [];
		const actualRooms = [];
		for (const room of payload.rooms) {
			const state = this.#roomStateMap.get(room);
			if (!state) {
				staleRooms.push(room);
				continue;
			}
			state.joined = false;
			state.pending = null;
			actualRooms.push(room);
			this.#cleanRoomState(room);
		}
		if (this._debug && staleRooms.length) {
			console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${staleRooms.join(", ")}" - ignored`);
		}
		if (actualRooms.length === 0) {
			return true;
		}
		this._triggerCallbacks(this._lifecycleCallbacksMap.get(payload.type), actualRooms);
		return true;
	}

	#handleRoomsErrorMessage(payload: unknown): boolean {
		if (!this._isLifecycleRoomsErrorMessage(payload)) {
			return false;
		}
		const staleRooms = [];
		const actualRooms = [];
		for (const room of payload.rooms) {
			const state = this.#roomStateMap.get(room);
			if (!state) {
				staleRooms.push(room);
				continue;
			}
			state.pending = null;
			actualRooms.push(room);
		}
		if (this._debug && staleRooms.length) {
			console.warn(`ByteSocket: stale ${LifecycleTypes[payload.type]} for "${staleRooms.join(", ")}" - ignored`);
		}
		if (actualRooms.length === 0) {
			return true;
		}
		this._triggerCallbacks(this._lifecycleCallbacksMap.get(payload.type), actualRooms, payload.data);
		return true;
	}

	#handleRoomsEventMessage(payload: unknown): boolean {
		if (!this._isRoomsEventMessage(payload)) {
			return false;
		}
		for (const room of payload.rooms) {
			this._triggerCallbacks(this._roomCallbacksMap.get(room)?.get(payload.event), payload.data);
		}
		return true;
	}

	#handleRoomEventMessage(payload: unknown): boolean {
		if (!this._isRoomEventMessage(payload)) {
			return false;
		}
		this._triggerCallbacks(this._roomCallbacksMap.get(payload.room)?.get(payload.event), payload.data);
		return true;
	}

	#handleEventMessage(payload: unknown): boolean {
		if (!this._isEventMessage(payload)) {
			return false;
		}
		this._triggerCallbacks(this._callbacksMap.get(payload.event), payload.data);
		return true;
	}

	#onmessage(message: MessageEvent<ClientIncomingData>): void {
		if (message.data instanceof ArrayBuffer && message.data.byteLength === 0) {
			if (this._debug) {
				console.log("ByteSocket: pong received (empty binary)");
			}
			this.#clearPongTimeout();
			return;
		}

		this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.message), message.data);

		const { success, payload } = this.#parseMessage(message);
		if (!success) {
			return;
		}
		if (this.#handleAuthSuccessMessage(payload)) {
			return;
		}
		if (this.#handleAuthErrorMessage(payload)) {
			return;
		}
		if (this.#handleErrorMessage(payload)) {
			return;
		}
		if (this.#handleJoinRoomSuccessMessage(payload)) {
			return;
		}
		if (this.#handleLeaveRoomSuccessMessage(payload)) {
			return;
		}
		if (this.#handleRoomErrorMessage(payload)) {
			return;
		}
		if (this.#handleJoinRoomsSuccessMessage(payload)) {
			return;
		}
		if (this.#handleLeaveRoomsSuccessMessage(payload)) {
			return;
		}
		if (this.#handleRoomsErrorMessage(payload)) {
			return;
		}
		if (this.#handleRoomsEventMessage(payload)) {
			return;
		}
		if (this.#handleRoomEventMessage(payload)) {
			return;
		}
		if (this.#handleEventMessage(payload)) {
			return;
		}

		if (this._debug) {
			console.warn("ByteSocket: unhandled message", payload);
		}
	}

	// ──── Reconnection ────────────────────────────────────────────────────────────────────────

	reconnect(): this {
		if (this.#destroyed) {
			if (this._debug) {
				console.warn("ByteSocket: reconnect() called after destroy()");
			}
			return this;
		}
		this.#cleanupConnection(true);
		this.#reconnectAttempts = 0;
		this.#authState = AuthState.idle;
		this.#reconnectExhausted = false;
		this.#manuallyClosed = false;
		this.#reconnecting = true;
		if (this.#ws && this.readyState !== WebSocket.CLOSED) {
			this.#ws.close(4100, "Client reconnect");
		} else {
			this.#reconnecting = false;
			this.#createSocket();
		}
		return this;
	}

	#clearReconnectTimeout(): void {
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}
	}

	// ──── Close / Destroy ────────────────────────────────────────────────────────────────────────

	close(code?: number, reason?: string): this {
		if (this.#destroyed) {
			return this;
		}
		this.#manuallyClosed = true;
		this.#cleanupConnection(true);
		this.#ws?.close(code, reason);
		return this;
	}

	destroy(): void {
		if (this.#destroyed) {
			return;
		}
		this.#manuallyClosed = true;
		this.#cleanupConnection(false);
		this.#destroyed = true;
		if (this.#ws) {
			this.#ws.close(1000, "Destroyed");
			this.#ws.onopen = null;
			this.#ws.onmessage = null;
			this.#ws.onclose = null;
			this.#ws.onerror = null;
		}
		this.#ws = null;
		this._clearCallbacks();
		this.#roomStateMap.clear();
	}

	#cleanupConnection(keepQueue: boolean = false): void {
		this.#stopHeartbeat();
		this.#clearAuthTimeout();
		this.#clearReconnectTimeout();
		if (!keepQueue) {
			this.#messageQueue = [];
		}
	}

	#onclose(event: CloseEvent): void {
		if (this._debug) {
			console.log(`ByteSocket: closed (code ${event.code}, reason: ${event.reason})`);
		}
		this.#stopHeartbeat();
		this.#clearAuthTimeout();
		this.#onRoomsClose();
		if (!this.#destroyed) {
			this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.close), event);
		}
		if (this.#destroyed || this.#manuallyClosed || this.#authState === AuthState.failed || this.#reconnectExhausted) {
			return;
		}
		if (this.#manualReconnect()) {
			return;
		}
		if (!this.#options.reconnectOnNormalClosure && (event.code === 1000 || event.code === 1001)) {
			if (this._debug) {
				console.log(`ByteSocket: normal closure (code ${event.code}), will not reconnect`);
			}
			return;
		}
		this.#tryAutoReconnect();
	}

	#manualReconnect() {
		if (this.#reconnecting) {
			if (this._debug) {
				console.log("ByteSocket: reconnecting immediately as requested");
			}
			this.#reconnecting = false;
			this.#reconnectExhausted = false;
			this.#createSocket();
			return true;
		}
		return false;
	}

	#tryAutoReconnect() {
		if (this.#options.reconnection && this.#reconnectAttempts < this.#options.maxReconnectionAttempts) {
			let delay = this.#options.reconnectionDelay * Math.pow(2, this.#reconnectAttempts);
			delay = Math.min(delay, this.#options.reconnectionDelayMax);
			if (this.#options.randomizationFactor !== 0) {
				delay = delay * (1 + (Math.random() - 0.5) * this.#options.randomizationFactor);
			}
			this.#reconnectAttempts++;
			if (this._debug) {
				console.log(`ByteSocket: reconnecting in ${Math.round(delay)}ms (attempt ${this.#reconnectAttempts})`);
			}
			this.#reconnectTimer = setTimeout(() => {
				this.#reconnectTimer = null;
				this.#createSocket();
			}, delay);
			return;
		}
		if (this._debug) {
			if (this.#reconnectAttempts >= this.#options.maxReconnectionAttempts) {
				console.warn("ByteSocket: max reconnection attempts reached");
			} else {
				console.log("ByteSocket: reconnection disabled, not reconnecting");
			}
		}
		if (!this.#reconnectExhausted) {
			this.#reconnectExhausted = true;
			this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.reconnect_failed));
		}
	}

	// ──── Error ────────────────────────────────────────────────────────────────────────

	#onerror(event: Event): void {
		const ctx: ErrorContext = {
			phase: "network",
			error: event instanceof Error ? event : new Error("WebSocket error"),
			raw: String(event),
		};
		if (this._debug) {
			console.error("ByteSocket: error", event);
		}
		this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), ctx);
		if (
			this.#ws &&
			this.#ws.readyState === WebSocket.CONNECTING &&
			this.#reconnectAttempts >= this.#options.maxReconnectionAttempts &&
			!this.#reconnectExhausted
		) {
			this.#reconnectExhausted = true;
			this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.reconnect_failed));
		}
	}
}
