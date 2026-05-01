# @bytesocket/core

Shared TypeScript definitions for the ByteSocket ecosystem -- used internally by both the client and server packages.

You do not need to install this package directly; it is a dependency of the main packages.

[![npm version](https://img.shields.io/npm/v/@bytesocket/core)](https://www.npmjs.com/package/@bytesocket/core)
[![MIT](https://img.shields.io/npm/l/@bytesocket/core)](LICENSE)
[![node-current](https://img.shields.io/node/v/@bytesocket/core?logo=nodedotjs)](https://nodejs.org/)
[![GitHub](https://img.shields.io/badge/GitHub-gray?style=flat&logo=github)](https://github.com/a7med3ouda/bytesocket/tree/main/packages/core)
[![GitHub stars](https://img.shields.io/github/stars/a7med3ouda/bytesocket?style=flat&logo=github)](https://github.com/a7med3ouda/bytesocket)
[![Socket Badge](https://badge.socket.dev/npm/package/@bytesocket/core/0.3.1)](https://badge.socket.dev/npm/package/@bytesocket/core/0.3.1)

## Exports

### Core Types

- `StringKeys<T>` - Extract only string keys from a type.
- `StringNumberKeys<T>` - Extract string or number keys.
- `SocketEvents<T>` - The event map shape for end-to-end type safety.
- `EventsForRooms<T, R>` - Extract events for a specific set of rooms.

### Lifecycle & Error Types

- `LifecycleTypes` - Enum of all internal protocol message types (open, close, auth, ping, errors, room operations, etc.).
- `ErrorContext` - Structured context for error events (`phase`, `error`, `event`, `raw`, `code`, `bytes`).
- `LifecycleType` - Messages with only a `type` field (e.g., `open`, `ping`).
- `LifecycleRoomType<R>` - Success messages for single-room operations.
- `LifecycleRoomsType<Rs>` - Success messages for bulk room operations.
- `LifecyclePayload<D>` - Auth request message.
- `LifecycleError` - Global error messages (`error`, `auth_error`).
- `LifecycleRoomError<R>` - Error messages for single-room operations.
- `LifecycleRoomsError<Rs>` - Error messages for bulk room operations.
- `LifecycleMessage<R, D>` - Complete union of all lifecycle messages (combines the above).

### User Message Shapes

- `GeneralEvent<E, D>` - Global user event.
- `RoomEvent<R, E, D>` - User event scoped to a single room.
- `RoomsEvent<Rs, E, D>` - User event scoped to multiple rooms.
- `UserMessage<R, E, D>` - Union of all user-defined messages.

### Other

- `MsgpackrOptions` - Type for msgpackr configuration (excludes internal `useRecords` must be false).
- `AuthState` - Enum of authentication states (`idle`, `none`, `pending`, `success`, `failed`).
- `AnyCallback` - Generic callback type (internal).

### ByteSocketBase

`ByteSocketBase` is an **abstract base class** that provides the shared runtime infrastructure for both the client and server implementations. It bundles serialisation, callback management, and message‑type guards.

> **Note:** The base class has no abstract methods – it’s abstract only to prevent direct instantiation. Subclasses (client/server) provide the concrete networking layer.

#### Constructor Options

The constructor accepts an optional `ByteSocketBaseOptions` object:

| Option            | Type                   | Default    | Description                                         |
| ----------------- | ---------------------- | ---------- | --------------------------------------------------- |
| `debug`           | `boolean`              | `false`    | Enable debug logging to console.                    |
| `serialization`   | `"json"` \| `"binary"` | `"binary"` | Serialization format for messages.                  |
| `msgpackrOptions` | `MsgpackrOptions`      | `{}`       | Options forwarded to the internal `Packr` instance. |

#### Instance Properties

- `_packr` - The shared `Packr` instance for MessagePack encoding/decoding.
- `_msgpackrOptions` - The resolved options passed to `Packr`.
- `_serialization` - The active serialization mode.
- `_debug` - Debug flag.

#### Core Methods

**`encode(payload: unknown, serialization?): string | Buffer<ArrayBufferLike>`**
Encodes any payload into a string (JSON) or a `Uint8Array` (MessagePack). Uses the instance’s default serialization unless overridden.

**`decode(message, isBinary?): unknown`**
Decodes a raw WebSocket message into a structured object. Handles:

- Fragmented messages (`Array<Uint8Array>`) - concatenated automatically.
- Plain text frames (`string`) - parsed as JSON.
- Binary frames intended as text (`isBinary === false`) - decoded with `TextDecoder`.
- Binary MessagePack frames - unpacked via `Packr`.

#### Callback Management (Protected)

These methods manage typed event listeners. They are used internally by the client and server wrappers to wire up user‑facing `on`/`off`/`once` APIs.

- `_on(event, callback)` - Register a global event listener.
- `_off(event, callback?)` - Remove a global listener (or all for that event).
- `_once(event, callback)` - Register a one‑time global listener.
- `_onRoom(room, event, callback)` - Register a room‑scoped listener.
- `_offRoom(room, event?, callback?)` - Remove room‑scoped listeners.
- `_onceRoom(room, event, callback)` - Register a one‑time room listener.
- `_onLifecycle(type, callback)` - Listen for lifecycle events (open, close, etc.).
- `_offLifecycle(type, callback?)` - Remove lifecycle listeners.
- `_onceLifecycle(type, callback)` - One‑time lifecycle listener.
- `_clearCallbacks()` - Remove all registered callbacks (global, room, lifecycle).
- `_triggerCallbacks(callbacks, ...args)` - Invoke a set of callbacks safely, catching errors.

#### Type Guards (Protected)

A comprehensive set of runtime type guards for verifying decoded message shapes. These enable the client and server to branch on message type without unsafe casts.

- `_isObject(obj)` - Simple object check.
- `_isObjectEvent(obj)` - Checks for `event: string | number` property.
- `_isObjectRoom(obj)` - Checks for `room: string`.
- `_isObjectRooms(obj)` - Checks for `rooms: string[]`.
- `_isObjectLifecycle(obj)` - Checks for `type` property matching a `LifecycleTypes` value.
- `_isLifecycleMessage(type, obj)` - Composite guard for a specific lifecycle type.
- `_isLifecyclePayloadMessage(type, obj)` - Lifecycle message with a `data` payload.
- `_isLifecycleRoomMessage(type, obj)` - Single‑room lifecycle message.
- `_isLifecycleRoomsMessage(type, obj)` - Multi‑room lifecycle message.
- `_isLifecycleRoomErrorMessage(obj)` - Single‑room error lifecycle message.
- `_isLifecycleRoomsErrorMessage(obj)` - Multi‑room error lifecycle message.
- `_isEventMessage(obj)` - User event with `event` and `data`.
- `_isRoomEventMessage(obj)` - User event scoped to a single room.
- `_isRoomsEventMessage(obj)` - User event scoped to multiple rooms.

## Usage

All types are re-exported by `@bytesocket/client` and `@bytesocket/server`. Import from those packages instead of directly from `@bytesocket/core`.

```typescript
// ✅ Recommended
import { type SocketEvents, LifecycleTypes } from "@bytesocket/client";
// or
import { type SocketEvents, LifecycleTypes } from "@bytesocket/server";
```

---

## License

[MIT](LICENSE) © 2026 Ahmed Ouda

- GitHub: [@a7med3ouda](https://github.com/a7med3ouda)
