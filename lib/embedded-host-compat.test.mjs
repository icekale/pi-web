import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  MAGIC_CONTEXT_ACTIVE_LATCH,
  MAGIC_CONTEXT_CHILD_INIT_CONTEXT,
  MAGIC_CONTEXT_HOST_ADAPTER,
  createEmbeddedHostCompatExtension,
  getHostAdapterRegistry,
  getPiChildInitContext,
  installEmbeddedHostCompat,
  uninstallEmbeddedHostCompat,
} = await jiti.import("./embedded-host-compat.ts");
const { resolvePiCliPath } = await jiti.import("./pi-cli.ts");

test("old Magic Context latch becomes ALS-scoped instead of process-global", () => {
  installEmbeddedHostCompat();

  assert.equal(globalThis[MAGIC_CONTEXT_ACTIVE_LATCH] === true, false);
  globalThis[MAGIC_CONTEXT_ACTIVE_LATCH] = true;
  assert.equal(globalThis[MAGIC_CONTEXT_ACTIVE_LATCH] === true, false);

  const context = getPiChildInitContext();
  assert.equal(context, globalThis[MAGIC_CONTEXT_CHILD_INIT_CONTEXT]);
  context.run(true, () => {
    assert.equal(globalThis[MAGIC_CONTEXT_ACTIVE_LATCH] === true, true);
  });
  assert.equal(globalThis[MAGIC_CONTEXT_ACTIVE_LATCH] === true, false);
});

test("independent sessions can both initialize after the first marks the old latch", () => {
  installEmbeddedHostCompat();

  const sessionInits = [];
  const simulateFactory = (label) => {
    if (globalThis[MAGIC_CONTEXT_ACTIVE_LATCH] === true) {
      sessionInits.push(`${label}:skip`);
      return;
    }
    globalThis[MAGIC_CONTEXT_ACTIVE_LATCH] = true;
    sessionInits.push(`${label}:init`);
  };

  simulateFactory("session-a");
  simulateFactory("session-b");
  getPiChildInitContext().run(true, () => simulateFactory("in-process-child"));

  assert.deepEqual(sessionInits, [
    "session-a:init",
    "session-b:init",
    "in-process-child:skip",
  ]);
});

test("hidden extension records a per-session host adapter and child markers", () => {
  const listeners = new Map();
  const pi = {
    events: {
      on(channel, handler) {
        listeners.set(channel, handler);
        return () => listeners.delete(channel);
      },
    },
    on(event, handler) {
      listeners.set(event, handler);
    },
  };
  const extension = createEmbeddedHostCompatExtension({ cwd: "/repo/project" });
  extension.factory(pi);

  const adapter = globalThis[MAGIC_CONTEXT_HOST_ADAPTER];
  assert.equal(adapter.id, "pi-web");
  assert.equal(adapter.mode, "embedded-multi-session");
  assert.equal(adapter.getRuntimeKey(pi), pi);
  assert.equal(adapter.resolveSessionCwd({}), "/repo/project");
  assert.equal(adapter.resolveSessionCwd({ cwd: "/repo/worktree" }), "/repo/worktree");
  assert.equal(getHostAdapterRegistry().get(pi), adapter);
  assert.equal(process.env.MAGIC_CONTEXT_PI_HOST_MODE, "embedded-multi-session");

  listeners.get("subagents:child:session-created")();
  assert.equal(globalThis[MAGIC_CONTEXT_ACTIVE_LATCH] === true, true);
  listeners.get("subagents:child:disposed")();
  assert.equal(globalThis[MAGIC_CONTEXT_ACTIVE_LATCH] === true, false);

  listeners.get("session_shutdown")();
  assert.equal(getHostAdapterRegistry().has(pi), false);
});

test("install patches child_process so host argv[1] is not reused as a Pi CLI", (t) => {
  uninstallEmbeddedHostCompat();
  const require = createRequire(import.meta.url);
  const childProcess = require("child_process");
  installEmbeddedHostCompat();

  const calls = [];
  const original = globalThis.__piEmbeddedHostCompat.originals.spawn;
  globalThis.__piEmbeddedHostCompat.originals.spawn = (...args) => {
    calls.push(args);
    return { pid: 0 };
  };

  const previousArgv1 = process.argv[1];
  process.argv[1] = "/tmp/vite-node.mjs";
  t.after(() => {
    process.argv[1] = previousArgv1;
    const state = globalThis.__piEmbeddedHostCompat;
    if (state?.originals) state.originals.spawn = original;
    uninstallEmbeddedHostCompat();
  });

  childProcess.spawn(process.execPath, ["/tmp/vite-node.mjs", "--print", "--no-session"]);
  assert.deepEqual(calls[0][1][0], resolvePiCliPath());
  assert.deepEqual(calls[0][1].slice(1), ["--print", "--no-session"]);
});
