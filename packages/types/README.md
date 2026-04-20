# @bytesocket/types

Shared TypeScript definitions for the ByteSocket ecosystem — used internally by both the client (`@bytesocket/client`) and server (`@bytesocket/uws`) packages.

You do not need to install this package directly; it is a dependency of the main packages.

## Exports

### Core Types

- `StringKeys<T>` – Extract only string keys from a type.
- `StringNumberKeys<T>` – Extract string or number keys.
- `SymmetricEvents<T>` – The event map shape for end‑to‑end type safety.
- `EventsForRooms<T, R>` – Extract events for a specific set of rooms.

### Lifecycle & Error Types

- `LifecycleTypes` – Enum of all internal protocol message types (open, close, auth, ping, errors, room operations, etc.).
- `ErrorContext` – Structured context for error events (`phase`, `error`, `event`, `raw`, `code`, `bytes`).
- `LifecycleType` – Messages with only a `type` field (e.g., `open`, `ping`).
- `LifecycleRoomType<R>` – Success messages for single‑room operations.
- `LifecycleRoomsType<Rs>` – Success messages for bulk room operations.
- `LifecyclePayload<D>` – Auth request message.
- `LifecycleError` – Global error messages (`error`, `auth_error`).
- `LifecycleRoomError<R>` – Error messages for single‑room operations.
- `LifecycleRoomsError<Rs>` – Error messages for bulk room operations.
- `LifecycleMessage<R, D>` – Complete union of all lifecycle messages (combines the above).

### User Message Shapes

- `GeneralEvent<E, D>` – Global user event.
- `RoomEvent<R, E, D>` – User event scoped to a single room.
- `RoomsEvent<Rs, E, D>` – User event scoped to multiple rooms.
- `UserMessage<R, E, D>` – Union of all user‑defined messages.

### Other

- `MsgpackrOptions` – Type for msgpackr configuration (excludes internal `structures`).
- `AuthState` – Enum of authentication states (`idle`, `none`, `pending`, `success`, `failed`).
- `AnyCallback` – Generic callback type (internal).

## Usage

All types are re‑exported by `@bytesocket/client` and `@bytesocket/uws`. Import from those packages instead of directly from `@bytesocket/types`.

```typescript
// ✅ Recommended
import { SymmetricEvents, LifecycleTypes } from "@bytesocket/client";
// or
import { SymmetricEvents, LifecycleTypes } from "@bytesocket/uws";
```

---

## License

[MIT](LICENSE) © 2026 Ahmed Ouda

- GitHub: [@a7med3ouda](https://github.com/a7med3ouda)
