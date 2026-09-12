import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { createSubagentHandlers } = await jiti.import("./route.ts");

function session(id, name, parentSessionId, overrides = {}) {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    cwd: "/tmp",
    name,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: `first ${id}`,
    ...(parentSessionId ? { parentSessionId } : {}),
    ...overrides,
  };
}

function sessionsFixture() {
  return [
    session("root", "Main task"),
    session("child", "subagent-worker-317e1ca0-1", "root"),
    session("grand", "subagent-reviewer-76fa6d64-6031-4824-8a88-1282c22d9afa-2", "child"),
  ];
}

/**
 * Fake route deps backed by the built-in in-process runtime: liveness is a set of
 * child session ids and controls are recorded calls.
 */
function makeDeps({
  live = true,
  startFails = false,
  noFile = false,
  running = [],
  list = sessionsFixture(),
  runs = new Map(),
  controlError = null,
} = {}) {
  const runningIds = new Set(running);
  const calls = { started: [], steer: [], abort: [] };
  let alive = live;
  const wrapper = {
    isAlive: () => alive,
    isRunning: () => alive,
    setLiveSubagentSessionIds: () => false,
  };
  return {
    listSessions: async () => list,
    getWrapper: () => (alive ? wrapper : undefined),
    startWrapper: async (id, filePath) => {
      if (startFails) throw new Error("startup failed");
      calls.started.push({ id, filePath });
      alive = true;
      return { session: wrapper };
    },
    resolveSessionPath: async () => (noFile ? null : "/tmp/root.jsonl"),
    isChildRunning: (id) => alive && runningIds.has(id),
    getSubagentRun: async (id) => runs.get(id) ?? null,    steerSubagent: async (id, message) => {
      calls.steer.push({ id, message });
      if (controlError) throw controlError;
    },
    abortSubagent: async (id) => {
      calls.abort.push({ id });
      if (controlError) throw controlError;
    },
    calls,
    kill: () => {
      alive = false;
    },
  };
}

function json(response) {
  return response.json();
}

function get(id, deps) {
  const { GET } = createSubagentHandlers(deps);
  return GET(new Request("http://x/"), { params: Promise.resolve({ id }) });
}

function post(body, deps) {
  const { POST } = createSubagentHandlers(deps);
  return POST(
    new Request("http://x/", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "root" }) },
  );
}

test("GET unknown root returns 404", async () => {
  const response = await get("missing", makeDeps());
  assert.equal(response.status, 404);
});

test("GET a child id used as root returns 400", async () => {
  const response = await get("child", makeDeps());
  assert.equal(response.status, 400);
});

test("GET root without a session file returns durable tree with offline reason", async () => {
  const response = await get("root", makeDeps({ live: false, noFile: true }));
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.rpcAvailable, false);
  assert.equal(body.unavailableReason, "offline");
  assert.equal(body.nodes.length, 1);
  assert.equal(body.nodes[0].sessionId, "child");
  assert.equal(body.nodes[0].state, "inactive");
  assert.equal(body.nodes[0].children.length, 1);
});

test("GET starts an absent root wrapper without a prompt", async () => {
  const deps = makeDeps({ live: false });
  const response = await get("root", deps);
  assert.equal(response.status, 200);
  assert.deepEqual(deps.calls.started, [{ id: "root", filePath: "/tmp/root.jsonl" }]);
  assert.equal((await json(response)).rpcAvailable, true);
});

test("GET startup failure returns durable tree with offline reason", async () => {
  const response = await get("root", makeDeps({ live: false, startFails: true }));
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.rpcAvailable, false);
  assert.equal(body.unavailableReason, "offline");
  assert.equal(body.nodes[0].sessionId, "child");
});

test("GET reuses a live root wrapper without starting a new one", async () => {
  const deps = makeDeps();
  const response = await get("root", deps);
  assert.equal(response.status, 200);
  assert.equal(deps.calls.started.length, 0);
  assert.equal((await json(response)).rpcAvailable, true);
});

test("GET reports a running child as live with the nested contract", async () => {
  const runs = new Map([
    ["child", { profile: "worker", description: "Do the thing", createdAt: "2026-01-01T00:00:01.000Z" }],
    ["grand", { profile: "reviewer", description: "Review it" }],
  ]);
  const response = await get("root", makeDeps({ running: ["child", "grand"], runs }));
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.rpcAvailable, true);
  assert.equal(body.nodes.length, 1);

  const child = body.nodes.find((node) => node.sessionId === "child");
  assert.equal(child.state, "running");
  assert.equal(child.agent, "worker");
  assert.equal(child.task, "Do the thing");
  assert.equal(child.canInterrupt, true);
  assert.equal(child.children.length, 1);
  assert.equal(child.children[0].sessionId, "grand");
  assert.equal(child.children[0].state, "running");
  assert.equal(child.children[0].agent, "reviewer");
  assert.ok(body.polledAt > 0);
});

test("GET keeps finished children inactive when their runtime is gone", async () => {
  // Session names still carry the subagent shape, but no wrapper is running.
  const response = await get("root", makeDeps({ running: [] }));
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.nodes[0].state, "inactive");
  assert.equal(body.nodes[0].canInterrupt, false);
  assert.equal(body.nodes[0].children[0].state, "inactive");
});

test("GET lists sessions through the dep so durable nodes are found", async () => {
  const calls = [];
  const deps = makeDeps();
  deps.listSessions = async () => {
    calls.push("list");
    return sessionsFixture();
  };
  await get("root", deps);
  assert.deepEqual(calls, ["list"]);
});

