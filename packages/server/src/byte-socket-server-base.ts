// packages/server/src/byte-socket-server-base.ts
import {
	ByteSocketBase,
	LifecycleTypes,
	type AnyCallback,
	type ErrorContext,
	type EventsForRooms,
	type SocketEvents,
	type StringKeys,
	type StringNumberKeys,
	type UserMessage,
} from "@bytesocket/core";
import type { IByteSocket, ILifecycleServer, IRoomsBulkLifecycleServer, IRoomsLifecycleServer, IRoomsServer, ISocket } from "./interfaces";
import { SocketServerBase } from "./socket-server-base";
import type {
	ByteSocketOptionsBase,
	EventCallback,
	Middleware,
	MiddlewareNext,
	RoomEventMiddleware,
	ServerIncomingData,
	ServerOutgoingData,
	SocketData,
} from "./types";

type RequiredOptions =
	| "middlewareTimeout"
	| "roomMiddlewareTimeout"
	| "authTimeout"
	| "broadcastRoom"
	| "onMiddlewareError"
	| "onMiddlewareTimeout"
	| "idleTimeout"
	| "sendPingsAutomatically";

export abstract class ByteSocketServerBase<
	TEvents extends SocketEvents = SocketEvents,
	SD extends SocketData = SocketData,
	UpgradeCallback extends AnyCallback = AnyCallback,
