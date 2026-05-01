// packages/uws/src/byte-socket.ts
import {
	ByteSocketServerBase,
	LifecycleTypes,
	type IByteSocket,
	type ServerOutgoingData,
	type SocketData,
	type SocketEvents,
} from "@bytesocket/server";
import { randomUUID } from "node:crypto";
import type { HttpRequest, HttpResponse, TemplatedApp, us_socket_context_t, WebSocket } from "uWebSockets.js";
import { Socket } from "./socket";
import type { ByteSocketOptions, WebSocketServerOptions } from "./types";

type UpgradeCallback<SD> = (res: HttpResponse, req: HttpRequest, userData: SD, context: us_socket_context_t) => void;

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
 *   emitRooms:
 *     | { rooms: ['lobby', 'announcements']; event: { 'alert': string } }
 *     | { rooms: ['roomA', 'roomB']; event: { 'message': { text: string } } };
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
export class ByteSocket<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData>
	extends ByteSocketServerBase<TEvents, SD, UpgradeCallback<SD>>
	implements IByteSocket<TEvents, SD, UpgradeCallback<SD>>
{
	#app: TemplatedApp | undefined;
	#serverOptions: WebSocketServerOptions<SD> | undefined;

	/**
	 * Creates a new ByteSocket server instance.
	 *
	 * @param options - Configuration options.
	 *
	 * @example
	 * import uWS from 'uWebSockets.js';
	 * const app = uWS.App();
	 * const io = new ByteSocket({ debug: true });
	 *
	 * // Global middleware (runs before every user message)
	 * io.use((socket, ctx, next) => { ... })
	 *
	 * // Event listener
	 * io.on("event", (socket, data) => { ... })
	 *
	 * io.attach(app, "/socket");
	 * app.listen(3000, (token) => { if (token) console.log('Listening'); });
	 */
	constructor(options: ByteSocketOptions<TEvents, SD> = {}) {
		super(options);
		this.#serverOptions = options.serverOptions;
	}

	protected publishRaw(
		room: string,
		message: ServerOutgoingData,
		isBinary: boolean = typeof message !== "string",
		compress?: boolean,
	): typeof this.rooms {
		if (!this.#app || this.destroyed) {
			return this.rooms;
		}
		this.#app.publish(room, message, isBinary, compress);
		return this.rooms;
	}

	/**
	 * Attaches ByteSocket to a uWebSockets.js app.
	 *
	 * @param app  - The uWebSockets.js TemplatedApp instance.
	 * @param path - The WebSocket path (e.g. `"/ws"`).
	 * @returns This instance (for chaining).
	 *
	 * @example
	 * io.attach(app, "/socket");
	 * app.listen(3000);
	 */
	attach(app: TemplatedApp, path: string): this {
		if (this.destroyed) {
			return this;
		}
		app.ws(path, {
			...this.#serverOptions,
			idleTimeout: this.options.idleTimeout,
			sendPingsAutomatically: this.options.sendPingsAutomatically,
			upgrade: this.#upgrade.bind(this),
			open: this.#open.bind(this),
			message: this.#message.bind(this),
			close: this.#close.bind(this),
		});
		this.#app = app;
		return this;
	}

	/**
	 * Permanently destroy the server instance, closing all connections and
	 * cleaning up resources. The instance **cannot be reused** after this call.
	 *
	 * **Note about the WebSocket route:** uWebSockets.js does not offer a way
	 * to delete a registered route. After `destroy()`, the route still exists
	 * on the `TemplatedApp`, but it now points to the destroyed instance and
	 * will not function correctly. To fully replace ByteSocket on the same path,
	 * **attach a new ByteSocket instance** – `app.ws()` will overwrite the
	 * previous route, making the old one inactive.
	 *
	 * @example
	 * ```ts
	 * const app = uWS.App();
	 * const io = new ByteSocket();
	 * io.attach(app, "/ws");
	 *
	 * // Later, during shutdown or re‑configuration:
	 * io.destroy();
	 *
	 * // Reuse the same app and path with a fresh instance.
	 * // The new attach() replaces the dead route automatically:
	 * const io2 = new ByteSocket();
	 * io2.attach(app, "/ws");  // works – overrides the old, destroyed route
	 * ```
	 */
	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this._destroy();
		this.#app = undefined;
	}

	#upgrade(res: HttpResponse, req: HttpRequest, context: us_socket_context_t) {
		if (this.destroyed) {
			res.writeStatus("503 Service Unavailable");
			res.end("Server is shutting down");
			return;
		}
		if (this.options.origins?.length) {
			const origin = req.getHeader("origin");
			if (origin) {
				const normalized = origin.toLowerCase();
				const allowed = this.options.origins.some((o) => o.toLowerCase() === normalized);
				if (!allowed) {
					res.writeStatus("403 Forbidden");
					res.end("Origin not allowed");
					return;
				}
			}
		}
		const userData = {
			socketKey: randomUUID(),
			url: req.getUrl() ?? "",
			query: req.getQuery() ?? "",
			host: req.getHeader("host") ?? "",
			cookie: req.getHeader("cookie") ?? "",
			userAgent: req.getHeader("user-agent") ?? "",
			authorization: req.getHeader("authorization") ?? "",
			xForwardedFor: req.getHeader("x-forwarded-for") ?? "",
		} as SD;

		this._runSyncHooks(this._lifecycleCallbacksMap.get(LifecycleTypes.upgrade), [res, req, userData, context], (error) => {
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
				this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), null, { phase: "onUpgrade", error });
			}
		});
	}

	#open(ws: WebSocket<SD>) {
		if (this.destroyed) {
			ws.end(1001, "server destroyed");
			return;
		}
		const socketKey = ws.getUserData().socketKey;
		const socket = new Socket<TEvents, SD>(ws, this.options.broadcastRoom, this.encode.bind(this));
		this.sockets.set(socketKey, socket);
		if (!this.options.auth) {
			socket._handleAuth(null, this.options.auth, this.options.authTimeout, (err) => {
				if (err == null) {
					this._runSyncHooks(this._lifecycleCallbacksMap.get(LifecycleTypes.open), [socket], (error) => {
						if (error != null) {
							this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, { phase: "onOpen", error });
						}
					});
				}
			});
		}
	}

	#message(ws: WebSocket<SD>, message: ArrayBuffer, isBinary: boolean) {
		const socketKey = ws.getUserData().socketKey;
		const socket = this.sockets.get(socketKey);
		if (!socket || socket.isClosed) {
			return;
		}

		this.message(socket, message, isBinary);
	}

	#close(ws: WebSocket<SD>, code: number, reason: Buffer | ArrayBuffer) {
		const socketKey = ws.getUserData().socketKey;
		const socket = this.sockets.get(socketKey);
		if (!socket) {
			return;
		}
		this.close(socket, code, reason);
	}
}
