# ByteSocket

A modern WebSocket client for [ByteSocket](https://github.com/a7med3ouda/bytesocket/tree/main/packages/client) with automatic reconnection, room management, authentication, heartbeat, and pluggable serialization -- fully typed with TypeScript.

[![npm version](https://img.shields.io/npm/v/@bytesocket/client)](https://www.npmjs.com/package/@bytesocket/client)
[![MIT](https://img.shields.io/npm/l/@bytesocket/client)](LICENSE)
[![node-current](https://img.shields.io/node/v/@bytesocket/client?logo=nodedotjs)](https://nodejs.org/)
[![GitHub](https://img.shields.io/badge/GitHub-gray?style=flat&logo=github)](https://github.com/a7med3ouda/bytesocket/tree/main/packages/client)
[![GitHub stars](https://img.shields.io/github/stars/a7med3ouda/bytesocket?style=flat&logo=github)](https://github.com/a7med3ouda/bytesocket)
[![Socket Badge](https://badge.socket.dev/npm/package/@bytesocket/client/0.3.1)](https://badge.socket.dev/npm/package/@bytesocket/client/0.3.1)

---

## Features

- **Automatic reconnection** with exponential backoff and jitter
- **Room management** -- join/leave rooms, scoped event listeners, bulk operations
- **Authentication** -- static or async token injection with timeout
- **Heartbeat** -- configurable ping/pong keepalive
- **Message queue** -- outgoing messages are buffered while offline and flushed on reconnect
- **Dual serialization** -- JSON or binary MessagePack (`msgpackr`) out of the box
- **Fully typed** -- generic event maps for compile-time safety on all emit/listen calls
- **Lightweight** - uses `@bytesocket/core` internally (installed automatically, no extra step)

---

## Installation

```bash
npm install @bytesocket/client
# or
pnpm add @bytesocket/client
# or
yarn add @bytesocket/client
```

## Backend Packages

| Package                                                              | Backend                                                         | Status            |
| -------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------- |
| [`@bytesocket/uws`](https://www.npmjs.com/package/@bytesocket/uws)   | [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js) | ✅&nbsp;Available |
| [`@bytesocket/node`](https://www.npmjs.com/package/@bytesocket/node) | node:http server using [ws](https://www.npmjs.com/package/ws)   | ✅&nbsp;Available |

---

## Quick Start

```typescript
import { ByteSocket } from "@bytesocket/client";

const socket = new ByteSocket("wss://example.com/socket");

socket.lifecycle.onOpen(() => console.log("Connected!"));
socket.lifecycle.onClose((event) => console.log("Closed", event.code));

socket.emit("hello", { text: "world" });
socket.on("welcome", (data) => console.log(data));
```

---

## Type-Safe Events

Define your event schema once and get full inference everywhere. You can use **symmetric events** (emit and listen share the same map) or **asymmetric events** (full control via interface extension).

> **Note:** To type-check bulk room emits (`rooms.bulk.emit`), you must define an `emitRooms` union in your event map (see the asymmetric example). Otherwise, bulk emit falls back to loosely-typed arguments.

### Symmetric usage (most common)

Use `SocketEvents<T>` directly with a single event map:

```typescript
import { ByteSocket, SocketEvents } from "@bytesocket/client";

type MyEvents = SocketEvents<{
	"chat:message": { text: string };
	"user:joined": { userId: string };
}>;

const socket = new ByteSocket<MyEvents>("wss://example.com/socket");

// Emit and listen share the same typed events
socket.emit("chat:message", { text: "Hello!" });
socket.on("user:joined", (data) => console.log(data.userId));

// Rooms also use the same map
socket.rooms.join("lobby");
socket.rooms.emit("lobby", "chat:message", { text: "Hi room!" });
socket.rooms.on("lobby", "chat:message", (data) => {
	console.log(`Message: ${data.text}`);
});
```

### Asymmetric usage (full control)

Extend `SocketEvents` and override specific properties to differentiate emit/listen/room maps:

```typescript
import { ByteSocket, SocketEvents } from "@bytesocket/client";

interface MyEvents extends SocketEvents {
	emit: {
		"user:message": { text: string };
		"room:created": { roomId: string };
	};
	listen: {
		"server:broadcast": { text: string; from: string };
		"user:joined": { userId: string; name: string };
	};
	emitRoom: {
		chat: { message: { text: string } };
		notifications: { dismiss: { id: string } };
	};
	listenRoom: {
		chat: {
			message: { text: string; sender: string; timestamp: number };
			"user:left": { userId: string };
		};
	};
	// For bulk emit typing you MUST provide a union of explicit room arrays:
	emitRooms: { rooms: ["lobby", "announcements"]; event: { alert: string } } | { rooms: ["roomA", "roomB"]; event: { message: { text: string } } };
}

const socket = new ByteSocket<MyEvents>("wss://example.com/socket");

// Global emits/listens
socket.emit("room:created", { roomId: "abc" });
socket.on("user:joined", (data) => console.log(data.name));

// Room-specific emits/listens (different maps per room)
socket.rooms.emit("chat", "message", { text: "Hello!" });
socket.rooms.on("chat", "message", (data) => {
	console.log(`${data.sender}: ${data.text}`);
});
```

All methods (`emit`, `on`, `off`, `once`, `rooms.emit`, `rooms.on`, etc.) are fully typed -- wrong event names or payload shapes become compile-time errors.

---

## Authentication

### Static token

```typescript
const socket = new ByteSocket("wss://example.com/socket", {
	auth: { data: { token: "my-secret-token" } },
});

socket.lifecycle.onAuthSuccess(() => console.log("Authenticated"));
socket.lifecycle.onAuthError((err) => console.error("Auth failed", err));
```

> `onAuthError` receives an `ErrorContext` object containing `phase`, `error`, `event`, `raw`, `code`, and `bytes`.

### Async token (e.g. refresh before each connection)

```typescript
const socket = new ByteSocket("wss://example.com/socket", {
	auth: async (callback) => {
		const { token } = await fetch("/api/token").then((r) => r.json());
		callback({ token });
	},
	authTimeout: 8000, // ms to wait for server to confirm auth
});
```

> When auth is configured, `onOpen` fires only after the server confirms authentication -- your callbacks and queued messages are safe.

---

## Rooms

### Joining and leaving

```typescript
socket.rooms.join("lobby");
socket.rooms.leave("lobby");
```

### Listening to room events

```typescript
socket.rooms.on("chat", "message", (data) => {
	console.log(`${data.sender}: ${data.text}`);
});

// One-time listener
socket.rooms.once("chat", "message", (data) => {
	console.log("First message ever:", data.text);
});

// Remove a specific listener
socket.rooms.off("chat", "message", myCallback);

// Remove all listeners for an event
socket.rooms.off("chat", "message");

// Remove all listeners for a room
socket.rooms.off("chat");
```

### Emitting to a room

```typescript
socket.rooms.emit("chat", "message", { text: "Hello room!" });
```

### Room lifecycle events

```typescript
socket.rooms.lifecycle.onJoinSuccess((room) => {
	console.log(`Joined ${room}`);
});

socket.rooms.lifecycle.onJoinError((room, ctx) => {
	console.error(`Failed to join ${room}:`, ctx.error);
	// ctx also contains phase, event, raw, code, bytes for debugging
});

socket.rooms.lifecycle.onLeaveSuccess((room) => {
	console.log(`Left ${room}`);
});
```

### Bulk operations

```typescript
// Join multiple rooms in one request
socket.rooms.bulk.join(["lobby", "notifications", "chat"]);

// Leave multiple rooms
socket.rooms.bulk.leave(["lobby", "notifications"]);

// Emit to multiple rooms at once (fully typed only if emitRooms is defined)
socket.rooms.bulk.emit(["room1", "room2"], "announcement", { text: "Hello everyone!" });

// Bulk lifecycle events
socket.rooms.bulk.lifecycle.onJoinSuccess((rooms) => {
	console.log("Joined rooms:", rooms);
});
```

---

## Reconnection

Reconnection is automatic by default with exponential backoff and jitter.

```typescript
const socket = new ByteSocket("wss://example.com/socket", {
	reconnection: true,
	maxReconnectionAttempts: 10,
	reconnectionDelay: 1000, // initial delay in ms
	reconnectionDelayMax: 30000, // cap delay at 30s
	randomizationFactor: 0.5, // ±50% jitter
	reconnectOnNormalClosure: true, // default true - reconnect after server sends 1000/1001
});

socket.lifecycle.onReconnectFailed(() => {
	console.error("All reconnection attempts exhausted");
});
```

### reconnectOnNormalClosure

By default, ByteSocket will attempt to reconnect even when the server closes the connection gracefully (close codes `1000` or `1001`). This is useful when the server restarts or a load balancer terminates the connection for maintenance. Set `reconnectOnNormalClosure: false` to disable reconnection for normal closures.

### Manual reconnect

```typescript
// Force an immediate reconnect (e.g. after regaining network)
socket.reconnect();
```

### Rooms on reconnect

Rooms you joined are automatically re-joined after reconnection -- no extra code needed. The server is assumed to clear room membership on disconnect, and ByteSocket handles the rejoin handshake transparently.

---

## Heartbeat

Keepalive ping/pong is enabled by default.

```typescript
const socket = new ByteSocket("wss://example.com/socket", {
	heartbeatEnabled: true,
	pingInterval: 50000, // send ping every 50s (default)
	pingTimeout: 40000, // close if no pong within 40s (default)
});
```

If no pong is received within `pingTimeout`, the connection is closed and reconnection begins automatically.

---

## Message Queue

Messages emitted while the socket is offline are queued and sent automatically on reconnect.

```typescript
const socket = new ByteSocket("wss://example.com/socket", {
	maxQueueSize: 100, // default; drop oldest when full
});

// onQueueFull is called when a message is dropped because the queue is full
socket.lifecycle.onQueueFull(() => {
	console.warn("Queue full -- some messages are being dropped");
});
```

---

## Serialization

```typescript
// Binary (default) -- uses msgpackr, smaller payloads
const socket = new ByteSocket("wss://example.com/socket", {
	serialization: "binary",
});

// JSON -- plain text, easier to inspect
const socket = new ByteSocket("wss://example.com/socket", {
	serialization: "json",
});
```

Advanced msgpackr options:

```typescript
const socket = new ByteSocket("wss://example.com/socket", {
	serialization: "binary",
	msgpackrOptions: {
		useFloat32: true,
		bundleStrings: false,
	},
});
```

---

## Advanced: Manual Serialization

If you need to inspect, pre-encode, or bypass the automatic serialization, you can use the `encode()` and `decode()` methods.

> ⚠️ **These are advanced APIs.** Prefer `emit()` and `on()` for type-safe, automatic encoding/decoding.

```typescript
// Encode any payload (returns a string or Uint8Array)
const encoded = socket.encode({ event: "chat", data: { text: "Hello" } });
socket.sendRaw(encoded);

// Decode a raw incoming message (auto-detects format)
socket.lifecycle.onMessage((raw) => {
	const decoded = socket.decode(raw);
	console.log("Decoded message:", decoded);
});

// You can also pass the binary flag explicitly
const decoded = socket.decode(someArrayBuffer, true);
```

- `encode(payload)` - uses the configured `serialization` (`"json"` or `"binary"`). Returns a `string` (JSON) or `Uint8Array` (MessagePack). Accepts any value (`unknown`).
- `decode(message, isBinary?)` - parses a raw WebSocket message back into an object. If `isBinary` is omitted, the format is auto-detected.

> **Caution:** `encode()` throws if the payload cannot be serialised (e.g., circular references or functions). Wrap it in a try-catch when dealing with untrusted data structures.

These methods give you full control when integrating with external systems or debugging the wire format.

---

## URL Options

```typescript
const socket = new ByteSocket("wss://example.com", {
	path: "/socket", // appended to URL path
	queryParams: {
		version: "2",
		clientId: "abc123",
	},
	protocols: ["v2.chat"], // WebSocket subprotocols
});
// Connects to: wss://example.com/socket?version=2&clientId=abc123
```

Relative URLs are supported in browser environments:

```typescript
const socket = new ByteSocket("/socket"); // uses window.location.origin
```

---

## Connection Control

```typescript
// Disable auto-connect and connect manually
const socket = new ByteSocket("wss://example.com/socket", {
	autoConnect: false,
});

socket.connect();

// Graceful close (no auto-reconnect after this)
socket.close();
socket.close(1000, "User logged out");

// Permanently destroy the instance and clean up all resources
socket.destroy();
```

---

## Lifecycle Events Reference

```typescript
// Connection
socket.lifecycle.onOpen(() => {}); // socket ready (after auth if configured)
socket.lifecycle.onClose((event) => {}); // socket closed
socket.lifecycle.onError((event) => {}); // WebSocket error

// Authentication
socket.lifecycle.onAuthSuccess(() => {});
socket.lifecycle.onAuthError((err) => {}); // err is ErrorContext

// Raw incoming message (before parsing)
socket.lifecycle.onMessage((raw) => {
	console.log("Raw message received", raw);
});

// Queue
socket.lifecycle.onQueueFull(() => {});

// Reconnection
socket.lifecycle.onReconnectFailed(() => {});
```

All lifecycle methods have `on`, `once`, and `off` variants:

```typescript
socket.lifecycle.onceOpen(() => console.log("Connected for the first time"));
socket.lifecycle.offOpen(myOpenHandler);
socket.lifecycle.offOpen(); // remove all open listeners
```

---

## Update Auth Before Reconnect

```typescript
const socket = new ByteSocket("wss://example.com/socket", {
	autoConnect: false,
});

// Set auth before the first connect
socket.setAuth({ data: { token: getToken() } });
socket.connect();

// Update auth before a manual reconnect (must be called while socket is closed)
socket.close();
socket.setAuth({ data: { token: await refreshToken() } });
socket.connect();
```

---

## Raw Messages

For advanced use cases where you need to bypass serialization:

```typescript
socket.sendRaw(new Uint8Array([1, 2, 3]));
socket.sendRaw('{"custom":"payload"}');
```

---

## Full Configuration Reference

```typescript
const socket = new ByteSocket("wss://example.com/socket", {
	// Connection
	autoConnect: true,

	// Reconnection
	reconnection: true,
	maxReconnectionAttempts: Infinity,
	reconnectionDelay: 1000,
	reconnectionDelayMax: 5000,
	reconnectOnNormalClosure: true, // default true - reconnect after server-initiated 1000/1001
	randomizationFactor: 0.5, // 0 = no jitter, 1 = maximum jitter

	// URL
	path: "/socket",
	queryParams: { key: "value" },
	protocols: "v1",

	// Auth
	auth: { data: { token: "abc" } }, // or async (callback) => callback(data)
	authTimeout: 5000,

	// Heartbeat
	heartbeatEnabled: true,
	pingInterval: 50000,
	pingTimeout: 40000,

	// Queue
	maxQueueSize: 100,

	// Serialization
	serialization: "binary", // 'binary' | 'json'
	msgpackrOptions: {
		useFloat32: FLOAT32_OPTIONS.DECIMAL_FIT,
		copyBuffers: false,
		int64AsType: "bigint",
		bundleStrings: true,
	},

	// Debug
	debug: false,
});
```

---

## License

[MIT](LICENSE) © 2026 Ahmed Ouda

- GitHub: [@a7med3ouda](https://github.com/a7med3ouda)
