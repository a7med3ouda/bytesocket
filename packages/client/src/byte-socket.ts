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
import type { AuthConfig, ByteSocketOptions, ClientSendData, EventCallback, IByteSocket, LifecycleApi } from "./types";

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
export class ByteSocket<TEvents extends SocketEvents = SocketEvents> extends SocketBase implements IByteSocket<TEvents> {
	// ──── Namespaces ────────────────────────────────────────────────────────────────────────

	readonly lifecycle: LifecycleApi;
	readonly rooms: RoomManager<TEvents>;

	// ──── States ────────────────────────────────────────────────────────────────────────

	protected readonly debug: boolean;

	#defaultStructures: Array<Array<string>> = [
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
	#baseUrl: string;
	#packr: Packr;
	#options: Omit<Required<ByteSocketOptions>, "auth" | "debug" | "msgpackrOptions" | "path" | "protocols" | "queryParams"> &
		Pick<ByteSocketOptions, "msgpackrOptions" | "path" | "protocols" | "queryParams">;
	#ws: WebSocket | null = null;
	#authConfig: AuthConfig | undefined;
	#authState: AuthState = AuthState.idle;
	#messageQueue: Array<ClientSendData> = [];
	#reconnectAttempts: number = 0;
	#flushFailures: number = 0;

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

