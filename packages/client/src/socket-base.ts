import { AnyCallback, LifecycleTypes, type EventCallback } from "./types";

/**
 * Abstract base class providing common callback management for lifecycle and user events.
 * Used internally by `ByteSocket` and `RoomManager`.
 *
 * @internal
 */
export abstract class SocketBase {
	/** Whether debug logging is enabled. */
	protected abstract readonly debug: boolean;

	/** Stores permanent callbacks for lifecycle events. */
	protected lifecycleCallbacksMap = new Map<string | number, Set<AnyCallback>>();
	/** Stores `once` wrappers for lifecycle events. */
	protected onceLifecycleCallbacksMap = new Map<string | number, Map<AnyCallback, Set<AnyCallback>>>();

	/**
	 * Adds a callback to a given event in the provided map.
	 */
	protected addCallback<E extends string | number, D = unknown>(
		callbacksMap: Map<string | number, Set<AnyCallback>>,
		event: E,
		callback: EventCallback<D>,
	) {
		let eventCallbackSet = callbacksMap.get(event);
		if (!eventCallbackSet) {
			eventCallbackSet = new Set();
			callbacksMap.set(event, eventCallbackSet);
		}
		eventCallbackSet.add(callback);
	}

	/**
	 * Registers a one‑time callback by storing the wrapper in a separate map.
	 */
	protected addOnceCallback<E extends string | number, D = unknown>(
		onceCallbacksMap: Map<string | number, Map<AnyCallback, Set<AnyCallback>>>,
		event: E,
		callback: EventCallback<D>,
		callbackWrapper: EventCallback<D>,
	) {
		let onceEventMap = onceCallbacksMap.get(event);
		if (!onceEventMap) {
			onceEventMap = new Map();
			onceCallbacksMap.set(event, onceEventMap);
		}
		let wrappersSet = onceEventMap.get(callback);
		if (!wrappersSet) {
			wrappersSet = new Set();
			onceEventMap.set(callback, wrappersSet);
		}
		wrappersSet.add(callbackWrapper);
	}

	/**
	 * Removes a callback from an event map.
	 */
	protected deleteCallback<E extends string | number, D = unknown>(
		callbacksMap: Map<string | number, Set<AnyCallback>>,
		event: E,
		callbackWrapper: EventCallback<D>,
	) {
		const eventCallbackSet = callbacksMap.get(event);
		if (eventCallbackSet) {
			eventCallbackSet.delete(callbackWrapper);
			if (eventCallbackSet.size === 0) {
				callbacksMap.delete(event);
			}
		}
	}

	/**
	 * Removes a one‑time callback and its associated wrapper.
	 */
	protected deleteOnceCallback<E extends string | number, D = unknown>(
		onceCallbacksMap: Map<string | number, Map<AnyCallback, Set<AnyCallback>>>,
		event: E,
		callback: EventCallback<D>,
		callbackWrapper: EventCallback<D>,
	) {
		const onceEventMap = onceCallbacksMap.get(event);
		const wrappersSet = onceEventMap?.get(callback);
		if (wrappersSet) {
			wrappersSet.delete(callbackWrapper);
			if (wrappersSet.size === 0) {
				onceEventMap?.delete(callback);
				if (onceEventMap?.size === 0) {
					onceCallbacksMap.delete(event);
				}
			}
		}
	}

	/**
	 * Registers a permanent listener for a lifecycle event.
	 */
	protected onLifecycle<T extends LifecycleTypes>(type: T, callback: AnyCallback) {
		this.addCallback(this.lifecycleCallbacksMap, type, callback);
	}

	/**
	 * Removes a listener for a lifecycle event.
	 * If no callback is provided, all listeners for that event are removed.
	 */
	protected offLifecycle<T extends LifecycleTypes>(type: T, callback?: AnyCallback) {
		if (!callback) {
			this.lifecycleCallbacksMap.delete(type);
			this.onceLifecycleCallbacksMap.delete(type);
			return;
		}
		const onceTypeMap = this.onceLifecycleCallbacksMap.get(type);
		const wrappersSet = onceTypeMap?.get(callback);
		if (wrappersSet) {
			wrappersSet.forEach((wrapper) => {
				this.deleteCallback(this.lifecycleCallbacksMap, type, wrapper);
				this.deleteOnceCallback(this.onceLifecycleCallbacksMap, type, callback, wrapper);
			});
		}
		this.deleteCallback(this.lifecycleCallbacksMap, type, callback);
	}

	/**
	 * Registers a one‑time listener for a lifecycle event.
	 * The callback is automatically removed after the first invocation.
	 */
	protected onceLifecycle<T extends LifecycleTypes>(type: T, callback: AnyCallback) {
		const callbackWrapper = (...args: unknown[]) => {
			this.deleteCallback(this.lifecycleCallbacksMap, type, callbackWrapper);
			this.deleteOnceCallback(this.onceLifecycleCallbacksMap, type, callback, callbackWrapper);
			callback(...args);
		};
		this.addOnceCallback(this.onceLifecycleCallbacksMap, type, callback, callbackWrapper);
		this.addCallback(this.lifecycleCallbacksMap, type, callbackWrapper);
	}

	/**
	 * Safely invokes a set of callbacks, catching and logging errors if debug is enabled.
	 */
	protected triggerCallback(callbackWrappers?: Set<AnyCallback>, ...args: unknown[]) {
		if (!callbackWrappers) return;
		const callbacks = Array.from(callbackWrappers);
		for (const callback of callbacks) {
			if (!callbackWrappers.has(callback)) continue;
			try {
				callback(...args);
			} catch (error) {
				if (this.debug) console.error(error);
			}
		}
	}
}
