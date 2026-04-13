# ByteSocket

**ByteSocket** is a strongly typed WebSocket client for TypeScript that focuses on reliability, ergonomics, and performance.

It includes:

- **Binary serialization** with `msgpackr` by default
- **JSON serialization** when you need it
- **Automatic reconnection** with exponential backoff
- **Heartbeat / ping-pong** health checks
- **Room management** with optimistic join / leave behavior
- **Authentication support**
- **Message queuing** while offline
- **Type-safe global, room, and multi-room events**

---

## Backend support

ByteSocket currently includes backend support through:

- `@bytesocket/uws` for **uWebSockets.js** backend apps

**Express support is coming soon.**

---

## Installation

Install ByteSocket in your project using your package manager of choice.

```bash
npm install @bytesocket/client
# or
pnpm add @bytesocket/client
# or
yarn add @bytesocket/client
```

---

## Why ByteSocket?

WebSocket libraries are often either flexible but untyped, or typed but limited.

ByteSocket aims to give you both:

- a clean API for real-time apps
- strong TypeScript inference for events and room data
- a stable transport layer with reconnect, heartbeat, and auth handling
- support for both JSON and binary message formats

---

## Features

### Transport and reliability

- Automatic connection on creation
- Manual connect, reconnect, close, and destroy control
- Reconnection with configurable backoff
- Ping / pong heartbeat
- Message queue with size limit
- Queue overflow notification

### Serialization

- Default binary serialization with `msgpackr`
- Optional JSON serialization
- Predefined msgpack structures for efficient encoding

### Messaging model

- Global events
- Room events
- Multi-room events
- System messages for open, close, error, auth, join, leave, and queue events

### Type safety

- Strongly typed event maps
- Room-aware payload inference
- Symmetric event definitions for `emit`, `listen`, `emitRoom`, `listenRoom`, and `emitRooms`

---

## Quick start

```ts
import { ByteSocket, SymmetricEvents } from "bytesocket";

type Events = SymmetricEvents<{
	emit: {
		chat: { message: string };
		typing: { isTyping: boolean };
	};
	listen: {
		chat: { message: string; sender: string };
		welcome: { text: string };
	};
	emitRoom: {
		lobby: {
			gameStart: { level: number };
		};
	};
	listenRoom: {
		lobby: {
			playerMove: { playerId: string; position: { x: number; y: number } };
		};
	};
}>;

const socket = new ByteSocket<Events>("ws://localhost:3000", {
	debug: true,
	auth: {
		data: { token: "abc123" },
	},
});

socket.onOpen(() => {
	console.log("Connected");
});

socket.on("chat", (data) => {
	console.log(`${data.sender}: ${data.message}`);
});

socket.onRoom("lobby", "playerMove", (data) => {
	console.log("Player moved:", data.position);
});

socket.emit("chat", { message: "Hello!" });
socket.emitRoom("lobby", "gameStart", { level: 1 });
```

---

## Authentication

ByteSocket supports authentication in two ways:

### Static auth payload

```ts
const socket = new ByteSocket("ws://localhost:3000", {
	auth: {
		data: { token: "abc123" },
	},
});
```

### Async auth provider

```ts
const socket = new ByteSocket("ws://localhost:3000", {
	auth: (done) => {
		fetch("/api/token")
			.then((res) => res.json())
			.then((data) => done({ token: data.token }));
	},
});
```

Authentication is sent automatically after the socket opens. If auth succeeds, queued messages are flushed and room rejoin is restored.

---

## Rooms

Rooms are first-class in ByteSocket.

```ts
socket.joinRoom("lobby");
socket.leaveRoom("lobby");

socket.joinRooms(["lobby", "chat"]);
socket.leaveRooms(["lobby", "chat"]);
```

Room listeners are typed as well:

```ts
socket.onRoom("lobby", "playerMove", (data) => {
	console.log(data.playerId);
});
```

You can also remove room listeners safely:

```ts
socket.offRoom("lobby", "playerMove");
socket.offRoom("lobby");
```

---

## Events

### Global events

```ts
socket.on("message", (data) => {
	console.log(data);
});

socket.emit("message", { text: "hello" });
```

### One-time listeners

```ts
socket.once("welcome", (data) => {
	console.log("Received once:", data);
});
```

