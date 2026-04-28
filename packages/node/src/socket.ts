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
import { WebSocket } from "ws";
import type { RoomManager } from "./room-manager";
import type { AuthFunction, HeartbeatConfig, ISocket, MiddlewareNext, SocketData, SocketRoomsAPI } from "./types";

/**
 * Represents an individual WebSocket connection.
 *
 * Provides methods for sending messages, joining/leaving rooms, and accessing
 * connection metadata. You receive instances of this class in lifecycle hooks,
 * middleware, and event listeners.
 *
 * @typeParam SD - The socket data type (must extend `SocketData`).
 * @typeParam TEvents - The event map type (from `SocketEvents`) for type-safe emits.
 *
 * @example
 * io.lifecycle.onOpen((socket) => {
 *   console.log(`Socket ${socket.id} connected`);
 *   socket.rooms.join("lobby");
 *   socket.emit("welcome", { message: "Hello!" });
 * });
 */
export class Socket<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData> implements ISocket<TEvents, SD> {
	readonly rooms: SocketRoomsAPI<this, TEvents>;
	readonly id: string;

	payload: any = {};
	locals: any = {};

	readonly #ws: WebSocket;
	readonly #broadcastRoom: string;
	readonly #encode: <R extends string, E extends string | number, D>(
		payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
	) => string | Buffer<ArrayBufferLike>;
	#authState: AuthState = AuthState.idle;
	#authTimer: ReturnType<typeof setTimeout> | null = null;
	#closed: boolean = false;
	#roomManager: RoomManager<TEvents, SD>;
	#rooms: Set<string> = new Set();
	#onMessageResetIdle: (() => void) | undefined;

	// ──── Heartbeat ──────────────────────────────────────────────
	readonly #heartbeat: {
		enabled: boolean;
		idleTimeoutMs: number;
		pingIntervalMs: number;
	};
	#idleTimer: ReturnType<typeof setTimeout> | undefined;
	#pingIntervalHandle: ReturnType<typeof setInterval> | undefined;
	#heartbeatStarted: boolean = false;
	// ──────────────────────────────────────────────────────────────

	get isAuthenticated(): boolean {
		return this.#authState === AuthState.none || this.#authState === AuthState.success;
	}
	get isClosed(): boolean {
		return this.#closed;
	}
	get canSend(): boolean {
		return !this.#closed && this.isAuthenticated;
	}
	readonly userData: SD;
	get url(): string {
		return this.userData.url;
	}
	get query(): string {
		return this.userData.query;
	}
	get cookie(): string {
		return this.userData.cookie;
	}
	get authorization(): string {
		return this.userData.authorization;
	}
	get userAgent(): string {
		return this.userData.userAgent;
	}
	get host(): string {
		return this.userData.host;
	}
	get xForwardedFor(): string {
		return this.userData.xForwardedFor;
	}

	/** @internal */
	constructor(
		ws: WebSocket,
		data: SD,
		broadcastRoom: string,
		roomManager: RoomManager<TEvents, SD>,
		encode: <R extends string, E extends string | number, D>(
			payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
		) => string | Buffer<ArrayBufferLike>,
		heartbeatConfig?: HeartbeatConfig,
	) {
		this.userData = data;
		this.id = data.socketKey;
		this.#ws = ws;
		this.#broadcastRoom = broadcastRoom;
		this.#roomManager = roomManager;
		this.#encode = encode;
		const idleTimeoutSec = heartbeatConfig?.idleTimeout ?? 120;
		const sendPings = heartbeatConfig?.sendPingsAutomatically ?? true;

		if (sendPings && idleTimeoutSec > 0) {
			this.#heartbeat = {
				enabled: true,
				idleTimeoutMs: idleTimeoutSec * 1000,
				pingIntervalMs: (idleTimeoutSec * 1000) / 2,
			};
		} else {
			this.#heartbeat = { enabled: false, idleTimeoutMs: 0, pingIntervalMs: 0 };
		}

		this.rooms = {
			publishRaw: this.#publishRaw.bind(this),
			emit: this.#publish.bind(this),
			join: this.#joinRoom.bind(this),
			leave: this.#leaveRoom.bind(this),
			list: (includeBroadcast = false) => {
				if (this.#closed) {
					return includeBroadcast ? [...this.#rooms] : [...this.#rooms].filter((r) => r !== this.#broadcastRoom);
				}
				return this.#roomManager.getSocketRooms(this, includeBroadcast ? undefined : this.#broadcastRoom);
			},
			bulk: {
				emit: this.#publishMany.bind(this),
				join: this.#joinRooms.bind(this),
				leave: this.#leaveRooms.bind(this),
			},
		};
	}

	emit<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): this {
		this.send({ event, data });
		return this;
	}

	sendRaw(message: WebSocket.Data, isBinary: boolean = typeof message !== "string", compress?: boolean): this {
		if (this.#closed) {
			return this;
		}
		this.#ws.send(message, { binary: isBinary, compress });
		return this;
	}

	send<R extends string, E extends string | number, D>(payload: LifecycleMessage<R, D> | UserMessage<R, E, D>): this {
		if (!this.canSend) {
			return this;
		}
		const message = this.#encode(payload);
		this.sendRaw(message);
		return this;
	}

	broadcast<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): this {
		if (!this.canSend) {
			return this;
		}
		const message = this.#encode({ event, data });
		this.#publishRaw(this.#broadcastRoom, message);
		return this;
	}

	#publishRaw(room: string, message: WebSocket.Data, isBinary: boolean = typeof message !== "string", compress?: boolean): this {
		if (this.#closed) {
			return this;
		}
		this.#roomManager.publish(this, room, message, isBinary, compress);
		return this;
	}

	#sendUnchecked<R extends string, E extends string | number, D>(payload: LifecycleMessage<R, D> | UserMessage<R, E, D>): void {
		if (this.#closed) {
			return;
		}
		const message = this.#encode(payload);
		this.sendRaw(message);
	}

	#publish<
		R extends StringKeys<TEvents["emitRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["emitRoom"]>[R]>,
		D extends NonNullable<TEvents["emitRoom"]>[R][E],
	>(room: R, event: E, data: D): this {
		if (!this.canSend) {
			return this;
		}
		const message = this.#encode({ room, event, data });
		this.#publishRaw(room, message);
		return this;
	}

	#publishMany<
		Rs extends NonNullable<TEvents["emitRooms"]>["rooms"],
		E extends StringNumberKeys<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>,
		D extends NonNullable<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>[E],
	>(rooms: Rs, event: E, data: D): this {
		if (!this.canSend) {
			return this;
		}
		const message = this.#encode({ rooms, event, data });
		for (const room of rooms) {
			this.#publishRaw(room, message);
		}
		return this;
	}

	#joinRoom(room: string): this {
		if (!this.canSend) {
			return this;
		}
		if (this.#roomManager.isSubscribed(this, room) || this.#rooms.has(room)) {
			return this;
		}
		this.#rooms.add(room);
		this.#roomManager.join(this, room);
		return this;
	}

	#leaveRoom(room: string): this {
		if (!this.canSend) {
			return this;
		}
		if (!this.#roomManager.isSubscribed(this, room) && !this.#rooms.has(room)) {
			return this;
		}
		this.#rooms.delete(room);
		this.#roomManager.leave(this, room);
		return this;
	}

	#joinRooms(rooms: string[]): this {
		if (!this.canSend) {
			return this;
		}
		for (const room of rooms) {
			this.#joinRoom(room);
		}
		return this;
	}

	#leaveRooms(rooms: string[]): this {
		if (!this.canSend) {
			return this;
		}
		for (const room of rooms) {
			this.#leaveRoom(room);
		}
		return this;
	}

	_markClosed(): void {
		this.#closed = true;
		this.#clearAuthTimer();
		this.#clearHeartbeat();
		this.#roomManager.leaveAll(this);
	}

	close(code: number = 1000, reason: string = "normal"): void {
		if (this.#closed) {
			return;
		}
		this._markClosed();
		this.#ws.close(code, reason);
	}

	#startHeartbeat(): void {
		if (this.#heartbeatStarted || this.#closed || !this.#heartbeat.enabled) {
			return;
		}
		this.#heartbeatStarted = true;

		const resetIdle = () => {
			clearTimeout(this.#idleTimer);
			this.#idleTimer = setTimeout(() => {
				if (!this.#closed) {
					this.close(1001, "idle timeout");
				}
			}, this.#heartbeat.idleTimeoutMs);
		};
		this.#onMessageResetIdle = resetIdle;

		this.#ws.on("pong", resetIdle);
		this.#ws.on("message", resetIdle);

		resetIdle();

		this.#pingIntervalHandle = setInterval(() => {
			if (this.#closed) {
				return;
			}
			this.#ws.ping();
		}, this.#heartbeat.pingIntervalMs);
	}

	#clearHeartbeat(): void {
		if (this.#pingIntervalHandle) {
			clearInterval(this.#pingIntervalHandle);
			this.#pingIntervalHandle = undefined;
		}
		if (this.#idleTimer) {
			clearTimeout(this.#idleTimer);
			this.#idleTimer = undefined;
		}
		if (this.#onMessageResetIdle) {
			this.#ws.off("message", this.#onMessageResetIdle);
			this.#ws.off("pong", this.#onMessageResetIdle);
			this.#onMessageResetIdle = undefined;
		}
	}

	_handleAuth<D>(
		parsed: { type: LifecycleTypes.auth; data: D } | null,
		auth: AuthFunction<TEvents, SD, D> | undefined,
		authTimeout: number,
		next: MiddlewareNext,
	) {
		if (auth && parsed !== null) {
			if (this.#authState !== AuthState.idle) {
				return;
			}
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
					this.#setAuthSuccess(payload);
					this.rooms.join(this.#broadcastRoom);
					this.#startHeartbeat();
					next();
				});
			} catch (err) {
				this.#setAuthFailed({ phase: "auth", error: err, code: 4003 });
				next(err);
			}
		} else {
			this.#handleNoAuth();
			this.#startHeartbeat();
			next();
		}
	}

	#handleNoAuth() {
		if (this.#closed || this.#authState !== AuthState.idle) {
			return;
		}
		this.#authState = AuthState.none;
		this.rooms.join(this.#broadcastRoom);
	}

	#setAuthSuccess<P>(payload: P): void {
		if (this.#closed || this.#authState !== AuthState.pending) {
			return;
		}
		this.#clearAuthTimer();
		this.#authState = AuthState.success;
		this.payload = payload;
		this.#sendUnchecked({ type: LifecycleTypes.auth_success });
	}

	#setAuthFailed(ctx: ErrorContext): void {
		if (this.#closed || this.#authState !== AuthState.pending) {
			return;
		}
		this.#clearAuthTimer();
		this.#authState = AuthState.failed;
		this.#sendUnchecked({ type: LifecycleTypes.auth_error, data: ctx });
		this.close(ctx.code, ctx.phase);
	}

	#clearAuthTimer(): void {
		if (this.#authTimer) {
			clearTimeout(this.#authTimer);
			this.#authTimer = null;
		}
	}
}
