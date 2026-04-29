// packages/node/tests/lifecycle.test.ts
import { coreLifecycleTest } from "@bytesocket/core/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket node: Lifecycle", () => {
	coreLifecycleTest(vitest, createByteSocketServer, destroyByteSocketServer);
});