### Removing listeners

```ts
socket.off("message");
socket.off("message", handler);
```

---

## System events

ByteSocket exposes built-in system event helpers for lifecycle and room operations:

```ts
socket.onOpen(() => console.log("Opened"));
socket.onClose((event) => console.log("Closed:", event.code));
socket.onError((event) => console.error(event));
socket.onAuthSuccess(() => console.log("Auth successful"));
socket.onAuthError((data) => console.error("Auth failed", data));

socket.onJoinRoomSuccess((room) => console.log("Joined room:", room));
socket.onJoinRoomError((room, data) => console.error("Join failed:", room, data));
socket.onLeaveRoomSuccess((room) => console.log("Left room:", room));
socket.onLeaveRoomError((room, data) => console.error("Leave failed:", room, data));

socket.onQueueFull(() => console.warn("Message queue is full"));
```

---

## Configuration

```ts
const socket = new ByteSocket("ws://localhost:3000", {
	autoConnect: true,
	reconnection: true,
	maxReconnectionAttempts: Infinity,
	reconnectionDelay: 1000,
	reconnectionDelayMax: 5000,
	randomizationFactor: 0.5,
	protocols: ["v1"],
	path: "/socket",
	queryParams: { client: "web" },
	heartbeatEnabled: true,
	pingInterval: 25000,
	pingTimeout: 20000,
	authTimeout: 5000,
	maxQueueSize: 100,
	serialization: "binary",
	debug: false,
});
```

### Options overview

- `autoConnect`: connect immediately after construction
- `reconnection`: enable automatic reconnects
- `maxReconnectionAttempts`: maximum reconnect attempts
- `reconnectionDelay`: base reconnect delay
- `reconnectionDelayMax`: maximum reconnect delay
- `randomizationFactor`: jitter applied to reconnect delay
- `protocols`: WebSocket subprotocol(s)
- `path`: append a path to the base URL
- `queryParams`: add URL query parameters
- `heartbeatEnabled`: enable ping / pong heartbeat
- `pingInterval`: interval between pings
- `pingTimeout`: timeout waiting for pong
- `auth`: static or callback-based auth configuration
- `authTimeout`: timeout for authentication
- `maxQueueSize`: maximum queued messages while offline
- `serialization`: `binary` or `json`
- `debug`: enable diagnostic logging

---

## Message formats

### User messages

- `GeneralEvent` for global broadcasts
- `RoomEvent` for single-room messages
- `RoomsEvent` for multi-room messages

### System messages

ByteSocket reserves internal message types for:

- open / close / error
- auth / auth success / auth error
- ping / pong
- join / leave room
- join / leave multiple rooms
- queue full

These are represented by the `SystemTypes` enum.

---

## Utilities and types

ByteSocket exports reusable TypeScript helpers:

- `StringKeys<T>`
- `StringNumberKeys<T>`
- `MsgpackrOptions`
- `SystemTypes`
- `SystemMessage`
- `UserMessage`
- `AuthConfig`
- `SymmetricEvents`
- `ByteSocketOptions`

This makes it easy to build your own abstractions on top of ByteSocket while keeping type safety.

---

## Example architecture

A common setup looks like this:

```ts
type AppEvents = SymmetricEvents<{
	emit: {
		chat: { message: string };
	};
	listen: {
		chat: { message: string; sender: string };
	};
	emitRoom: {
		lobby: {
			ready: { userId: string };
		};
	};
	listenRoom: {
		lobby: {
			playerJoined: { userId: string };
		};
	};
}>;

const socket = new ByteSocket<AppEvents>("ws://localhost:3000", {
	serialization: "binary",
	heartbeatEnabled: true,
	reconnection: true,
});
```

This gives you typed emit/listen calls while ByteSocket handles the transport details.

---

## Notes

- ByteSocket is designed for environments that support `WebSocket`.
- In browsers, relative URLs such as `/socket` are supported.
- The client can queue messages while offline and flush them after reconnection or auth success.
- Room joins are optimistic, and success or error events can be used to confirm server state.

---

## Copyright

Copyright © Ahmed Ouda (`a7med3ouda`). All rights reserved.

No part of this project may be reproduced, distributed, or modified without the developer's permission, except where explicitly allowed by law.

---

## License

All rights reserved.
