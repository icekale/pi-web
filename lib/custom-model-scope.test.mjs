import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { customModelKeys, missingCustomModelKeys, removeMissingCustomModelKeys } = await jiti.import("./custom-model-scope.ts");

test("custom models.json entries are picker keys", () => {
  assert.deepEqual(customModelKeys({
    providers: { one2api: { models: [{ id: "gpt-6.1-sol" }, { id: "  " }, "nope"] } },
  }), ["one2api/gpt-6.1-sol"]);
});

test("missing custom model entries are removed without touching other providers", () => {
  assert.deepEqual(removeMissingCustomModelKeys(
    ["one2api/gpt-5.5", "one2api/gpt-6-sol", "openai/gpt-4o"],
    new Set(["one2api/gpt-5.5", "one2api/gpt-6-sol"]),
    new Set(["one2api/gpt-6-sol"]),
  ), ["one2api/gpt-6-sol", "openai/gpt-4o"]);
});
test("a new custom model is adopted unless the user turned it off", () => {
  const customKeys = ["one2api/gpt-6-sol", "one2api/gpt-6.1-sol"];
  const visibleKeys = new Set(["one2api/gpt-6-sol"]);
  assert.deepEqual(missingCustomModelKeys({
    customKeys,
    visibleKeys,
    disabledKeys: new Set(),
  }), ["one2api/gpt-6.1-sol"]);
  assert.deepEqual(missingCustomModelKeys({
    customKeys,
    visibleKeys,
    disabledKeys: new Set(["one2api/gpt-6.1-sol"]),
  }), []);
});
