// packages/uws/tests/connection.test.ts
import { serverConnectionTest } from "@bytesocket/server/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocket, createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket uws: Connection", () => {
	serverConnectionTest(vitest, createByteSocket, createByteSocketServer, destroyByteSocketServer);
});
