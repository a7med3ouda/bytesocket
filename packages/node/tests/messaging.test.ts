// packages/node/tests/messaging.test.ts
import { serverMessagingTest } from "@bytesocket/server/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocket, createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket node: Messaging", () => {
	serverMessagingTest(vitest, createByteSocket, createByteSocketServer, destroyByteSocketServer);
});
