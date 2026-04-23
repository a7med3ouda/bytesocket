// packages/client/tests/socket-base.test.ts
import { LifecycleTypes } from "@bytesocket/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SocketBase } from "../src/socket-base";

class TestSocketBase extends SocketBase {
	debug = false;
}

describe("ByteSocket Client: SocketBase", () => {
	let base: TestSocketBase;

	beforeEach(() => {
		base = new TestSocketBase();
	});

	it("should add and trigger callbacks", () => {
		const callback = vi.fn();
		base["addCallback"](base["lifecycleCallbacksMap"], LifecycleTypes.message, callback);
		base["triggerCallback"](base["lifecycleCallbacksMap"].get(LifecycleTypes.message), "arg1", "arg2");
		expect(callback).toHaveBeenCalledWith("arg1", "arg2");
	});

	it("should delete a specific callback", () => {
		const cb1 = vi.fn();
		const cb2 = vi.fn();
		base["addCallback"](base["lifecycleCallbacksMap"], LifecycleTypes.message, cb1);
		base["addCallback"](base["lifecycleCallbacksMap"], LifecycleTypes.message, cb2);

		base["deleteCallback"](base["lifecycleCallbacksMap"], LifecycleTypes.message, cb1);

		base["triggerCallback"](base["lifecycleCallbacksMap"].get(LifecycleTypes.message), "arg");
		expect(cb1).not.toHaveBeenCalled();
		expect(cb2).toHaveBeenCalledWith("arg");
	});

	it("should clear all callbacks when no callback provided", () => {
		const cb1 = vi.fn();
		const cb2 = vi.fn();
		base["addCallback"](base["lifecycleCallbacksMap"], LifecycleTypes.message, cb1);
		base["addCallback"](base["lifecycleCallbacksMap"], LifecycleTypes.message, cb2);

		base["offLifecycle"](LifecycleTypes.message);

		base["triggerCallback"](base["lifecycleCallbacksMap"].get(LifecycleTypes.message), "arg");
		expect(cb1).not.toHaveBeenCalled();
		expect(cb2).not.toHaveBeenCalled();

		expect(base["onceLifecycleCallbacksMap"].has(LifecycleTypes.message)).toBe(false);
	});

	it("should execute once callbacks only once", () => {
		const callback = vi.fn();
		base["onceLifecycle"](LifecycleTypes.message, callback);

		const set = base["lifecycleCallbacksMap"]?.get(LifecycleTypes.message);
		expect(set?.size).toBe(1);

		base["triggerCallback"](set, "arg");
		expect(callback).toHaveBeenCalledTimes(1);

		expect(set?.size).toBe(0);

		base["triggerCallback"](set, "arg");
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("should catch and log errors in debug mode", () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		base = new TestSocketBase();
		base.debug = true;

		const errorCb = vi.fn(() => {
			throw new Error("test error");
		});
		base["addCallback"](base["lifecycleCallbacksMap"], LifecycleTypes.message, errorCb);
		base["triggerCallback"](base["lifecycleCallbacksMap"].get(LifecycleTypes.message));

		expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error));
		consoleSpy.mockRestore();
	});

	it("should delete an event key when its last callback is removed", () => {
		const cb = vi.fn();
		base["addCallback"](base["lifecycleCallbacksMap"], LifecycleTypes.message, cb);
		base["deleteCallback"](base["lifecycleCallbacksMap"], LifecycleTypes.message, cb);
		expect(base["lifecycleCallbacksMap"].has(LifecycleTypes.message)).toBe(false);
	});

	it("should offLifecycle with a callback and clean up its once wrappers", () => {
		const cb = vi.fn();
		base["onceLifecycle"](LifecycleTypes.message, cb);
		base["offLifecycle"](LifecycleTypes.message, cb);
		base["triggerCallback"](base["lifecycleCallbacksMap"].get(LifecycleTypes.message), "arg");
		expect(cb).not.toHaveBeenCalled();
		expect(base["onceLifecycleCallbacksMap"].has(LifecycleTypes.message)).toBe(false);
	});
});
