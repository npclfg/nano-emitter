const assert = require("assert");
const { NanoEmitter } = require("../dist/cjs/nanoemitter");

// ============================================================================
// Test Harness
// ============================================================================

const tests = [];
let currentSuite = null;

function describe(name, fn) {
  currentSuite = name;
  fn();
  currentSuite = null;
}

function it(name, fn) {
  tests.push({
    suite: currentSuite,
    name,
    fn,
  });
}

async function runTests() {
  let passed = 0;
  let failed = 0;
  let currentSuite = null;

  for (const test of tests) {
    if (test.suite !== currentSuite) {
      currentSuite = test.suite;
      console.log(`\n${currentSuite}`);
    }
    try {
      await test.fn();
      console.log(`  ✓ ${test.name}`);
      passed++;
    } catch (err) {
      console.log(`  ✗ ${test.name}`);
      console.log(`    ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passing, ${failed} failing`);
  if (failed > 0) process.exit(1);
}

// ============================================================================
// Core Subscription Behavior
// ============================================================================

describe("Core Subscriptions", () => {
  it("should invoke listener when event is emitted", () => {
    const bus = new NanoEmitter();
    let called = false;
    bus.on("ping", () => { called = true; });
    bus.emit("ping");
    assert.strictEqual(called, true);
  });

  it("should pass arguments to listener", () => {
    const bus = new NanoEmitter();
    let received;
    bus.on("data", (a, b) => { received = [a, b]; });
    bus.emit("data", "hello", 42);
    assert.deepStrictEqual(received, ["hello", 42]);
  });

  it("should return listener results from emit", () => {
    const bus = new NanoEmitter();
    bus.on("calc", (x) => x * 2);
    bus.on("calc", (x) => x + 1);
    const results = bus.emit("calc", 5);
    assert.deepStrictEqual(results, [10, 6]);
  });

  it("should stop receiving events after unsubscribe", () => {
    const bus = new NanoEmitter();
    let count = 0;
    const off = bus.on("ping", () => { count++; });
    bus.emit("ping");
    off();
    bus.emit("ping");
    assert.strictEqual(count, 1);
  });

  it("should only remove one instance when same function subscribed multiple times", () => {
    const bus = new NanoEmitter();
    let count = 0;
    const fn = () => { count++; };
    const off1 = bus.on("ping", fn);
    bus.on("ping", fn);
    bus.emit("ping");
    assert.strictEqual(count, 2);
    off1();
    bus.emit("ping");
    assert.strictEqual(count, 3); // second instance still fires
  });

  it("should be idempotent when unsubscribe called multiple times", () => {
    const bus = new NanoEmitter();
    let count = 0;
    const fn = () => { count++; };
    const off = bus.on("ping", fn);
    bus.on("ping", fn); // second instance
    off();
    off(); // second call should be no-op
    off(); // third call should be no-op
    bus.emit("ping");
    assert.strictEqual(count, 1); // only second instance fires
  });
});

// ============================================================================
// Once Behavior
// ============================================================================

describe("Once Subscriptions", () => {
  it("should only fire once then auto-remove", () => {
    const bus = new NanoEmitter();
    let count = 0;
    bus.once("ping", () => { count++; });
    bus.emit("ping");
    bus.emit("ping");
    bus.emit("ping");
    assert.strictEqual(count, 1);
  });

  it("should work with onAny", () => {
    const bus = new NanoEmitter();
    const events = [];
    bus.onAny((event) => { events.push(event); }, { once: true });
    bus.emit("first");
    bus.emit("second");
    assert.deepStrictEqual(events, ["first"]);
  });

  it("should work with onPattern", () => {
    const bus = new NanoEmitter();
    const events = [];
    bus.onPattern("task:*", (event) => { events.push(event); }, { once: true });
    bus.emit("task:start");
    bus.emit("task:done");
    assert.deepStrictEqual(events, ["task:start"]);
  });
});

// ============================================================================
// Priority Ordering
// ============================================================================

describe("Priority Ordering", () => {
  it("should execute higher priority listeners first", () => {
    const bus = new NanoEmitter();
    const order = [];
    bus.on("ping", () => order.push("default")); // priority 0
    bus.on("ping", () => order.push("low"), { priority: -10 });
    bus.on("ping", () => order.push("high"), { priority: 10 });
    bus.emit("ping");
    assert.deepStrictEqual(order, ["high", "default", "low"]);
  });

  it("should respect GLOBAL priority across on, onAny, and onPattern", () => {
    const bus = new NanoEmitter();
    const order = [];
    bus.on("task:done", () => order.push("on"), { priority: 5 });
    bus.onAny(() => order.push("onAny"), { priority: 10 });
    bus.onPattern("task:*", () => order.push("onPattern"), { priority: 1 });
    bus.emit("task:done");
    // With global priority: onAny (10) > on (5) > onPattern (1)
    assert.deepStrictEqual(order, ["onAny", "on", "onPattern"]);
  });

  it("should maintain priority order in emitAsync", async () => {
    const bus = new NanoEmitter();
    const order = [];
    bus.on("ping", async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push("slow-high");
    }, { priority: 10 });
    bus.on("ping", () => order.push("fast-low"), { priority: 1 });
    await bus.emitAsync("ping");
    assert.deepStrictEqual(order, ["slow-high", "fast-low"]);
  });
});

// ============================================================================
// Wildcard Listeners (onAny)
// ============================================================================

describe("Wildcard Listeners (onAny)", () => {
  it("should receive all events", () => {
    const bus = new NanoEmitter();
    const events = [];
    bus.onAny((event) => { events.push(event); });
    bus.emit("foo");
    bus.emit("bar");
    bus.emit("baz");
    assert.deepStrictEqual(events, ["foo", "bar", "baz"]);
  });

  it("should receive event name and arguments", () => {
    const bus = new NanoEmitter();
    let captured;
    bus.onAny((event, ...args) => { captured = { event, args }; });
    bus.emit("test", 1, 2, 3);
    assert.deepStrictEqual(captured, { event: "test", args: [1, 2, 3] });
  });

  it("should be removable with offAny", () => {
    const bus = new NanoEmitter();
    const events = [];
    const fn = (event) => { events.push(event); };
    bus.onAny(fn);
    bus.emit("first");
    bus.offAny(fn);
    bus.emit("second");
    assert.deepStrictEqual(events, ["first"]);
  });
});

// ============================================================================
// Pattern Matching (onPattern)
// ============================================================================

describe("Pattern Matching", () => {
  it("should match events with trailing wildcard", () => {
    const bus = new NanoEmitter();
    const hits = [];
    bus.onPattern("task:*", (event) => hits.push(event));
    bus.emit("task:start");
    bus.emit("task:done");
    bus.emit("task"); // should NOT match - wildcard requires segment after
    bus.emit("other:start");
    assert.deepStrictEqual(hits, ["task:start", "task:done"]);
  });

  it("should match deeply nested events", () => {
    const bus = new NanoEmitter();
    const hits = [];
    bus.onPattern("a:b:*", (event) => hits.push(event));
    bus.emit("a:b:c");
    bus.emit("a:b:c:d:e"); // multiple segments after wildcard
    bus.emit("a:b"); // should NOT match
    assert.deepStrictEqual(hits, ["a:b:c", "a:b:c:d:e"]);
  });

  it("should match exact pattern without wildcard", () => {
    const bus = new NanoEmitter();
    const hits = [];
    bus.onPattern("task:done", (event) => hits.push(event));
    bus.emit("task:done");
    bus.emit("task:done:extra"); // should NOT match
    bus.emit("task");
    assert.deepStrictEqual(hits, ["task:done"]);
  });

  it("should be removable with offPattern", () => {
    const bus = new NanoEmitter();
    const hits = [];
    const fn = (event) => hits.push(event);
    bus.onPattern("task:*", fn);
    bus.emit("task:start");
    bus.offPattern("task:*", fn);
    bus.emit("task:done");
    assert.deepStrictEqual(hits, ["task:start"]);
  });

  it("should work with custom delimiter", () => {
    const bus = new NanoEmitter({ delimiter: "." });
    const hits = [];
    bus.onPattern("user.created.*", (event) => hits.push(event));
    bus.emit("user.created.admin");
    bus.emit("user.created.guest");
    bus.emit("user.deleted.admin");
    assert.deepStrictEqual(hits, ["user.created.admin", "user.created.guest"]);
  });
});

// ============================================================================
// Async Emission
// ============================================================================

describe("Async Emission", () => {
  it("should await each listener sequentially", async () => {
    const bus = new NanoEmitter();
    const order = [];
    bus.on("ping", async () => {
      await new Promise(r => setTimeout(r, 20));
      order.push("first");
    });
    bus.on("ping", async () => {
      await new Promise(r => setTimeout(r, 5));
      order.push("second");
    });
    await bus.emitAsync("ping");
    assert.deepStrictEqual(order, ["first", "second"]);
  });

  it("should return results in order", async () => {
    const bus = new NanoEmitter();
    bus.on("calc", async (x) => {
      await new Promise(r => setTimeout(r, 5));
      return x * 2;
    });
    bus.on("calc", (x) => x + 1);
    const results = await bus.emitAsync("calc", 10);
    assert.deepStrictEqual(results, [20, 11]);
  });

  it("should stop on first error", async () => {
    const bus = new NanoEmitter();
    const order = [];
    bus.on("ping", () => { order.push("first"); });
    bus.on("ping", () => { throw new Error("fail"); });
    bus.on("ping", () => { order.push("third"); });

    let caught;
    try {
      await bus.emitAsync("ping");
    } catch (err) {
      caught = err.message;
    }
    assert.strictEqual(caught, "fail");
    assert.deepStrictEqual(order, ["first"]); // third never runs
  });
});

// ============================================================================
// Error Propagation
// ============================================================================

describe("Error Propagation", () => {
  it("should propagate sync listener errors", () => {
    const bus = new NanoEmitter();
    bus.on("ping", () => { throw new Error("sync error"); });

    assert.throws(
      () => bus.emit("ping"),
      /sync error/
    );
  });

  it("should propagate async listener errors", async () => {
    const bus = new NanoEmitter();
    bus.on("ping", async () => { throw new Error("async error"); });

    await assert.rejects(
      () => bus.emitAsync("ping"),
      /async error/
    );
  });
});

// ============================================================================
// Clear Behavior
// ============================================================================

describe("Clear Behavior", () => {
  it("should clear specific event listeners", () => {
    const bus = new NanoEmitter();
    let pingCount = 0;
    let pongCount = 0;
    bus.on("ping", () => { pingCount++; });
    bus.on("pong", () => { pongCount++; });
    bus.clear("ping");
    bus.emit("ping");
    bus.emit("pong");
    assert.strictEqual(pingCount, 0);
    assert.strictEqual(pongCount, 1);
  });

  it("should clear all listeners when no event specified", () => {
    const bus = new NanoEmitter();
    let count = 0;
    bus.on("ping", () => { count++; });
    bus.onAny(() => { count++; });
    bus.onPattern("test:*", () => { count++; });
    bus.clear();
    bus.emit("ping");
    bus.emit("test:foo");
    assert.strictEqual(count, 0);
  });
});

// ============================================================================
// Edge Cases: Mutation During Emission
// ============================================================================

describe("Mutation During Emission", () => {
  it("should handle listener unsubscribing itself", () => {
    const bus = new NanoEmitter();
    const order = [];
    let unsub;
    unsub = bus.on("ping", () => {
      order.push("self-removing");
      unsub();
    });
    bus.on("ping", () => order.push("stable"));

    bus.emit("ping");
    bus.emit("ping");

    assert.deepStrictEqual(order, [
      "self-removing", "stable", // first emit
      "stable" // second emit - self-removing is gone
    ]);
  });

  it("should handle clear during emission", () => {
    const bus = new NanoEmitter();
    const order = [];
    bus.on("ping", () => {
      order.push("first");
      bus.clear("ping");
    });
    bus.on("ping", () => order.push("second"));

    bus.emit("ping");
    bus.emit("ping"); // should be silent

    // Only first fires - clear marks listeners as removed immediately
    assert.deepStrictEqual(order, ["first"]);
  });

  it("should handle adding listener during emission", () => {
    const bus = new NanoEmitter();
    const order = [];
    bus.on("ping", () => {
      order.push("first");
      bus.on("ping", () => order.push("added"));
    });

    bus.emit("ping"); // "added" listener shouldn't fire this emit
    bus.emit("ping"); // now both should fire

    assert.deepStrictEqual(order, ["first", "first", "added"]);
  });
});

// ============================================================================
// Input Validation
// ============================================================================

describe("Input Validation", () => {
  it("should reject non-string event names", () => {
    const bus = new NanoEmitter();
    assert.throws(() => bus.on(123, () => {}), /event must be a string/);
    assert.throws(() => bus.emit(null), /event must be a string/);
    assert.throws(() => bus.off({}, () => {}), /event must be a string/);
  });

  it("should reject non-function listeners", () => {
    const bus = new NanoEmitter();
    assert.throws(() => bus.on("ping", "not a function"), /listener must be a function/);
    assert.throws(() => bus.onAny(123), /listener must be a function/);
    assert.throws(() => bus.onPattern("test:*", null), /listener must be a function/);
  });

  it("should reject non-string patterns", () => {
    const bus = new NanoEmitter();
    assert.throws(() => bus.onPattern(123, () => {}), /pattern must be a string/);
  });

  it("should reject wildcard not at trailing position", () => {
    const bus = new NanoEmitter();
    assert.throws(
      () => bus.onPattern("a:*:b", () => {}),
      /wildcard must be the trailing segment/
    );
  });

  it("should reject invalid delimiters", () => {
    assert.throws(
      () => new NanoEmitter({ delimiter: "" }),
      /delimiter must be a non-empty string/
    );
    assert.throws(
      () => new NanoEmitter({ delimiter: "*" }),
      /delimiter cannot be '\*'/
    );
  });
});

// ============================================================================
// Introspection Methods
// ============================================================================

describe("Introspection", () => {
  it("listenerCount() should return total count with no argument", () => {
    const bus = new NanoEmitter();
    assert.strictEqual(bus.listenerCount(), 0);
    bus.on("ping", () => {});
    bus.on("pong", () => {});
    bus.onAny(() => {});
    assert.strictEqual(bus.listenerCount(), 3);
  });

  it("listenerCount(event) should count listeners that would fire for that event", () => {
    const bus = new NanoEmitter();
    bus.on("task:ping", () => {});
    bus.on("task:ping", () => {});
    bus.on("task:pong", () => {});
    bus.onAny(() => {});
    bus.onPattern("task:*", () => {});
    // task:ping: 2 direct + 1 onAny + 1 pattern = 4
    assert.strictEqual(bus.listenerCount("task:ping"), 4);
    // task:pong: 1 direct + 1 onAny + 1 pattern = 3
    assert.strictEqual(bus.listenerCount("task:pong"), 3);
    // other: 0 direct + 1 onAny + 0 pattern = 1
    assert.strictEqual(bus.listenerCount("other"), 1);
  });

  it("hasListeners() should return true if any listeners exist", () => {
    const bus = new NanoEmitter();
    assert.strictEqual(bus.hasListeners(), false);
    const off = bus.on("ping", () => {});
    assert.strictEqual(bus.hasListeners(), true);
    off();
    assert.strictEqual(bus.hasListeners(), false);
  });

  it("hasListeners(event) should check if event would trigger listeners", () => {
    const bus = new NanoEmitter();
    assert.strictEqual(bus.hasListeners("ping"), false);
    bus.on("pong", () => {});
    assert.strictEqual(bus.hasListeners("ping"), false);
    bus.onAny(() => {});
    assert.strictEqual(bus.hasListeners("ping"), true);
  });

  it("eventNames() should return array of subscribed event names", () => {
    const bus = new NanoEmitter();
    assert.deepStrictEqual(bus.eventNames(), []);
    bus.on("ping", () => {});
    bus.on("pong", () => {});
    bus.on("ping", () => {}); // duplicate
    bus.onAny(() => {}); // not included
    bus.onPattern("test:*", () => {}); // not included
    assert.deepStrictEqual(bus.eventNames().sort(), ["ping", "pong"]);
  });
});

// ============================================================================
// AbortSignal Support
// ============================================================================

describe("AbortSignal Support", () => {
  it("should auto-unsubscribe when signal is aborted", () => {
    const bus = new NanoEmitter();
    const controller = new AbortController();
    let count = 0;
    bus.on("ping", () => { count++; }, { signal: controller.signal });

    bus.emit("ping");
    assert.strictEqual(count, 1);

    controller.abort();

    bus.emit("ping");
    assert.strictEqual(count, 1); // didn't fire again
  });

  it("should not subscribe if signal is already aborted", () => {
    const bus = new NanoEmitter();
    const controller = new AbortController();
    controller.abort();

    let count = 0;
    bus.on("ping", () => { count++; }, { signal: controller.signal });

    bus.emit("ping");
    assert.strictEqual(count, 0);
    assert.strictEqual(bus.listenerCount(), 0);
  });

  it("should work with onAny and onPattern", () => {
    const bus = new NanoEmitter();
    const controller = new AbortController();
    const events = [];

    bus.onAny((e) => { events.push(`any:${e}`); }, { signal: controller.signal });
    bus.onPattern("task:*", (e) => { events.push(`pattern:${e}`); }, { signal: controller.signal });

    bus.emit("task:done");
    assert.deepStrictEqual(events, ["any:task:done", "pattern:task:done"]);

    controller.abort();

    bus.emit("task:start");
    assert.deepStrictEqual(events, ["any:task:done", "pattern:task:done"]); // unchanged
  });
});

// ============================================================================
// waitFor() Promise-Based Waiting
// ============================================================================

describe("waitFor()", () => {
  it("should resolve with event arguments when event is emitted", async () => {
    const bus = new NanoEmitter();

    const promise = bus.waitFor("user:login");

    // Emit after a small delay
    setTimeout(() => bus.emit("user:login", "alice", 42), 10);

    const args = await promise;
    assert.deepStrictEqual(args, ["alice", 42]);
  });

  it("should resolve immediately if event is emitted before await", async () => {
    const bus = new NanoEmitter();

    const promise = bus.waitFor("ping");
    bus.emit("ping", "data");

    const args = await promise;
    assert.deepStrictEqual(args, ["data"]);
  });

  it("should only capture first emission (once behavior)", async () => {
    const bus = new NanoEmitter();

    const promise = bus.waitFor("ping");
    bus.emit("ping", "first");
    bus.emit("ping", "second");

    const args = await promise;
    assert.deepStrictEqual(args, ["first"]);
  });

  it("should reject with TimeoutError when timeout exceeded", async () => {
    const bus = new NanoEmitter();

    let error;
    try {
      await bus.waitFor("never", { timeout: 20 });
    } catch (err) {
      error = err;
    }

    assert.strictEqual(error.name, "TimeoutError");
    assert.ok(error.message.includes("Timeout"));
    assert.ok(error.message.includes("never"));
    assert.ok(error.message.includes("20ms"));
  });

  it("should resolve before timeout if event fires in time", async () => {
    const bus = new NanoEmitter();

    const promise = bus.waitFor("ping", { timeout: 100 });
    setTimeout(() => bus.emit("ping", "success"), 10);

    const args = await promise;
    assert.deepStrictEqual(args, ["success"]);
  });

  it("should reject with AbortError when signal is aborted", async () => {
    const bus = new NanoEmitter();
    const controller = new AbortController();

    const promise = bus.waitFor("ping", { signal: controller.signal });

    setTimeout(() => controller.abort(), 10);

    let error;
    try {
      await promise;
    } catch (err) {
      error = err;
    }

    assert.strictEqual(error.name, "AbortError");
    assert.ok(error.message.includes("Aborted"));
  });

  it("should reject immediately if signal is already aborted", async () => {
    const bus = new NanoEmitter();
    const controller = new AbortController();
    controller.abort();

    let error;
    try {
      await bus.waitFor("ping", { signal: controller.signal });
    } catch (err) {
      error = err;
    }

    assert.strictEqual(error.name, "AbortError");
  });

  it("should clean up listener after resolution", async () => {
    const bus = new NanoEmitter();

    const promise = bus.waitFor("ping");
    assert.strictEqual(bus.listenerCount("ping"), 1);

    bus.emit("ping");
    await promise;

    assert.strictEqual(bus.listenerCount("ping"), 0);
  });

  it("should clean up listener after timeout", async () => {
    const bus = new NanoEmitter();

    const promise = bus.waitFor("ping", { timeout: 10 });
    assert.strictEqual(bus.listenerCount("ping"), 1);

    try {
      await promise;
    } catch (err) {
      // expected timeout
    }

    assert.strictEqual(bus.listenerCount("ping"), 0);
  });

  it("should clean up listener after abort", async () => {
    const bus = new NanoEmitter();
    const controller = new AbortController();

    const promise = bus.waitFor("ping", { signal: controller.signal });
    assert.strictEqual(bus.listenerCount("ping"), 1);

    controller.abort();

    try {
      await promise;
    } catch (err) {
      // expected abort
    }

    assert.strictEqual(bus.listenerCount("ping"), 0);
  });

  it("should work with combined timeout and signal", async () => {
    const bus = new NanoEmitter();
    const controller = new AbortController();

    // Abort before timeout
    const promise = bus.waitFor("ping", { timeout: 100, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);

    let error;
    try {
      await promise;
    } catch (err) {
      error = err;
    }

    assert.strictEqual(error.name, "AbortError");
  });

  it("should throw if emitter is disposed", () => {
    const bus = new NanoEmitter();
    bus.dispose();

    assert.throws(
      () => bus.waitFor("ping"),
      /disposed/
    );
  });
});

// ============================================================================
// Filter Option
// ============================================================================

describe("Filter Option", () => {
  it("should only invoke listener when filter returns true", () => {
    const bus = new NanoEmitter();
    const received = [];

    bus.on("message", (msg) => received.push(msg), {
      filter: (msg) => msg.important === true
    });

    bus.emit("message", { text: "hello", important: false });
    bus.emit("message", { text: "urgent", important: true });
    bus.emit("message", { text: "spam", important: false });

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].text, "urgent");
  });

  it("should pass all arguments to filter function", () => {
    const bus = new NanoEmitter();
    let filterArgs;

    bus.on("multi", () => {}, {
      filter: (...args) => {
        filterArgs = args;
        return true;
      }
    });

    bus.emit("multi", "a", "b", "c");
    assert.deepStrictEqual(filterArgs, ["a", "b", "c"]);
  });

  it("should work with onAny (filter receives event name + args)", () => {
    const bus = new NanoEmitter();
    const received = [];

    bus.onAny((event, data) => received.push({ event, data }), {
      filter: (event, data) => event.startsWith("user:") && data.admin === true
    });

    bus.emit("user:login", { admin: false });
    bus.emit("user:login", { admin: true });
    bus.emit("task:done", { admin: true }); // doesn't match event filter

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].event, "user:login");
  });

  it("should work with onPattern (filter receives event name + args)", () => {
    const bus = new NanoEmitter();
    const received = [];

    bus.onPattern("task:*", (event, status) => received.push({ event, status }), {
      filter: (event, status) => status === "success"
    });

    bus.emit("task:build", "success");
    bus.emit("task:test", "failure");
    bus.emit("task:deploy", "success");

    assert.strictEqual(received.length, 2);
    assert.deepStrictEqual(received.map(r => r.event), ["task:build", "task:deploy"]);
  });

  it("should work with once option", () => {
    const bus = new NanoEmitter();
    const received = [];

    bus.on("ping", (val) => received.push(val), {
      once: true,
      filter: (val) => val > 5
    });

    bus.emit("ping", 3); // filtered out
    bus.emit("ping", 2); // filtered out
    bus.emit("ping", 10); // passes filter, fires once
    bus.emit("ping", 20); // listener already removed

    assert.deepStrictEqual(received, [10]);
  });

  it("should work with priority option", () => {
    const bus = new NanoEmitter();
    const order = [];

    bus.on("ping", () => order.push("low-filtered"), { priority: 1, filter: () => true });
    bus.on("ping", () => order.push("high-filtered"), { priority: 10, filter: () => true });
    bus.on("ping", () => order.push("mid-no-filter"), { priority: 5 });

    bus.emit("ping");
    assert.deepStrictEqual(order, ["high-filtered", "mid-no-filter", "low-filtered"]);
  });

  it("should not affect return values for passing listeners", () => {
    const bus = new NanoEmitter();

    bus.on("calc", (x) => x * 2, { filter: (x) => x > 0 });
    bus.on("calc", (x) => x + 1);

    const results = bus.emit("calc", 5);
    assert.deepStrictEqual(results, [10, 6]);

    const filteredResults = bus.emit("calc", -5);
    assert.deepStrictEqual(filteredResults, [-4]); // first listener filtered out
  });

  it("should work with emitAsync", async () => {
    const bus = new NanoEmitter();
    const received = [];

    bus.on("task", async (data) => {
      await new Promise(r => setTimeout(r, 5));
      received.push(data);
    }, { filter: (data) => data.type === "important" });

    await bus.emitAsync("task", { type: "spam" });
    await bus.emitAsync("task", { type: "important" });

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].type, "important");
  });
});

