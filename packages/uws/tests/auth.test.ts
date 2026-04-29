// packages/uws/tests/auth.test.ts
import { coreAuthTest } from "@bytesocket/core/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocket, createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket uws: Auth", () => {
	coreAuthTest(vitest, createByteSocket, createByteSocketServer, destroyByteSocketServer);
});
