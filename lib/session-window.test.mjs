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

test("mergeWindowedHistory keeps live messages that disk has not indexed yet", () => {
  const live = { role: "assistant", content: [{ type: "text", text: "done" }] };
  const merged = mergeWindowedHistory(
    [{ role: "user", content: "hi" }, live],
    ["u1"],
    [{ role: "user", content: "hi" }],
    ["u1"],
  );
  assert.equal(merged.entryIds.length, 1);
  assert.equal(merged.items.length, 2);
  assert.equal(merged.items[1], live);

  const caughtUp = mergeWindowedHistory(
    [{ role: "user", content: "hi" }, live],
    ["u1"],
    [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "done" }] }],
    ["u1", "a1"],
  );
  assert.deepEqual(caughtUp.entryIds, ["u1", "a1"]);
  assert.equal(caughtUp.items.length, 2);

  const emptyIncoming = mergeWindowedHistory(["live"], ["u1"], [], []);
  assert.deepEqual(emptyIncoming.items, ["live"]);
  assert.deepEqual(emptyIncoming.entryIds, ["u1"]);
});

test("mergeWindowedHistory ignores a stale shorter window", () => {
  const merged = mergeWindowedHistory(
    ["u", "a"],
    ["u1", "a1"],
    ["u"],
    ["u1"],
  );
  assert.deepEqual(merged.entryIds, ["u1", "a1"]);
  assert.deepEqual(merged.items, ["u", "a"]);
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
