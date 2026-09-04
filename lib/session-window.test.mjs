import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  SESSION_MESSAGE_WINDOW,
  parseSessionWindowParams,
  sliceSessionContext,
  mergeWindowedHistory,
} = await jiti.import("./session-window.ts");

test("defaults the history window to 80 messages", () => {
  assert.equal(SESSION_MESSAGE_WINDOW, 80);
  assert.deepEqual(parseSessionWindowParams(new URLSearchParams()), { limit: 80 });
  assert.deepEqual(
    parseSessionWindowParams(new URLSearchParams("limit=5&before=abc&leafId=leaf-1")),
    { limit: 5, before: "abc", leafId: "leaf-1" },
  );
  assert.equal(parseSessionWindowParams(new URLSearchParams("limit=9999")).limit, 500);
  assert.equal(parseSessionWindowParams(new URLSearchParams("limit=nope")).limit, 80);
});

test("slices context to the newest page and pages backward with before", () => {
  const context = {
    messages: ["a", "b", "c", "d", "e"].map((content) => ({ role: "user", content })),
    entryIds: ["a", "b", "c", "d", "e"],
    thinkingLevel: "off",
    model: null,
  };

  const first = sliceSessionContext(context, { limit: 2 });
  assert.deepEqual(first.context.entryIds, ["d", "e"]);
  assert.equal(first.hasMore, true);

  const older = sliceSessionContext(context, { limit: 2, before: "d" });
  assert.deepEqual(older.context.entryIds, ["b", "c"]);
  assert.equal(older.hasMore, true);

  const oldest = sliceSessionContext(context, { limit: 2, before: "b" });
  assert.deepEqual(oldest.context.entryIds, ["a"]);
  assert.equal(oldest.hasMore, false);

  const missing = sliceSessionContext(context, { limit: 2, before: "missing" });
  assert.deepEqual(missing.context.entryIds, []);
  assert.equal(missing.hasMore, false);
});

test("mergeWindowedHistory keeps already-loaded older messages on a refresh", () => {
  const merged = mergeWindowedHistory(
    ["old-1", "old-2", "new-1", "new-2"],
    ["o1", "o2", "n1", "n2"],
    ["new-1", "new-2", "new-3"],
    ["n1", "n2", "n3"],
  );
  assert.deepEqual(merged.entryIds, ["o1", "o2", "n1", "n2", "n3"]);
  assert.deepEqual(merged.items, ["old-1", "old-2", "new-1", "new-2", "new-3"]);

  const switched = mergeWindowedHistory(
    ["root", "side"],
    ["root", "side"],
    ["root", "main"],
    ["root", "main"],
  );
  assert.deepEqual(switched.entryIds, ["root", "main"]);
});
