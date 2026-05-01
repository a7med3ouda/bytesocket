// packages/node/tests/auth.test.ts
import { serverAuthTest } from "@bytesocket/server/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocket, createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket node: Auth", () => {
	serverAuthTest(vitest, createByteSocket, createByteSocketServer, destroyByteSocketServer);
});
