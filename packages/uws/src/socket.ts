// packages/uws/src/socket.ts
import {
	SocketServerBase,
	type ISocket,
	type LifecycleMessage,
	type ServerOutgoingData,
	type SocketData,
	type SocketEvents,
	type UserMessage,
} from "@bytesocket/server";
import type { WebSocket } from "uWebSockets.js";

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
	extends SocketServerBase<TEvents, SD>
	implements ISocket<TEvents, SD>
{
	#ws: WebSocket<SD>;
	#rooms = new Set<string>();

	get userData(): SD {
		return this.#ws.getUserData();
	}

	protected readonly broadcastRoom: string;

	/** @internal */
	constructor(
		ws: WebSocket<SD>,
		broadcastRoom: string,
		encode: <R extends string, E extends string | number, D>(
			payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
		) => string | Buffer<ArrayBufferLike>,
	) {
		super(encode);
		this.#ws = ws;
		this.broadcastRoom = broadcastRoom;
	}

	sendRaw(message: ServerOutgoingData, isBinary: boolean = typeof message !== "string", compress?: boolean): this {
		if (this.isClosed) {
			return this;
		}
		this.#ws.send(message, isBinary, compress);
		return this;
	}

	close(code = 1000, reason = "normal"): void {
		if (this.isClosed) {
			return;
		}
		this._close();
		try {
			this.#ws.end(code, reason);
		} catch {
			// Transport already closed – ignore silently
		}
	}

	protected getRoomList(includeBroadcast?: boolean): string[] {
		if (this.isClosed) {
			return includeBroadcast ? [...this.#rooms] : [...this.#rooms].filter((r) => r !== this.broadcastRoom);
		}
		const topics = this.#ws.getTopics();
		return includeBroadcast ? topics : topics.filter((t) => t !== this.broadcastRoom);
	}

	protected publishRaw(
		room: string,
		message: ServerOutgoingData,
		isBinary: boolean = typeof message !== "string",
		compress?: boolean,
	): typeof this.rooms {
		if (this.isClosed) {
			return this.rooms;
		}
		this.#ws.publish(room, message, isBinary, compress);
		return this.rooms;
	}

	protected joinRoom(room: string): typeof this.rooms {
		if (!this.canSend) {
			return this.rooms;
		}
		if (this.#ws.isSubscribed(room) || this.#rooms.has(room)) {
			return this.rooms;
		}
		this.#ws.subscribe(room);
		this.#rooms.add(room);
		return this.rooms;
	}

	protected leaveRoom(room: string): typeof this.rooms {
		if (!this.canSend) {
			return this.rooms;
		}
		if (!this.#ws.isSubscribed(room) && !this.#rooms.has(room)) {
			return this.rooms;
		}
		this.#ws.unsubscribe(room);
		this.#rooms.delete(room);
		return this.rooms;
	}
}
