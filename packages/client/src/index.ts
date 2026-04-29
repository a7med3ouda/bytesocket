/**
 * ByteSocket - A robust WebSocket client with binary serialization, reconnection, heartbeat, and room management.
 *
 * @packageDocumentation
 */

export * from "@bytesocket/types";
export { FLOAT32_OPTIONS } from "msgpackr";
export * from "./byte-socket";
export type { AuthConfig, ByteSocketOptions, EventCallback, IByteSocket, IRoomManager, LifecycleApi, RoomBulkApi, RoomLifecycleApi } from "./types";
