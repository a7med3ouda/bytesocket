// packages/node/src/room-manager.ts
import type { ServerOutgoingData, SocketData, SocketEvents } from "@bytesocket/server";
import type { Socket } from "./socket";

export class RoomManager<TEvents extends SocketEvents = SocketEvents, SD extends SocketData = SocketData> {
	#rooms = new Map<string, Set<Socket<TEvents, SD>>>();
	#socketRooms = new Map<Socket<TEvents, SD>, Set<string>>();

	isSubscribed(socket: Socket<TEvents, SD>, room: string): boolean {
		return !!this.#rooms.get(room)?.has(socket);
	}

	getSocketRooms(socket: Socket<TEvents, SD>, exclude?: string): string[] {
		const owned = this.#socketRooms.get(socket);
		if (!owned) {
			return [];
		}
		if (exclude === undefined) {
			return Array.from(owned);
		}
		const result: string[] = [];
		for (const room of owned) {
			if (room !== exclude) {
				result.push(room);
			}
		}
		return result;
	}

	getRoomSockets(room: string) {
		return [...(this.#rooms.get(room) ?? [])];
	}

	join(socket: Socket<TEvents, SD>, room: string): void {
		let set = this.#rooms.get(room);
		if (!set) {
			set = new Set();
			this.#rooms.set(room, set);
		}
		set.add(socket);

		let owned = this.#socketRooms.get(socket);
		if (!owned) {
			owned = new Set();
			this.#socketRooms.set(socket, owned);
		}
		owned.add(room);
	}

	leave(socket: Socket<TEvents, SD>, room: string): void {
		const set = this.#rooms.get(room);
		if (set) {
			set.delete(socket);
			if (set.size === 0) {
				this.#rooms.delete(room);
			}
		}

		const owned = this.#socketRooms.get(socket);
		if (owned) {
			owned.delete(room);
			if (owned.size === 0) {
				this.#socketRooms.delete(socket);
			}
		}
	}

	publishServer(room: string, message: ServerOutgoingData, isBinary?: boolean, compress?: boolean): void {
		const set = this.#rooms.get(room);
		if (!set || set.size === 0) {
			return;
		}
		for (const s of [...set]) {
			if (!s.canSend) {
				continue;
			}
			s.sendRaw(message, isBinary, compress);
		}
	}

	publish(socket: Socket<TEvents, SD>, room: string, message: ServerOutgoingData, isBinary?: boolean, compress?: boolean): void {
		const set = this.#rooms.get(room);
		if (!set || set.size === 0) {
			return;
		}
		for (const s of [...set]) {
			if (s === socket || !s.canSend) {
				continue;
			}
			s.sendRaw(message, isBinary, compress);
		}
	}

	leaveAll(socket: Socket<TEvents, SD>): void {
		const owned = this.#socketRooms.get(socket);
		if (!owned) {
			return;
		}
		for (const room of owned) {
			const set = this.#rooms.get(room);
			if (!set) {
				continue;
			}
			set.delete(socket);
			if (set.size === 0) {
				this.#rooms.delete(room);
			}
		}
		this.#socketRooms.delete(socket);
	}
}
