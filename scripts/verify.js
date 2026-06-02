const { spawnSync } = require("child_process");

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.status !== 0) {
    process.exit(res.status || 1);
  }
}

console.log("==> tests");
run("node", ["test/run.js"]);

console.log("\n==> sample");
run("node", ["sample/app.js"]);

console.log("\n==> benchmarks");
run("node", ["benchmark/bench.js"]);
