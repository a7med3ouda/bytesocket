// packages/uws/tests/lifecycle.test.ts
import { serverLifecycleTest } from "@bytesocket/server/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket uws: Lifecycle", () => {
	serverLifecycleTest(vitest, createByteSocketServer, destroyByteSocketServer);
});
