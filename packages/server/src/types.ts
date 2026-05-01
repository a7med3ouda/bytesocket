// packages/server/src/types.ts
import type { MsgpackrOptions, SocketEvents, UserMessage } from "@bytesocket/core";
import type { UUID } from "node:crypto";
import type { ISocket } from "./interfaces";

/** The data types actually received from outside.*/
export type ServerIncomingData = Buffer | ArrayBuffer | Uint8Array;

/** The data types actually accepted by the server `server.send()` or `ws.send()` methods.*/
export type ServerOutgoingData = string | ServerIncomingData;

/**
 * Callback used by the authentication function to return the authentication result.
 * @param payload - The authenticated user data to attach to the socket.
 * @param error - Optional error if authentication failed.
 */
export type AuthCallback = (payload: any, error?: Error) => void;

/**
 * Authentication function signature. Called when a client sends an auth message.
 *
 * @typeParam SD - The socket data type (must extend `SocketData`).
 * @typeParam D - The type of the authentication data sent by the client.
 *
 * @example
 * const auth: AuthFunction = (socket, data, callback) => {
 *   if (data.token === "secret") {
 *     callback({ userId: 1 });
 *   } else {
 *     callback(null, new Error("Invalid token"));
 *   }
 * };
 */
export type AuthFunction<TEvents extends SocketEvents, SD extends SocketData, D = any> = (
	socket: ISocket<TEvents, SD>,
	data: D,
	callback: AuthCallback,
) => void;

/**
 * Callback for global event listeners.
 *
 * @typeParam SD - The socket data type.
 * @typeParam D - The type of the event data.
 *
 * @example
 * socket.on("userJoined", (socket, data) => {
 *   console.log(`User ${data.userId} joined`);
 * });
 */
export type EventCallback<TEvents extends SocketEvents, SD extends SocketData, D> = (socket: ISocket<TEvents, SD>, data: D) => void;

/**
 * Middleware function for room-scoped events. Can inspect or block the broadcast.
 *
 * @typeParam SD - The socket data type.
 * @typeParam D - The type of the event data.
 *
 * @example
 * io.rooms.on("chat", "message", (socket, data, next) => {
 *   if (data.text.includes("badword")) {
 *     next(new Error("Profanity not allowed"));
 *   } else {
 *     next();
 *   }
 * });
 *
 * // Also supports async functions / Promises
 * io.rooms.on("chat", "message", async (socket, data, next) => {
 *   const isValid = await validateMessage(data);
 *   if (!isValid) {
 * 		return next(new Error("Invalid"));
 *	 }
 *   next();
 * });
 */
export type RoomEventMiddleware<TEvents extends SocketEvents, SD extends SocketData, D> = (
	socket: ISocket<TEvents, SD>,
	data: D,
	next: MiddlewareNext,
) => void | Promise<void>;

/** Next function for middleware chains. Call `next()` to proceed, or `next(error)` to abort. */
export type MiddlewareNext = (error?: unknown | null) => void;

/**
 * Global middleware function. Runs before any user message is processed.
 *
 * @typeParam SD - The socket data type.
 *
 * @example
 * io.use((socket, ctx, next) => {
 *   console.log("Received:", ctx);
 *   next();
 * });
 */
export type Middleware<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData> = (
	socket: ISocket<TEvents, SD>,
	ctx: UserMessage,
	next: MiddlewareNext,
) => void | Promise<void>;

/**
 * Data automatically attached to every socket by the server.
 * Contains HTTP request information available during the WebSocket upgrade.
 */
export type SocketData = {
	/** Unique identifier for the socket (UUID v4). */
	socketKey: UUID;
	/** The url string from the upgrade request. */
	url: string;
	/** The query string from the upgrade request. */
	query: string;
	/** The `Host` header value. */
	host: string;
	/** The `Cookie` header value. */
	cookie: string;
	/** The `User-Agent` header value. */
	userAgent: string;
	/** The `Authorization` header value. */
	authorization: string;
	/** The `X-Forwarded-For` header value. */
	xForwardedFor: string;
};

/**
 * Configuration options for the ByteSocket server.
 *
 * @typeParam TEvents - The socket events definition.
 * @typeParam SD - The socket data type (must extend `SocketData`).
 *
 * @example
 * const io = new ByteSocket({
 *   debug: true,
 *   authTimeout: 10000,
 *   origins: ["https://example.com"],
 *   serialization: "binary",
 *   auth: (socket, data, callback) => {
 *     // validate token
 *     callback({ userId: 1 });
 *   }
 * });
 */
export type ByteSocketOptionsBase<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData> = {
	/** Enable debug logging to console. @default false */
	debug?: boolean;
	/** Timeout in milliseconds for global middleware execution. @default 5000 */
	middlewareTimeout?: number;
	/** Timeout in milliseconds for room event middleware execution. @default 5000 */
	roomMiddlewareTimeout?: number;
	/** Timeout for authentication response in milliseconds. @default 5000 */
	authTimeout?: number;
	/** List of allowed origins for CORS. If empty, all origins are allowed. */
	origins?: string[];
	/** Serialization format: `"json"` or `"binary"` (msgpack). @default "binary" */
	serialization?: "json" | "binary";
	/** Room name used for global broadcasts. @default "__bytesocket_broadcast__" */
	broadcastRoom?: string;
	/** Options passed directly to the underlying msgpackr Packr instance. */
	msgpackrOptions?: MsgpackrOptions;
	/** Action to take when a global middleware error occurs. @default "ignore" */
	onMiddlewareError?: "ignore" | "close" | ((error: unknown, socket: ISocket<TEvents, SD>) => void);
	/** Action to take when a global middleware times out. @default "ignore" */
	onMiddlewareTimeout?: "ignore" | "close" | ((error: unknown, socket: ISocket<TEvents, SD>) => void);
	/** Authentication configuration. */
	auth?: AuthFunction<TEvents, SD>;
	/**
	 * Maximum seconds of inactivity (no messages received or pongs) before the connection is closed.
	 * Only effective when `sendPingsAutomatically` is `true`.
	 * Set to `0` to disable.
	 * @default 120
	 */
	idleTimeout?: number;
	/**
	 * Whether the server should automatically send WebSocket ping frames to keep
	 * the connection alive and detect dead clients.
	 * @default true
	 */
	sendPingsAutomatically?: boolean;
};
