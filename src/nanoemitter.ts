export type EventMap = Record<string, unknown[]>;

export interface ListenerOptions<Args extends unknown[] = unknown[]> {
  once?: boolean;
  priority?: number;
  signal?: AbortSignal;
  filter?: (...args: Args) => boolean;
}

export interface EmitterOptions {
  delimiter?: string;
}

export interface WaitForOptions {
  timeout?: number;
  signal?: AbortSignal;
}

export type Unsubscribe = () => void;

// Internal listener types
type ListenerType = "event" | "any" | "pattern";

interface BaseListener {
  fn: Function;
  once: boolean;
  priority: number;
  type: ListenerType;
  removed?: boolean;
  filter?: (...args: unknown[]) => boolean;
}

interface EventListener extends BaseListener {
  type: "event";
  event: string;
}

interface AnyListener extends BaseListener {
  type: "any";
}

interface PatternListener extends BaseListener {
  type: "pattern";
  pattern: string;
  matcher: (event: string) => boolean;
}

type Listener = EventListener | AnyListener | PatternListener;

/**
 * Binary search to find insertion index for priority-sorted array.
 * Higher priority = earlier in array.
 */
function findInsertIndex(listeners: Listener[], priority: number): number {
  let low = 0;
  let high = listeners.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (listeners[mid].priority >= priority) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * Create a matcher function for a pattern, with caching of split results.
 */
function createMatcher(pattern: string, delimiter: string): (event: string) => boolean {
  const patternParts = pattern.split(delimiter);
  const hasWildcard = patternParts[patternParts.length - 1] === "*";
  const prefixLen = hasWildcard ? patternParts.length - 1 : patternParts.length;
  const prefixParts = patternParts.slice(0, prefixLen);

  return (event: string): boolean => {
    const eventParts = event.split(delimiter);
    if (eventParts.length < prefixLen) return false;
    if (hasWildcard && eventParts.length === prefixLen) return false;
    for (let i = 0; i < prefixLen; i++) {
      if (eventParts[i] !== prefixParts[i]) return false;
    }
    return hasWildcard ? true : eventParts.length === patternParts.length;
  };
}

export class NanoEmitter<Events extends EventMap = EventMap> {
  private _listeners: Listener[] = [];
  private _delimiter: string;
  private _disposed = false;

  constructor(options: EmitterOptions = {}) {
    const delimiter = options.delimiter ?? ":";
    if (typeof delimiter !== "string" || delimiter.length === 0) {
      throw new TypeError("delimiter must be a non-empty string");
    }
    if (delimiter === "*") {
      throw new TypeError("delimiter cannot be '*' as it conflicts with wildcard matching");
    }
    this._delimiter = delimiter;
  }

  // -------------------------------------------------------------------------
  // Validation helpers
  // -------------------------------------------------------------------------

  private _assertNotDisposed(): void {
    if (this._disposed) {
      throw new Error("Emitter has been disposed");
    }
  }

  private _assertEvent(event: unknown): asserts event is string {
    if (typeof event !== "string") {
      throw new TypeError("event must be a string");
    }
  }

  private _assertPattern(pattern: unknown): asserts pattern is string {
    if (typeof pattern !== "string") {
      throw new TypeError("pattern must be a string");
    }
    const parts = pattern.split(this._delimiter);
    const wildcardIndex = parts.indexOf("*");
    if (wildcardIndex !== -1 && wildcardIndex !== parts.length - 1) {
      throw new TypeError("pattern wildcard must be the trailing segment");
    }
  }

  private _assertListener(fn: unknown): asserts fn is Function {
    if (typeof fn !== "function") {
      throw new TypeError("listener must be a function");
    }
  }

  // -------------------------------------------------------------------------
  // Subscribe methods
  // -------------------------------------------------------------------------

  on<E extends string & keyof Events>(
    event: E,
    fn: (...args: Events[E]) => unknown,
    options: ListenerOptions<Events[E]> = {}
  ): Unsubscribe {
    this._assertNotDisposed();
    this._assertEvent(event);
    this._assertListener(fn);

    const listener: EventListener = {
      type: "event",
      event: event as string,
      fn,
      once: Boolean(options.once),
      priority: Number(options.priority ?? 0),
      filter: options.filter as ((...args: unknown[]) => boolean) | undefined,
    };

    return this._addListener(listener, options.signal);
  }

  once<E extends string & keyof Events>(
    event: E,
    fn: (...args: Events[E]) => unknown,
    options: ListenerOptions<Events[E]> = {}
  ): Unsubscribe {
    return this.on(event, fn, { ...options, once: true });
  }

  onAny(
    fn: (event: string, ...args: unknown[]) => unknown,
    options: ListenerOptions<[string, ...unknown[]]> = {}
  ): Unsubscribe {
    this._assertNotDisposed();
    this._assertListener(fn);

    const listener: AnyListener = {
      type: "any",
      fn,
      once: Boolean(options.once),
      priority: Number(options.priority ?? 0),
      filter: options.filter as ((...args: unknown[]) => boolean) | undefined,
    };

    return this._addListener(listener, options.signal);
  }

  onPattern(
    pattern: string,
    fn: (event: string, ...args: unknown[]) => unknown,
    options: ListenerOptions<[string, ...unknown[]]> = {}
  ): Unsubscribe {
    this._assertNotDisposed();
    this._assertPattern(pattern);
    this._assertListener(fn);

    const listener: PatternListener = {
      type: "pattern",
      pattern,
      fn,
      once: Boolean(options.once),
      priority: Number(options.priority ?? 0),
      matcher: createMatcher(pattern, this._delimiter),
      filter: options.filter as ((...args: unknown[]) => boolean) | undefined,
    };

    return this._addListener(listener, options.signal);
  }

  private _addListener(listener: Listener, signal?: AbortSignal): Unsubscribe {
    if (signal?.aborted) {
      return () => {};
    }

    const index = findInsertIndex(this._listeners, listener.priority);
    this._listeners.splice(index, 0, listener);

    const unsubscribe = () => {
      if (listener.removed) return;
      listener.removed = true;
      const idx = this._listeners.indexOf(listener);
      if (idx !== -1) {
        this._listeners.splice(idx, 1);
      }
    };

    if (signal) {
      signal.addEventListener("abort", unsubscribe, { once: true });
    }

    return unsubscribe;
  }

  // -------------------------------------------------------------------------
  // Unsubscribe methods
  // -------------------------------------------------------------------------

  off<E extends string & keyof Events>(
    event: E,
    fn: (...args: Events[E]) => unknown
  ): void {
    this._assertEvent(event);
    this._assertListener(fn);
    const idx = this._listeners.findIndex(
      (l) => l.type === "event" && (l as EventListener).event === event && l.fn === fn
    );
    if (idx !== -1) {
      this._listeners[idx].removed = true;
      this._listeners.splice(idx, 1);
    }
  }

  offAny(fn: (event: string, ...args: unknown[]) => unknown): void {
    this._assertListener(fn);
    const idx = this._listeners.findIndex(
      (l) => l.type === "any" && l.fn === fn
    );
    if (idx !== -1) {
      this._listeners[idx].removed = true;
      this._listeners.splice(idx, 1);
    }
  }

  offPattern(
    pattern: string,
    fn: (event: string, ...args: unknown[]) => unknown
  ): void {
    this._assertPattern(pattern);
    this._assertListener(fn);
    const idx = this._listeners.findIndex(
      (l) => l.type === "pattern" && (l as PatternListener).pattern === pattern && l.fn === fn
    );
    if (idx !== -1) {
      this._listeners[idx].removed = true;
      this._listeners.splice(idx, 1);
    }
  }

  clear(event?: string & keyof Events): void {
    if (event !== undefined) {
      this._assertEvent(event);
      this._listeners = this._listeners.filter((l) => {
        if (l.type === "event" && (l as EventListener).event === event) {
          l.removed = true;
          return false;
        }
        return true;
      });
      return;
    }
    for (const l of this._listeners) {
      l.removed = true;
    }
    this._listeners = [];
  }

  // -------------------------------------------------------------------------
  // Emit methods
  // -------------------------------------------------------------------------

  emit<E extends string & keyof Events>(event: E, ...args: Events[E]): unknown[] {
    this._assertNotDisposed();
    this._assertEvent(event);
    const results: unknown[] = [];
    const eventStr = event as string;

    // Snapshot listeners to allow mutation during iteration
    const snapshot = this._listeners.slice();

    for (const listener of snapshot) {
      if (listener.removed) continue;

      let matches = false;
      let callArgs: unknown[];

      if (listener.type === "event") {
        matches = (listener as EventListener).event === eventStr;
        callArgs = args;
      } else if (listener.type === "any") {
        matches = true;
        callArgs = [eventStr, ...args];
      } else if (listener.type === "pattern") {
        matches = (listener as PatternListener).matcher(eventStr);
        callArgs = [eventStr, ...args];
      } else {
        continue;
      }

      if (!matches) continue;

      // Apply filter if present
      if (listener.filter && !listener.filter(...callArgs)) {
        continue;
      }

      results.push(listener.fn(...callArgs));

      if (listener.once && !listener.removed) {
        listener.removed = true;
        const idx = this._listeners.indexOf(listener);
        if (idx !== -1) {
          this._listeners.splice(idx, 1);
        }
      }
    }

    return results;
  }

  async emitAsync<E extends string & keyof Events>(
    event: E,
    ...args: Events[E]
  ): Promise<unknown[]> {
    this._assertNotDisposed();
    this._assertEvent(event);
    const results: unknown[] = [];
    const eventStr = event as string;

    // Snapshot listeners to allow mutation during iteration
    const snapshot = this._listeners.slice();

    for (const listener of snapshot) {
      if (listener.removed) continue;

      let matches = false;
      let callArgs: unknown[];

      if (listener.type === "event") {
        matches = (listener as EventListener).event === eventStr;
        callArgs = args;
      } else if (listener.type === "any") {
        matches = true;
        callArgs = [eventStr, ...args];
      } else if (listener.type === "pattern") {
        matches = (listener as PatternListener).matcher(eventStr);
        callArgs = [eventStr, ...args];
      } else {
        continue;
      }

      if (!matches) continue;

      // Apply filter if present
      if (listener.filter && !listener.filter(...callArgs)) {
        continue;
      }

      results.push(await listener.fn(...callArgs));

      if (listener.once && !listener.removed) {
        listener.removed = true;
        const idx = this._listeners.indexOf(listener);
        if (idx !== -1) {
          this._listeners.splice(idx, 1);
        }
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Promise-based waiting
  // -------------------------------------------------------------------------

  /**
   * Wait for an event to be emitted. Returns a promise that resolves with the event arguments.
   *
   * @param event - The event to wait for
   * @param options.timeout - Timeout in milliseconds (rejects with TimeoutError if exceeded)
   * @param options.signal - AbortSignal to cancel waiting (rejects with AbortError if aborted)
   * @returns Promise that resolves with the event arguments as a tuple
   */
  waitFor<E extends string & keyof Events>(
    event: E,
    options: WaitForOptions = {}
  ): Promise<Events[E]> {
    this._assertNotDisposed();
    this._assertEvent(event);

    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe: Unsubscribe | undefined;
      let settled = false;

      const cleanup = () => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        if (unsubscribe) {
          unsubscribe();
        }
      };

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      // Handle timeout
      if (options.timeout !== undefined && options.timeout > 0) {
        timeoutId = setTimeout(() => {
          settle(() => {
            const error = new Error(`Timeout waiting for event "${event}" after ${options.timeout}ms`);
            error.name = "TimeoutError";
            reject(error);
          });
        }, options.timeout);
      }

      // Handle abort signal
      if (options.signal) {
        if (options.signal.aborted) {
          const error = new Error(`Aborted waiting for event "${event}"`);
          error.name = "AbortError";
          reject(error);
          return;
        }
        options.signal.addEventListener("abort", () => {
          settle(() => {
            const error = new Error(`Aborted waiting for event "${event}"`);
            error.name = "AbortError";
            reject(error);
          });
        }, { once: true });
      }

      // Subscribe to event
      unsubscribe = this.once(event, ((...args: Events[E]) => {
        settle(() => resolve(args as Events[E]));
      }) as (...args: Events[E]) => unknown);
    });
  }

  // -------------------------------------------------------------------------
  // Introspection methods
  // -------------------------------------------------------------------------

  /**
   * Returns the number of listeners for a given event, or total listeners if no event specified.
   * Useful for debugging and detecting listener leaks.
   */
  listenerCount(event?: string & keyof Events): number {
    if (event === undefined) {
      return this._listeners.length;
    }

    this._assertEvent(event);
    const eventStr = event as string;

    let count = 0;
    for (const listener of this._listeners) {
      if (listener.type === "event" && (listener as EventListener).event === eventStr) {
        count++;
      } else if (listener.type === "any") {
        count++;
      } else if (listener.type === "pattern" && (listener as PatternListener).matcher(eventStr)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Returns true if there are any listeners that would be triggered by the given event.
   * Useful for avoiding expensive argument preparation when no one is listening.
   */
  hasListeners(event?: string & keyof Events): boolean {
    if (event === undefined) {
      return this._listeners.length > 0;
    }

    this._assertEvent(event);
    const eventStr = event as string;

    for (const listener of this._listeners) {
      if (listener.type === "event" && (listener as EventListener).event === eventStr) {
        return true;
      } else if (listener.type === "any") {
        return true;
      } else if (listener.type === "pattern" && (listener as PatternListener).matcher(eventStr)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns an array of event names that have direct listeners (not patterns or any).
   */
  eventNames(): string[] {
    const names = new Set<string>();
    for (const listener of this._listeners) {
      if (listener.type === "event") {
        names.add((listener as EventListener).event);
      }
    }
    return Array.from(names);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Returns true if the emitter has been disposed.
   */
  get disposed(): boolean {
    return this._disposed;
  }

  /**
   * Disposes the emitter, removing all listeners and preventing further use.
   * After disposal, any attempt to subscribe or emit will throw an error.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const l of this._listeners) {
      l.removed = true;
    }
    this._listeners = [];
  }
}
