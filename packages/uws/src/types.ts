import type { MsgpackrOptions, UserMessage } from "@bytesocket/types";
import type { UUID } from "node:crypto";
import type { WebSocketBehavior } from "uWebSockets.js";
import type { Socket } from "./socket";

/**
 * Context object passed to error handlers, providing details about where an error occurred.
 */
export type ErrorContext = {
	/** The phase or component where the error originated (e.g., "decode", "auth", "middleware") */
	phase: string;
	/** The error object itself, if any */
	error?: unknown;
	/** The event name involved, if applicable */
	event?: string;
	/** Raw message content (stringified) for debugging */
	raw?: string;
	/** WebSocket close code, if applicable */
	code?: number;
	/** Number of bytes received, if applicable */
	bytes?: number;
};

/**
 * Callback used by the authentication function to return the authentication result.
 * @param payload - The authenticated user data to attach to the socket.
 * @param error - Optional error if authentication failed.
 */
export type AuthCallback = (payload: unknown, error?: Error) => void;

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
export type AuthFunction<SD extends SocketData, D = any> = (socket: Socket<SD>, data: D, callback: AuthCallback) => void;

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
export type EventCallback<SD extends SocketData, D> = (socket: Socket<SD>, data: D) => void;

/**
 * Middleware function for room‑scoped events. Can inspect or block the broadcast.
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
 *   if (!isValid) return next(new Error("Invalid"));
 *   next();
 * });
 */
export type RoomEventMiddleware<SD extends SocketData, D> = (socket: Socket<SD>, data: D, next: MiddlewareNext) => void | Promise<void>;

/**
 * Next function for middleware chains. Call `next()` to proceed, or `next(error)` to abort.
 */
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
export type Middleware<SD extends SocketData = SocketData> = (socket: Socket<SD>, ctx: UserMessage, next: MiddlewareNext) => void | Promise<void>;

/**
 * Data automatically attached to every socket by the server.
 * Contains HTTP request information available during the WebSocket upgrade.
 */
export interface SocketData {
	/** Unique identifier for the socket (UUID v4). */
	socketKey: UUID;
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
}

/**
 * Configuration options for the ByteSocket server.
 *
 * @typeParam SD - The socket data type (must extend `SocketData`).
 *
 * @example
 * const io = new ByteSocket(app, {
 *   debug: true,
 *   authTimeout: 10000,
 *   origins: ["https://example.com"],
 *   serialization: "binary",
 *   auth: (socket, data, cb) => {
 *     // validate token
 *     cb({ userId: 1 });
 *   }
 * });
 */
export interface ByteSocketOptions<SD extends SocketData = SocketData> extends Omit<WebSocketBehavior<SD>, "upgrade" | "open" | "message" | "close"> {
	/** Enable debug logging to console. Default `false`. */
	debug?: boolean;
	/** Timeout in milliseconds for global middleware execution. Default `5000`. */
	middlewareTimeout?: number;
	/** Timeout in milliseconds for room event middleware execution. Default `5000`. */
	roomMiddlewareTimeout?: number;
	/** Timeout for authentication response in milliseconds. Default `5000`. */
	authTimeout?: number;
	/** List of allowed origins for CORS. If empty, all origins are allowed. */
	origins?: string[];
	/** Serialization format: `"json"` or `"binary"` (msgpack). Default `"binary"`. */
	serialization?: "json" | "binary";
	/** Room name used for global broadcasts. Default `"__bytesocket_broadcast__"`. */
	broadcastRoom?: string;
	/** Options passed directly to the underlying msgpackr Packr instance. */
	msgpackrOptions?: MsgpackrOptions;
	/** Action to take when a global middleware error occurs. Default `"ignore"`. */
	onMiddlewareError?: "ignore" | "close" | ((error: unknown, socket: Socket<SD>) => void);
	/** Action to take when a global middleware times out. Default `"ignore"`. */
	onMiddlewareTimeout?: "ignore" | "close" | ((error: unknown, socket: Socket<SD>) => void);
	/** Authentication configuration. */
	auth?: AuthFunction<SD>;
}
