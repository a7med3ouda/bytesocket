// packages/core/src/interfaces.ts
import type { LifecycleMessage, MsgpackrOptions, Serialization, UserMessage } from "./types";

export interface ByteSocketBaseOptions {
	/** Enable debug logging to console. @default false */
	debug?: boolean;
	/** Serialization format: `"json"` or `"binary"` (msgpack). @default "binary" */
	serialization?: Serialization;
	/** Options passed directly to the underlying msgpackr Packr instance. */
	msgpackrOptions?: MsgpackrOptions;
}

export interface IByteSocketBase {
	/**
	 * Encode a structured payload into a format suitable for sending over the WebSocket.
	 *
	 * **Advanced usage only.** Prefer `emit()` or `send()` for type‑safe communication.
	 *
	 * @param payload - A lifecycle message or user event object.
	 * @param serialization - Serialization format: `"json"` or `"binary"` (defaults to the server's configured format).
	 * @returns Encoded `string` (JSON) or `Buffer` (MessagePack).
	 *
	 * @example
	 * const encoded = io.encode({ event: 'chat', data: { text: 'Hello' } });
	 */
	encode<R extends string, E extends string | number, D>(
		payload: LifecycleMessage<R, D> | UserMessage<R, E, D>,
		serialization?: "json" | "binary",
	): string | Buffer<ArrayBufferLike>;
	/**
	 * Decode a raw WebSocket message into a structured payload.
	 * Automatically detects JSON or MessagePack based on the binary flag and message content.
	 *
	 * **Advanced usage only.** Normally you should use `on()` listeners to receive typed data.
	 *
	 * @param message - Raw `string` (JSON) or `ArrayBuffer` (MessagePack).
	 * @param isBinary - Whether the message is binary. If omitted, format is detected from the message type.
	 * @returns Decoded lifecycle or user message object.
	 */
	decode(message: string | ArrayBuffer | Uint8Array | Array<Uint8Array>, isBinary?: boolean): unknown;
}
