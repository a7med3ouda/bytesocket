// packages/server/src/test-utils/index.ts
import type { SocketEvents } from "@bytesocket/core";
import type { ClientRequestArgs } from "node:http";
import { WebSocket } from "ws";
import type { ByteSocketServerBase } from "../byte-socket-server-base";

export type TestEvents = SocketEvents<{
	echo: { message: string };
	broadcast: { text: string };
}>;
export interface CreateByteSocketServerResponse<B extends ByteSocketServerBase = ByteSocketServerBase> {
	io: B;
	server: unknown;
	port: number;
	listenSocket?: unknown;
}

export function createClient(
	port: number,
	url = `ws://localhost:${port}/ws`,
	options?: WebSocket.ClientOptions | ClientRequestArgs,
): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url, options);
		ws.on("open", () => resolve(ws));
		ws.on("error", reject);
	});
}

export * from "./auth";
export * from "./connection";
export * from "./heartbeat";
export * from "./lifecycle";
export * from "./messaging";
export * from "./rooms-bulk";
export * from "./rooms-single";
