# `@bytesocket/uws`

High-performance WebSocket server for [ByteSocket](https://github.com/a7med3ouda/bytesocket/tree/main/packages/uws) built on [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js).

> ✅ Compatible with Ultimate Express and any framework exposing a `uWebSockets.js` instance.
> ⚠️ Hyper Express supported only when accessing the underlying uWS instance

```bash
npm install @bytesocket/uws
# or
pnpm add @bytesocket/uws
# or
yarn add @bytesocket/uws
```

> **Peer dependency:** `uWebSockets.js` must be installed separately.  
> See [uWebSockets.js installation](https://github.com/uNetworking/uWebSockets.js#installation) for platform-specific instructions.

---

## Features

- **Room-based pub/sub** — join/leave rooms, scoped middleware, bulk operations
- **Authentication** — server-side auth function with callback and timeout
- **Global middleware** — inspect or block any incoming message before processing
- **Room middleware** — middleware chain per room+event, with `next()` / `next(err)` flow
- **Lifecycle hooks** — upgrade, open, message, close, error — all typed and cancellable
- **Server-side broadcast** — emit to all sockets, a room, or multiple rooms
- **Origin validation** — allowlist origins at the framework level
- **Full TypeScript** — generic event maps shared with the client for end-to-end type safety
- **Dual serialization** — JSON or binary MessagePack (`msgpackr`) out of the box

---

## Quick Start

```typescript
import uWS from "uWebSockets.js";
import { ByteSocket } from "@bytesocket/uws";

const app = uWS.App();
const io = new ByteSocket(app);

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

app.ws("/socket", io.handler);

app.listen(3000, (token) => {
	if (token) console.log("Listening on port 3000");
});
```

---

## Ultimate Express Compatibility

```typescript
import express from "ultimate-express";

const app = express();
const io = new ByteSocket(app.uwsApp);

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

app.uwsApp.ws("/api/ws", io.handler);

app.listen(3000, (token) => {
	if (token) console.log("Listening on port 3000");
});
```

---

## Type-Safe Events

Share a single event interface between server and client for end-to-end type safety:

```typescript
import { ByteSocket, SocketEvents } from "@bytesocket/uws";

// Define once, import on both sides
export type MyEvents = SocketEvents<{
	emit: {
		"server:broadcast": { text: string; from: string };
		"user:joined": { userId: string; name: string };
	};
	listen: {
		"user:message": { text: string };
		"user:typing": { userId: string };
	};
	emitRoom: {
		chat: {
			message: { text: string; sender: string; timestamp: number };
		};
	};
	listenRoom: {
		chat: {
			message: { text: string; sender: string };
		};
	};
	emitRooms?: {
		rooms: ["lobby", "announcements"];
		events: {
			alert: { msg: string };
		};
	};
}>;

const io = new ByteSocket<MyEvents>(app);

// Fully typed — wrong event names or payload shapes are compile errors
io.on("user:message", (socket, data) => {
	console.log(data.text); // string ✓
});

io.rooms.on("chat", "message", (socket, data, next) => {
	console.log(data.sender); // string ✓
	next();
});
```

---

## Authentication

Validate credentials when a client first connects. Until auth succeeds, no user messages are processed.

```typescript
import { ByteSocket } from "@bytesocket/uws";

interface MySocketData extends SocketData {
	userId: number;
}

const io = new ByteSocket<MyEvents, MySocketData>(app, {
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
		// The error is sent to the client as a join_room_error with a proper ErrorContext
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
// Middleware chain per room + event — call next() to forward, next(err) to block
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
const io = new ByteSocket(app, {
	middlewareTimeout: 5000, // ms before timeout error
	onMiddlewareError: "close", // "ignore" | "close" | (error, socket) => void
	onMiddlewareTimeout: "ignore",
});
```

---

## Lifecycle Events

```typescript
// HTTP upgrade phase
io.lifecycle.onUpgrade((res, req, userData, context) => {
	// Inspect headers, validate origin, etc.
	// Throw or call res.end() to reject
});

// Socket open (fires after auth if configured)
io.lifecycle.onOpen((socket) => {
	console.log(`${socket.id} connected`);
});

// Authentication success (fires after server confirms auth)
io.lifecycle.onAuthSuccess((socket) => {
	console.log(`Socket ${socket.id} authenticated`);
});

// Authentication failure (fires when auth fails or times out)
io.lifecycle.onAuthError((socket, ctx) => {
	console.error(`Auth failed for ${socket.id}:`, ctx.error);
});

// Raw incoming message
io.lifecycle.onMessage((socket, parsed, rawBuffer, isBinary) => {
	console.log("Raw message received", parsed);
});

// Socket closed
io.lifecycle.onClose((socket, code, message) => {
	console.log(`${socket.id} closed with code ${code}`);
});

// Errors (decode, auth, middleware, etc.)
io.lifecycle.onError((socket, ctx) => {
	// socket may be null if the error occurred before the socket was fully created (e.g., upgrade phase)
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

// Arbitrary data store — survives across middleware
socket.locals.requestId = randomUUID();

// HTTP metadata from upgrade request (convenience getters)
socket.query; // query string
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
import { ByteSocket, SocketData } from "@bytesocket/uws";

interface AppSocketData extends SocketData {
	tenantId: string;
}

const io = new ByteSocket<MyEvents, AppSocketData>(app, {
	auth: (socket, data, callback) => {
		const tenant = lookupTenant(data.token);
		if (!tenant) return callback(null, new Error("Unauthorized"));
		// Attach to userData directly during upgrade via onUpgrade,
		// or use socket.locals / socket.payload for runtime data
		callback({ tenantId: tenant.id });
	},
});
```

---

## Origin Validation

```typescript
const io = new ByteSocket(app, {
	origins: ["https://example.com", "https://app.example.com"],
	// Empty array (default) = allow all origins
});
```

---

## Serialization

```typescript
// Binary (default) — msgpackr, smallest payloads
const io = new ByteSocket(app, { serialization: "binary" });

// JSON — plain text, easier to inspect/debug
const io = new ByteSocket(app, { serialization: "json" });

// Advanced msgpackr options
const io = new ByteSocket(app, {
	serialization: "binary",
	msgpackrOptions: {
		useFloat32: true,
		bundleStrings: false,
	},
});
```

> The serialization mode must match the client's `serialization` option.

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

## Destroy

```typescript
// Closes all connections and cleans up all resources
// Instance cannot be reused after this
io.destroy();
```

---

## Full Configuration Reference

```typescript
const io = new ByteSocket(app, {
	// Authentication
	auth: (socket, data, cb) => {
		cb({ userId: 1 });
	},
	authTimeout: 5000,

	// Middleware
	middlewareTimeout: 5000,
	roomMiddlewareTimeout: 5000,
	onMiddlewareError: "ignore", // "ignore" | "close" | (err, socket) => void
	onMiddlewareTimeout: "ignore",

	// Serialization
	serialization: "binary", // "binary" | "json"
	msgpackrOptions: {},

	// CORS
	origins: ["https://example.com"],

	// Broadcast
	broadcastRoom: "__bytesocket_broadcast__",

	// Debug
	debug: false,

	// uWebSockets.js pass-through options
	maxPayloadLength: 16 * 1024 * 1024,
	idleTimeout: 120,
	compression: 0,
});
```

Any option not consumed by ByteSocket is passed directly to uWebSockets.js as part of the `WebSocketBehavior` configuration.

---

## License

[MIT](LICENSE) © 2026 Ahmed Ouda

- GitHub: [@a7med3ouda](https://github.com/a7med3ouda)
