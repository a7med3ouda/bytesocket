import {
	AuthState,
	LifecycleTypes,
	type AnyCallback,
	type ErrorContext,
	type LifecycleMessage,
	type SocketEvents,
	type StringNumberKeys,
	type UserMessage,
} from "@bytesocket/types";
import { FLOAT32_OPTIONS, Packr } from "msgpackr";
import { RoomManager } from "./room-manager";
import { SocketBase } from "./socket-base";
import type { AuthConfig, ByteSocketOptions, EventCallback } from "./types";

/**
 * ByteSocket is a WebSocket client with automatic reconnection, room management,
 * authentication, heartbeat, and pluggable serialization (JSON or MessagePack).
 *
 * It provides a fully typed event system via a user‑supplied event map (`TEvents`).
 *
 * @typeParam TEvents - A type extending `SocketEvents` that defines the shape of
 *                      all emit/listen events (global and room‑scoped).
 *
 * @example
 * // Define your event schema
 * interface MyEvents extends SocketEvents<{
 *   emit: { ping: void };
 *   listen: { pong: number };
 *   emitRoom: {
 *     chat: { message: string };
 *   };
 *   listenRoom: {
 *     chat: { message: string; sender: string };
 *   };
 * }> {}
 *
 * // Create a typed socket instance
 * const socket = new ByteSocket<MyEvents>('wss://example.com/socket', {
 *   debug: true,
 *   auth: { token: 'abc123' }
 * });
 *
 * // Use typed methods
 * socket.emit('ping', undefined);
 * socket.on('pong', (timestamp) => console.log(timestamp));
 *
 * socket.rooms.join('chat');
 * socket.rooms.emit('chat', 'message', { message: 'Hello!' });
 * socket.rooms.on('chat', 'message', (data) => {
 *   console.log(`${data.sender}: ${data.message}`);
 * });
 */
export class ByteSocket<TEvents extends SocketEvents = SocketEvents> extends SocketBase {
	// ────────────────────────────────────────────────────────────────────────────
	// Namespaces
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * Lifecycle event listeners for connection, authentication, and errors.
	 *
	 * @example
	 * socket.lifecycle.onOpen(() => console.log('Connected!'));
	 * socket.lifecycle.onAuthError((err) => console.error('Auth failed', err));
	 * socket.lifecycle.onQueueFull(() => console.warn('Message queue full'));
	 */
	readonly lifecycle;

	/**
	 * Room management and room‑scoped events.
	 *
	 * @example
	 * socket.rooms.join('lobby');
	 * socket.rooms.on('lobby', 'chat', (msg) => { ... });
	 */
	readonly rooms: RoomManager<TEvents>;

	// ────────────────────────────────────────────────────────────────────────────
	// Options
	// ────────────────────────────────────────────────────────────────────────────

	protected readonly debug: boolean;

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

	readonly #baseUrl: string;
	readonly #packr: Packr;
	readonly #options: Omit<Required<ByteSocketOptions>, "auth" | "debug" | "msgpackrOptions" | "path" | "protocols" | "queryParams"> &
		Pick<ByteSocketOptions, "msgpackrOptions" | "path" | "protocols" | "queryParams">;

	// ────────────────────────────────────────────────────────────────────────────
	// States
	// ────────────────────────────────────────────────────────────────────────────

	#ws: WebSocket | null = null;
	#authConfig: AuthConfig | undefined;
	#authState: AuthState = AuthState.idle;
	#messageQueue: Array<string | Blob | BufferSource> = [];
	#reconnectAttempts: number = 0;
	#flushFailures: number = 0;

	// ────────────────────────────────────────────────────────────────────────────
	// Flags
	// ────────────────────────────────────────────────────────────────────────────

	#manuallyClosed: boolean = false;
	#flushing: boolean = false;
	#destroyed: boolean = false;
	#reconnecting: boolean = false;

	// ────────────────────────────────────────────────────────────────────────────
	// Timers
	// ────────────────────────────────────────────────────────────────────────────

