const { EventEmitter } = require("events");
const { NanoEmitter } = require("../dist/cjs/nanoemitter");

function bench(name, iterations, fn) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) fn();
  const end = process.hrtime.bigint();
  const totalNs = Number(end - start);
  const perOpNs = totalNs / iterations;
  console.log(`${name}: ${perOpNs.toFixed(1)} ns/op`);
}

function benchSyncEmitters(iterations, listeners) {
  const node = new EventEmitter();
  const nano = new NanoEmitter();

  for (let i = 0; i < listeners; i += 1) {
    node.on("ping", () => {});
    nano.on("ping", () => {});
  }

  bench(`EventEmitter emit (${listeners} listeners)`, iterations, () => {
    node.emit("ping");
  });

  bench(`NanoEmitter emit (${listeners} listeners)`, iterations, () => {
    nano.emit("ping");
  });
}

function benchOnOff(iterations) {
  const node = new EventEmitter();
  const nano = new NanoEmitter();
  const noop = () => {};

  bench("EventEmitter on+off", iterations, () => {
    node.on("ping", noop);
    node.off("ping", noop);
  });

  bench("NanoEmitter on+off", iterations, () => {
    const off = nano.on("ping", noop);
    off();
  });
}

const iterations = Number(process.env.ITERATIONS || 200000);
const listeners = Number(process.env.LISTENERS || 5);

console.log(`Iterations: ${iterations}, Listeners: ${listeners}`);
benchSyncEmitters(iterations, listeners);
benchOnOff(iterations);
