const { NanoEmitter } = require("../dist/cjs/nanoemitter");

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runBuild() {
  const bus = new NanoEmitter();
  const stats = { started: 0, finished: 0, failed: 0 };

  // Prioritize metrics before logging so output is consistent.
  bus.onPattern("task:*", (event) => {
    if (event === "task:start") stats.started += 1;
    if (event === "task:done") stats.finished += 1;
    if (event === "task:fail") stats.failed += 1;
  }, { priority: 10 });

  bus.onAny((event, payload) => {
    const msg = payload && payload.name ? ` ${payload.name}` : "";
    console.log(`[event] ${event}${msg}`);
  });

  bus.once("build:complete", () => {
    console.log("Build completed once.");
  });

  const tasks = [
    { name: "lint", run: async () => delay(20) },
    { name: "bundle", run: async () => delay(10) },
    { name: "upload", run: async () => delay(5), fail: true },
  ];

  for (const task of tasks) {
    await bus.emitAsync("task:start", { name: task.name });
    try {
      await task.run();
      if (task.fail) throw new Error("upload failed");
      await bus.emitAsync("task:done", { name: task.name });
    } catch (err) {
      await bus.emitAsync("task:fail", { name: task.name, error: err.message });
    }
  }

  await bus.emitAsync("build:complete");
  await bus.emitAsync("build:complete");

  console.log("Stats:", stats);
}

runBuild().catch((err) => {
  console.error(err);
  process.exit(1);
});
