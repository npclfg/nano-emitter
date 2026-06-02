# NanoEmitter

A tiny event emitter with priorities, pattern matching, and async support.

- **Zero dependencies**
- **TypeScript-first** with full type inference
- **~420 lines** of code
- **ESM and CommonJS** support

## Why NanoEmitter?

| Feature | Node EventEmitter | NanoEmitter |
|---------|-------------------|-------------|
| Unsubscribe function | ❌ | ✅ `on()` returns `off()` |
| Listener priorities | ❌ | ✅ Global ordering across all listener types |
| Pattern matching | ❌ | ✅ `task:*` wildcards |
| Async sequencing | ❌ | ✅ `emitAsync()` awaits in order |
| AbortSignal support | ❌ | ✅ Modern cancellation |
| Promise-based waiting | ❌ | ✅ `waitFor()` with timeout |
| Listener filters | ❌ | ✅ Conditional listener execution |
| Dispose lifecycle | ❌ | ✅ `dispose()` for cleanup |
| Listener introspection | ✅ | ✅ `listenerCount()`, `hasListeners()` |

Trade-off: NanoEmitter is ~1.3–1.9x slower in microbenchmarks (`emit` has the larger gap). It is not faster than native `EventEmitter` — the win is features and types, not speed. For I/O-bound apps, the overhead is negligible.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [TypeScript Usage](#typescript-usage)
- [API Reference](#api-reference)
- [Patterns & Recipes](#patterns--recipes)
- [Error Handling](#error-handling)
- [Performance](#performance)
- [Migration from EventEmitter](#migration-from-eventemitter)
- [License](#license)

## Installation

```bash
npm install nano-emitter
```

**Requirements:** Node.js 16+ or modern browsers (ES2020)

## Quick Start

### Basic Usage

```js
import { NanoEmitter } from "nano-emitter";

const bus = new NanoEmitter();

// Subscribe - returns unsubscribe function
const off = bus.on("user:login", (user) => {
  console.log(`${user.name} logged in`);
});

// Emit
bus.emit("user:login", { name: "Alice" });

// Unsubscribe
off();
```

### CommonJS

```js
const { NanoEmitter } = require("nano-emitter");
```

### With Priorities

Priorities are **global** across all listener types (`on`, `onAny`, `onPattern`).

```js
const bus = new NanoEmitter();

bus.on("save", () => console.log("write to disk"), { priority: 1 });
bus.onAny(() => console.log("log all events"), { priority: 100 });
bus.on("save", () => console.log("validate first"), { priority: 10 });

bus.emit("save");
// Output:
// log all events     (priority 100)
// validate first     (priority 10)
// write to disk      (priority 1)
```

### With Patterns

```js
const bus = new NanoEmitter();

// Match any event starting with "task:"
bus.onPattern("task:*", (event, data) => {
  console.log(`Task event: ${event}`);
});

bus.emit("task:start", { id: 1 });  // matches
bus.emit("task:done", { id: 1 });   // matches
bus.emit("task");                    // does NOT match (wildcard needs segment after)
```

### With AbortSignal

```js
const bus = new NanoEmitter();
const controller = new AbortController();

bus.on("update", (data) => {
  console.log("Update:", data);
}, { signal: controller.signal });

bus.emit("update", "first");  // logs
controller.abort();            // auto-unsubscribes
bus.emit("update", "second"); // doesn't log
```

### Async Sequencing

```js
const bus = new NanoEmitter();

bus.on("deploy", async () => {
  await runTests();
  console.log("tests passed");
});

bus.on("deploy", async () => {
  await uploadBuild();
  console.log("uploaded");
});

// Listeners run sequentially, awaiting each one
await bus.emitAsync("deploy");
// Output:
// tests passed
// uploaded
```

### Promise-Based Waiting

```js
const bus = new NanoEmitter();

// Wait for an event with timeout
try {
  const [user] = await bus.waitFor("user:login", { timeout: 5000 });
  console.log(`${user.name} logged in`);
} catch (err) {
  if (err.name === "TimeoutError") {
    console.log("Login timed out");
  }
}
```

### Listener Filters

```js
const bus = new NanoEmitter();

// Only react to important messages
bus.on("message", (msg) => {
  console.log("Important:", msg.text);
}, { filter: (msg) => msg.priority === "high" });

bus.emit("message", { text: "Hello", priority: "low" });   // filtered out
bus.emit("message", { text: "Alert!", priority: "high" }); // logs
```

### Lifecycle Management

```js
const bus = new NanoEmitter();

bus.on("update", () => console.log("update"));

// Clean up when done
bus.dispose();

// After dispose, subscribe/emit throws
bus.emit("update"); // Error: Emitter has been disposed
```

## TypeScript Usage

NanoEmitter is fully typed. Define your event map for type-safe emit/subscribe:

```typescript
import { NanoEmitter, EventMap } from "nano-emitter";

// Define your events
interface MyEvents extends EventMap {
  "user:login": [user: { id: string; name: string }];
  "user:logout": [userId: string];
  "message": [from: string, text: string];
}

const bus = new NanoEmitter<MyEvents>();

// ✅ Type-safe - TypeScript knows the argument types
bus.on("user:login", (user) => {
  console.log(user.name);  // user is typed as { id: string; name: string }
});

// ✅ Type-safe emit
bus.emit("user:login", { id: "1", name: "Alice" });

// ❌ Type error - wrong argument type
bus.emit("user:login", "wrong");

// ❌ Type error - unknown event
bus.emit("unknown:event");
```

### Type Exports

```typescript
import {
  NanoEmitter,
  EventMap,           // Base type for event maps
  ListenerOptions,    // { once?, priority?, signal?, filter? }
  EmitterOptions,     // { delimiter?: string }
  WaitForOptions,     // { timeout?, signal? }
  Unsubscribe,        // () => void
} from "nano-emitter";
```

## API Reference

### Constructor

```typescript
new NanoEmitter(options?: EmitterOptions)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `delimiter` | `string` | `":"` | Separator for pattern matching segments |

### Subscribe Methods

#### `on(event, listener, options?): Unsubscribe`

Subscribe to an event. Returns an unsubscribe function.

```typescript
const off = bus.on("ping", (data) => console.log(data), { priority: 5 });
off(); // unsubscribe
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `event` | `string` | Event name |
| `listener` | `(...args) => any` | Callback function |
| `options.once` | `boolean` | Auto-remove after first call (default: `false`) |
| `options.priority` | `number` | Higher = runs first (default: `0`) |
| `options.signal` | `AbortSignal` | Auto-unsubscribe when aborted |
| `options.filter` | `(...args) => boolean` | Only invoke if filter returns `true` |

#### `once(event, listener, options?): Unsubscribe`

Subscribe to an event, automatically unsubscribe after first emit.

```typescript
bus.once("init", () => console.log("runs once"));
```

#### `onAny(listener, options?): Unsubscribe`

Subscribe to all events. Listener receives event name as first argument.

```typescript
bus.onAny((event, ...args) => {
  console.log(`Event: ${event}`, args);
});
```

#### `onPattern(pattern, listener, options?): Unsubscribe`

Subscribe to events matching a pattern. Use `*` as trailing wildcard.

```typescript
bus.onPattern("user:*", (event, ...args) => {
  // matches "user:login", "user:logout", "user:update:profile"
});
```

**Pattern rules:**
- `task:*` matches `task:done`, `task:error`, `task:a:b:c`
- `task:*` does NOT match `task` (wildcard requires at least one segment)
- `task:done` matches only `task:done` exactly
- Wildcard must be the last segment (`a:*:b` is invalid)

### Emit Methods

#### `emit(event, ...args): unknown[]`

Emit an event synchronously. Returns array of listener return values.

```typescript
const results = bus.emit("calculate", 5);
// results = [10, 15] if listeners returned those values
```

#### `emitAsync(event, ...args): Promise<unknown[]>`

Emit an event, awaiting each listener in priority order.

```typescript
const results = await bus.emitAsync("deploy");
```

### Unsubscribe Methods

#### `off(event, listener): void`

Remove a specific listener (first matching instance only).

```typescript
const handler = (data) => console.log(data);
bus.on("ping", handler);
bus.off("ping", handler);
```

#### `offAny(listener): void`

Remove a wildcard listener (first matching instance only).

#### `offPattern(pattern, listener): void`

Remove a pattern listener (first matching instance only).

#### `clear(event?): void`

Remove listeners. If event specified, clears only that event's direct listeners. Otherwise clears all.

```typescript
bus.clear("ping");  // clear all "ping" listeners
bus.clear();        // clear everything (on, onAny, onPattern)
```

### Introspection Methods

#### `listenerCount(event?): number`

Returns the number of listeners. Without argument, returns total count. With event, returns count of listeners that would fire for that event (including `onAny` and matching patterns).

```typescript
bus.on("ping", () => {});
bus.onAny(() => {});
bus.listenerCount();       // 2
bus.listenerCount("ping"); // 2 (direct + onAny)
bus.listenerCount("pong"); // 1 (only onAny)
```

#### `hasListeners(event?): boolean`

Returns true if there are any listeners. With event, checks if that specific event would trigger any listeners.

```typescript
if (bus.hasListeners("expensive:operation")) {
  const data = prepareExpensiveData();
  bus.emit("expensive:operation", data);
}
```

#### `eventNames(): string[]`

Returns array of event names that have direct listeners (excludes patterns and `onAny`).

```typescript
bus.on("ping", () => {});
bus.on("pong", () => {});
bus.onAny(() => {});
bus.eventNames(); // ["ping", "pong"]
```

### Promise-Based Waiting

#### `waitFor(event, options?): Promise<Args>`

Wait for an event to be emitted. Returns a promise that resolves with the event arguments as a tuple.

```typescript
// Basic usage
const [user, timestamp] = await bus.waitFor("user:login");

// With timeout (rejects with TimeoutError)
const args = await bus.waitFor("ready", { timeout: 5000 });

// With AbortSignal (rejects with AbortError)
const controller = new AbortController();
const args = await bus.waitFor("data", { signal: controller.signal });
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `event` | `string` | Event name to wait for |
| `options.timeout` | `number` | Timeout in milliseconds (rejects with `TimeoutError` if exceeded) |
| `options.signal` | `AbortSignal` | Cancel waiting (rejects with `AbortError` if aborted) |

**Error handling:**

```typescript
try {
  const args = await bus.waitFor("response", { timeout: 3000 });
} catch (err) {
  if (err.name === "TimeoutError") {
    console.log("Request timed out");
  } else if (err.name === "AbortError") {
    console.log("Request was cancelled");
  }
}
```

### Lifecycle Methods

#### `dispose(): void`

Disposes the emitter, removing all listeners and preventing further use. After disposal, any attempt to subscribe or emit will throw an error.

```typescript
const bus = new NanoEmitter();
bus.on("ping", () => {});

bus.dispose();

bus.emit("ping");       // throws: "Emitter has been disposed"
bus.on("pong", () => {}); // throws: "Emitter has been disposed"
```

#### `disposed: boolean` (getter)

Returns `true` if the emitter has been disposed.

```typescript
const bus = new NanoEmitter();
console.log(bus.disposed); // false

bus.dispose();
console.log(bus.disposed); // true
```

## Patterns & Recipes

### Cleanup with AbortController

```typescript
class Component {
  private controller = new AbortController();

  mount() {
    const { signal } = this.controller;
    bus.on("update", this.handleUpdate, { signal });
    bus.onPattern("data:*", this.handleData, { signal });
  }

  unmount() {
    this.controller.abort(); // removes all listeners at once
  }
}
```

### Request/Response Pattern

```typescript
bus.on("request", async (req) => {
  const result = await processRequest(req);
  bus.emit(`response:${req.id}`, result);
});

// Make a request and wait for response (using waitFor)
async function request(data: RequestData, timeout = 5000): Promise<Response> {
  const id = crypto.randomUUID();
  const responsePromise = bus.waitFor(`response:${id}`, { timeout });
  bus.emit("request", { ...data, id });
  const [result] = await responsePromise;
  return result;
}
```

### Metrics Collection

```typescript
const metrics = { total: 0, byType: new Map() };

bus.onAny((event) => {
  metrics.total++;
  metrics.byType.set(event, (metrics.byType.get(event) || 0) + 1);
}, { priority: 1000 }); // high priority = runs first
```

### Conditional Emit

```typescript
// Avoid expensive preparation if no one is listening
if (bus.hasListeners("analytics:pageview")) {
  const data = gatherAnalyticsData(); // expensive
  bus.emit("analytics:pageview", data);
}
```

### Custom Delimiter

```typescript
// Dot notation (common in enterprise apps)
const bus = new NanoEmitter({ delimiter: "." });
bus.onPattern("user.created.*", handler);
bus.emit("user.created.admin");

// Slash notation (URL-like)
const router = new NanoEmitter({ delimiter: "/" });
router.onPattern("api/users/*", handler);
router.emit("api/users/123");
```

### Filtered Subscriptions

```typescript
// Only log errors from a specific service
bus.onPattern("log:*", (event, entry) => {
  console.error(`[${event}]`, entry.message);
}, {
  filter: (event, entry) => entry.level === "error"
});

// React only to your own user's updates
const myUserId = getCurrentUserId();
bus.on("user:updated", (user) => {
  updateUI(user);
}, {
  filter: (user) => user.id === myUserId
});
```

### Safe Cleanup with Dispose

```typescript
class Service {
  private bus = new NanoEmitter();

  start() {
    this.bus.on("task:*", this.handleTask);
  }

  stop() {
    this.bus.dispose(); // removes all listeners, prevents accidental use
  }
}
```

## Error Handling

Listener exceptions propagate to the caller. No internal try/catch.

```typescript
// Errors bubble up
bus.on("risky", () => { throw new Error("fail"); });

try {
  bus.emit("risky");
} catch (err) {
  console.error("Caught:", err);
}
```

### Async Error Handling

With `emitAsync()`, if a listener throws, subsequent listeners do NOT run:

```typescript
bus.on("pipeline", () => console.log("step 1"));
bus.on("pipeline", () => { throw new Error("fail"); });
bus.on("pipeline", () => console.log("step 3")); // never runs

try {
  await bus.emitAsync("pipeline");
} catch (err) {
  // Only "step 1" was logged
}
```

### Resilient Listeners

If you need all listeners to attempt execution:

```typescript
bus.on("task", async (data) => {
  try {
    await riskyOperation(data);
  } catch (err) {
    console.error("Task failed:", err);
    // Don't rethrow - allows other listeners to run
  }
});
```

## Performance

NanoEmitter is optimized for real-world usage. Benchmarks (Node 20, Apple M1):

| Operation | EventEmitter | NanoEmitter | Overhead |
|-----------|--------------|-------------|----------|
| emit (5 listeners) | ~27 ns | ~50 ns | 1.9x |
| on + off | ~38 ns | ~48 ns | 1.3x |

**When overhead matters:**
- Hot loops emitting 10,000+ events/second
- Real-time systems with microsecond budgets

**When overhead is negligible:**
- I/O-bound apps (network latency >> 10ns)
- Moderate event frequency (< 1000/sec)
- Internal tooling, CLI apps

Run benchmarks yourself:

```bash
npm run bench
ITERATIONS=500000 LISTENERS=10 npm run bench
```

## Migration from EventEmitter

| EventEmitter | NanoEmitter |
|--------------|-------------|
| `emitter.on("x", fn)` | `const off = bus.on("x", fn)` |
| `emitter.removeListener("x", fn)` | `off()` or `bus.off("x", fn)` |
| `emitter.once("x", fn)` | `bus.once("x", fn)` |
| `emitter.emit("x", data)` | `bus.emit("x", data)` |
| `emitter.removeAllListeners("x")` | `bus.clear("x")` |
| `emitter.removeAllListeners()` | `bus.clear()` |
| `emitter.listenerCount("x")` | `bus.listenerCount("x")` |
| `emitter.eventNames()` | `bus.eventNames()` |

### Key Differences

1. **Global priorities** - Priorities work across `on`, `onAny`, and `onPattern`
2. **No `this` binding** - Listeners don't receive emitter as `this`
3. **No `newListener`/`removeListener` events** - Use wrapper if needed
4. **No `error` event special handling** - Errors propagate normally
5. **No max listeners** - Use `listenerCount()` for leak detection

## Development

```bash
npm install
npm run build    # Compile TypeScript (CJS + ESM)
npm test         # Run tests (76 tests)
npm run bench    # Run benchmarks
npm run verify   # Run all checks
```

## License

MIT
