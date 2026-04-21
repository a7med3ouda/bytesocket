import type { MsgpackrOptions } from "@bytesocket/types";

/** Signature of a callback that receives event data. */
export type EventCallback<D> = (data: D) => void;

/** Internal state tracking for a single room. */
export interface RoomState {
	/** Current pending operation (join/leave) or null. */
	pending: "join" | "leave" | null;
	/** Whether the application intends to be in this room. */
	wanted: boolean;
	/** Whether the server has confirmed membership. */
	joined: boolean;
}

/**
 * Authentication configuration.
 * Can be a static object or a function that receives a callback to asynchronously provide auth data.
 *
 * @example
 * // Static auth object
 * const socket = new ByteSocket('ws://localhost:8080', {
 *   auth: { token: 'my-secret' }
 * });
 *
 * // Async auth callback
 * const socket = new ByteSocket('ws://localhost:8080', {
 *   auth: (callback) => {
 *     fetch('/api/token').then(res => res.json()).then(callback);
 *   }
 * });
 */
export type AuthConfig<D = any> = { data: D } | ((callback: (data: D) => void) => void);

/** Configuration options for ByteSocket. */
export type ByteSocketOptions = {
	/** Automatically call `connect()` in the constructor. @default true */
	autoConnect?: boolean;
	/** Enable automatic reconnection on unexpected close. @default true */
	reconnection?: boolean;
	/** Maximum number of reconnection attempts. @default Infinity */
	maxReconnectionAttempts?: number;
	/** Base delay in milliseconds before first reconnection attempt. @default 1000 */
	reconnectionDelay?: number;
	/** Maximum reconnection delay after exponential backoff. @default 5000 */
	reconnectionDelayMax?: number;
	/**
	 * Whether to attempt reconnection after the server sends a normal closure
	 * (close codes `1000` or `1001`). @default true
	 *
	 * Normal closures are typically graceful shutdowns (e.g., server restart,
	 * idle timeout, load balancer termination). Setting this to `false` will
	 * prevent automatic reconnection in these cases.
	 */
	reconnectOnNormalClosure?: boolean;
	/** Randomization factor for reconnection delay (0 to 1). @default 0.5 */
	randomizationFactor?: number;
	/** WebSocket subprotocols. */
	protocols?: string | string[];
	/** URL path appended to the base URL. */
	path?: string;
	/** Query parameters added to the connection URL. */
	queryParams?: Record<string, string>;
	/** Enable internal ping/pong heartbeat. @default true */
	heartbeatEnabled?: boolean;
	/** Interval between ping messages in ms. @default 25000 */
	pingInterval?: number;
	/** Time to wait for pong response before closing connection. @default 20000 */
	pingTimeout?: number;
	/** Authentication configuration. */
	auth?: AuthConfig;
	/** Timeout for authentication response in ms. @default 5000 */
	authTimeout?: number;
	/** Maximum number of outgoing messages to queue while offline. @default 100 */
	maxQueueSize?: number;
	/** Serialization format: `"json"` or `"binary"` (msgpack). @default "binary" */
	serialization?: "json" | "binary";
	/** Enable debug logging to console. @default false */
	debug?: boolean;
	/** Options passed directly to the underlying msgpackr Packr instance. */
	msgpackrOptions?: MsgpackrOptions;
};
