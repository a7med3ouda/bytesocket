// packages/uws/src/types.ts
import type { ByteSocketOptionsBase, SocketData, SocketEvents } from "@bytesocket/server";
import type { WebSocketBehavior } from "uWebSockets.js";

/**
 * Transport‑specific options that are forwarded directly to the underlying
 * uWebSockets.js `WebSocketBehavior` when registering a WebSocket route.
 *
 * The following fields are **reserved and managed by ByteSocket**; they are
 * therefore omitted from this type:
 * - `upgrade`, `open`, `message`, `close` - lifecycle handlers
 * - `idleTimeout`, `sendPingsAutomatically` - managed via ByteSocket’s own heartbeat config
 *
 * All other `WebSocketBehavior` properties (e.g., `maxPayloadLength`,
 * `compression`, `maxBackpressure`, `closeOnBackpressureLimit`, …) can be
 * passed through the {@link ByteSocketOptions.serverOptions} field.
 *
 * @typeParam SD - The socket user‑data type (must extend `SocketData`).
 *
 * @example
 * ```ts
 * import { ByteSocket } from '@bytesocket/uws';
 *
 * const io = new ByteSocket({
 *   serverOptions: {
 *     compression: uWS.SHARED_COMPRESSOR,
 *     maxPayloadLength: 64 * 1024,
 *     maxBackpressure: 128 * 1024,
 *   },
 * });
 * ```
 */
export type WebSocketServerOptions<SD extends SocketData = SocketData> = Omit<
	WebSocketBehavior<SD>,
	"upgrade" | "open" | "message" | "close" | "idleTimeout" | "sendPingsAutomatically"
>;

/**
 * Configuration options for the ByteSocket server (uWebSockets.js adaptor).
 *
 * Extends the base {@link ByteSocketOptionsBase} with a transport‑specific
 * `serverOptions` property that exposes settings from uWebSockets.js’s
 * `WebSocketBehavior`, excluding the hooks already managed by ByteSocket.
 *
 * @example
 * ```ts
 * const io = new ByteSocket({
 *   serverOptions: {
 *     compression: uWS.SHARED_COMPRESSOR,
 *     maxLifetime: 180,
 *   },
 *   authTimeout: 5000,
 * });
 * ```
 */
export interface ByteSocketOptions<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData> extends ByteSocketOptionsBase<
	TEvents,
	SD
> {
	/**
	 * Transport‑specific options forwarded to uWS.
	 * @see {@link WebSocketServerOptions}
	 */
	serverOptions?: WebSocketServerOptions<SD>;
}
