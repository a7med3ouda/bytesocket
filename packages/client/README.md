# ByteSocket

A modern WebSocket client with automatic reconnection, room management, authentication, heartbeat, and pluggable serialization — fully typed with TypeScript.

```bash
npm install bytesocket
```

---

## Features

- **Automatic reconnection** with exponential backoff and jitter
- **Room management** — join/leave rooms, scoped event listeners, bulk operations
- **Authentication** — static or async token injection with timeout
- **Heartbeat** — configurable ping/pong keepalive
- **Message queue** — outgoing messages are buffered while offline and flushed on reconnect
- **Dual serialization** — JSON or binary MessagePack (`msgpackr`) out of the box
- **Fully typed** — generic event maps for compile-time safety on all emit/listen calls
- **Zero runtime dependencies** beyond `msgpackr` (for binary mode)

---

## Backend Packages

| Package                                                            | Backend                                                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [`@bytesocket/uws`](https://www.npmjs.com/package/@bytesocket/uws) | [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js) ✅ Available |
| `@bytesocket/express`                                              | Express / `ws` 🚧 Coming soon                                                |

---

## Quick Start

```typescript
import { ByteSocket } from "bytesocket";

const socket = new ByteSocket("wss://example.com/socket");

socket.lifecycle.onOpen(() => console.log("Connected!"));
socket.lifecycle.onClose((event) => console.log("Closed", event.code));

socket.emit("hello", { text: "world" });
socket.on("welcome", (data) => console.log(data));
```

---

## Type-Safe Events

Define your event schema once and get full inference everywhere:

```typescript
import { ByteSocket, SymmetricEvents } from "bytesocket";

interface MyEvents extends SymmetricEvents {
	emit: {
		"user:message": { text: string };
		"user:typing": { userId: string };
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
}

const socket = new ByteSocket<MyEvents>("wss://example.com/socket");

// All of these are fully typed — wrong event names or payload shapes are compile errors
socket.emit("user:message", { text: "Hello!" });
socket.on("user:joined", (data) => console.log(data.name)); // data is typed
socket.rooms.emit("chat", "message", { text: "Hi room!" });
socket.rooms.on("chat", "message", (data) => console.log(data.sender));
```

---

## Authentication

### Static token

```typescript
const socket = new ByteSocket("wss://example.com/socket", {
	auth: { token: "my-secret-token" },
});

socket.lifecycle.onAuthSuccess(() => console.log("Authenticated"));
socket.lifecycle.onAuthError((err) => console.error("Auth failed", err));
```

### Async token (e.g. refresh before each connection)

```typescript
const socket = new ByteSocket("wss://example.com/socket", {
	auth: async (cb) => {
		const { token } = await fetch("/api/token").then((r) => r.json());
		cb({ token });
	},
	authTimeout: 8000, // ms to wait for server to confirm auth
});
```

> When auth is configured, `onOpen` fires only after the server confirms authentication — your callbacks and queued messages are safe.

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

socket.rooms.lifecycle.onJoinError((room, err) => {
	console.error(`Failed to join ${room}`, err);
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

// Emit to multiple rooms at once
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
});

socket.lifecycle.onReconnectFailed(() => {
	console.error("All reconnection attempts exhausted");
});
```

### Manual reconnect

```typescript
// Force an immediate reconnect (e.g. after regaining network)
socket.reconnect();
```

### Rooms on reconnect

Rooms you joined are automatically re-joined after reconnection — no extra code needed. The server is assumed to clear room membership on disconnect, and ByteSocket handles the rejoin handshake transparently.

---

## Heartbeat

Keepalive ping/pong is enabled by default.

```typescript
const socket = new ByteSocket("wss://example.com/socket", {
	heartbeatEnabled: true,
	pingInterval: 25000, // send ping every 25s
	pingTimeout: 20000, // close if no pong within 20s
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

socket.lifecycle.onQueueFull(() => {
	console.warn("Queue full — some messages will be dropped");
});
```

---

## Serialization

```typescript
// Binary (default) — uses msgpackr, smaller payloads
const socket = new ByteSocket("wss://example.com/socket", {
	serialization: "binary",
});

// JSON — plain text, easier to inspect
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
socket.lifecycle.onAuthError((err) => {});

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
socket.setAuth({ token: getToken() });
socket.connect();

// Update auth before a manual reconnect (must be called while socket is closed)
socket.close();
socket.setAuth({ token: await refreshToken() });
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
	randomizationFactor: 0.5, // 0 = no jitter, 1 = maximum jitter

	// URL
	path: "/socket",
	queryParams: { key: "value" },
	protocols: "v1",

	// Auth
	auth: { token: "abc" }, // or async (cb) => cb(data)
	authTimeout: 5000,

	// Heartbeat
	heartbeatEnabled: true,
	pingInterval: 25000,
	pingTimeout: 20000,

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

Copyright © 2026 Ahmed Ouda. All rights reserved.

This software and its source code are proprietary. No part of this package may be reproduced, distributed, or used in any form without prior written permission from the author.

- GitHub: [@a7med3ouda](https://github.com/a7med3ouda)
