# `@bytesocket/node`

WebSocket server for [ByteSocket](https://github.com/a7med3ouda/bytesocket/tree/main/packages/node) built on the popular [ws](https://github.com/websockets/ws) library.

[![npm version](https://img.shields.io/npm/v/@bytesocket/node)](https://www.npmjs.com/package/@bytesocket/node)
[![MIT](https://img.shields.io/npm/l/@bytesocket/node)](LICENSE)
[![node-current](https://img.shields.io/node/v/@bytesocket/node?logo=nodedotjs)](https://nodejs.org/)
[![GitHub](https://img.shields.io/badge/GitHub-gray?style=flat&logo=github)](https://github.com/a7med3ouda/bytesocket/tree/main/packages/node)
[![GitHub stars](https://img.shields.io/github/stars/a7med3ouda/bytesocket?style=flat&logo=github)](https://github.com/a7med3ouda/bytesocket)

> ✅ Works with any Node.js HTTP server -- Express, Fastify, Koa, NestJS, plain `http.createServer`, and more.

---

## Features

- **Room-based pub/sub** -- join/leave rooms, scoped middleware, bulk operations
- **Authentication** -- server-side auth function with callback and timeout
- **Global middleware** -- inspect or block any incoming message before processing
- **Room middleware** -- middleware chain per room+event, with `next()` / `next(err)` flow
- **Lifecycle hooks** -- upgrade, open, message, close, error -- all typed and cancellable
- **Server-side broadcast** -- emit to all sockets, a room, or multiple rooms
- **Origin validation** -- allowlist origins at the framework level
- **Full TypeScript** -- generic event maps shared with the client for end-to-end type safety
- **Dual serialization** -- JSON or binary MessagePack (`msgpackr`) out of the box
- **Built-in heartbeat** -- configurable idle timeout and automatic pings

---

## Installation

```bash
# Server (Node.js backend)
npm install @bytesocket/node
# or
pnpm add @bytesocket/node
# or
yarn add @bytesocket/node

# Client (browser / Node.js frontend)
npm install @bytesocket/client
# or
pnpm add @bytesocket/client
# or
yarn add @bytesocket/client
```

No additional dependencies required — `ws` is included as a dependency of `@bytesocket/node`.

---

## Quick Start

```typescript
import http from "node:http";
import { ByteSocket } from "@bytesocket/node";

const server = http.createServer();
const io = new ByteSocket();

io.lifecycle.onOpen((socket) => {
	console.log(`Socket ${socket.id} connected`);
	socket.rooms.join("lobby");
});

io.lifecycle.onClose((socket, code) => {
	console.log(`Socket ${socket.id} disconnected (${code})`);
});

io.on("hello", (socket, data) => {
	socket.emit("welcome", { message: `Hello, ${data.name}!` });
});

io.attach(server, "/socket");

server.listen(3000, () => {
	console.log("Listening on port 3000");
});
```

---

## Framework Integration

### Express

```typescript
import express from "express";
import http from "node:http";
import { ByteSocket } from "@bytesocket/node";

const app = express();
const server = http.createServer(app);
const io = new ByteSocket();

io.attach(server, "/ws");

server.listen(3000, () => console.log("Server ready"));
```

### Fastify

```typescript
import fastify from "fastify";
import { ByteSocket } from "@bytesocket/node";

const app = fastify({ logger: true });
const io = new ByteSocket();

io.attach(app.server, "/ws");

app.listen({ port: 3000 });
```

### Koa

```typescript
import Koa from "koa";
import http from "node:http";
import { ByteSocket } from "@bytesocket/node";

const app = new Koa();
const server = http.createServer(app.callback());
const io = new ByteSocket();

io.attach(server, "/ws");

server.listen(3000);
```

### NestJS

```typescript
import { Module, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ByteSocket } from "@bytesocket/node";
import * as http from "node:http";

@Module({})
export class SocketModule implements OnModuleInit, OnModuleDestroy {
	private io = new ByteSocket();

	onModuleInit() {
		// access the underlying HTTP server (Nest application adapter)
		const app = this.app.getHttpAdapter().getInstance();
		const server = app instanceof http.Server ? app : app?.server;

		if (server) {
			this.io.attach(server, "/ws");
			console.log("WebSocket server attached");
		}

		// example listener
		this.io.on("hello", (socket, data) => {
			socket.emit("welcome", { message: `Hi ${data.name}` });
		});
	}

	onModuleDestroy() {
		this.io.destroy();
	}
}
```

> **Note:** The exact way to obtain the HTTP server depends on the platform adapter used (Express, Fastify, etc.).  
> For Express, `app.getHttpServer()` returns the underlying `http.Server`. For Fastify, use `app.getHttpAdapter().getInstance().server`.

---

## Type-Safe Events

Share a single event interface between server and client for end-to-end type safety. You can use **symmetric events** (emit and listen share the same map) or **asymmetric events** (full control via interface extension).

### Symmetric usage (most common)

Use `SocketEvents<T>` directly with a single event map:

```typescript
import { ByteSocket, SocketEvents } from "@bytesocket/node";

type MyEvents = SocketEvents<{
	"chat:message": { text: string };
	"user:joined": { userId: string };
}>;

const io = new ByteSocket<MyEvents>();

// Emit and listen share the same typed events
io.emit("chat:message", { text: "Server announcement" });
io.on("user:joined", (socket, data) => {
	console.log(`User ${data.userId} joined`);
});

// Rooms also use the same map
io.rooms.emit("lobby", "chat:message", { text: "Welcome to the lobby" });
io.rooms.on("lobby", "chat:message", (socket, data, next) => {
	console.log(`${socket.id} said: ${data.text}`);
	next();
});
```

### Asymmetric usage (full control)

Extend `SocketEvents` and override specific properties to differentiate emit/listen/room maps:

```typescript
import { ByteSocket, SocketEvents } from "@bytesocket/node";

interface MyEvents extends SocketEvents {
	emit: {
		"server:broadcast": { text: string; from: string };
		"room:created": { roomId: string };
	};
	listen: {
		"user:message": { text: string };
		"user:typing": { userId: string };
	};
	emitRoom: {
		chat: { message: { text: string; sender: string } };
	};
	listenRoom: {
		chat: { message: { text: string; sender: string } };
	};
}

const io = new ByteSocket<MyEvents>();

// Global emits/listens
io.emit("server:broadcast", { text: "Hello all", from: "system" });
io.on("user:message", (socket, data) => {
	console.log(data.text); // string ✓
});

// Room-specific emits/listens (different maps per room)
io.rooms.emit("chat", "message", { text: "Hello!", sender: "server" });
io.rooms.on("chat", "message", (socket, data, next) => {
	console.log(`${data.sender}: ${data.text}`);
	next();
});
```

All server methods (`emit`, `on`, `off`, `once`, `rooms.emit`, `rooms.on`, etc.) are fully typed -- wrong event names or payload shapes become compile-time errors.

---

## Authentication

Validate credentials when a client first connects. Until auth succeeds, no user messages are processed.

```typescript
import { ByteSocket } from "@bytesocket/node";

interface MySocketData extends SocketData {
	userId: number;
}

const io = new ByteSocket<MyEvents, MySocketData>({
	auth: (socket, data, callback) => {
		// data is whatever the client sent in its auth payload
		if (data.token === "valid-token") {
			callback({ userId: 42 }); // payload is attached to socket.payload
		} else {
			callback(null, new Error("Invalid token"));
		}
	},
	authTimeout: 8000, // ms before closing unauthenticated connections
});

io.lifecycle.onOpen((socket) => {
	// Only fires after successful auth
	console.log("Authenticated user:", socket.payload);
});
```

---

## Rooms

### Joining and leaving (server-side)

```typescript
io.lifecycle.onOpen((socket) => {
	socket.rooms.join("lobby");
	socket.rooms.leave("lobby");
	console.log(socket.rooms.list()); // ["__bytesocket_broadcast__"]
});
```

### Emitting to rooms

```typescript
// From any socket instance
socket.rooms.emit("chat", "message", { text: "Hello room!", sender: "server" });

// From the server globally
io.rooms.emit("chat", "message", { text: "Announcement!", sender: "server" });

// Broadcast to all connected sockets
socket.broadcast("user:joined", { userId: socket.id, name: "Ahmed" });
io.emit("user:joined", { userId: "abc", name: "Ahmed" });
```

### Bulk operations

```typescript
socket.rooms.bulk.join(["lobby", "notifications", "chat"]);
socket.rooms.bulk.leave(["lobby", "notifications"]);
socket.rooms.bulk.emit(["room1", "room2"], "alert", { msg: "Hello both!" });
```

### Room lifecycle hooks (join/leave guards)

```typescript
// Single-room guard
io.rooms.lifecycle.onJoin((socket, room, next) => {
	if (room === "admin" && !socket.payload?.isAdmin) {
		next(new Error("Not authorized"));
	} else {
		next();
	}
});

// Bulk join guard
io.rooms.bulk.lifecycle.onJoin((socket, rooms, next) => {
	console.log(`${socket.id} joining: ${rooms.join(", ")}`);
	next();
});
```

### Room event middleware

```typescript
// Middleware chain per room + event -- call next() to forward, next(err) to block
io.rooms.on("chat", "message", (socket, data, next) => {
	if (data.text.includes("badword")) {
		next(new Error("Profanity not allowed")); // message is not forwarded
	} else {
		next();
	}
});

// One-time middleware
io.rooms.once("chat", "message", (socket, data, next) => {
	console.log("First chat message ever:", data.text);
	next();
});

// Remove middleware
io.rooms.off("chat", "message", myMiddleware);
io.rooms.off("chat", "message"); // remove all for this event
io.rooms.off("chat"); // remove all for this room
```

---

## Global Middleware

Runs before any user message is dispatched to listeners.

```typescript
// Synchronous
io.use((socket, ctx, next) => {
	console.log("Incoming message:", ctx.event);
	next();
});

// Async
io.use(async (socket, ctx, next) => {
	await logToDatabase(socket.id, ctx);
	next();
});

// Block a message
io.use((socket, ctx, next) => {
	if (socket.locals.rateLimited) {
		next(new Error("Rate limited"));
	} else {
		next();
	}
});
```

### Middleware error handling

```typescript
const io = new ByteSocket({
	middlewareTimeout: 5000, // ms before timeout error
	onMiddlewareError: "close", // "ignore" | "close" | (error, socket) => void
	onMiddlewareTimeout: "ignore",
});
```

---

## Heartbeat / Idle Timeout

By default, the server sends automatic pings and closes connections that remain idle for 120 seconds.

```typescript
const io = new ByteSocket({
	idleTimeout: 60, // seconds of inactivity before termination (0 = disabled)
	sendPingsAutomatically: true, // set to false to disable pings
});
```

The idle timer resets on every incoming message or pong. You can disable pings and timeouts entirely:

```typescript
const io = new ByteSocket({
	idleTimeout: 0,
	sendPingsAutomatically: false,
});
```

---

## Lifecycle Events

```typescript
// HTTP upgrade phase
io.lifecycle.onUpgrade((req, streamSocket, head, userData, wss) => {
	// Inspect headers, throw or call streamSocket.destroy() to reject
});

// Socket open (fires after auth if configured)
io.lifecycle.onOpen((socket) => {
	console.log(`${socket.id} connected`);
});

// Authentication success
io.lifecycle.onAuthSuccess((socket) => {
	console.log(`Socket ${socket.id} authenticated`);
});

// Authentication failure
io.lifecycle.onAuthError((socket, ctx) => {
	console.error(`Auth failed for ${socket.id}:`, ctx.error);
});

// Raw incoming message
io.lifecycle.onMessage((socket, rawBuffer, isBinary) => {
	console.log("Raw message received", rawBuffer);
});

// Socket closed
io.lifecycle.onClose((socket, code, reason) => {
	console.log(`${socket.id} closed with code ${code}`);
});

// Errors (decode, auth, middleware, etc.)
io.lifecycle.onError((socket, ctx) => {
	const socketId = socket?.id ?? "unknown";
	console.error(`[${socketId}] Error in phase "${ctx.phase}":`, ctx.error);
});
```

All lifecycle methods have `on`, `once`, and `off` variants:

```typescript
io.lifecycle.onceOpen((socket) => console.log("First ever connection"));
io.lifecycle.offClose(myCloseHandler);
io.lifecycle.offClose(); // remove all close listeners
```

---

## Socket API

Every event handler and middleware receives a `Socket` instance:

```typescript
// Unique identifier
socket.id; // UUID string

// Auth payload (set by your auth function)
socket.payload; // any (cast to your type)

// Arbitrary data store -- survives across middleware
socket.locals.requestId = randomUUID();

// HTTP metadata from upgrade request (convenience getters)
socket.url; // path, e.g. "/socket"
socket.query; // raw query string (without leading `?`)
socket.cookie; // Cookie header
socket.authorization; // Authorization header
socket.userAgent; // User-Agent header
socket.host; // Host header
socket.xForwardedFor; // X-Forwarded-For header

// The raw userData object (including any custom fields) is still available:
socket.userData; // full SocketData object

// Auth state
socket.isAuthenticated; // boolean
socket.isClosed; // boolean

// Send directly to this socket
socket.emit("welcome", { message: "Hello!" });
socket.sendRaw(buffer); // bypass serialization

// Room operations
socket.rooms.join("chat");
socket.rooms.leave("chat");
socket.rooms.list(); // string[]
socket.rooms.emit("chat", "message", { text: "Hi" });

// Broadcast to everyone (including this socket)
socket.broadcast("user:joined", { userId: socket.id });

// Close this connection
socket.close();
socket.close(1008, "Policy violation");
```

---

## Custom Socket Data

Extend `SocketData` to add your own typed fields, populated during the upgrade:

```typescript
import { ByteSocket, SocketData } from "@bytesocket/node";

interface AppSocketData extends SocketData {
	tenantId: string;
}

const io = new ByteSocket<MyEvents, AppSocketData>({
	// ...
});
```

You can populate extra fields by overriding `onUpgrade` or using a custom auth function that stores values in `socket.locals` or `socket.payload`.

---

## Origin Validation

```typescript
const io = new ByteSocket({
	origins: ["https://example.com", "https://app.example.com"],
	// Empty array (default) = allow all origins
});
```

---

## Serialization

```typescript
// Binary (default) -- msgpackr, smallest payloads
const io = new ByteSocket({ serialization: "binary" });

// JSON -- plain text, easier to inspect/debug
const io = new ByteSocket({ serialization: "json" });

// Advanced msgpackr options
const io = new ByteSocket({
	serialization: "binary",
	msgpackrOptions: {
		useFloat32: true,
		bundleStrings: false,
	},
});
```

> The serialization mode must match the client's `serialization` option.

---

## Advanced: Manual Serialization

Use `encode()` and `decode()` to bypass the automatic serialization.

```typescript
// Encode a structured payload (returns a string or Buffer)
const encoded = io.encode({ event: "chat", data: { text: "Hello" } });

// Broadcast the raw encoded payload to a room
io.rooms.publishRaw("lobby", encoded);

// Or send it to a specific socket
socket.sendRaw(encoded);

// Decode a raw incoming message
io.lifecycle.onMessage((socket, rawBuffer, isBinary) => {
	const decoded = io.decode(rawBuffer, isBinary);
	console.log("Decoded message:", decoded);
});
```

- `encode(payload)` -- uses the configured `serialization` (`"json"` or `"binary"`).
- `decode(message, isBinary?)` -- parses a raw WebSocket message. Handles fragmented messages automatically.

---

## Server Sockets Map

```typescript
// Iterate all connected sockets
for (const [id, socket] of io.sockets) {
	socket.emit("ping", undefined);
}

// Look up a specific socket
const socket = io.sockets.get(socketId);
```

---

## Multiple Paths on One Server

```typescript
const io = new ByteSocket();
io.attach(server, "/chat");
io.attach(server, "/notifications");
// Share the same underlying WebSocket server, but route messages based on path
```

The `path` is available via `socket.url`.

---

## Destroy

```typescript
// Closes all connections, shuts down the WebSocket server,
// removes the upgrade listener from the HTTP server.
// Instance cannot be reused.
io.destroy();
```

After `destroy()`, you can safely attach a new `ByteSocket` instance to the same HTTP server without conflicts.

---

## Full Configuration Reference

```ts
const io = new ByteSocket({
	// Authentication
	auth: (socket, data, callback) => {
		callback({ userId: 1 });
	},
	authTimeout: 5000,

	// Middleware
	middlewareTimeout: 5000,
	roomMiddlewareTimeout: 5000,
	onMiddlewareError: "ignore",
	onMiddlewareTimeout: "ignore",

	// Serialization
	serialization: "binary", // "binary" | "json"
	msgpackrOptions: {},

	// CORS
	origins: ["https://example.com"],

	// Broadcast
	broadcastRoom: "__bytesocket_broadcast__",

	// Heartbeat
	idleTimeout: 120, // seconds, 0 = disabled
	sendPingsAutomatically: true,

	// Debug
	debug: false,

	// ws-specific options (see ServerOptions for full list)
	serverOptions: {
		maxPayload: 100 * 1024 * 1024,
		perMessageDeflate: true,
		skipUTF8Validation: false,
		autoPong: true,
		// … any other ws.ServerOptions except `noServer`/`port`/`server`/`host`/`backlog`/`path`
	},
});
```

### Transport‑specific options

All `ws` server settings (e.g., `maxPayload`, `perMessageDeflate`, `verifyClient`, `handleProtocols`) are passed through the `serverOptions` field. The reserved keys `noServer`, `port`, `server`, `host`, `backlog`, and `path` are excluded because ByteSocket manages them internally.

```typescript
const io = new ByteSocket({
	serverOptions: {
		maxPayload: 1024 * 1024,
		perMessageDeflate: { threshold: 512 },
	},
});
```

Any option in serverOptions is passed directly to the `ws` WebSocketServer constructor.

---

## License

[MIT](LICENSE) © 2026 Ahmed Ouda

- GitHub: [@a7med3ouda](https://github.com/a7med3ouda)
