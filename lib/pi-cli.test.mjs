import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  isPiCliScript,
  looksLikePiChildArgs,
  resolvePiCliPath,
  resolvePiInvocation,
  rewriteEmbeddedHostPiInvocation,
} = await jiti.import("./pi-cli.ts");

test("identifies packaged Pi CLI scripts and rejects embedded host entries", () => {
  assert.equal(
    isPiCliScript("/app/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
    true,
  );
  assert.equal(
    isPiCliScript(String.raw`C:\app\node_modules\@earendil-works\pi-coding-agent\dist\cli.js`),
    true,
  );
  assert.equal(isPiCliScript("/app/node_modules/.bin/vite.js"), false);
  assert.equal(isPiCliScript("/workspace/bin/pi-web.js"), false);
  assert.equal(isPiCliScript(undefined), false);
});

test("detects Pi child flags used by historian and dreamer spawns", () => {
  assert.equal(looksLikePiChildArgs(["--print", "--mode", "json", "--no-session"]), true);
  assert.equal(looksLikePiChildArgs(["--export", "in.jsonl", "out.html"]), true);
  assert.equal(looksLikePiChildArgs(["--host", "127.0.0.1", "--port", "30141"]), false);
});

test("resolves the bundled Pi CLI from this install", () => {
  const cliPath = resolvePiCliPath();
  assert.ok(cliPath);
  assert.equal(existsSync(cliPath), true);
  assert.equal(isPiCliScript(cliPath), true);

  const invocation = resolvePiInvocation();
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.prefixArgs, [cliPath]);
});

test("rewrites embedded-host argv[1] into the real Pi CLI", () => {
  const cliPath = resolvePiCliPath();
  const hostScript = "/tmp/vite-node.mjs";
  const rewritten = rewriteEmbeddedHostPiInvocation(
    process.execPath,
    [hostScript, "--print", "--mode", "json", "--no-session"],
    hostScript,
  );

  assert.equal(rewritten.rewritten, true);
  assert.deepEqual(rewritten.args, [cliPath, "--print", "--mode", "json", "--no-session"]);
});

test("does not rewrite an already-correct Pi CLI spawn", () => {
  const cliPath = resolvePiCliPath();
  const result = rewriteEmbeddedHostPiInvocation(
    process.execPath,
    [cliPath, "--print", "--no-session"],
    "/tmp/vite-node.mjs",
  );
  assert.equal(result.rewritten, false);
});

test("does not rewrite unrelated host children", () => {
  const hostScript = "/tmp/vite-node.mjs";
  const result = rewriteEmbeddedHostPiInvocation(
    process.execPath,
    [hostScript, "--host", "127.0.0.1"],
    hostScript,
  );
  assert.equal(result.rewritten, false);
});