// ============================================================================
// Dispose Lifecycle
// ============================================================================

describe("Dispose Lifecycle", () => {
  it("should set disposed property to true", () => {
    const bus = new NanoEmitter();
    assert.strictEqual(bus.disposed, false);
    bus.dispose();
    assert.strictEqual(bus.disposed, true);
  });

  it("should remove all listeners on dispose", () => {
    const bus = new NanoEmitter();
    bus.on("ping", () => {});
    bus.onAny(() => {});
    bus.onPattern("task:*", () => {});

    assert.strictEqual(bus.listenerCount(), 3);
    bus.dispose();
    assert.strictEqual(bus.listenerCount(), 0);
  });

  it("should mark all listeners as removed", () => {
    const bus = new NanoEmitter();
    let count = 0;

    const off = bus.on("ping", () => { count++; });
    bus.dispose();

    // Calling off() after dispose should be no-op (already removed)
    off();
    assert.strictEqual(bus.listenerCount(), 0);
  });

  it("should throw on emit after dispose", () => {
    const bus = new NanoEmitter();
    bus.dispose();

    assert.throws(
      () => bus.emit("ping"),
      /disposed/
    );
  });

  it("should throw on emitAsync after dispose", async () => {
    const bus = new NanoEmitter();
    bus.dispose();

    await assert.rejects(
      () => bus.emitAsync("ping"),
      /disposed/
    );
  });

  it("should throw on on() after dispose", () => {
    const bus = new NanoEmitter();
    bus.dispose();

    assert.throws(
      () => bus.on("ping", () => {}),
      /disposed/
    );
  });

  it("should throw on once() after dispose", () => {
    const bus = new NanoEmitter();
    bus.dispose();

    assert.throws(
      () => bus.once("ping", () => {}),
      /disposed/
    );
  });

  it("should throw on onAny() after dispose", () => {
    const bus = new NanoEmitter();
    bus.dispose();

    assert.throws(
      () => bus.onAny(() => {}),
      /disposed/
    );
  });

  it("should throw on onPattern() after dispose", () => {
    const bus = new NanoEmitter();
    bus.dispose();

    assert.throws(
      () => bus.onPattern("task:*", () => {}),
      /disposed/
    );
  });

  it("should be idempotent (multiple dispose calls are safe)", () => {
    const bus = new NanoEmitter();
    bus.on("ping", () => {});

    bus.dispose();
    bus.dispose();
    bus.dispose();

    assert.strictEqual(bus.disposed, true);
    assert.strictEqual(bus.listenerCount(), 0);
  });

  it("should not throw on off/offAny/offPattern/clear after dispose", () => {
    const bus = new NanoEmitter();
    const fn = () => {};
    bus.dispose();

    // These should all be safe no-ops
    bus.off("ping", fn);
    bus.offAny(fn);
    bus.offPattern("task:*", fn);
    bus.clear();
    bus.clear("ping");
  });

  it("should allow introspection after dispose", () => {
    const bus = new NanoEmitter();
    bus.dispose();

    // These should work and return empty/zero
    assert.strictEqual(bus.listenerCount(), 0);
    assert.strictEqual(bus.hasListeners(), false);
    assert.deepStrictEqual(bus.eventNames(), []);
  });
});

