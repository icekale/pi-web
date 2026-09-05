import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { sessionPathKey } = await jiti.import("./paths.ts");
const {
  listAllSessions,
  mergeSessionLists,
  discoverNestedSessions,
  buildSessionContext,
  cacheSessionPath,
  invalidateSessionListCache,
  invalidateSessionPathCache,
  readSessionHeader,
  readSessionWindow,
  readCachedSessionInfo,
  findSessionEntry,
  resolveSessionIdByPath,
  resolveSessionPath,
} = await jiti.import("./session-reader.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");

function resetSessionListState() {
  globalThis.__piSessionListCache = undefined;
  globalThis.__piSessionListPromise = undefined;
  globalThis.__piSessionListPromiseGeneration = undefined;
  globalThis.__piSessionListGeneration = 0;
  delete globalThis.__piListSessionFiles;
}

function withAgentDir(t) {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-sessions-"));
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  resetSessionListState();
  t.after(() => {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    rmSync(agentDir, { recursive: true, force: true });
    resetSessionListState();
  });
  return agentDir;
}

function writeJsonl(filePath, entries) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

function userEntry(id, parentId, content, timestamp = "2026-01-01T00:00:00.000Z") {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "user",
      content,
    },
  };
}

function assistantEntry(id, parentId, text, timestamp = "2026-01-01T00:00:00.000Z") {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "assistant",
      provider: "test",
      model: "test-model",
      content: [{ type: "text", text }],
    },
  };
}

test("renders the SDK compaction-aware context with aligned entry IDs", () => {
  const entries = [
    userEntry("u1", null, "old user request"),
    assistantEntry("a1", "u1", "old assistant answer"),
    userEntry("u2", "a1", "kept user request"),
    {
      type: "compaction",
      id: "cmp",
      parentId: "u2",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "old exchange summary",
      firstKeptEntryId: "u2",
      tokensBefore: 123,
    },
    userEntry("u3", "cmp", "after compaction"),
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.entryIds, ["cmp", "u2", "u3"]);
  assert.deepEqual(
    context.messages.map((message) => [message.role, message.customType, message.content]),
    [
      ["custom", "compaction", "old exchange summary"],
      ["user", undefined, "kept user request"],
      ["user", undefined, "after compaction"],
    ],
  );
});

test("uses only the latest compaction on the active path", () => {
  const entries = [
    userEntry("u1", null, "old request"),
    assistantEntry("a1", "u1", "old answer"),
    userEntry("u2", "a1", "first kept request"),
    {
      type: "compaction",
      id: "cmp1",
      parentId: "u2",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "first summary",
      firstKeptEntryId: "u2",
      tokensBefore: 100,
    },
    assistantEntry("a2", "cmp1", "second kept answer"),
    userEntry("u3", "a2", "second kept request"),
    {
      type: "compaction",
      id: "cmp2",
      parentId: "u3",
      timestamp: "2026-01-01T00:00:06.000Z",
      summary: "latest summary",
      firstKeptEntryId: "a2",
      tokensBefore: 200,
    },
    assistantEntry("a3", "cmp2", "latest answer"),
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.entryIds, ["cmp2", "a2", "u3", "a3"]);
  assert.equal(context.messages[0].role, "custom");
  assert.equal(context.messages[0].content, "latest summary");
  assert.equal(context.messages.length, context.entryIds.length);
});

test("uses the selected leaf's path before a later compaction", () => {
  const entries = [
    userEntry("u1", null, "root request"),
    assistantEntry("a1", "u1", "root answer"),
    userEntry("u2", "a1", "main branch"),
    {
      type: "compaction",
      id: "cmp",
      parentId: "u2",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "main branch summary",
      firstKeptEntryId: "u2",
      tokensBefore: 100,
    },
    userEntry("alt", "a1", "alternate branch"),
  ];

  const context = buildSessionContext(entries, "alt");

  assert.deepEqual(context.entryIds, ["u1", "a1", "alt"]);
  assert.equal(context.messages.some((message) => message.role === "custom"), false);
});

test("returns an empty context for a null leaf", () => {
  const context = buildSessionContext([
    userEntry("u1", null, "not active"),
  ], null);

  assert.deepEqual(context.messages, []);
  assert.deepEqual(context.entryIds, []);
});

