// packages/node/src/byte-socket.ts
import {
	ByteSocketServerBase,
	LifecycleTypes,
	type IByteSocket,
	type ServerIncomingData,
	type ServerOutgoingData,
	type SocketData,
	type SocketEvents,
} from "@bytesocket/server";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type Stream from "node:stream";
import { WebSocketServer } from "ws";
import { RoomManager } from "./room-manager";
import { Socket } from "./socket";
import type { ByteSocketOptions, WebSocketServerOptions } from "./types";

type UpgradeCallback<SD> = (req: IncomingMessage, socket: Stream.Duplex, head: Buffer<ArrayBuffer>, userData: SD, context: WebSocketServer) => void;

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
	#paths: Set<string> = new Set();
	#server: Server | undefined;
	#wss: WebSocketServer | undefined;
	#roomManager = new RoomManager<TEvents, SD>();
	#serverOptions: WebSocketServerOptions | undefined;

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
		super(options);
		this.#serverOptions = options.serverOptions;
	}

	protected publishRaw(
		room: string,
		message: ServerOutgoingData,
		isBinary: boolean = typeof message !== "string",
		compress?: boolean,
	): typeof this.rooms {
		if (!this.#wss || this.destroyed) {
			return this.rooms;
		}
		this.#roomManager.publishServer(room, message, isBinary, compress);
		return this.rooms;
	}

	/**
	 * Attaches the ByteSocket instance to a Node.js HTTP server on the given path.
	 *
	 * You can call `attach` multiple times on the same server with different paths --
	 * they will all share a single WebSocket server and a single `upgrade` listener.
	 *
	 * **Note:** On the first call, the method registers an `upgrade` listener on the
	 * HTTP server. That listener is automatically removed when you call
	 * {@link destroy}, so you can later attach a new ByteSocket instance to the same
	 * server.
	 *
	 * @param server - The Node.js HTTP(S) server (e.g. from `http.createServer()`).
	 * @param path   - The URL path to handle WebSocket upgrades on (e.g. `"/ws"`).
	 * @returns This instance (for chaining).
	 *
	 * @example
	 * ```ts
	 * const server = http.createServer(app);
	 * const io = new ByteSocket();
	 *
	 * // Single path
	 * io.attach(server, "/ws");
	 *
	 * // Multiple paths on the same server
	 * io.attach(server, "/chat");
	 * io.attach(server, "/notifications");
	 * ```
	 */
	attach(server: Server, path: string): this {
		if (this.destroyed) {
			return this;
		}
		if (!this.#wss) {
			this.#wss = new WebSocketServer({ ...this.#serverOptions, noServer: true });
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

	/**
	 * Permanently destroys the ByteSocket instance.
	 *
	 * - Closes all active WebSocket connections.
	 * - Closes the underlying WebSocketServer.
	 * - **Removes the `upgrade` listener** from the attached HTTP server, freeing
	 *   the server to be used with a new ByteSocket instance later.
	 * - Clears all event listeners, middleware, and internal state.
	 *
	 * After calling `destroy()`, the instance **cannot be reused**.
	 *
	 * @example
	 * ```ts
	 * const io = new ByteSocket();
	 * io.attach(server, "/ws");
	 * // ... later, during graceful shutdown:
	 * io.destroy();
	 *
	 * // The HTTP server will be free and can be reused if you do:
	 * server.removeAllListeners("upgrade");
	 * const io2 = new ByteSocket();
	 * io2.attach(server, "/ws");  // works without conflict
	 * ```
	 */
	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this._destroy();
		this.#wss?.close();
		this.#paths.clear();
		// if (this.#upgrade) {
		// 	this.#server?.off("upgrade", this.#upgrade);
		// }
		this.#wss = undefined;
		this.#server = undefined;
	}

	#upgrade: ((req: IncomingMessage, socket: Stream.Duplex, head: Buffer<ArrayBuffer>) => void) | undefined;

	#handleUpgrade(req: IncomingMessage, streamSocket: Stream.Duplex, head: Buffer) {
		if (this.destroyed) {
			streamSocket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
			streamSocket.destroy();
			return;
		}

		const urlObj = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);

		if (!this.#paths.has(urlObj.pathname)) {
			streamSocket.destroy();
			return;
		}

		if (this.options.origins?.length) {
			const origin = req.headers.origin;
			if (origin && !this.options.origins.some((o) => o.toLowerCase() === origin.toLowerCase())) {
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

		this._runSyncHooks(this._lifecycleCallbacksMap.get(LifecycleTypes.upgrade), [req, streamSocket, head, socketData, this.#wss], (error) => {
			if (error == null) {
				if (this.destroyed || !this.#wss) {
					streamSocket.destroy();
					return;
				}
				this.#wss.handleUpgrade(req, streamSocket, head, (ws) => {
					if (!this.#wss || this.destroyed) {
						ws.close(1001, "server destroyed");
						return;
					}
					const socket = new Socket<TEvents, SD>(ws, socketData, this.options.broadcastRoom, this.#roomManager, this.encode.bind(this), {
						idleTimeout: this.options.idleTimeout,
						sendPingsAutomatically: this.options.sendPingsAutomatically,
					});
					this.sockets.set(socket.id, socket);
					if (!this.options.auth) {
						socket._handleAuth(null, this.options.auth, this.options.authTimeout, (err) => {
							if (err == null) {
								this._runSyncHooks(this._lifecycleCallbacksMap.get(LifecycleTypes.open), [socket], (error) => {
									if (error != null) {
										this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), socket, {
											phase: "onOpen",
											error,
										});
									}
								});
							}
						});
					}
					ws.on("message", (data: ServerIncomingData, isBinary) => this.message(socket, data, isBinary));
					ws.on("close", (code, reason) => this.close(socket, code, reason));
				});
			} else {
				if (this._debug) {
					console.error(error);
				}
				streamSocket.destroy();
				this._triggerCallbacks(this._lifecycleCallbacksMap.get(LifecycleTypes.error), null, { phase: "onUpgrade", error });
			}
		});
	}
}