	// ──── Callbacks ────────────────────────────────────────────────────────────────────────

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
			reconnectOnNormalClosure: options.reconnectOnNormalClosure ?? true,
			authTimeout: options.authTimeout ?? 5000,
			maxQueueSize: options.maxQueueSize ?? 100,
			serialization: options.serialization ?? "binary",
			randomizationFactor: options.randomizationFactor != null ? Math.max(0, Math.min(1, options.randomizationFactor)) : 0.5,
			pingInterval: options.pingInterval ?? 25000,
			pingTimeout: options.pingTimeout ?? 20000,
			heartbeatEnabled: options.heartbeatEnabled ?? true,
		};

		if (this.#options.pingTimeout >= this.#options.pingInterval) {
			if (this.debug) {
				console.warn(
					`ByteSocket: pingTimeout (${this.#options.pingTimeout}ms) should be less than pingInterval (${this.#options.pingInterval}ms).`,
				);
			}
		} else if (this.#options.pingTimeout > this.#options.pingInterval * 0.8) {
			if (this.debug) {
				console.warn(
					`ByteSocket: pingTimeout (${this.#options.pingTimeout}ms) is close to pingInterval (${this.#options.pingInterval}ms). ` +
						`Consider a larger gap to avoid overlapping timers.`,
				);
			}
		}

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
			onOpen: (callback) => this.onLifecycle(LifecycleTypes.open, callback),
			offOpen: (callback) => this.offLifecycle(LifecycleTypes.open, callback),
			onceOpen: (callback) => this.onceLifecycle(LifecycleTypes.open, callback),

			onMessage: (callback) => this.onLifecycle(LifecycleTypes.message, callback),
			offMessage: (callback) => this.offLifecycle(LifecycleTypes.message, callback),
			onceMessage: (callback) => this.onceLifecycle(LifecycleTypes.message, callback),

			onClose: (callback) => this.onLifecycle(LifecycleTypes.close, callback),
			offClose: (callback) => this.offLifecycle(LifecycleTypes.close, callback),
			onceClose: (callback) => this.onceLifecycle(LifecycleTypes.close, callback),

			onError: (callback) => this.onLifecycle(LifecycleTypes.error, callback),
			offError: (callback) => this.offLifecycle(LifecycleTypes.error, callback),
			onceError: (callback) => this.onceLifecycle(LifecycleTypes.error, callback),

			onAuthSuccess: (callback) => this.onLifecycle(LifecycleTypes.auth_success, callback),
			offAuthSuccess: (callback) => this.offLifecycle(LifecycleTypes.auth_success, callback),
			onceAuthSuccess: (callback) => this.onceLifecycle(LifecycleTypes.auth_success, callback),

			onAuthError: (callback: (ctx: ErrorContext) => void) => this.onLifecycle(LifecycleTypes.auth_error, callback),
			offAuthError: (callback?: (ctx: ErrorContext) => void) => this.offLifecycle(LifecycleTypes.auth_error, callback),
			onceAuthError: (callback: (ctx: ErrorContext) => void) => this.onceLifecycle(LifecycleTypes.auth_error, callback),

			onQueueFull: (callback) => this.onLifecycle(LifecycleTypes.queue_full, callback),
			offQueueFull: (callback) => this.offLifecycle(LifecycleTypes.queue_full, callback),
			onceQueueFull: (callback) => this.onceLifecycle(LifecycleTypes.queue_full, callback),

			onReconnectFailed: (callback) => this.onLifecycle(LifecycleTypes.reconnect_failed, callback),
			offReconnectFailed: (callback) => this.offLifecycle(LifecycleTypes.reconnect_failed, callback),
			onceReconnectFailed: (callback) => this.onceLifecycle(LifecycleTypes.reconnect_failed, callback),
		};

		this.rooms = new RoomManager<TEvents>(this.debug, this.send.bind(this), this.lifecycle.onOpen.bind(this), this.lifecycle.onClose.bind(this));

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

	// ──── Encoding / Decoding ────────────────────────────────────────────────────────────────────────

	encode<R extends string, E extends string | number, D>(
		payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
		serialization = this.#options.serialization,
	): string | Uint8Array<ArrayBuffer> {
		if (serialization === "binary") {
			return this.#packr.pack(payload) as Uint8Array<ArrayBuffer>;
		} else {
			return JSON.stringify(payload);
		}
	}

	decode(message: string | ArrayBuffer, isBinary?: boolean) {
		if (typeof message === "string") {
			if (isBinary === true) {
				throw new Error("Received string but expected binary");
			}
			return JSON.parse(message);
		}

		if (isBinary === false) {
			const text = new TextDecoder().decode(message);
			return JSON.parse(text);
		}

		return this.#packr.unpack(new Uint8Array(message));
	}

	// ──── Emits ────────────────────────────────────────────────────────────────────────

	#trySend(message: ClientSendData): boolean {
		if (!this.#ws || this.readyState !== WebSocket.OPEN) {
			return false;
		}
		try {
			this.#ws.send(message);
			return true;
		} catch (err) {
			if (this.debug) {
				console.warn("ByteSocket: send failed", err);
			}
			return false;
		}
	}

	#enqueue(message: ClientSendData): void {
		if (this.#messageQueue.length < this.#options.maxQueueSize) {
			this.#messageQueue.push(message);
		} else {
			if (this.debug) {
				console.warn(`ByteSocket: message queue full (${this.#options.maxQueueSize}), dropping message`);
			}
			this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.queue_full));
		}
	}

	#sendOrQueue(message: ClientSendData): void {
		if (this.canSend && !this.#flushing) {
			const sent = this.#trySend(message);
			if (sent) {
				return;
			}
		}
		this.#enqueue(message);
	}

	send<R extends string, E extends string | number, D>(payload: LifecycleMessage<R, D> | UserMessage<R, E, D>): void {
		if (!this.#isOperational()) {
			return;
		}
		const message = this.encode(payload);
		this.#sendOrQueue(message);
	}

	sendRaw(message: ClientSendData): void {
		if (!this.#isOperational()) {
			return;
		}
		if (this.readyState === WebSocket.OPEN && !this.#flushing) {
			const sent = this.#trySend(message);
			if (sent) {
				return;
			}
		}
		this.#enqueue(message);
	}

	emit<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): void {
		this.send({ event, data });
	}

	#sendAuthPayload<D>(data: D): void {
		if (this.readyState !== WebSocket.OPEN) {
			if (this.debug) {
				console.warn("ByteSocket: cannot send auth, socket not open");
			}
			this.#handleAuthError(new Error("Auth failed: socket not open"), false);
			return;
		}
		const message = this.encode({ type: LifecycleTypes.auth, data });
		const sent = this.#trySend(message);
		if (!sent) {
			if (this.debug) {
				console.warn("ByteSocket: auth send failed");
			}
			this.#handleAuthError(new Error("Auth send failed"), false);
		} else {
			if (this.debug) {
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

	on<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback: EventCallback<D>): void {
		this.addCallback(this.#callbacksMap, event, callback);
	}

	off<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback?: EventCallback<D>): void {
		if (!callback) {
			this.#callbacksMap.delete(event);
			this.#onceCallbacksMap.delete(event);
			return;
		}
		const onceEventMap = this.#onceCallbacksMap.get(event);
		const wrappersSet = onceEventMap?.get(callback);
		if (wrappersSet) {
			for (const wrapper of [...wrappersSet]) {
				this.deleteCallback(this.#callbacksMap, event, wrapper);
				this.deleteOnceCallback(this.#onceCallbacksMap, event, callback, wrapper);
			}
		}
		this.deleteCallback(this.#callbacksMap, event, callback);
	}

	once<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(event: E, callback: EventCallback<D>): void {
		const callbackWrapper: EventCallback<D> = (data) => {
			this.deleteCallback(this.#callbacksMap, event, callbackWrapper);
			this.deleteOnceCallback(this.#onceCallbacksMap, event, callback, callbackWrapper);
			callback(data);
		};
		this.addOnceCallback(this.#onceCallbacksMap, event, callback, callbackWrapper);
		this.addCallback(this.#callbacksMap, event, callbackWrapper);
	}

	// ──── Helpers ────────────────────────────────────────────────────────────────────────

	#isOperational(): boolean {
		if (this.#destroyed) {
			return false;
		}
		if (this.#manuallyClosed) {
			if (this.debug) {
				console.warn("ByteSocket: send() called after close() -- message dropped");
			}
			return false;
		}
		if (this.#authState === AuthState.failed) {
			if (this.debug) {
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

	setAuth<D>(config: AuthConfig<D> | undefined) {
		if (this.#destroyed) {
			throw new Error("ByteSocket: cannot call setAuth() after destroy().");
		}
		if (this.#ws !== null && this.readyState !== WebSocket.CLOSED) {
			throw new Error("ByteSocket: auth cannot be changed after connect() has been called.");
		}
		this.#authConfig = config;
	}

	#startAuthTimeout(): void {
		this.#authTimer = setTimeout(() => {
			if (this.#authState === AuthState.pending && this.readyState === WebSocket.OPEN) {
				if (this.debug) {
					console.warn("ByteSocket: auth timeout");
				}
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
		this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.auth_success));
		this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.open));
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
		this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.auth_error), err);
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

	// ──── Heartbeat ────────────────────────────────────────────────────────────────────────

	#startHeartbeat(): void {
		if (!this.#options.heartbeatEnabled) {
			return;
		}
		if (this.debug) {
			console.log("ByteSocket: start heartbeat");
		}
		this.#clearPongTimeout();
		this.#startPingInterval();
	}

	#stopHeartbeat(): void {
		if (this.debug) {
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
				if (this.debug) {
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
			if (this.debug) {
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

	connect(): void {
		if (this.#destroyed) {
			if (this.debug) {
				console.warn("ByteSocket: connect() called after destroy()");
			}
			return;
		}
		if (this.readyState === WebSocket.OPEN || this.readyState === WebSocket.CONNECTING) {
			if (this.debug) {
				console.warn("ByteSocket: already connected or connecting");
			}
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
		if (this.debug) {
			console.log("ByteSocket: connected");
		}
		this.#reconnecting = false;
		this.#reconnectAttempts = 0;
		if (this.#authConfig) {
			this.#authenticate(this.#authConfig);
		} else {
			this.#authState = AuthState.none;
			this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.open));
			this.#startHeartbeat();
			this.#flushQueue();
		}
	}

	// ──── Message Handling ────────────────────────────────────────────────────────────────────────

	#parseMessage(message: MessageEvent): { success: true; payload: UserMessage } | { success: false; payload?: never } {
		if (message.data instanceof Blob) {
			if (this.debug) {
				console.warn("ByteSocket: received unexpected Blob message. Ensure binaryType is 'arraybuffer'.");
			}
			return { success: false };
		}
		try {
			const payload = this.decode(message.data);
			return { success: true, payload };
		} catch (error) {
			if (this.debug) {
				console.error("ByteSocket: decode error", error);
			}
			this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.error), error);
			return { success: false };
		}
	}

	#handleAuthMessage(payload: UserMessage): boolean {
		if ("type" in payload && payload.type === LifecycleTypes.auth_success) {
			if (this.debug) {
				console.log("ByteSocket: auth success");
			}
			this.#handleAuthSuccess();
			return true;
		}
		if ("type" in payload && payload.type === LifecycleTypes.auth_error) {
			if (this.debug) {
				console.warn("ByteSocket: auth error", payload.data);
			}
			this.#handleAuthError(payload.data);
			return true;
		}
		return false;
	}

	#handleEventMessage(payload: UserMessage): boolean {
		if ("type" in payload || "room" in payload || "rooms" in payload || payload.event == null) {
			return false;
		}
		this.triggerCallback(this.#callbacksMap.get(payload.event), payload.data);
		return true;
	}

	#handleMessage(message: MessageEvent): void {
		if (message.data instanceof ArrayBuffer && message.data.byteLength === 0) {
			if (this.debug) {
				console.log("ByteSocket: pong received (empty binary)");
			}
			this.#clearPongTimeout();
			return;
		}

		this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.message), message.data);

		const { success, payload } = this.#parseMessage(message);
		if (!success) {
			return;
		}
		if (this.#handleAuthMessage(payload)) {
			return;
		}
		if (this.rooms._handleMessage(payload)) {
			return;
		}
		if (this.#handleEventMessage(payload)) {
			return;
		}

		if (this.debug) {
			console.warn("ByteSocket: unhandled message", payload);
		}
	}

	// ──── Reconnection ────────────────────────────────────────────────────────────────────────

	reconnect(): void {
		if (this.#destroyed) {
			if (this.debug) {
				console.warn("ByteSocket: reconnect() called after destroy()");
			}
			return;
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
	}

	#clearReconnectTimeout(): void {
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}
	}

	// ──── Close / Destroy ────────────────────────────────────────────────────────────────────────

	close(code?: number, reason?: string): void {
		if (this.#destroyed) {
			return;
		}
		this.#manuallyClosed = true;
		this.#cleanupConnection(true);
		this.#ws?.close(code, reason);
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
		if (!keepQueue) {
			this.#messageQueue = [];
		}
	}

	#handleClose(event: CloseEvent): void {
		if (this.debug) {
			console.log(`ByteSocket: closed (code ${event.code}, reason: ${event.reason})`);
		}
		this.#stopHeartbeat();
		this.#clearAuthTimeout();
		if (!this.#destroyed) {
			this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.close), event);
		}
		if (this.#destroyed || this.#manuallyClosed || this.#authState === AuthState.failed || this.#reconnectExhausted) {
			return;
		}
		if (this.#manualReconnect()) {
			return;
		}
		if (!this.#options.reconnectOnNormalClosure && (event.code === 1000 || event.code === 1001)) {
			if (this.debug) {
				console.log(`ByteSocket: normal closure (code ${event.code}), will not reconnect`);
			}
			return;
		}
		this.#tryAutoReconnect();
	}

	#manualReconnect() {
		if (this.#reconnecting) {
			if (this.debug) {
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
			if (this.debug) {
				console.log(`ByteSocket: reconnecting in ${Math.round(delay)}ms (attempt ${this.#reconnectAttempts})`);
			}
			this.#reconnectTimer = setTimeout(() => {
				this.#reconnectTimer = null;
				this.#createSocket();
			}, delay);
			return;
		}
		if (this.debug) {
			if (this.#reconnectAttempts >= this.#options.maxReconnectionAttempts) {
				console.warn("ByteSocket: max reconnection attempts reached");
			} else {
				console.log("ByteSocket: reconnection disabled, not reconnecting");
			}
		}
		if (!this.#reconnectExhausted) {
			this.#reconnectExhausted = true;
			this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.reconnect_failed));
		}
	}

	// ──── Error ────────────────────────────────────────────────────────────────────────

	#handleError(event: Event): void {
		const ctx: ErrorContext = {
			phase: "network",
			error: event instanceof Error ? event : new Error("WebSocket error"),
			raw: JSON.stringify(event),
		};
		if (this.debug) {
			console.error("ByteSocket: error", event);
		}
		this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.error), ctx);
		if (
			this.#ws &&
			this.#ws.readyState === WebSocket.CONNECTING &&
			this.#reconnectAttempts >= this.#options.maxReconnectionAttempts &&
			!this.#reconnectExhausted
		) {
			this.#reconnectExhausted = true;
			this.triggerCallback(this.lifecycleCallbacksMap.get(LifecycleTypes.reconnect_failed));
		}
	}
}
