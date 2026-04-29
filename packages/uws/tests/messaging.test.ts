// packages/uws/tests/messaging.test.ts
import { coreMessagingTest } from "@bytesocket/core/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocket, createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket uws: Messaging", () => {
	coreMessagingTest(vitest, createByteSocket, createByteSocketServer, destroyByteSocketServer);
});
