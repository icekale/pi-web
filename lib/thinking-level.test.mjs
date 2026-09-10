import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { highestThinkingLevel, sessionPathHasThinkingLevelChange } = await jiti.import("./thinking-level.ts");

test("highestThinkingLevel picks the strongest advertised level", () => {
  assert.equal(highestThinkingLevel(undefined), "auto");
  assert.equal(highestThinkingLevel([]), "auto");
  assert.equal(highestThinkingLevel(["off"]), "off");
  assert.equal(highestThinkingLevel(["off", "high", "max"]), "max");
  assert.equal(highestThinkingLevel(["low", "medium", "high", "xhigh"]), "xhigh");
});

test("sessionPathHasThinkingLevelChange only follows the active path", () => {
  const entries = [
    { id: "u1", parentId: null, type: "message" },
    { id: "t-alt", parentId: "u1", type: "thinking_level_change" },
    { id: "u2", parentId: "u1", type: "message" },
    { id: "t-main", parentId: "u2", type: "thinking_level_change" },
  ];
  assert.equal(sessionPathHasThinkingLevelChange(entries, "u2"), false);
  assert.equal(sessionPathHasThinkingLevelChange(entries, "t-main"), true);
  assert.equal(sessionPathHasThinkingLevelChange(entries, "t-alt"), true);
});