>
	extends ByteSocketBase
	implements IByteSocket<TEvents, SD, UpgradeCallback>
{
	// ──── Namespaces ────────────────────────────────────────────────────────────────────────
	readonly lifecycle: ILifecycleServer<TEvents, SD, UpgradeCallback>;
	readonly rooms: IRoomsServer<TEvents, SD>;
	readonly sockets = new Map<string, ISocket<TEvents, SD>>();

	// ──── States ────────────────────────────────────────────────────────────────────────

	protected options: Omit<ByteSocketOptionsBase<TEvents, SD>, RequiredOptions | "debug" | "serialization" | "msgpackrOptions"> &
		Pick<Required<ByteSocketOptionsBase<TEvents, SD>>, RequiredOptions>;
	#middlewares: Middleware<TEvents, SD>[] = [];
	#destroyed = false;

	constructor(options: ByteSocketOptionsBase<TEvents, SD> = {}) {
		super(options);

		this.options = {
			...options,
			middlewareTimeout: options.middlewareTimeout ?? 5000,
			roomMiddlewareTimeout: options.roomMiddlewareTimeout ?? 5000,
			authTimeout: options.authTimeout ?? 5000,
			broadcastRoom: options.broadcastRoom ?? "__bytesocket_broadcast__",
			onMiddlewareError: options.onMiddlewareError ?? "ignore",
			onMiddlewareTimeout: options.onMiddlewareTimeout ?? "ignore",
			idleTimeout: options.idleTimeout ?? 120,
			sendPingsAutomatically: options.sendPingsAutomatically ?? true,
		};

		const lifecycle: ILifecycleServer<TEvents, SD, UpgradeCallback> = {
			onUpgrade: (callback) => {
				this._onLifecycle(LifecycleTypes.upgrade, callback);
				return lifecycle;
			},
			offUpgrade: (callback) => {
				this._offLifecycle(LifecycleTypes.upgrade, callback);
				return lifecycle;
			},
			onceUpgrade: (callback) => {
				this._onceLifecycle(LifecycleTypes.upgrade, callback);
				return lifecycle;
			},

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
		};

		this.lifecycle = lifecycle;

		const roomsLifecycle: IRoomsLifecycleServer<TEvents, SD> = {
			onJoin: (callback) => {
				this._onLifecycle(LifecycleTypes.join_room, callback);
				return roomsLifecycle;
			},
			offJoin: (callback) => {
				this._offLifecycle(LifecycleTypes.join_room, callback);
				return roomsLifecycle;
			},
			onceJoin: (callback) => {
				this._onceLifecycle(LifecycleTypes.join_room, callback);
				return roomsLifecycle;
			},

			onLeave: (callback) => {
				this._onLifecycle(LifecycleTypes.leave_room, callback);
				return roomsLifecycle;
			},
			offLeave: (callback) => {
				this._offLifecycle(LifecycleTypes.leave_room, callback);
				return roomsLifecycle;
			},
			onceLeave: (callback) => {
				this._onceLifecycle(LifecycleTypes.leave_room, callback);
				return roomsLifecycle;
			},
		};

		const roomsBulkLifecycle: IRoomsBulkLifecycleServer<TEvents, SD> = {
			onJoin: (callback) => {
				this._onLifecycle(LifecycleTypes.join_rooms, callback);
				return roomsBulkLifecycle;
			},
			offJoin: (callback) => {
				this._offLifecycle(LifecycleTypes.join_rooms, callback);
				return roomsBulkLifecycle;
			},
			onceJoin: (callback) => {
				this._onceLifecycle(LifecycleTypes.join_rooms, callback);
				return roomsBulkLifecycle;
			},

			onLeave: (callback) => {
				this._onLifecycle(LifecycleTypes.leave_rooms, callback);
				return roomsBulkLifecycle;
			},
			offLeave: (callback) => {
				this._offLifecycle(LifecycleTypes.leave_rooms, callback);
				return roomsBulkLifecycle;
			},
			onceLeave: (callback) => {
				this._onceLifecycle(LifecycleTypes.leave_rooms, callback);
				return roomsBulkLifecycle;
			},
		};

		this.rooms = {
			publishRaw: this.publishRaw.bind(this),
			emit: this.#publish.bind(this),
			on: this.#onRoom.bind(this),
			off: this.#offRoom.bind(this),
			once: this.#onceRoom.bind(this),
			lifecycle: roomsLifecycle,
			bulk: {
				emit: this.#publishMany.bind(this),
				lifecycle: roomsBulkLifecycle,
			},
		};
	}

	abstract attach(server: unknown, path: string): this;
	abstract destroy(): void;

	protected abstract publishRaw(room: string, message: ServerOutgoingData, isBinary?: boolean, compress?: boolean): typeof this.rooms;

	protected _destroy(): void {
		this.#destroyed = true;

		for (const socket of this.sockets.values()) {
			if (!socket.isClosed) {
				socket.close(1001, "server destroy");
			}
		}
		this.sockets.clear();

		this._clearCallbacks();
		this.#middlewares = [];
	}

	emit<E extends StringNumberKeys<TEvents["emit"]>, D extends NonNullable<TEvents["emit"]>[E]>(event: E, data: D): this {
		if (this.#destroyed) {
			return this;
		}
		const message = this.encode({ event, data });
		this.publishRaw(this.options.broadcastRoom, message);
		return this;
	}

	#publish<
		R extends StringKeys<TEvents["emitRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["emitRoom"]>[R]>,
		D extends NonNullable<TEvents["emitRoom"]>[R][E],
	>(room: R, event: E, data: D): typeof this.rooms {
		if (this.#destroyed) {
			return this.rooms;
		}
		const message = this.encode({ room, event, data });
		this.publishRaw(room, message);
		return this.rooms;
	}

	#publishMany<
		Rs extends NonNullable<TEvents["emitRooms"]>["rooms"],
		E extends StringNumberKeys<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>,
		D extends NonNullable<EventsForRooms<NonNullable<TEvents["emitRooms"]>, Rs>>[E],
	>(rooms: Rs, event: E, data: D): typeof this.rooms.bulk {
		if (this.#destroyed) {
			return this.rooms.bulk;
		}
		const message = this.encode({ rooms, event, data });
		for (const room of rooms) {
			this.publishRaw(room, message);
		}
		return this.rooms.bulk;
	}

	on<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(
		event: E,
		callback: EventCallback<TEvents, SD, D>,
	): this {
		this._on(event, callback);
		return this;
	}

	off<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(
		event: E,
		callback?: EventCallback<TEvents, SD, D>,
	): this {
		this._off(event, callback);
		return this;
	}

	once<E extends StringNumberKeys<TEvents["listen"]>, D extends NonNullable<TEvents["listen"]>[E]>(
		event: E,
		callback: EventCallback<TEvents, SD, D>,
	): this {
		this._once(event, callback);
		return this;
	}

	#onRoom<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: RoomEventMiddleware<TEvents, SD, D>): typeof this.rooms {
		this._onRoom(room, event, callback);
		return this.rooms;
	}

	#offRoom<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event?: E, callback?: RoomEventMiddleware<TEvents, SD, D>): typeof this.rooms {
		this._offRoom(room, event, callback);
		return this.rooms;
	}

	#onceRoom<
		R extends StringKeys<TEvents["listenRoom"]>,
		E extends StringNumberKeys<NonNullable<TEvents["listenRoom"]>[R]>,
		D extends NonNullable<TEvents["listenRoom"]>[R][E],
	>(room: R, event: E, callback: RoomEventMiddleware<TEvents, SD, D>): typeof this.rooms {
		this._onceRoom(room, event, callback);
		return this.rooms;
	}

	use(fn: Middleware<TEvents, SD>): this {
		this.#middlewares.push(fn);
		return this;
	}

	#runMiddlewares<R extends string, E extends string | number, D>(
		socket: ISocket<TEvents, SD>,
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
				this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase, error });

				const option = isTimeout ? this.options.onMiddlewareTimeout : this.options.onMiddlewareError;
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
					this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "finalCallback", error: err });
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
						const timeoutError = new Error(`Middleware timeout after ${this.options.middlewareTimeout}ms`);
						timeoutError.name = "TimeoutError";
						reject(timeoutError);
					}
				}, this.options.middlewareTimeout);
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

	#rawMessageDescription(message: ServerIncomingData, isBinary: boolean): string {
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

	protected message(socket: ISocket<TEvents, SD>, message: ServerIncomingData, isBinary: boolean) {
		this._runSyncHooks(this._lifecycleCallbacksMap.get(LifecycleTypes.message), [socket, message, isBinary], (error) => {
			if (error != null) {
				this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onMessage", error });
			}
		});

		if (isBinary && (message.byteLength === 0 || (message instanceof Buffer && message.length === 0))) {
			socket.sendRaw(new Uint8Array(0), true);
			return;
		}

		let parsed;
		try {
			parsed = this.decode(message, isBinary);
		} catch (error) {
			const raw = this.#rawMessageDescription(message, isBinary);
			this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "decode", raw, error });
			socket.close(1008, "decode error");
			return;
		}

		if (parsed == null || typeof parsed !== "object") {
			const error = new Error("Message must be an object");
			this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, {
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
			if (this.#handleRoomsEventMessage(socket, parsed)) {
				return;
			}
			if (this.#handleRoomEventMessage(socket, parsed)) {
				return;
			}
			if (this.#handleEventMessage(socket, parsed)) {
				return;
			}
		});
	}

	protected close(socket: ISocket<TEvents, SD>, code: number, reason: Buffer | ArrayBuffer) {
		if (this._debug && code === 4008) {
			console.warn(`Auth timeout for socket ${socket.id}`);
		}
		this.sockets.delete(socket.id);
		socket.close(code, Buffer.from(reason as ArrayBuffer).toString("utf8"));
		this._runSyncHooks(this._lifecycleCallbacksMap.get(LifecycleTypes.close), [socket, code, reason], (error) => {
			if (error != null) {
				this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onClose", error });
			}
		});
	}

	#handleAuthMessage<T extends object>(socket: ISocket<TEvents, SD>, parsed: T): boolean {
		if (!this._isLifecyclePayloadMessage(LifecycleTypes.auth, parsed)) {
			return false;
		}
		socket._handleAuth(parsed, this.options.auth, this.options.authTimeout, (err) => {
			if (err == null) {
				this._runSyncHooks(this._lifecycleCallbacksMap.get(LifecycleTypes.auth_success), [socket], (error) => {
					if (error != null) {
						this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onAuthSuccess", error });
					}
				});
				this._runSyncHooks(this._lifecycleCallbacksMap.get(LifecycleTypes.open), [socket], (error) => {
					if (error != null) {
						this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onOpen", error });
					}
				});
			} else {
				const ctx: ErrorContext = {
					phase: "auth",
					error: err instanceof Error ? err : new Error(String(err)),
					code: 4003,
				};
				this._runSyncHooks(this._lifecycleCallbacksMap.get(LifecycleTypes.auth_error), [socket, ctx], (error) => {
					if (error != null) {
						this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onAuthError", error });
					}
				});
			}
		});
		return true;
	}

	#handleJoinRoomMessage<T extends object>(socket: ISocket<TEvents, SD>, parsed: T): boolean {
		if (!this._isLifecycleRoomMessage(LifecycleTypes.join_room, parsed)) {
			return false;
		}
		this.#runAsyncHooksOrNext(this._lifecycleCallbacksMap.get(LifecycleTypes.join_room), [socket, parsed.room], (error) => {
			if (error == null) {
				socket.rooms.join(parsed.room);
				socket.send({ type: LifecycleTypes.join_room_success, room: parsed.room });
			} else {
				socket.send({ type: LifecycleTypes.join_room_error, room: parsed.room, data: { phase: "onJoinRoom", error } });
			}
		});
		return true;
	}

	#handleLeaveRoomMessage<T extends object>(socket: ISocket<TEvents, SD>, parsed: T): boolean {
		if (!this._isLifecycleRoomMessage(LifecycleTypes.leave_room, parsed)) {
			return false;
		}
		this.#runAsyncHooksOrNext(this._lifecycleCallbacksMap.get(LifecycleTypes.leave_room), [socket, parsed.room], (error) => {
			if (error == null) {
				socket.rooms.leave(parsed.room);
				socket.send({ type: LifecycleTypes.leave_room_success, room: parsed.room });
			} else {
				socket.send({ type: LifecycleTypes.leave_room_error, room: parsed.room, data: { phase: "onLeaveRoom", error } });
			}
		});
		return true;
	}

	#handleJoinRoomsMessage<T extends object>(socket: ISocket<TEvents, SD>, parsed: T): boolean {
		if (!this._isLifecycleRoomsMessage(LifecycleTypes.join_rooms, parsed)) {
			return false;
		}
		this.#runAsyncHooksOrNext(this._lifecycleCallbacksMap.get(LifecycleTypes.join_rooms), [socket, parsed.rooms], (error) => {
			if (error == null) {
				socket.rooms.bulk.join(parsed.rooms);
				socket.send({ type: LifecycleTypes.join_rooms_success, rooms: parsed.rooms });
			} else {
				socket.send({ type: LifecycleTypes.join_rooms_error, rooms: parsed.rooms, data: { phase: "onJoinRooms", error } });
			}
		});
		return true;
	}

	#handleLeaveRoomsMessage<T extends object>(socket: ISocket<TEvents, SD>, parsed: T): boolean {
		if (!this._isLifecycleRoomsMessage(LifecycleTypes.leave_rooms, parsed)) {
			return false;
		}
		this.#runAsyncHooksOrNext(this._lifecycleCallbacksMap.get(LifecycleTypes.leave_rooms), [socket, parsed.rooms], (error) => {
			if (error == null) {
				socket.rooms.bulk.leave(parsed.rooms);
				socket.send({ type: LifecycleTypes.leave_rooms_success, rooms: parsed.rooms });
			} else {
				socket.send({ type: LifecycleTypes.leave_rooms_error, rooms: parsed.rooms, data: { phase: "onLeaveRooms", error } });
			}
		});
		return true;
	}

	#handleRoomsEventMessage<T extends object>(socket: ISocket<TEvents, SD>, parsed: T): boolean {
		if (!this._isRoomsEventMessage(parsed)) {
			return false;
		}
		const message = this.encode({ rooms: parsed.rooms, event: parsed.event, data: parsed.data });
		for (const room of parsed.rooms) {
			this.#runAsyncHooksOrNext(this._roomCallbacksMap.get(room)?.get(parsed.event), [socket, parsed.data], (error) => {
				if (error == null) {
					socket.rooms.publishRaw(room, message);
				} else {
					this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, {
						phase: "rooms message",
						raw: JSON.stringify(parsed),
						error,
					});
				}
			});
		}
		return true;
	}

	#handleRoomEventMessage<T extends object>(socket: ISocket<TEvents, SD>, parsed: T): boolean {
		if (!this._isRoomEventMessage(parsed)) {
			return false;
		}
		this.#runAsyncHooksOrNext(this._roomCallbacksMap.get(parsed.room)?.get(parsed.event), [socket, parsed.data], (error) => {
			if (error == null) {
				const message = this.encode({ room: parsed.room, event: parsed.event, data: parsed.data });
				socket.rooms.publishRaw(parsed.room, message);
			} else {
				this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, {
					phase: "room message",
					raw: JSON.stringify(parsed),
					error,
				});
			}
		});
		return true;
	}

	#handleEventMessage<T extends object>(socket: ISocket<TEvents, SD>, parsed: T): boolean {
		if (!this._isEventMessage(parsed)) {
			return false;
		}
		this._triggerCallbacks(this._callbacksMap.get(parsed.event), socket, parsed.data);
		return true;
	}

	protected _runSyncHooks<Args extends Array<unknown>>(callbackSet: Set<AnyCallback> | undefined, args: Args, next: MiddlewareNext): void {
		if (!callbackSet) {
			return next();
		}
		let firstError: unknown = null;
		for (const callback of callbackSet) {
			try {
				callback(...args);
			} catch (err) {
				if (this._debug) {
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
				const socket = args[0] instanceof SocketServerBase ? args[0] : undefined;
				this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "asyncHookFinal", error: err });
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
					const socket = args[0] instanceof SocketServerBase ? args[0] : undefined;
					this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "asyncHookFinal", error: err });
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
						const timeoutError = new Error(`Room middleware timeout after ${this.options.roomMiddlewareTimeout}ms`);
						timeoutError.name = "TimeoutError";
						reject(timeoutError);
					}
				}, this.options.roomMiddlewareTimeout);
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
}
