import type { MsgpackrOptions } from "@bytesocket/types";

/**
 * Signature of a callback that receives event data.
 */
export type EventCallback<D = unknown> = (data: D) => void;

/**
 * Internal state tracking for a single room.
 */
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
 *   auth: (cb) => {
 *     fetch('/api/token').then(res => res.json()).then(cb);
 *   }
 * });
 */
export type AuthConfig<D = unknown> = { data: D } | ((cb: (data: D) => void) => void);

/**
 * Configuration options for ByteSocket.
 */
export type ByteSocketOptions = {
	/** Automatically call `connect()` in the constructor. Default `true`. */
	autoConnect?: boolean;
	/** Enable automatic reconnection on unexpected close. Default `true`. */
	reconnection?: boolean;
	/** Maximum number of reconnection attempts. Default `Infinity`. */
	maxReconnectionAttempts?: number;
	/** Base delay in milliseconds before first reconnection attempt. Default `1000`. */
	reconnectionDelay?: number;
	/** Maximum reconnection delay after exponential backoff. Default `5000`. */
	reconnectionDelayMax?: number;
	/** Randomization factor for reconnection delay (0 to 1). Default `0.5`. */
	randomizationFactor?: number;
	/** WebSocket subprotocols. */
	protocols?: string | string[];
	/** URL path appended to the base URL. */
	path?: string;
	/** Query parameters added to the connection URL. */
	queryParams?: Record<string, string>;
	/** Enable internal ping/pong heartbeat. Default `true`. */
	heartbeatEnabled?: boolean;
	/** Interval between ping messages in ms. Default `25000`. */
	pingInterval?: number;
	/** Time to wait for pong response before closing connection. Default `20000`. */
	pingTimeout?: number;
	/** Authentication configuration. */
	auth?: AuthConfig;
	/** Timeout for authentication response in ms. Default `5000`. */
	authTimeout?: number;
	/** Maximum number of outgoing messages to queue while offline. Default `100`. */
	maxQueueSize?: number;
	/** Serialization format: `"json"` or `"binary"` (msgpack). Default `"binary"`. */
	serialization?: "json" | "binary";
	/** Enable debug logging to console. Default `false`. */
	debug?: boolean;
	/** Options passed directly to the underlying msgpackr Packr instance. */
	msgpackrOptions?: MsgpackrOptions;
};
