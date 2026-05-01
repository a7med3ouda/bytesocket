// packages/node/tests/rooms-single.test.ts
import { serverRoomsSingleTest } from "@bytesocket/server/test-utils";
import * as vitest from "vitest";
import { describe } from "vitest";
import { createByteSocket, createByteSocketServer, destroyByteSocketServer } from "./factory";

describe("ByteSocket node: Rooms single operations", () => {
	serverRoomsSingleTest(vitest, createByteSocket, createByteSocketServer, destroyByteSocketServer);
});
