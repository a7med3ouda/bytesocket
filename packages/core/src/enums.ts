// packages/core/src/enums.ts
/**
 * Enumeration of all lifecycle message types used internally by ByteSocket.
 * These correspond to system-level events like connection open, authentication,
 * room join/leave, and errors.
 */
export enum LifecycleTypes {
	open = 1,
	close = 2,
	error = 3,
	auth = 4,
	auth_success = 5,
	auth_error = 6,
	/** @deprecated We use now a zero‑length byte array instead of custom message */
	ping = 7,
	/** @deprecated We use now a zero‑length byte array instead of custom message */
	pong = 8,
	join_room = 9,
	join_room_success = 10,
	join_room_error = 11,
	leave_room = 12,
	leave_room_success = 13,
	leave_room_error = 14,
	join_rooms = 15,
	join_rooms_success = 16,
	join_rooms_error = 17,
	leave_rooms = 18,
	leave_rooms_success = 19,
	leave_rooms_error = 20,
	queue_full = 21,
	reconnect_failed = 22,
	upgrade = 23,
	message = 24,
}

/** Authentication state of a socket. */
export enum AuthState {
	/** Initial state before any connection attempt. */
	idle = 1,
	/** No authentication required / not configured. */
	none = 2,
	/** Authentication request sent, awaiting server response. */
	pending = 3,
	/** Authentication successful. */
	success = 4,
	/** Authentication failed permanently. */
	failed = 5,
}
