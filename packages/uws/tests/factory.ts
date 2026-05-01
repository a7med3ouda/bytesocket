// packages/uws/tests/factory.ts
import type { CreateByteSocketServerResponse, TestEvents } from "@bytesocket/server/test-utils";
import uWS from "uWebSockets.js";
import { ByteSocket } from "../src/byte-socket";
import type { ByteSocketOptions } from "../src/types";

export function createByteSocket(options?: ByteSocketOptions) {
	return new ByteSocket<TestEvents>({ serialization: "json", ...options });
}

export async function createByteSocketServer(): Promise<CreateByteSocketServerResponse> {
	const server = uWS.App();
	const io = createByteSocket();
	const [port, listenSocket] = await new Promise<[number, false | uWS.us_listen_socket]>((resolve) => {
		server.listen(0, (token) => {
			resolve([uWS.us_socket_local_port(token), token]);
		});
	});
	return {
		io,
		server,
		port,
		listenSocket,
	};
}

export function destroyByteSocketServer({ io, listenSocket }: CreateByteSocketServerResponse) {
	io.destroy();
	if (listenSocket) {
		uWS.us_listen_socket_close(listenSocket);
	}
}
