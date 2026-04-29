// packages/uws/tests/rooms-bulk.test.ts
import { coreRoomsBulkTest } from "@bytesocket/core/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket uws: Rooms bulk operations", () => {
	coreRoomsBulkTest(vitest, createByteSocketServer, destroyByteSocketServer);
});
