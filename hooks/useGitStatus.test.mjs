import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { GIT_STATUS_POLL_INTERVAL_MS, shouldPollGitStatus } = await jiti.import("./useGitStatus.ts");

test("polls only while the panel is open and the tab is visible", () => {
  assert.equal(shouldPollGitStatus({ open: true, tabVisible: true }), true);
  assert.equal(shouldPollGitStatus({ open: false, tabVisible: true }), false);
  assert.equal(shouldPollGitStatus({ open: true, tabVisible: false }), false);
  assert.equal(shouldPollGitStatus({ open: false, tabVisible: false }), false);
});

test("poll interval stays in the 8-10s range and is gated by the policy", async () => {
  assert.equal(GIT_STATUS_POLL_INTERVAL_MS, 8_000);
  const source = await readFile(new URL("./useGitStatus.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!shouldPollGitStatus\(\{ open, tabVisible \}\)\) return;/);
  assert.match(source, /setInterval\(\(\) => \{\s*void refresh\(\);\s*\}, GIT_STATUS_POLL_INTERVAL_MS\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
  assert.match(source, /if \(visible\) void refresh\(\)/);
});

test("hides 400/403/404 and non-git payloads without treating them as errors", async () => {
  const source = await readFile(new URL("./useGitStatus.ts", import.meta.url), "utf8");
  assert.match(source, /status === 400 \|\| status === 403 \|\| status === 404/);
  assert.match(source, /setStatus\(isGitStatusResponse\(body\) && body\.isGitRepository \? body : null\)/);
  assert.match(source, /if \(!response\.ok\) return;/);
  assert.doesNotMatch(source, /setError/);
});

test("aborts the previous request when cwd or refreshKey changes", async () => {
  const source = await readFile(new URL("./useGitStatus.ts", import.meta.url), "utf8");
  assert.match(source, /abortRef\.current\?\.abort\(\)/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /void refresh\(\);\s*\}, \[cwd, refreshKey, refresh\]\)/);
  assert.match(source, /setStatus\(null\);\s*\}, \[cwd\]\)/);
});
