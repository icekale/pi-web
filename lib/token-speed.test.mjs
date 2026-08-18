import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  computeStreamingTps,
  estimateTokens,
  estimateStreamingTokens,
} = await jiti.import("./token-speed.ts");

test("CJK characters count as about one token, latin as about four chars per token", () => {
  assert.equal(estimateTokens("你好"), 2);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("你好abcd"), 3);
});

test("streaming t/s uses time since the first token, not a later interval tick", () => {
  // 50 tokens arrive at t=0, UI polls at t=300 then t=800.
  // The old interval clock started at t=300 and showed 50 / 0.5 = 100 t/s.
  const firstTokenAt = 1_000;
  const now = 1_800;
  const tps = computeStreamingTps(50, firstTokenAt, now);
  assert.equal(tps, 50 / 0.8);
});

test("does not report t/s until half a second of generation has elapsed", () => {
  assert.equal(computeStreamingTps(40, 1_000, 1_400), null);
  assert.equal(computeStreamingTps(0, 1_000, 2_000), null);
  assert.equal(computeStreamingTps(40, null, 2_000), null);
});

test("a late interval start would inflate the same sample", () => {
  const tokens = 50;
  const firstTokenAt = 1_000;
  const intervalStart = 1_300;
  const now = 1_800;
  const inflated = tokens / ((now - intervalStart) / 1000);
  const actual = computeStreamingTps(tokens, firstTokenAt, now);
  assert.equal(inflated, 100);
  assert.ok(actual !== null && actual < inflated);
  assert.equal(actual, 62.5);
});

test("streaming estimate sums thinking, text, and tool-call argument text", () => {
  const { tokens } = estimateStreamingTokens([
    { originalIndex: 0, block: { type: "thinking", thinking: "你好" } },
    { originalIndex: 1, block: { type: "text", text: "abcd" } },
    { originalIndex: 2, block: { type: "toolCall", toolCallId: "t1", toolName: "bash", input: {}, rawInput: "abcd" } },
  ], new Map());
  assert.equal(tokens, 4);
});
