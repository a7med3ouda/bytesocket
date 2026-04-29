import type { ByteSocketOptionsBase, SocketData } from "@bytesocket/core";
import type { SocketEvents } from "@bytesocket/types";
import type { ServerOptions } from "ws";

export interface HeartbeatConfig {
	/** Idle timeout in seconds. 0 = disabled. Default 120. */
	idleTimeout?: number;
	/** Whether to send automatic pings. Default true. */
	sendPingsAutomatically?: boolean;
}

/**
 * Transport‑specific options that are forwarded directly to the `ws`
 * `WebSocketServer` constructor.
 *
 * The following fields are **reserved and managed by ByteSocket**; they are
 * therefore omitted:
 * - `noServer` – always set to `true` internally
 * - `port`, `server`, `host`, `backlog`, `path` – because the HTTP server
 *   and upgrade listener are managed by the {@link ByteSocket.attach} method
 *
 * All other `ServerOptions` (e.g., `maxPayload`, `perMessageDeflate`,
 * `verifyClient`, `handleProtocols`, …) can be passed through
 * {@link ByteSocketOptions.serverOptions}.
 *
 * @example
 * ```ts
 * import { ByteSocket } from '@bytesocket/ws';
 *
 * const io = new ByteSocket({
 *   serverOptions: {
 *     maxPayload: 1024 * 1024,
 *     perMessageDeflate: true,
 *     verifyClient: ({ origin, secure }, cb) => {
 *       // custom verification
 *       cb(true);
 *     },
 *   },
 * });
 * ```
 */
export type WebSocketServerOptions = Omit<ServerOptions, "noServer" | "port" | "server" | "host" | "backlog" | "path">;

/**
 * Configuration options for the ByteSocket server.
 *
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
export interface ByteSocketOptions<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData> extends ByteSocketOptionsBase<
	TEvents,
	SD
> {
	/**
	 * Transport‑specific options forwarded to uWS.
	 * @see {@link WebSocketServerOptions}
	 */
	serverOptions?: WebSocketServerOptions;
}
