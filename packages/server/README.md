# @bytesocket/server

Shared server logic for ByteSocket WebSocket server implementations. This package provides the abstract base classes, interfaces, and types that the transport‑specific adaptors (`@bytesocket/node`, `@bytesocket/uws`) extend to create a fully‑typed, real‑time server.

You do not need to install this package directly; it is a dependency of the main packages.

[![npm version](https://img.shields.io/npm/v/@bytesocket/server)](https://www.npmjs.com/package/@bytesocket/server)
[![MIT](https://img.shields.io/npm/l/@bytesocket/server)](LICENSE)
[![node-current](https://img.shields.io/node/v/@bytesocket/server?logo=nodedotjs)](https://nodejs.org/)
[![GitHub](https://img.shields.io/badge/GitHub-gray?style=flat&logo=github)](https://github.com/a7med3ouda/bytesocket/tree/main/packages/server)
[![GitHub stars](https://img.shields.io/github/stars/a7med3ouda/bytesocket?style=flat&logo=github)](https://github.com/a7med3ouda/bytesocket)
[![Socket Badge](https://badge.socket.dev/npm/package/@bytesocket/server/0.3.1)](https://badge.socket.dev/npm/package/@bytesocket/server/0.3.1)

## Features

- **Transport‑agnostic server skeleton** - `ByteSocketServerBase` handles message parsing, middleware execution, event routing, authentication, room join/leave, and lifecycle hooks. You only implement the transport‑specific parts.
- **Type‑safe event system** - Full TypeScript generics for emit/listen maps, room events, socket data, and middleware callbacks.
- **Pluggable serialization** - JSON (text) or MessagePack (binary) encoding, selectable per‑server instance or per‑message.
- **Shared test utilities** - Common test factories (`/test-utils`) let you run the exact same test suite against every adaptor.

---

## Installation

```bash
npm install @bytesocket/server
```

> This package is not meant to be used directly. Choose an adaptor that matches your WebSocket library:
>
> - [`@bytesocket/node`](https://www.npmjs.com/package/@bytesocket/node) - for Node.js [`ws`](https://github.com/websockets/ws)
> - [`@bytesocket/uws`](https://www.npmjs.com/package/@bytesocket/uws) - for [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js)

---

## Exports

### Main entry (`@bytesocket/server`)

- `ByteSocketServerBase` - abstract server class
- `SocketServerBase` - abstract per‑connection socket class
- `IByteSocket` / `ISocket` / `ISocketRooms` / `IRoomsServer` / `ILifecycleServer` - public API interfaces
- `ByteSocketOptionsBase` - configuration options shared by every adaptor
- `ServerIncomingData` / `ServerOutgoingData` - type aliases for raw WebSocket data
- `Middleware`, `EventCallback`, `RoomEventMiddleware`, `AuthFunction`, `MiddlewareNext` - callback types
- `SocketData` - the user data shape attached to every socket
- `encode` / `decode` - serialization helpers (MessagePack / JSON)

### Test utilities (`@bytesocket/server/test-utils`)

Factory functions that create a server + test client for running integration tests across adaptors:

```ts
import { serverConnectionTest } from "@bytesocket/server/test-utils";
```

Available test suites:

- `serverConnectionTest` - connection open/close, origin checks, header getters
- `serverHeartbeatTest` - empty‑binary ping/pong, automatic keep‑alive
- `serverAuthTest` - authentication flow (success / failure / timeout)
- `serverLifecycleTest` - lifecycle hook ordering and errors
- `serverMessagingTest` - message send / receive, serialization
- `serverRoomsSingleTest` - single‑room join/leave/emit
- `serverRoomsBulkTest` - bulk room operations

Each factory function receives:

1. The Vitest instance (`import * as vitest from 'vitest'`)
2. A `createByteSocket` function
3. A `createByteSocketServer` function
4. A `destroyByteSocketServer` function

See the [adaptor packages](#adaptors) for concrete examples.

---

## API overview

### `ByteSocketServerBase`

The abstract server class. Adaptors extend it and implement `attach`, `publishRaw`, and the upgrade lifecycle methods.

```ts
import { ByteSocketServerBase } from "@bytesocket/server";

class MyByteSocket extends ByteSocketServerBase<MyEvents> {
	attach(server: unknown, path: string): this {
		/* … */
	}
	// …
}
```

Key protected methods (call these from your adaptor):

- `message(socket, data, isBinary)` - process an incoming WebSocket message
- `close(socket, code, reason)` - handle a transport close event

Public API: `emit`, `on`, `off`, `once`, `use` (middleware), `encode`, `decode`, `destroy`.

### `SocketServerBase`

Abstract socket instance. Adaptors subclass it to provide `sendRaw`, `publishRaw`, `joinRoom`, `leaveRoom`, and `closeTransport`.

### Common options (`ByteSocketOptionsBase`)

| Option                   | Type                                  | Default                      | Description                                        |
| ------------------------ | ------------------------------------- | ---------------------------- | -------------------------------------------------- |
| `debug`                  | `boolean`                             | `false`                      | Enable debug logging                               |
| `serialization`          | `"json"` \| `"binary"`                | `"binary"`                   | Payload encoding format                            |
| `broadcastRoom`          | `string`                              | `"__bytesocket_broadcast__"` | Internal room used for global broadcasts           |
| `authTimeout`            | `number`                              | `5000`                       | Max milliseconds to wait for an auth response      |
| `middlewareTimeout`      | `number`                              | `5000`                       | Timeout for global middleware                      |
| `roomMiddlewareTimeout`  | `number`                              | `5000`                       | Timeout for room middleware                        |
| `idleTimeout`            | `number`                              | `120`                        | Seconds before an idle connection is closed        |
| `sendPingsAutomatically` | `boolean`                             | `true`                       | Send WebSocket pings to keep the connection alive  |
| `origins`                | `string[]`                            | -                            | Allowed origin list (empty = all allowed)          |
| `onMiddlewareError`      | `"ignore"` \| `"close"` \| `function` | `"ignore"`                   | Action when global middleware errors               |
| `onMiddlewareTimeout`    | `"ignore"` \| `"close"` \| `function` | `"ignore"`                   | Action when global middleware times out            |
| `msgpackrOptions`        | `object`                              | -                            | Options forwarded to the `msgpackr` Packr instance |
| `auth`                   | `AuthFunction`                        | -                            | User‑supplied authentication handler               |

---

## Usage example (via an adaptor)

```ts
import { ByteSocket } from '@bytesocket/node';   // or '@bytesocket/uws'
import { SocketEvents } from '@bytesocket/core';

type MyEvents = SocketEvents<{
  "chat:message": { text: string };
  "user:joined": { userId: string };
}>;

const io = new ByteSocket<MyEvents>({ debug: true });

io.on('chat:message', (socket, data) => {
  console.log(\`${socket.id} says: ${data.text}\`);
});

io.emit('user:joined', { userId: 'server' });

// attach to an HTTP server or uWS app
io.attach(server, '/ws');
```

---

## Adaptors

Transport‑specific implementations:

- [@bytesocket/node](../node) - Node.js `ws` library
- [@bytesocket/uws](../uws) - uWebSockets.js

Both expose a concrete `ByteSocket` class that you instantiate directly.

---

## Testing with shared utilities

```ts
// packages/node/tests/connection.test.ts
import * as vitest from "vitest";
import { serverConnectionTest } from "@bytesocket/server/test-utils";
import { createByteSocket, createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket node: Connection", () => {
	serverConnectionTest(vitest, createByteSocket, createByteSocketServer, destroyByteSocketServer);
});
```

Your factory file provides the three functions that wrap your specific transport setup. The shared test suite handles the rest.

---

## License

[MIT](LICENSE) © 2026 Ahmed Ouda

- GitHub: [@a7med3ouda](https://github.com/a7med3ouda)
