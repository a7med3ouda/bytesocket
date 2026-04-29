// packages/uws/tests/heartbeat.test.ts
import { coreHeartbeatTest } from "@bytesocket/core/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket uws: Heartbeat", () => {
	coreHeartbeatTest(vitest, createByteSocketServer, destroyByteSocketServer);
});