test("defers historical thinking without changing live-session content", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      ...assistantEntry("a1", "u1", "answer"),
      message: {
        role: "assistant",
        provider: "test",
        model: "test-model",
        content: [
          { type: "thinking", thinking: "large reasoning" },
          { type: "text", text: "answer" },
        ],
      },
    },
  ];

  const deferred = buildSessionContext(entries, undefined, { deferThinking: true });
  assert.deepEqual(deferred.messages[1].content[0], {
    type: "thinking",
    thinking: "",
    deferred: true,
  });

  const full = buildSessionContext(entries);
  assert.equal(full.messages[1].content[0].thinking, "large reasoning");
});

test("does not defer empty historical thinking blocks", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      ...assistantEntry("a1", "u1", "answer"),
      message: {
        role: "assistant",
        provider: "test",
        model: "test-model",
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: "answer" },
        ],
      },
    },
  ];

  const context = buildSessionContext(entries, undefined, { deferThinking: true });
  assert.deepEqual(context.messages[1].content[0], { type: "thinking", thinking: "" });
});

test("defers only base64 images from historical tool results", () => {
  const userImage = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QUJDRA==" },
  };
  const toolImage = {
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: "QUJDRA==" },
  };
  const toolUrlImage = {
    type: "image",
    source: { type: "url", url: "https://example.com/result.png" },
  };
  const flatToolImage = {
    type: "image",
    data: "QUJDRA==",
    mimeType: "image/png",
  };
  const entries = [
    userEntry("u1", null, [{ type: "text", text: "inspect this" }, userImage]),
    assistantEntry("a1", "u1", "reading"),
    {
      type: "message",
      id: "tr1",
      parentId: "a1",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call1",
        content: [
          { type: "text", text: "Read image file" },
          toolImage,
          flatToolImage,
          toolUrlImage,
        ],
      },
    },
  ];

  const deferred = buildSessionContext(entries, undefined, { deferToolResultImages: true });
  assert.deepEqual(deferred.messages[0].content[1], userImage);
  assert.deepEqual(deferred.messages[2].content[0], { type: "text", text: "Read image file" });
  assert.deepEqual(deferred.messages[2].content[1], toolUrlImage);
  assert.match(deferred.messages[2].content[2].text, /2 tool result images omitted.*image\/jpeg, image\/png.*~8 bytes/);

  const full = buildSessionContext(entries);
  assert.deepEqual(full.messages[2].content[1], toolImage);
  assert.deepEqual(full.messages[2].content[2], flatToolImage);
  assert.deepEqual(full.messages[2].content[3], toolUrlImage);
});

test("preserves hidden custom messages so the UI can render them collapsed", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      type: "custom_message",
      id: "c1",
      parentId: "u1",
      timestamp: "2026-01-01T00:00:01.000Z",
      customType: "extension_debug",
      content: "hidden extension payload",
      display: false,
      details: { source: "test" },
    },
    assistantEntry("a1", "c1", "done"),
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.entryIds, ["u1", "c1", "a1"]);
  assert.equal(context.messages[1].role, "custom");
  assert.equal(context.messages[1].customType, "extension_debug");
  assert.equal(context.messages[1].display, false);
  assert.equal(context.messages[1].content, "hidden extension payload");
});

test("preserves valid epoch timestamps on synthetic UI messages", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      type: "compaction",
      id: "cmp",
      parentId: "u1",
      timestamp: "1970-01-01T00:00:00.000Z",
      summary: "epoch summary",
      firstKeptEntryId: "u1",
      tokensBefore: 10,
    },
  ];

  const context = buildSessionContext(entries);

  assert.equal(context.messages[0].role, "custom");
  assert.equal(context.messages[0].customType, "compaction");
  assert.equal(context.messages[0].timestamp, 0);
});

test("reads only a bounded session header, including headers larger than 4 KiB", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-header-"));
  const filePath = join(dir, "session.jsonl");
  const parentSession = `/tmp/${"p".repeat(5_000)}.jsonl`;
  writeFileSync(filePath, `${JSON.stringify({
    type: "session",
    version: 3,
    id: "session",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: dir,
    parentSession,
  })}\n${JSON.stringify(userEntry("u1", null, "message"))}\n`);

  try {
    assert.equal(readSessionHeader(filePath)?.parentSession, parentSession);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns null for malformed or unbounded session headers", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-header-invalid-"));
  const malformedPath = join(dir, "malformed.jsonl");
  const oversizedPath = join(dir, "oversized.jsonl");
  writeFileSync(malformedPath, "{not-json}\n");
  writeFileSync(oversizedPath, "x".repeat(64 * 1024));

  try {
    assert.equal(readSessionHeader(malformedPath), null);
    assert.equal(readSessionHeader(oversizedPath), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keeps forward and reverse session path caches in sync", async () => {
  const sessionId = "cache-test-session";
  const filePath = join(tmpdir(), "pi-web-cache-test", "..", "cache-test", "session.jsonl");

  cacheSessionPath(sessionId, filePath);
  try {
    assert.equal(
      await resolveSessionIdByPath(filePath),
      sessionId,
    );
  } finally {
    invalidateSessionPathCache(sessionId);
  }

  assert.equal(globalThis.__piSessionPathCache?.has(sessionId), false);
  assert.equal(globalThis.__piPathToSessionIdCache?.has(sessionPathKey(filePath)), false);
});

