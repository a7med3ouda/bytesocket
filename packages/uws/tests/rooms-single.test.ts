// packages/uws/tests/rooms-single.test.ts
import { coreRoomsSingleTest } from "@bytesocket/core/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocket, createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket uws: Rooms single operations", () => {
	coreRoomsSingleTest(vitest, createByteSocket, createByteSocketServer, destroyByteSocketServer);
});
