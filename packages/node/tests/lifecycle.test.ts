// packages/node/tests/lifecycle.test.ts
import { serverLifecycleTest } from "@bytesocket/server/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket node: Lifecycle", () => {
	serverLifecycleTest(vitest, createByteSocketServer, destroyByteSocketServer);
});