test("lists sessions from jsonl headers without the SDK catalogue", async (t) => {
  const agentDir = withAgentDir(t);
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  writeJsonl(join(agentDir, "sessions", "cwd", `${id}.jsonl`), [
    { type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: "/tmp/proj" },
    userEntry("m1", null, "hello list", "2026-01-01T00:00:01.000Z"),
    {
      type: "session_info",
      id: "n1",
      parentId: "m1",
      timestamp: "2026-01-01T00:00:02.000Z",
      name: "Hello List",
    },
  ]);

  const originalListAll = SessionManager.listAll;
  SessionManager.listAll = async () => {
    throw new Error("listAll should not be called");
  };
  t.after(() => {
    SessionManager.listAll = originalListAll;
  });

  const sessions = await listAllSessions({ force: true });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, id);
  assert.equal(sessions[0].name, "Hello List");
  assert.equal(sessions[0].firstMessage, "hello list");
  assert.equal(sessions[0].cwd, "/tmp/proj");
  assert.equal(existsSync(join(agentDir, "sessions-index.sqlite")), true);
  assert.equal(existsSync(join(agentDir, "sessions-index.json")), false);
});

test("session list index reloads from sqlite after a process-style cache reset", async (t) => {
  const agentDir = withAgentDir(t);
  writeJsonl(join(agentDir, "sessions", "cwd", "s.jsonl"), [
    { type: "session", version: 3, id: "sqlite-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/tmp" },
    userEntry("u1", null, "hello from sqlite"),
  ]);
  const first = await listAllSessions({ force: true });
  assert.equal(first[0]?.id, "sqlite-1");
  resetSessionListState();
  const second = await listAllSessions({ force: true });
  assert.equal(second[0]?.firstMessage, "hello from sqlite");
  assert.equal(existsSync(join(agentDir, "sessions-index.sqlite")), true);
});

test("session list picks up a new jsonl without waiting for ttl", async (t) => {
  const agentDir = withAgentDir(t);
  const first = await listAllSessions({ force: true });
  assert.equal(first.length, 0);

  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  writeJsonl(join(agentDir, "sessions", "cwd", `${id}.jsonl`), [
    { type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: "/tmp/proj" },
  ]);

  const second = await listAllSessions();
  assert.equal(second.length, 1);
  assert.equal(second[0].id, id);
  assert.equal(second[0].firstMessage, "(no messages)");
});

test("forced session listing starts a new scan", async (t) => {
  withAgentDir(t);
  let scans = 0;
  globalThis.__piListSessionFiles = async () => {
    scans += 1;
    return [];
  };

  await listAllSessions({ force: true });
  await listAllSessions();
  assert.equal(scans, 2);

  await listAllSessions({ force: true });
  assert.equal(scans, 3);
});

test("a scan invalidated in flight retries before returning to its caller", async (t) => {
  withAgentDir(t);
  let scans = 0;
  let releaseFirstScan;
  let markFirstScanStarted;
  const firstScanStarted = new Promise((resolve) => {
    markFirstScanStarted = resolve;
  });
  const firstScanGate = new Promise((resolve) => {
    releaseFirstScan = resolve;
  });
  globalThis.__piListSessionFiles = async () => {
    scans += 1;
    if (scans === 1) {
      markFirstScanStarted();
      await firstScanGate;
    }
    return [];
  };

  const listing = listAllSessions({ force: true });
  await firstScanStarted;
  invalidateSessionListCache();
  releaseFirstScan();
  await listing;

  assert.equal(scans, 2);
});

