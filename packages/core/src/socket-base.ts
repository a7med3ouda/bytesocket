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
import type { AuthFunction, ISocket, ISocketRooms, MiddlewareNext, ServerOutgoingData, SocketData } from "./types";

export abstract class SocketBase<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData> implements ISocket<TEvents, SD> {
	readonly rooms: ISocketRooms<this, TEvents>;

	payload: any = {};
	locals: any = {};

	#encode: <R extends string, E extends string | number, D>(
		payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
	) => string | Buffer<ArrayBufferLike>;
	#authState: AuthState = AuthState.idle;
	#authTimer: ReturnType<typeof setTimeout> | null = null;
	#closed: boolean = false;

	get isAuthenticated(): boolean {
		return this.#authState === AuthState.none || this.#authState === AuthState.success;
	}
	get isClosed(): boolean {
		return this.#closed;
	}
	get canSend(): boolean {
		return !this.#closed && this.isAuthenticated;
	}

	abstract readonly userData: SD;
	get id(): string {
		return this.userData.socketKey;
	}
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

	protected abstract readonly broadcastRoom: string;

	constructor(
		encode: <R extends string, E extends string | number, D>(
			payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
		) => string | Buffer<ArrayBufferLike>,
	) {
		this.#encode = encode;
		this.rooms = {
			publishRaw: this.publishRaw.bind(this),
			emit: this.#publish.bind(this),
			join: this.joinRoom.bind(this),
			leave: this.leaveRoom.bind(this),
			list: this.getRoomList.bind(this),
			bulk: {
				emit: this.#publishMany.bind(this),
				join: this.#joinRooms.bind(this),
				leave: this.#leaveRooms.bind(this),
			},
		};
	}

	abstract sendRaw(message: ServerOutgoingData, isBinary?: boolean, compress?: boolean): this;

	protected abstract getRoomList(includeBroadcast?: boolean): string[];

	protected abstract publishRaw(room: string, message: ServerOutgoingData, isBinary?: boolean, compress?: boolean): this;

	protected abstract joinRoom(room: string): this;

	protected abstract leaveRoom(room: string): this;

	protected abstract closeTransport(code: number, reason: string): void;

	protected startHeartbeat(): void {}

	protected clearHeartbeat(): void {}

	emit<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): this {
		this.send({ event, data });
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
		this.publishRaw(this.broadcastRoom, message);
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
		this.publishRaw(room, message);
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
			this.publishRaw(room, message);
		}
		return this;
	}

	#joinRooms(rooms: string[]): this {
		if (!this.canSend) {
			return this;
		}
		for (const room of rooms) {
			this.joinRoom(room);
		}
		return this;
	}

	#leaveRooms(rooms: string[]): this {
		if (!this.canSend) {
			return this;
		}
		for (const room of rooms) {
			this.leaveRoom(room);
		}
		return this;
	}

	close(code = 1000, reason = "normal"): void {
		this.#clearAuthTimer();
		this.clearHeartbeat();
		if (!this.#closed) {
			this.closeTransport(code, reason);
			this.#closed = true;
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
					this.rooms.join(this.broadcastRoom);
					this.startHeartbeat();
					next();
				});
			} catch (err) {
				this.#setAuthFailed({ phase: "auth", error: err, code: 4003 });
				next(err);
			}
		} else {
			this.#handleNoAuth();
			this.startHeartbeat();
			next();
		}
	}

	#handleNoAuth() {
		if (this.#closed || this.#authState !== AuthState.idle) {
			return;
		}
		this.#authState = AuthState.none;
		this.rooms.join(this.broadcastRoom);
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