	#authTimer: ReturnType<typeof setTimeout> | null = null;
	#pingTimer: ReturnType<typeof setInterval> | null = null;
	#pongTimer: ReturnType<typeof setTimeout> | null = null;
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	// ────────────────────────────────────────────────────────────────────────────
	// Callbacks
	// ────────────────────────────────────────────────────────────────────────────

	#callbacksMap = new Map<string | number, Set<AnyCallback>>();
	#onceCallbacksMap = new Map<string | number, Map<AnyCallback, Set<AnyCallback>>>();

	/**
	 * Creates a new ByteSocket instance.
	 *
	 * @param baseUrl - WebSocket URL (e.g., `wss://example.com/socket` or relative `"/socket"`).
	 * @param options - Configuration options.
	 */
	constructor(baseUrl: string, options: ByteSocketOptions = {}) {
		super();
		const { auth, debug, msgpackrOptions, ...restOptions } = options;

		this.#baseUrl = baseUrl;
		this.#authConfig = auth;
		this.debug = debug ?? false;

		this.#options = {
			...restOptions,
			autoConnect: options.autoConnect ?? true,
			reconnection: options.reconnection ?? true,
			maxReconnectionAttempts: options.maxReconnectionAttempts ?? Infinity,
			reconnectionDelay: options.reconnectionDelay ?? 1000,
			reconnectionDelayMax: options.reconnectionDelayMax ?? 5000,
			authTimeout: options.authTimeout ?? 5000,
			maxQueueSize: options.maxQueueSize ?? 100,
			serialization: options.serialization ?? "binary",
			randomizationFactor: options.randomizationFactor != null ? Math.max(0, Math.min(1, options.randomizationFactor)) : 0.5,
			pingInterval: options.pingInterval ?? 25000,
			pingTimeout: options.pingTimeout ?? 20000,
			heartbeatEnabled: options.heartbeatEnabled ?? true,
		};

		if (this.#options.pingTimeout >= this.#options.pingInterval) {
			if (this.debug)
				console.warn(
					`ByteSocket: pingTimeout (${this.#options.pingTimeout}ms) should be less than pingInterval (${this.#options.pingInterval}ms).`,
				);
		} else if (this.#options.pingTimeout > this.#options.pingInterval * 0.8) {
			if (this.debug)
				console.warn(
					`ByteSocket: pingTimeout (${this.#options.pingTimeout}ms) is close to pingInterval (${this.#options.pingInterval}ms). ` +
						`Consider a larger gap to avoid overlapping timers.`,
				);
		}

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
			/**
			 * Register a listener for socket open.
			 */
			onOpen: (callback: () => void) => this.onLifecycle(LifecycleTypes.open, callback),
			/**
			 * Remove a listener for socket open.
			 */
			offOpen: (callback?: () => void) => this.offLifecycle(LifecycleTypes.open, callback),
			/**
			 * Register a one‑time listener for socket open.
			 */
			onceOpen: (callback: () => void) => this.onceLifecycle(LifecycleTypes.open, callback),

			/**
			 * Register a listener for socket close.
			 */
			onClose: (callback: (event: CloseEvent) => void) => this.onLifecycle(LifecycleTypes.close, callback),
			/**
			 * Remove a listener for socket close.
			 */
			offClose: (callback?: (event: CloseEvent) => void) => this.offLifecycle(LifecycleTypes.close, callback),
			/**
			 * Register a one‑time listener for socket close.
			 */
			onceClose: (callback: (event: CloseEvent) => void) => this.onceLifecycle(LifecycleTypes.close, callback),

			/**
			 * Register a listener for WebSocket errors.
			 */
			onError: (callback: (event: Event) => void) => this.onLifecycle(LifecycleTypes.error, callback),
			/**
			 * Remove a listener for WebSocket errors.
			 */
			offError: (callback?: (event: Event) => void) => this.offLifecycle(LifecycleTypes.error, callback),
			/**
			 * Register a one‑time listener for WebSocket errors.
			 */
			onceError: (callback: (event: Event) => void) => this.onceLifecycle(LifecycleTypes.error, callback),

