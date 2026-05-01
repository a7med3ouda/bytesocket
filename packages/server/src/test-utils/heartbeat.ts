// packages/server/src/test-utils/heartbeat.ts
import type * as vitest from "vitest";
import WebSocket from "ws";
import { type CreateByteSocketServerResponse, type TestEvents } from ".";
import type { ByteSocketServerBase } from "../byte-socket-server-base";

export function serverHeartbeatTest<B extends ByteSocketServerBase<TestEvents> = ByteSocketServerBase<TestEvents>>(
	{ vi, afterEach, beforeEach, it, expect }: typeof vitest,
	createByteSocketServer: () => Promise<CreateByteSocketServerResponse<B>>,
	destroyByteSocketServer: (obj: CreateByteSocketServerResponse<B>) => void,
) {
	let obj: CreateByteSocketServerResponse<B>;

	beforeEach(async () => {
		obj = await createByteSocketServer();
	});

	afterEach(() => {
		destroyByteSocketServer(obj);
	});

	it("should respond to an empty binary ping with an empty binary pong", async () => {
		obj.io.attach(obj.server, "/ws");

		const client = new WebSocket(`ws://localhost:${obj.port}/ws`);
		const openHandler = vi.fn();
		client.on("open", openHandler);
		await vi.waitFor(() => expect(openHandler).toHaveBeenCalled());

		const pongReceived = vi.fn();
		client.on("message", (data, isBinary) => {
			if (isBinary && Buffer.isBuffer(data) && data.length === 0) {
				pongReceived();
			}
		});

		client.send(Buffer.alloc(0), { binary: true });

		await vi.waitFor(() => expect(pongReceived).toHaveBeenCalled());
		client.close();
	});

	return () => obj;
}
