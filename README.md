# ByteSocket

> A modern, fully-typed WebSocket framework for real-time applications -- batteries included.

ByteSocket is a monorepo providing a client library and server adapters that work together out of the box. It handles reconnection, rooms, authentication, heartbeat, message queuing, and serialization so you can focus on your application logic.

---

## Packages

| Package                                   | Description                                                                        | Status         |
| ----------------------------------------- | ---------------------------------------------------------------------------------- | -------------- |
| [`@bytesocket/client`](./packages/client) | Browser / Node WebSocket client                                                    | ✅ Available   |
| [`@bytesocket/uws`](./packages/uws)       | Server adapter for [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js) | ✅ Available   |
| `@bytesocket/express`                     | Server adapter for Express / `ws`                                                  | 🚧 Coming soon |

---

## Why ByteSocket?

Most WebSocket setups require wiring together reconnection logic, room management, auth handshakes, heartbeats, and serialization yourself. ByteSocket ships all of that as a cohesive, type-safe system:

- **One shared event map** -- define your events once in TypeScript and get compile-time safety on both the client and the server.
- **Room pub/sub** -- clients join and leave rooms; the server routes messages automatically. Rooms are re-joined transparently on reconnect.
- **Auth built in** -- the server holds messages until authentication succeeds; no race conditions, no guesswork.
- **Offline-first queue** -- messages sent while disconnected are buffered and flushed when the connection is restored.
- **Binary by default** -- `msgpackr` MessagePack serialization out of the box, with JSON as an option.

---

## Architecture

```
┌───────────────────────────────────────────────────┐
│                     Your App                      │
├───────────────────────┬───────────────────────────┤
│   @bytesocket/client  │      @bytesocket/uws      │
│    (Browser / Node)   │  (uWebSockets.js server)  │
├───────────────────────┴───────────────────────────┤
│            Shared SocketEvents<T> type            │
│      (event names · payloads · room scopes)       │
└───────────────────────────────────────────────────┘
```

The `SocketEvents` interface is the single source of truth for your event schema. Import it on both sides and TypeScript enforces correctness everywhere.

---

## Quick Example

**Shared types** (`types.ts`):

```typescript
import type { SocketEvents } from "@bytesocket/client";

// Asymmetric usage (full control) – override specific event categories
export interface ChatEvents extends SocketEvents {
	listen: {
		"user:joined": { userId: string; name: string };
	};
	emit: {
		"user:message": { text: string };
	};
	listenRoom: {
		chat: { message: { text: string; sender: string } };
	};
	emitRoom: {
		chat: { message: { text: string } };
	};
}

// For symmetric events (emit and listen share the same map), use the generic directly:
export type ChatEvents = SocketEvents<{
	"user:message": { text: string };
	"user:joined": { userId: string; name: string };
}>;
```

**Server** (`server.ts`):

```typescript
import uWS from "uWebSockets.js";
import { ByteSocket } from "@bytesocket/uws";
import type { ChatEvents } from "./types";

const app = uWS.App();
const io = new ByteSocket<ChatEvents>(app, {
	auth: (socket, data, callback) => {
		// validate data.token, then:
		callback({ userId: "abc", name: "Ahmed" });
	},
});

io.lifecycle.onOpen((socket) => {
	socket.rooms.join("chat");
	io.emit("user:joined", { userId: socket.id, name: socket.payload.name });
});

io.rooms.on("chat", "message", (socket, data, next) => {
	// middleware -- runs before the message is broadcast
	next();
});

app.ws("/socket", io.handler);
app.listen(3000, () => console.log("Listening on :3000"));
```

**Client** (`client.ts`):

```typescript
import { ByteSocket } from "@bytesocket/client";
import type { ChatEvents } from "./types";

const socket = new ByteSocket<ChatEvents>("wss://example.com/socket", {
	auth: { token: "my-token" },
});

socket.lifecycle.onOpen(() => {
	socket.rooms.join("chat");
	socket.rooms.emit("chat", "message", { text: "Hello room!" });
});

socket.rooms.on("chat", "message", (data) => {
	console.log(`${data.sender}: ${data.text}`);
});

socket.on("user:joined", (data) => {
	console.log(`${data.name} joined`);
});
```

---

## Client Highlights

- Automatic reconnection with exponential backoff and jitter
- Offline message queue -- flushed automatically on reconnect
- Rooms re-joined transparently after reconnection
- Static or async auth token injection
- Configurable ping/pong heartbeat
- Relative URL support in browsers

→ [Full client documentation](./packages/client/README.md)

---

## Server Highlights (uws)

- Built on uWebSockets.js -- one of the fastest WebSocket servers available
- Per-socket and server-wide room emit
- Global middleware chain (async-capable, with timeout)
- Per-room, per-event middleware chain
- Join/leave guards via lifecycle hooks
- Origin allowlist
- Access to full HTTP upgrade context (headers, cookies, query)

→ [Full server documentation](./packages/uws/README.md)

---

## Installation

```bash
# Client
npm install @bytesocket/client

# Server (uWebSockets.js adapter)
npm install @bytesocket/uws
# uWebSockets.js must be installed separately -- see its docs for platform binaries
```

---

## Serialization

Both packages default to **binary MessagePack** via `msgpackr` -- significantly smaller payloads than JSON, especially for structured objects. Switch to JSON for easier debugging:

```typescript
// Must match on both client and server
{
	serialization: "json";
}
```

---

## Repository Structure

```
bytesocket/
├── packages/
│   ├── client/          # @bytesocket/client
│   └── uws/             # @bytesocket/uws
├── examples/
│   ├── chat/            # Full chat app (client + uws)
│   └── auth/            # Auth flow example
└── README.md
```

---

## License

[MIT](LICENSE) © 2026 Ahmed Ouda

- GitHub: [@a7med3ouda](https://github.com/a7med3ouda)