			/**
			 * Register a listener for authentication success.
			 */
			onAuthSuccess: (callback: () => void) => this.onLifecycle(LifecycleTypes.auth_success, callback),
			/**
			 * Remove a listener for authentication success.
			 */
			offAuthSuccess: (callback?: () => void) => this.offLifecycle(LifecycleTypes.auth_success, callback),
			/**
			 * Register a one‑time listener for authentication success.
			 */
			onceAuthSuccess: (callback: () => void) => this.onceLifecycle(LifecycleTypes.auth_success, callback),

			/**
			 * Register a listener for authentication errors.
			 */
			onAuthError: (callback: (ctx: ErrorContext) => void) => this.onLifecycle(LifecycleTypes.auth_error, callback),
			/**
			 * Remove a listener for authentication errors.
			 */
			offAuthError: (callback?: (ctx: ErrorContext) => void) => this.offLifecycle(LifecycleTypes.auth_error, callback),
			/**
			 * Register a one‑time listener for authentication errors.
			 */
			onceAuthError: (callback: (ctx: ErrorContext) => void) => this.onceLifecycle(LifecycleTypes.auth_error, callback),

			/**
			 * Register a listener for when the message queue becomes full and a message is dropped.
			 */
			onQueueFull: (callback: () => void) => this.onLifecycle(LifecycleTypes.queue_full, callback),
			/**
			 * Remove a listener for queue‑full events.
			 */
			offQueueFull: (callback?: () => void) => this.offLifecycle(LifecycleTypes.queue_full, callback),
			/**
			 * Register a one‑time listener for queue‑full events.
			 */
			onceQueueFull: (callback: () => void) => this.onceLifecycle(LifecycleTypes.queue_full, callback),

