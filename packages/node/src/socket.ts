import { SocketBase, type ISocket, type ServerOutgoingData, type SocketData } from "@bytesocket/core";
import { type LifecycleMessage, type SocketEvents, type UserMessage } from "@bytesocket/types";
import { WebSocket } from "ws";
import type { RoomManager } from "./room-manager";
import type { HeartbeatConfig } from "./types";

/**
 * Represents an individual WebSocket connection.
 *
 * Provides methods for sending messages, joining/leaving rooms, and accessing
 * connection metadata. You receive instances of this class in lifecycle hooks,
 * middleware, and event listeners.
 *
 * @typeParam TEvents - The event map type (from `SocketEvents`) for type-safe emits.
 * @typeParam SD - The socket data type (must extend `SocketData`).
 *
 * @example
 * io.lifecycle.onOpen((socket) => {
 *   console.log(`Socket ${socket.id} connected`);
 *   socket.rooms.join("lobby");
 *   socket.emit("welcome", { message: "Hello!" });
 * });
 */
export class Socket<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData>
	extends SocketBase<TEvents, SD>
	implements ISocket<TEvents, SD>
{
	#ws: WebSocket;
	#roomManager: RoomManager<TEvents, SD>;
	#rooms: Set<string> = new Set();
	#onMessageResetIdle: (() => void) | undefined;

	// ──── Heartbeat ──────────────────────────────────────────────
	#heartbeat: {
		enabled: boolean;
		idleTimeoutMs: number;
		pingIntervalMs: number;
	};
	#idleTimer: ReturnType<typeof setTimeout> | undefined;
	#pingIntervalHandle: ReturnType<typeof setInterval> | undefined;
	#heartbeatStarted: boolean = false;
	// ──────────────────────────────────────────────────────────────
	readonly userData: SD;

	protected readonly broadcastRoom: string;

	/** @internal */
	constructor(
		ws: WebSocket,
		data: SD,
		broadcastRoom: string,
		roomManager: RoomManager<TEvents, SD>,
		encode: <R extends string, E extends string | number, D>(
			payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
		) => string | Buffer<ArrayBufferLike>,
		heartbeatConfig?: HeartbeatConfig,
	) {
		super(encode);
		this.userData = data;
		this.broadcastRoom = broadcastRoom;
		this.#ws = ws;
		this.#roomManager = roomManager;
		const idleTimeoutSec = heartbeatConfig?.idleTimeout ?? 120;
		const sendPings = heartbeatConfig?.sendPingsAutomatically ?? true;

		if (sendPings && idleTimeoutSec > 0) {
			this.#heartbeat = {
				enabled: true,
				idleTimeoutMs: idleTimeoutSec * 1000,
				pingIntervalMs: (idleTimeoutSec * 1000) / 2,
			};
		} else {
			this.#heartbeat = { enabled: false, idleTimeoutMs: 0, pingIntervalMs: 0 };
		}
	}

	sendRaw(message: ServerOutgoingData, isBinary: boolean = typeof message !== "string", compress?: boolean): this {
		if (this.isClosed) {
			return this;
		}
		this.#ws.send(message, { binary: isBinary, compress });
		return this;
	}

	protected getRoomList(includeBroadcast?: boolean): string[] {
		if (this.isClosed) {
			return includeBroadcast ? [...this.#rooms] : [...this.#rooms].filter((r) => r !== this.broadcastRoom);
		}
		return this.#roomManager.getSocketRooms(this, includeBroadcast ? undefined : this.broadcastRoom);
	}

	protected publishRaw(room: string, message: ServerOutgoingData, isBinary: boolean = typeof message !== "string", compress?: boolean): this {
		if (this.isClosed) {
			return this;
		}
		this.#roomManager.publish(this, room, message, isBinary, compress);
		return this;
	}

	protected joinRoom(room: string): this {
		if (!this.canSend) {
			return this;
		}
		if (this.#roomManager.isSubscribed(this, room) || this.#rooms.has(room)) {
			return this;
		}
		this.#rooms.add(room);
		this.#roomManager.join(this, room);
		return this;
	}

	protected leaveRoom(room: string): this {
		if (!this.canSend) {
			return this;
		}
		if (!this.#roomManager.isSubscribed(this, room) && !this.#rooms.has(room)) {
			return this;
		}
		this.#rooms.delete(room);
		this.#roomManager.leave(this, room);
		return this;
	}

	protected closeTransport(code: number, reason: string) {
		this.#roomManager.leaveAll(this);
		this.#ws.close(code, reason);
	}

	protected startHeartbeat(): void {
		if (this.#heartbeatStarted || this.isClosed || !this.#heartbeat.enabled) {
			return;
		}
		this.#heartbeatStarted = true;

		const resetIdle = () => {
			clearTimeout(this.#idleTimer);
			this.#idleTimer = setTimeout(() => {
				if (!this.isClosed) {
					this.close(1001, "idle timeout");
				}
			}, this.#heartbeat.idleTimeoutMs);
		};
		this.#onMessageResetIdle = resetIdle;

		this.#ws.on("pong", resetIdle);
		this.#ws.on("message", resetIdle);

		resetIdle();

		this.#pingIntervalHandle = setInterval(() => {
			if (this.isClosed) {
				return;
			}
			this.#ws.ping();
		}, this.#heartbeat.pingIntervalMs);
	}

	protected clearHeartbeat(): void {
		if (this.#pingIntervalHandle) {
			clearInterval(this.#pingIntervalHandle);
			this.#pingIntervalHandle = undefined;
		}
		if (this.#idleTimer) {
			clearTimeout(this.#idleTimer);
			this.#idleTimer = undefined;
		}
		if (this.#onMessageResetIdle) {
			this.#ws.off("message", this.#onMessageResetIdle);
			this.#ws.off("pong", this.#onMessageResetIdle);
			this.#onMessageResetIdle = undefined;
		}
	}
}
