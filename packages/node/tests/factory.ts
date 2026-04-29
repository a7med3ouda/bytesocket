import type { CreateByteSocketServerResponse, TestEvents } from "@bytesocket/core";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ByteSocket } from "../src/byte-socket";
import type { ByteSocketOptions } from "../src/types";

export function createByteSocket(options?: ByteSocketOptions) {
	return new ByteSocket<TestEvents>({ serialization: "json", ...options });
}

export async function createByteSocketServer(): Promise<CreateByteSocketServerResponse> {
	const server = createServer();
	const io = createByteSocket();
	const port = await new Promise<number>((resolve) => {
		server.listen(0, () => {
			resolve((server.address() as AddressInfo).port);
		});
	});

	return {
		io,
		server,
		port,
	};
}

export function destroyByteSocketServer({ io, server }: CreateByteSocketServerResponse) {
	io.destroy();
	if (typeof server === "object" && server !== null && "close" in server && typeof server.close === "function") {
		server.close();
	}
}