test("retries session listing after a failed in-flight load", async (t) => {
  withAgentDir(t);
  let scans = 0;
  globalThis.__piListSessionFiles = async () => {
    scans += 1;
    if (scans === 1) throw new Error("boom");
    return [];
  };

  await assert.rejects(() => listAllSessions({ force: true }), /boom/);
  const sessions = await listAllSessions();
  assert.equal(scans, 2);
  assert.deepEqual(sessions, []);
});

test("disk sessions replace runtime snapshots with the same id", () => {
  const base = {
    path: "/tmp/session.jsonl",
    id: "same-id",
    cwd: "/tmp",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:01.000Z",
    messageCount: 2,
    firstMessage: "persisted",
  };
  const persisted = { ...base };
  const runtime = {
    ...base,
    path: "/tmp/not-written-yet.jsonl",
    modified: "2026-01-01T00:00:02.000Z",
    firstMessage: "runtime",
    transient: true,
  };
  const runtimeOnly = {
    ...runtime,
    id: "runtime-only",
    modified: "2026-01-01T00:00:03.000Z",
  };

  const merged = mergeSessionLists([persisted], [runtime, runtimeOnly]);

  assert.deepEqual(merged.map((session) => session.id), ["runtime-only", "same-id"]);
  assert.equal(merged[1], persisted);
  assert.equal(merged[1].transient, undefined);
});

test("discovers nested session.jsonl under a parent session directory and infers parentSessionId", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-nested-sessions-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const parentPath = join(dir, "2026-01-01T00-00-00-000Z_root.jsonl");
  writeFileSync(parentPath, `${JSON.stringify({
    type: "session",
    version: 3,
    id: "root",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: dir,
  })}\n`);
  const nestedPath = join(dir, "2026-01-01T00-00-00-000Z_root", "c486ba7a", "run-0", "session.jsonl");
  mkdirSync(join(dir, "2026-01-01T00-00-00-000Z_root", "c486ba7a", "run-0"), { recursive: true });
  writeFileSync(nestedPath, [
    JSON.stringify({
      type: "session",
      version: 3,
      id: "child",
      timestamp: "2026-01-01T00:00:01.000Z",
      cwd: dir,
    }),
    JSON.stringify({
      type: "session_info",
      id: "n1",
      parentId: null,
      timestamp: "2026-01-01T00:00:02.000Z",
      name: "subagent-worker-c486ba7a-1",
    }),
    JSON.stringify({
      type: "message",
      id: "m1",
      parentId: "n1",
      timestamp: "2026-01-01T00:00:03.000Z",
      message: { role: "user", content: [{ type: "text", text: "Task: sleep 45" }] },
    }),
  ].join("\n") + "\n");

  const nested = discoverNestedSessions([{ id: "root", path: parentPath }]);
  assert.equal(nested.length, 1);
  assert.equal(nested[0].id, "child");
  assert.equal(nested[0].name, "subagent-worker-c486ba7a-1");
  assert.equal(nested[0].parentSessionId, "root");
  assert.equal(nested[0].firstMessage, "Task: sleep 45");
});

function toolResultEntry(id, parentId, text) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:02.000Z",
    message: {
      role: "toolResult",
      toolCallId: `call-${id}`,
      content: [{ type: "text", text }],
    },
  };
}

test("defers only oversized historical tool results when requested", () => {
  const entries = [
    userEntry("u1", null, "start"),
    toolResultEntry("tr1", "u1", "x".repeat(20_001)),
  ];

  const deferred = buildSessionContext(entries, undefined, { deferToolResults: true });
  assert.equal(deferred.messages[1].deferred, true);
  assert.ok(deferred.messages[1].contentLength > 20_000);
  assert.deepEqual(deferred.messages[1].content, []);

  const full = buildSessionContext(entries);
  assert.equal(full.messages[1].deferred, undefined);
  assert.equal(full.messages[1].content[0].text.length, 20_001);
});

test("keeps small tool results in the initial payload", () => {
  const context = buildSessionContext([
    userEntry("u1", null, "start"),
    toolResultEntry("tr1", "u1", "small"),
  ], undefined, { deferToolResults: true });

  assert.equal(context.messages[1].deferred, undefined);
  assert.equal(context.messages[1].content[0].text, "small");
});

