import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { SubagentQueue } = await createJiti(import.meta.url).import("./subagent-queue.ts");

test("runs FIFO with a per-parent concurrency limit and drains after completion", async () => {
  const queue = new SubagentQueue();
  const events = [];
  let release;
  const first = queue.enqueue("parent", 1, () => new Promise((resolve) => { release = () => resolve("first"); }), (state) => events.push(["first", state]));
  const second = queue.enqueue("parent", 1, async () => "second", (state) => events.push(["second", state]));
  assert.deepEqual(events, [["first", "queued"], ["first", "running"], ["second", "queued"]]);
  release();
  assert.equal(await first.promise, "first");
  assert.equal(await second.promise, "second");
  assert.deepEqual(events, [
    ["first", "queued"], ["first", "running"], ["second", "queued"], ["second", "running"],
  ]);
});

test("cancels queued work without starting it", async () => {
  const queue = new SubagentQueue();
  let release;
  const first = queue.enqueue("parent", 1, () => new Promise((resolve) => { release = resolve; }), () => {});
  let started = false;
  let cancelled = false;
  const second = queue.enqueue("parent", 1, async () => { started = true; return "bad"; }, () => {}, () => { cancelled = true; });
  assert.equal(second.cancel(), true);
  assert.equal(cancelled, true);
  release();
  await first.promise;
  assert.equal(await second.promise, undefined);
  assert.equal(started, false);
});

test("a throwing state notification never drops the item or strands its promise", async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  try {
    const queue = new SubagentQueue();
    let runs = 0;
    // Throws on the synchronous "queued" notification inside enqueue() and again on
    // "running" inside pump(): the item must still run and still settle.
    const boom = () => { throw new Error("disk is full"); };
    const first = queue.enqueue("parent", 1, async () => { runs += 1; return "first"; }, boom);
    assert.equal(await first.promise, "first");
    assert.equal(runs, 1);
    const second = queue.enqueue("parent", 1, async () => { runs += 1; return "second"; }, (state) => {
      if (state === "queued") throw new Error("disk is full");
    });
    assert.equal(await second.promise, "second");
    assert.equal(runs, 2);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 3, "each failed notification must be reported, not swallowed silently");
  assert.match(warnings[0], /state notification failed/);
});
