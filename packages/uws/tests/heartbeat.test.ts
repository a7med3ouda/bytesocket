// packages/uws/tests/heartbeat.test.ts
import { serverHeartbeatTest } from "@bytesocket/server/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket uws: Heartbeat", () => {
	serverHeartbeatTest(vitest, createByteSocketServer, destroyByteSocketServer);
});