test("POST rejects unsupported actions and blank messages", async () => {
  const deps = makeDeps();

  let response = await post({ childSessionId: "child", action: "stop" }, deps);
  assert.equal(response.status, 400);

  response = await post({ childSessionId: "child", action: "steer" }, deps);
  assert.equal(response.status, 400);

  response = await post({ childSessionId: "child", action: "resume", message: "   " }, deps);
  assert.equal(response.status, 400);

  response = await post({ childSessionId: "child", action: "interrupt", message: "nope" }, deps);
  assert.equal(response.status, 400);

  response = await post({ action: "interrupt" }, deps);
  assert.equal(response.status, 400);

  assert.deepEqual(deps.calls.steer, []);
  assert.deepEqual(deps.calls.abort, []);
});

test("POST rejects foreign, orphan, and placeholder child ids", async () => {
  const list = [
    session("root", "Main task"),
    session("other-root", "Other task"),
    session("foreign", "subagent-worker-33333333-0", "other-root"),
    session("orphan", "subagent-worker-44444444-1"),
  ];
  const deps = makeDeps({ list });

  let response = await post({ childSessionId: "foreign", action: "interrupt" }, deps);
  assert.equal(response.status, 400);

  response = await post({ childSessionId: "orphan", action: "interrupt" }, deps);
  assert.equal(response.status, 400);

  response = await post({ childSessionId: "root", action: "interrupt" }, deps);
  assert.equal(response.status, 400);

  assert.deepEqual(deps.calls.abort, []);
});

test("POST steers the resolved child and ignores browser target fields", async () => {
  const deps = makeDeps();
  const response = await post(
    { childSessionId: "child", action: "steer", message: "keep going", runId: "evil", index: 99, asyncDir: "/tmp/evil" },
    deps,
  );
  assert.equal(response.status, 200);
  // The child session id is the run identity; browser-supplied fields are dropped.
  assert.deepEqual(deps.calls.steer, [{ id: "child", message: "keep going" }]);
  assert.deepEqual(deps.calls.abort, []);
});

test("POST interrupt aborts the resolved child", async () => {
  const deps = makeDeps();
  const response = await post({ childSessionId: "grand", action: "interrupt" }, deps);
  assert.equal(response.status, 200);
  assert.deepEqual(deps.calls.abort, [{ id: "grand" }]);
  assert.deepEqual(deps.calls.steer, []);
});

test("POST starts the root wrapper before a control runs", async () => {
  const deps = makeDeps({ live: false });
  const response = await post({ childSessionId: "child", action: "steer", message: "go on" }, deps);
  assert.equal(response.status, 200);
  assert.deepEqual(deps.calls.started, [{ id: "root", filePath: "/tmp/root.jsonl" }]);
});

test("POST offline root returns 409", async () => {
  const deps = makeDeps({ live: false, noFile: true });
  const response = await post({ childSessionId: "child", action: "interrupt" }, deps);
  assert.equal(response.status, 409);
  assert.deepEqual(deps.calls.abort, []);
});

test("POST maps runtime control failures to 409", async () => {
  for (const message of ["subagent is not running", "Subagent not found"]) {
    const deps = makeDeps({ controlError: new Error(message) });
    const response = await post({ childSessionId: "child", action: "interrupt" }, deps);
    assert.equal(response.status, 409);
    assert.equal((await json(response)).error, message);
  }
});

test("POST resume is rejected because only the parent Agent tool can restart a child", async () => {
  const deps = makeDeps();
  const response = await post({ childSessionId: "child", action: "resume", message: "go on" }, deps);
  assert.equal(response.status, 400);
  assert.match((await json(response)).error, /not supported/);
  assert.deepEqual(deps.calls.steer, []);
});

test("POST success returns the acknowledgement and a fresh tree", async () => {
  const deps = makeDeps();
  const response = await post({ childSessionId: "child", action: "interrupt" }, deps);
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.success, true);
  assert.equal(body.data.action, "interrupt");
  assert.equal(body.data.childSessionId, "child");
  assert.equal(body.data.control, undefined);
  assert.equal(body.data.tree.rootSessionId, "root");
  assert.equal(body.data.tree.nodes[0].sessionId, "child");
  assert.equal(body.data.tree.nodes[0].state, "inactive");
});

test("POST success returns only the public DTO and never internal run paths", async () => {
  const deps = makeDeps();
  const response = await post({ childSessionId: "child", action: "interrupt" }, deps);
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.success, true);
  assert.doesNotMatch(
    JSON.stringify(body),
    /asyncDir|sessionFile|transcriptPath|capabilityToken|controlInbox|intercomTarget/,
  );
});

test("POST reflects the changed liveness in the returned tree", async () => {
  const deps = makeDeps({ running: ["child"] });
  const before = await json(await get("root", deps));
  assert.equal(before.nodes[0].state, "running");

  // The control succeeds and the child is no longer running.
  deps.isChildRunning = () => false;
  const body = await json(await post({ childSessionId: "child", action: "interrupt" }, deps));
  assert.equal(body.success, true);
  assert.equal(body.data.action, "interrupt");
  assert.equal(body.data.childSessionId, "child");
  assert.equal(body.data.tree.nodes[0].sessionId, "child");
  assert.equal(body.data.tree.nodes[0].state, "inactive");
  assert.equal(body.data.control, undefined);
});

test("POST never exposes spawn, stop, retry, or bulk actions", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /"spawn"/);
  assert.doesNotMatch(source, /"stop"/);
  assert.doesNotMatch(source, /"retry"/);
  assert.match(source, /action !== "steer" && action !== "interrupt" && action !== "resume"/);
});