test("resolveSessionPath finds a session by header without listing the catalogue", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-session-lookup-"));
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const id = "11111111-1111-4111-8111-111111111111";
  const filePath = join(agentDir, "sessions", "cwd", `${id}.jsonl`);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    type: "session", version: 3, id, timestamp: "2026-08-18T00:00:00.000Z", cwd: "/tmp",
  })}\n`);

  let scans = 0;
  const original = SessionManager.listAll;
  SessionManager.listAll = async () => { scans += 1; return []; };

  t.after(() => {
    SessionManager.listAll = original;
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    rmSync(agentDir, { recursive: true, force: true });
    invalidateSessionPathCache(id);
  });

  assert.equal(await resolveSessionPath(id), filePath);
  assert.equal(scans, 0);
});

test("resolveSessionIdByPath reads the header without listing the catalogue", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-session-id-by-path-"));
  const id = "22222222-2222-4222-8222-222222222222";
  const filePath = join(dir, `${id}.jsonl`);
  writeFileSync(filePath, `${JSON.stringify({
    type: "session", version: 3, id, timestamp: "2026-08-18T00:00:00.000Z", cwd: "/tmp",
  })}\n`);

  const original = SessionManager.listAll;
  SessionManager.listAll = async () => {
    throw new Error("listAll should not be called");
  };

  t.after(() => {
    SessionManager.listAll = original;
    rmSync(dir, { recursive: true, force: true });
    invalidateSessionPathCache(id);
  });

  assert.equal(await resolveSessionIdByPath(filePath), id);
});

test("readSessionWindow returns the newest messages and pages backward", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-window-"));
  const filePath = join(agentDir, "chat.jsonl");
  const entries = [{ type: "session", version: 3, id: "win", timestamp: "2026-01-01T00:00:00.000Z", cwd: agentDir }];
  let parent = null;
  for (let i = 1; i <= 12; i++) {
    const id = `u${i}`;
    entries.push(userEntry(id, parent, `msg ${i}`));
    parent = id;
  }
  writeJsonl(filePath, entries);

  const first = readSessionWindow(filePath, { limit: 4 });
  assert.deepEqual(first.context.entryIds, ["u9", "u10", "u11", "u12"]);
  assert.deepEqual(first.context.messages.map((message) => message.content), ["msg 9", "msg 10", "msg 11", "msg 12"]);
  assert.equal(first.hasMore, true);
  assert.equal(first.leafId, "u12");

  const older = readSessionWindow(filePath, { limit: 4, before: "u9" });
  assert.deepEqual(older.context.entryIds, ["u5", "u6", "u7", "u8"]);
  assert.equal(older.hasMore, true);

  const oldest = readSessionWindow(filePath, { limit: 8, before: "u5" });
  assert.deepEqual(oldest.context.entryIds, ["u1", "u2", "u3", "u4"]);
  assert.equal(oldest.hasMore, false);
});

test("readSessionWindow follows the leaf path instead of file order", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-window-branch-"));
  const filePath = join(agentDir, "chat.jsonl");
  writeJsonl(filePath, [
    { type: "session", version: 3, id: "br", timestamp: "2026-01-01T00:00:00.000Z", cwd: agentDir },
    userEntry("u1", null, "root"),
    assistantEntry("a1", "u1", "root answer"),
    userEntry("side", "a1", "side branch"),
    userEntry("main", "a1", "main branch"),
  ]);

  const window = readSessionWindow(filePath, { limit: 10 });
  assert.deepEqual(window.context.entryIds, ["u1", "a1", "main"]);
  assert.equal(window.hasMore, false);

  const side = readSessionWindow(filePath, { limit: 10, leafId: "side" });
  assert.deepEqual(side.context.entryIds, ["u1", "a1", "side"]);
});

test("readSessionWindow keeps compaction summaries when paging recent messages", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-window-cmp-"));
  const filePath = join(agentDir, "chat.jsonl");
  writeJsonl(filePath, [
    { type: "session", version: 3, id: "cmp", timestamp: "2026-01-01T00:00:00.000Z", cwd: agentDir },
    userEntry("u1", null, "old user request"),
    assistantEntry("a1", "u1", "old assistant answer"),
    userEntry("u2", "a1", "kept user request"),
    {
      type: "compaction",
      id: "cmp",
      parentId: "u2",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "old exchange summary",
      firstKeptEntryId: "u2",
      tokensBefore: 123,
    },
    userEntry("u3", "cmp", "after compaction"),
  ]);

  const window = readSessionWindow(filePath, { limit: 10 });
  assert.deepEqual(window.context.entryIds, ["cmp", "u2", "u3"]);
  assert.equal(window.hasMore, false);
});

test("readSessionWindow can skip a huge prefix by reading the tail", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-window-tail-"));
  const filePath = join(agentDir, "chat.jsonl");
  const entries = [{ type: "session", version: 3, id: "tail", timestamp: "2026-01-01T00:00:00.000Z", cwd: agentDir }];
  entries.push(userEntry("huge", null, "H".repeat(600_000)));
  let parent = "huge";
  for (let i = 1; i <= 8; i++) {
    const id = `u${i}`;
    entries.push(userEntry(id, parent, `msg ${i}`));
    parent = id;
  }
  writeJsonl(filePath, entries);

  const window = readSessionWindow(filePath, { limit: 4 });
  assert.deepEqual(window.context.entryIds, ["u5", "u6", "u7", "u8"]);
  assert.equal(window.context.messages.some((message) => String(message.content).startsWith("HH")), false);
  assert.equal(window.hasMore, true);
});

test("large jsonl files leave messageCount unknown instead of 0", (t) => {
  const agentDir = withAgentDir(t);
  const filePath = join(agentDir, "sessions", "2026-01-01T00-00-00-000Z_big.jsonl");
  writeJsonl(filePath, [
    { type: "session", version: 3, id: "big", timestamp: "2026-01-01T00:00:00.000Z", cwd: agentDir },
    userEntry("u1", null, "hello"),
    userEntry("pad", "u1", "H".repeat(1_200_000)),
  ]);
  const info = readCachedSessionInfo(filePath);
  assert.equal(info?.messageCount, null);
});

test("small jsonl files still report a real zero messageCount", (t) => {
  const agentDir = withAgentDir(t);
  const filePath = join(agentDir, "sessions", "2026-01-01T00-00-00-000Z_empty.jsonl");
  writeJsonl(filePath, [
    { type: "session", version: 3, id: "empty", timestamp: "2026-01-01T00:00:00.000Z", cwd: agentDir },
  ]);
  const info = readCachedSessionInfo(filePath);
  assert.equal(info?.messageCount, 0);
});

test("readSessionWindow stops expanding once the byte cap is hit", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-window-cap-"));
  const filePath = join(agentDir, "chat.jsonl");
  writeJsonl(filePath, [
    { type: "session", version: 3, id: "cap", timestamp: "2026-01-01T00:00:00.000Z", cwd: agentDir },
    userEntry("u1", null, "kept user request"),
    userEntry("huge", "u1", "H".repeat(3_000_000)),
    {
      type: "compaction",
      id: "cmp",
      parentId: "huge",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "old exchange summary",
      firstKeptEntryId: "u1",
      tokensBefore: 123,
    },
    userEntry("u2", "cmp", "after compaction"),
  ]);
  const window = readSessionWindow(filePath, { limit: 10 });
  assert.ok(window.context.entryIds.includes("u2"));
  assert.equal(window.context.entryIds.includes("u1"), false);
  assert.equal(window.hasMore, true);
});

test("readSessionWindow prepends earlier bytes to reach a distant firstKept entry", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-window-expand-"));
  const filePath = join(agentDir, "chat.jsonl");
  writeJsonl(filePath, [
    { type: "session", version: 3, id: "exp", timestamp: "2026-01-01T00:00:00.000Z", cwd: agentDir },
    userEntry("u1", null, "kept user request"),
    userEntry("huge", "u1", "H".repeat(700_000)),
    {
      type: "compaction",
      id: "cmp",
      parentId: "huge",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "old exchange summary",
      firstKeptEntryId: "u1",
      tokensBefore: 123,
    },
    userEntry("u2", "cmp", "after compaction"),
  ]);
  const window = readSessionWindow(filePath, { limit: 10 });
  assert.equal(window.context.entryIds[0], "cmp");
  assert.ok(window.context.entryIds.includes("u1"));
  assert.ok(window.context.entryIds.includes("u2"));
  assert.equal(window.hasMore, false);
});

test("findSessionEntry reads the tail first then earlier prefixes", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-find-entry-"));
  const filePath = join(agentDir, "chat.jsonl");
  writeJsonl(filePath, [
    { type: "session", version: 3, id: "find", timestamp: "2026-01-01T00:00:00.000Z", cwd: agentDir },
    userEntry("early", null, "early message"),
    userEntry("huge", "early", "H".repeat(700_000)),
    userEntry("late", "huge", "late message"),
  ]);
  assert.equal(findSessionEntry(filePath, "late")?.id, "late");
  assert.equal(findSessionEntry(filePath, "early")?.id, "early");
  assert.equal(findSessionEntry(filePath, "missing"), undefined);
});