// ============================================================================
// Integration Scenarios
// ============================================================================

describe("Integration: Build Pipeline Scenario", () => {
  it("should handle a realistic event-driven workflow", async () => {
    const bus = new NanoEmitter();
    const log = [];
    const metrics = { started: 0, completed: 0, failed: 0 };

    // Metrics collector (high priority, runs first)
    bus.onPattern("task:*", (event) => {
      if (event.endsWith(":start")) metrics.started++;
      else if (event.endsWith(":done")) metrics.completed++;
      else if (event.endsWith(":fail")) metrics.failed++;
    }, { priority: 100 });

    // Logger (lower priority)
    bus.onAny((event, ...args) => {
      log.push({ event, args });
    }, { priority: 50 });

    // Task handlers
    bus.on("task:lint:start", async () => {
      await new Promise(r => setTimeout(r, 5));
      bus.emit("task:lint:done");
    });

    bus.on("task:build:start", async () => {
      await new Promise(r => setTimeout(r, 5));
      bus.emit("task:build:fail", "compilation error");
    });

    // Run pipeline
    await bus.emitAsync("task:lint:start");
    await bus.emitAsync("task:build:start");

    assert.deepStrictEqual(metrics, { started: 2, completed: 1, failed: 1 });
    assert.strictEqual(log.length, 4); // start, done, start, fail
  });
});

// ============================================================================
// Run
// ============================================================================

runTests();
