// packages/node/tests/connection.test.ts
import { coreConnectionTest } from "@bytesocket/core/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocket, createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket node: Connection", () => {
	coreConnectionTest(vitest, createByteSocket, createByteSocketServer, destroyByteSocketServer);
});