			/**
			 * Register a listener for when reconnection fails after all attempts.
			 */
			onReconnectFailed: (callback: () => void) => this.onLifecycle(LifecycleTypes.reconnect_failed, callback),
			/**
			 * Remove a listener for reconnect‑failed events.
			 */
			offReconnectFailed: (callback?: () => void) => this.offLifecycle(LifecycleTypes.reconnect_failed, callback),
			/**
			 * Register a one‑time listener for reconnect‑failed events.
			 */
			onceReconnectFailed: (callback: () => void) => this.onceLifecycle(LifecycleTypes.reconnect_failed, callback),
		} as const;

		this.rooms = new RoomManager<TEvents>(this.debug, this.#send.bind(this), this.lifecycle.onOpen.bind(this), this.lifecycle.onClose.bind(this));

		if (this.#options.autoConnect) this.connect();
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Getters
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * Current WebSocket readyState (CONNECTING, OPEN, CLOSING, CLOSED).
	 * Returns `WebSocket.CLOSED` if no socket exists.
	 */
	get readyState(): number {
		return this.#ws?.readyState ?? WebSocket.CLOSED;
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Encoding / Decoding
	// ────────────────────────────────────────────────────────────────────────────

	#encode<R extends string, E extends string | number, D>(payload: LifecycleMessage<R, D> | UserMessage<R, E, D>): string | BufferSource {
		if (this.#options.serialization === "binary") {
			return this.#packr.pack(payload);
		} else {
			return JSON.stringify(payload);
		}
	}

	#decode(message: string | ArrayBuffer, isBinary: boolean) {
		if (this.#options.serialization === "binary" && message instanceof ArrayBuffer) {
			if (!isBinary) throw new Error("Expected binary message for msgpack serialization");
			return this.#packr.unpack(new Uint8Array(message));
		} else if (this.#options.serialization === "json" && typeof message === "string") {
			if (isBinary) throw new Error("Binary message received but serialization is set to JSON");
			return JSON.parse(message);
		}
		throw new Error(`Decode failed: unexpected message type for ${this.#options.serialization} serialization`);
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Emits
	// ────────────────────────────────────────────────────────────────────────────

	#trySend(message: string | Blob | BufferSource): boolean {
		if (!this.#ws || this.readyState !== WebSocket.OPEN) return false;
		try {
			this.#ws.send(message);
			return true;
		} catch (err) {
			if (this.debug) console.warn("ByteSocket: send failed", err);
			return false;
		}
	}

	#sendOrQueue(message: string | Blob | BufferSource, bypassAuthPending: boolean = false): void {
		if (this.#canSend(bypassAuthPending) && !this.#flushing) {
			const sent = this.#trySend(message);
			if (sent) return;
		}
		if (this.#messageQueue.length < this.#options.maxQueueSize) {
			this.#messageQueue.push(message);
		} else {
			if (this.debug) console.warn(`ByteSocket: message queue full (${this.#options.maxQueueSize}), dropping message`);
			this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.queue_full));
		}
	}

	#send<R extends string, E extends string | number, D>(
		payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
		bypassAuthPending: boolean = false,
	): void {
		if (!this.#isOperational()) return;
		const message = this.#encode(payload);
		this.#sendOrQueue(message, bypassAuthPending);
	}

	/**
	 * Send a raw message (string, Blob, or BufferSource) directly over the WebSocket.
	 * Bypasses serialization and auth checks. If the socket is not open, the message
	 * is queued and sent when possible (auth state is ignored).
	 *
	 * @param message - The raw data to send.
	 */
	sendRaw(message: string | Blob | BufferSource): void {
		if (!this.#isOperational()) return;
		this.#sendOrQueue(message, true);
	}

	/**
	 * Emit a global event.
	 *
	 * @typeParam E - Event name (must be a key in `TEvents['emit']`).
	 * @typeParam D - Event data type.
	 *
	 * @example
	 * // Assuming event map defines emit: { 'user:typing': { userId: string } }
	 * socket.emit('user:typing', { userId: '123' });
	 */
	emit<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): void {
		this.#send({ event, data });
	}

	#flushQueue(): void {
		if (this.#flushing) return;
		this.#flushing = true;
		try {
			while (this.#messageQueue.length > 0 && this.#canSend() && this.#isOperational()) {
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
			if (this.#messageQueue.length > 0 && this.#canSend() && this.#isOperational()) {
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

	// ────────────────────────────────────────────────────────────────────────────
	// Listeners
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * Register a permanent listener for global events.
	 *
	 * @typeParam E - Event name (must be a key in `TEvents['listen']`).
	 *
	 * @example
	 * // Assuming event map defines listen: { 'user:joined': { userId: string } }
	 * socket.on('user:joined', (data) => {
	 *   console.log(`User ${data.userId} joined`);
	 * });
	 */
	on<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback: EventCallback<D>): void {
		this.addCallback(this.#callbacksMap, event, callback);
	}

	/**
	 * Remove a listener for global events.
	 * If no callback is provided, all listeners for that event are removed.
	 *
	 * @example
	 * // Remove specific callback
	 * socket.off('user:joined', myCallback);
	 * // Remove all listeners for 'user:joined'
	 * socket.off('user:joined');
	 */
	off<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback?: EventCallback<D>): void {
		if (!callback) {
			this.#callbacksMap.delete(event);
			this.#onceCallbacksMap.delete(event);
			return;
		}
		const onceEventMap = this.#onceCallbacksMap.get(event);
		const wrappersSet = onceEventMap?.get(callback);
		if (wrappersSet) {
			wrappersSet.forEach((wrapper) => {
				this.deleteCallback(this.#callbacksMap, event, wrapper);
				this.deleteOnceCallback(this.#onceCallbacksMap, event, callback, wrapper);
			});
		}
		this.deleteCallback(this.#callbacksMap, event, callback);
	}

	/**
	 * Register a one‑time listener for a global event.
	 * The callback is removed after the first invocation.
	 *
	 * @example
	 * socket.once('user:joined', (data) => {
	 *   console.log('First join event:', data);
	 * });
	 */
	once<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback: EventCallback<D>): void {
		const callbackWrapper: EventCallback<D> = (data) => {
			this.deleteCallback(this.#callbacksMap, event, callbackWrapper);
			this.deleteOnceCallback(this.#onceCallbacksMap, event, callback, callbackWrapper);
			callback(data);
		};
		this.addOnceCallback(this.#onceCallbacksMap, event, callback, callbackWrapper);
		this.addCallback(this.#callbacksMap, event, callbackWrapper);
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Helpers
	// ────────────────────────────────────────────────────────────────────────────

	#canSend(bypassAuthPending: boolean = false): boolean {
		return (
			this.readyState === WebSocket.OPEN && (bypassAuthPending || this.#authState === AuthState.none || this.#authState === AuthState.success)
		);
	}

	#isOperational(): boolean {
		if (this.#destroyed) return false;
		if (this.#manuallyClosed) {
			if (this.debug) console.warn("ByteSocket: send() called after close() — message dropped");
			return false;
		}
		if (this.#authState === AuthState.failed) {
			if (this.debug) console.warn("ByteSocket: send() called after auth_failed — message dropped");
			return false;
		}
		return true;
	}

	// ────────────────────────────────────────────────────────────────────────────
	// URL Building
	// ────────────────────────────────────────────────────────────────────────────

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
			Object.entries(this.#options.queryParams).forEach(([key, value]) => {
				url.searchParams.set(key, value);
			});
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

	// ────────────────────────────────────────────────────────────────────────────
	// Auth
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * Update the authentication configuration before connecting.
	 * Must be called before `connect()` (or auto‑connect).
	 *
	 * @param config - New auth config (static object or async callback).
	 *
	 * @throws {Error} If called after `destroy()` or after the socket is already connecting/open.
	 */
	setAuth<D>(config: AuthConfig<D> | undefined) {
		if (this.#destroyed) throw new Error("ByteSocket: cannot call setAuth() after destroy().");
		if (this.#ws !== null && this.readyState !== WebSocket.CLOSED)
			throw new Error("ByteSocket: auth cannot be changed after connect() has been called.");
		this.#authConfig = config;
	}

	#startAuthTimeout(): void {
		this.#authTimer = setTimeout(() => {
			if (this.#authState === AuthState.pending && this.readyState === WebSocket.OPEN) {
				if (this.debug) console.warn("ByteSocket: auth timeout");
				this.#authState = AuthState.failed;
				this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.auth_error), { reason: "timeout" });
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
		this.#startHeartbeat();
		this.#flushQueue();
		this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.open));
		this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.auth_success));
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
		this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.auth_error), err);
	}

	#authenticate<D>(config: AuthConfig<D>): void {
		this.#authState = AuthState.pending;
		this.#startAuthTimeout();
		if (typeof config === "function") {
			try {
				config((data) => {
					try {
						this.#sendAuthData(data);
					} catch (error) {
						this.#handleAuthError(error);
					}
				});
			} catch (error) {
				this.#handleAuthError(error);
			}
		} else {
			this.#sendAuthData(config.data);
		}
	}

	#sendAuthData<D>(data: D): void {
		if (this.readyState === WebSocket.OPEN) {
			this.#send({ type: LifecycleTypes.auth, data }, true);
			if (this.debug) console.log("ByteSocket: auth payload sent");
		} else {
			if (this.debug) console.warn("ByteSocket: cannot send auth, socket not open");
			this.#handleAuthError(new Error("Auth failed: socket not open"), false);
		}
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Heartbeat
	// ────────────────────────────────────────────────────────────────────────────

	#startHeartbeat(): void {
		if (!this.#options.heartbeatEnabled) return;
		if (this.debug) console.log("ByteSocket: start heartbeat");
		this.#clearPongTimeout();
		this.#startPingInterval();
	}

	#stopHeartbeat(): void {
		if (this.debug) console.log("ByteSocket: stop heartbeat");
		this.#clearPingInterval();
		this.#clearPongTimeout();
	}

	#startPingInterval() {
		if (this.#pingTimer) clearInterval(this.#pingTimer);

		this.#pingTimer = setInterval(() => {
			if (this.#canSend()) {
				if (this.debug) console.time("ByteSocket: heartbeat");
				this.#send({ type: LifecycleTypes.ping });
				if (this.debug) console.log("ByteSocket: ping sent");
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
		if (this.#pongTimer) clearTimeout(this.#pongTimer);

		this.#pongTimer = setTimeout(() => {
			if (this.debug) {
				console.warn("ByteSocket: pong timeout, closing connection");
				console.timeEnd("ByteSocket: heartbeat");
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
			if (this.debug) console.timeEnd("ByteSocket: heartbeat");
		}
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Connection Lifecycle
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * Opens the WebSocket connection. Called automatically if `autoConnect` is `true`.
	 * Can be called manually after a previous `close()`.
	 */
	connect(): void {
		if (this.#destroyed) {
			if (this.debug) console.warn("ByteSocket: connect() called after destroy()");
			return;
		}
		if (this.readyState === WebSocket.OPEN || this.readyState === WebSocket.CONNECTING) {
			if (this.debug) console.warn("ByteSocket: already connected or connecting");
			return;
		}
		this.#cleanupConnection(true);
		this.#authState = AuthState.idle;
		this.#manuallyClosed = false;
		this.#createSocket();
	}

	#createSocket(): void {
		const url = this.#buildFullUrl();
		this.#ws = new WebSocket(url, this.#options.protocols);
		this.#ws.binaryType = "arraybuffer";

		this.#ws.onopen = this.#handleOpen.bind(this);
		this.#ws.onmessage = this.#handleMessage.bind(this);
		this.#ws.onclose = this.#handleClose.bind(this);
		this.#ws.onerror = this.#handleError.bind(this);
	}

	#handleOpen(): void {
		if (this.debug) console.log("ByteSocket: connected");
		this.#reconnecting = false;
		this.#reconnectAttempts = 0;
		if (this.#authConfig) {
			this.#authenticate(this.#authConfig);
		} else {
			this.#authState = AuthState.none;
			this.#startHeartbeat();
			this.#flushQueue();
			this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.open));
		}
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Message Handling
	// ────────────────────────────────────────────────────────────────────────────

	#parseMessage(message: MessageEvent): { success: true; payload: UserMessage } | { success: false; payload?: never } {
		if (message.data instanceof Blob) {
			if (this.debug) console.warn("ByteSocket: received unexpected Blob message. Ensure binaryType is 'arraybuffer'.");
			return { success: false };
		}
		try {
			const payload = this.#decode(message.data, message.data instanceof ArrayBuffer);
			return { success: true, payload };
		} catch (error) {
			if (this.debug) console.error("ByteSocket: decode error", error);
			this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.error), error);
			return { success: false };
		}
	}

	#handleAuthMessage(payload: UserMessage): boolean {
		if ("type" in payload && payload.type === LifecycleTypes.auth_success) {
			if (this.debug) console.log("ByteSocket: auth success");
			this.#handleAuthSuccess();
			return true;
		}
		if ("type" in payload && payload.type === LifecycleTypes.auth_error) {
			if (this.debug) console.warn("ByteSocket: auth error", payload.data);
			this.#handleAuthError(payload.data);
			return true;
		}
		return false;
	}

	#handleHeartbeatMessage(payload: UserMessage): boolean {
		if ("type" in payload && payload.type === LifecycleTypes.ping) {
			if (this.debug) console.log("ByteSocket: ping received");
			this.#send({ type: LifecycleTypes.pong });
			return true;
		}
		if ("type" in payload && payload.type === LifecycleTypes.pong) {
			if (this.debug) console.log("ByteSocket: pong received");
			this.#clearPongTimeout();
			return true;
		}
		return false;
	}

	#handleEventMessage(payload: UserMessage): boolean {
		if (payload.event == null) return false;
		this.triggerCallback(this.#callbacksMap.get(payload.event), payload.data);
		return true;
	}

	#handleMessage(message: MessageEvent): void {
		const { success, payload } = this.#parseMessage(message);
		if (!success) return;

		if (this.#handleAuthMessage(payload)) return;
		if (this.#handleHeartbeatMessage(payload)) return;
		if (this.rooms._handleMessage(payload)) return;
		if (this.#handleEventMessage(payload)) return;

		if (this.debug) console.warn("ByteSocket: unhandled message", payload);
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Reconnection
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * Force an immediate reconnection, resetting the current connection and re‑establishing.
	 * Useful when you suspect the connection is stale but hasn't closed yet.
	 */
	reconnect(): void {
		if (this.#destroyed) {
			if (this.debug) console.warn("ByteSocket: reconnect() called after destroy()");
			return;
		}
		this.#cleanupConnection(true);
		this.#reconnectAttempts = 0;
		this.#authState = AuthState.idle;
		this.#manuallyClosed = false;
		this.#reconnecting = true;
		if (this.#ws && this.readyState !== WebSocket.CLOSED) {
			this.#ws.close(4100, "Client reconnect");
		} else {
			this.#reconnecting = false;
			this.#createSocket();
		}
	}

	#clearReconnectTimeout(): void {
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Close / Destroy
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * Gracefully close the WebSocket connection.
	 * Automatic reconnection is disabled after a manual close.
	 *
	 * @param code - Close code (default none).
	 * @param reason - Close reason (default none).
	 */
	close(code?: number, reason?: string): void {
		if (this.#destroyed) return;
		this.#manuallyClosed = true;
		this.#cleanupConnection(true);
		this.#ws?.close(code, reason);
	}

	/**
	 * Permanently destroy the socket instance, cleaning up all resources,
	 * timers, and callbacks. The instance cannot be reused.
	 */
	destroy(): void {
		if (this.#destroyed) return;
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
		this.#callbacksMap.clear();
		this.#onceCallbacksMap.clear();
		this.lifecycleCallbacksMap.clear();
		this.onceLifecycleCallbacksMap.clear();
		this.rooms._clear();
	}

	#cleanupConnection(keepQueue: boolean = false): void {
		this.#stopHeartbeat();
		this.#clearAuthTimeout();
		this.#clearReconnectTimeout();
		if (!keepQueue) this.#messageQueue = [];
	}

	#handleClose(event: CloseEvent): void {
		if (this.debug) console.log(`ByteSocket: closed (code ${event.code}, reason: ${event.reason})`);
		this.#stopHeartbeat();
		this.#clearAuthTimeout();
		if (!this.#destroyed) this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.close), event);
		if (this.#destroyed || this.#manuallyClosed || this.#authState === AuthState.failed) return;
		if (this.#manualReconnect()) return;
		if (event.code === 1000 || event.code === 1001) {
			if (this.debug) console.log(`ByteSocket: normal closure (code ${event.code}), will not reconnect`);
			return;
		}
		this.#tryAutoReconnect();
	}

	#manualReconnect() {
		if (this.#reconnecting) {
			this.#reconnecting = false;
			if (this.debug) console.log("ByteSocket: reconnecting immediately as requested");
			this.#createSocket();
			return true;
		}
		return false;
	}

	#tryAutoReconnect() {
		if (this.#options.reconnection && this.#reconnectAttempts < this.#options.maxReconnectionAttempts) {
			let delay = this.#options.reconnectionDelay * Math.pow(2, this.#reconnectAttempts);
			delay = Math.min(delay, this.#options.reconnectionDelayMax);
			if (this.#options.randomizationFactor !== 0) delay = delay * (1 + (Math.random() - 0.5) * this.#options.randomizationFactor);
			this.#reconnectAttempts++;
			if (this.debug) console.log(`ByteSocket: reconnecting in ${Math.round(delay)}ms (attempt ${this.#reconnectAttempts})`);
			this.#reconnectTimer = setTimeout(() => {
				this.#reconnectTimer = null;
				this.#createSocket();
			}, delay);
		} else if (this.#reconnectAttempts >= this.#options.maxReconnectionAttempts) {
			if (this.debug) console.warn("ByteSocket: max reconnection attempts reached");
			this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.reconnect_failed));
		} else {
			if (this.debug) console.log("ByteSocket: reconnection disabled, not reconnecting");
			this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.reconnect_failed));
		}
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Error
	// ────────────────────────────────────────────────────────────────────────────

	#handleError(event: Event): void {
		if (this.debug) console.error("ByteSocket: error", event);
		this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.error), event);
	}
}
