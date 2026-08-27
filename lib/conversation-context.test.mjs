import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildConversationContextModel, contextTokensFromUsage, contextUsageFromAssistant } = await createJiti(import.meta.url).import("./conversation-context.ts");

const stats = {
  sessionId: "s1",
  userMessages: 1,
  assistantMessages: 1,
  toolCalls: 2,
  toolResults: 2,
  totalMessages: 4,
  tokens: { input: 6400, output: 22000, cacheRead: 339000, cacheWrite: 0, total: 367400 },
  cost: 0.008,
};

test("builds the compact card metrics from existing stats", () => {
  assert.deepEqual(buildConversationContextModel({
    stats,
    contextUsage: { percent: 2.9, tokens: 31000, contextWindow: 1_000_000 },
  }), {
    percent: 2.9,
    usedTokens: 31000,
    contextWindow: 1_000_000,
    availableTokens: 969000,
    userMessages: 1,
    toolCalls: 2,
    cacheHitRate: 98.1,
  });
});

test("derives live context usage from an assistant usage block", () => {
  assert.equal(contextTokensFromUsage({ input: 10, output: 5, cacheRead: 20, cacheWrite: 1 }), 36);
  assert.equal(contextTokensFromUsage({ totalTokens: 100, input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }), 100);
  assert.deepEqual(contextUsageFromAssistant({ totalTokens: 250 }, 1000), {
    tokens: 250,
    contextWindow: 1000,
    percent: 25,
  });
  assert.equal(contextUsageFromAssistant({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 1000), null);
  assert.equal(contextUsageFromAssistant({ totalTokens: 10 }, 0), null);
  assert.equal(contextUsageFromAssistant({ totalTokens: 250 }, 1000, "aborted"), null);
  assert.equal(contextUsageFromAssistant({ totalTokens: 250 }, 1000, "error"), null);
});

test("clamps context values", () => {
  const model = buildConversationContextModel({
    stats: { ...stats, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 },
    contextUsage: { percent: 110, tokens: 1200, contextWindow: 1000 },
  });
  assert.equal(model.percent, 100);
  assert.equal(model.availableTokens, 0);
  assert.equal(model.cacheHitRate, null);
});
