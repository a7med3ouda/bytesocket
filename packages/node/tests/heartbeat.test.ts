// packages/node/tests/heartbeat.test.ts
import { coreHeartbeatTest } from "@bytesocket/core/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import WebSocket from "ws";
import { createByteSocket, createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket node: Heartbeat", () => {
	const getObj = coreHeartbeatTest(vitest, createByteSocketServer, destroyByteSocketServer);

	vitest.it("should send protocol pings and keep connection alive when client responds", async () => {
		const obj = getObj();

		obj.io = createByteSocket({
			serialization: "json",
			idleTimeout: 2,
			sendPingsAutomatically: true,
		});
		obj.io.attach(obj.server, "/ws");

		const client = new WebSocket(`ws://localhost:${obj.port}/ws`);
		const closeHandler = vitest.vi.fn();
		client.on("close", closeHandler);

		await vitest.vi.waitFor(() => vitest.expect(client.readyState).toBe(WebSocket.OPEN));
		await vitest.vi.waitFor(() => vitest.expect(closeHandler).not.toHaveBeenCalled(), { timeout: 5000 });

		client.close();
	});

	vitest.it("should send protocol pings at the configured interval", async () => {
		const obj = getObj();

		obj.io = createByteSocket({
			serialization: "json",
			idleTimeout: 2,
			sendPingsAutomatically: true,
		});
		obj.io.attach(obj.server, "/ws");

		const client = new WebSocket(`ws://localhost:${obj.port}/ws`);
		const pingHandler = vitest.vi.fn();
		client.on("ping", pingHandler);

		await vitest.vi.waitFor(() => vitest.expect(client.readyState).toBe(WebSocket.OPEN));
		await vitest.vi.waitFor(() => vitest.expect(pingHandler).toHaveBeenCalled(), { timeout: 3000 });

		client.close();
	});
});
