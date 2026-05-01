// packages/uws/tests/rooms-bulk.test.ts
import { serverRoomsBulkTest } from "@bytesocket/server/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket uws: Rooms bulk operations", () => {
	serverRoomsBulkTest(vitest, createByteSocketServer, destroyByteSocketServer);
});
