import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";

const agentDir = mkdtempSync(join(tmpdir(), "pi-web-subagents-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "pi-web-subagents-cwd-"));
const settingsPath = join(agentDir, "agents", "settings.json");

process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_WEB_PASSWORD;
delete process.env.PI_WEB_ALLOWED_HOSTS;
delete process.env.PI_WEB_HOSTNAME;
// Allowed roots normally come from recorded sessions; seed the short-TTL cache so
// the cwd check does not depend on which sessions exist on this machine.
globalThis.__piAllowedRootsCache = { roots: new Set([cwd]), expiresAt: Date.now() + 60_000 };

after(() => {
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  moduleCache: false,
});

function request(method, { queryCwd, body, headers = {} } = {}) {
  const url = new URL("http://127.0.0.1:30141/api/subagents");
  if (queryCwd !== undefined) url.searchParams.set("cwd", queryCwd);
  return new Request(url, {
    method,
    headers: {
      host: "127.0.0.1:30141",
      origin: "http://127.0.0.1:30141",
      "sec-fetch-site": "same-origin",
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("GET requires a cwd", async () => {
  const { GET } = await jiti.import("./route.ts");
  const response = await GET(request("GET"));
  assert.equal(response.status, 400);
});

test("GET returns settings plus a profile summary without system prompts", async () => {
  const { GET } = await jiti.import("./route.ts");
  const response = await GET(request("GET", { queryCwd: cwd }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.settings, { builtInEnabled: false, maxConcurrent: 10, maxConcurrentLimit: 32 });
  const names = body.profiles.map((profile) => profile.name);
  assert.ok(names.includes("general-purpose"), `expected general-purpose in ${names.join(", ")}`);
  assert.ok(names.includes("explore"));
  const explore = body.profiles.find((profile) => profile.name === "explore");
  assert.equal(explore.scope, "builtin");
  assert.equal(explore.enabled, true);
  assert.ok(explore.tools.length > 0);
  assert.ok(typeof explore.description === "string" && explore.description.length > 0);
  assert.ok(body.profiles.every((profile) => !("systemPrompt" in profile)));
});

test("GET rejects a cwd outside the allowed roots", async () => {
  const { GET } = await jiti.import("./route.ts");
  const outside = mkdtempSync(join(tmpdir(), "pi-web-subagents-outside-"));
  try {
    const response = await GET(request("GET", { queryCwd: outside }));
    assert.equal(response.status, 403);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("GET and PUT reject an untrusted host", async () => {
  const { GET, PUT } = await jiti.import("./route.ts");
  const untrusted = { host: "evil.example.com" };
  assert.equal((await GET(request("GET", { queryCwd: cwd, headers: untrusted }))).status, 403);
  assert.equal((await PUT(request("PUT", { body: { builtInEnabled: true }, headers: untrusted }))).status, 403);
});

test("PUT persists builtInEnabled and maxConcurrent", async () => {
  const { GET, PUT } = await jiti.import("./route.ts");
  const put = await PUT(request("PUT", { body: { builtInEnabled: true, maxConcurrent: 4 } }));
  assert.equal(put.status, 200);
  assert.deepEqual((await put.json()).settings, { builtInEnabled: true, maxConcurrent: 4, maxConcurrentLimit: 32 });

  const stored = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(stored.builtInEnabled, true);
  assert.equal(stored.maxConcurrent, 4);
  assert.equal(stored.version, 1);

  const get = await GET(request("GET", { queryCwd: cwd }));
  assert.equal((await get.json()).settings.builtInEnabled, true);

  // A partial update leaves the other field untouched.
  const disable = await PUT(request("PUT", { body: { builtInEnabled: false } }));
  assert.deepEqual((await disable.json()).settings, { builtInEnabled: false, maxConcurrent: 4, maxConcurrentLimit: 32 });
});

test("PUT validates input and writes nothing on rejection", async () => {
  const { PUT } = await jiti.import("./route.ts");
  for (const value of [0, 33, 1.5, -1, "abc", null]) {
    const response = await PUT(request("PUT", { body: { maxConcurrent: value } }));
    assert.equal(response.status, 400, `maxConcurrent ${JSON.stringify(value)}`);
  }
  assert.equal((await PUT(request("PUT", { body: { builtInEnabled: "yes" } }))).status, 400);
  assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).maxConcurrent, 4);
});

test("PUT requires a JSON content type", async () => {
  const { PUT } = await jiti.import("./route.ts");
  const response = await PUT(new Request("http://127.0.0.1:30141/api/subagents", {
    method: "PUT",
    headers: {
      host: "127.0.0.1:30141",
      origin: "http://127.0.0.1:30141",
      "sec-fetch-site": "same-origin",
      "content-type": "text/plain",
    },
    body: "builtInEnabled=true",
  }));
  assert.equal(response.status, 415);
});

test("PUT validates the whole body before writing anything", async () => {
  const { PUT } = await jiti.import("./route.ts");
  const seed = await PUT(request("PUT", { body: { builtInEnabled: false, maxConcurrent: 4 } }));
  assert.equal(seed.status, 200);
  const before = readFileSync(settingsPath, "utf8");

  for (const body of [
    { builtInEnabled: true, maxConcurrent: 0 },
    { builtInEnabled: true, maxConcurrent: 33 },
    { builtInEnabled: true, maxConcurrent: "7" },
    { maxConcurrent: true },
  ]) {
    const response = await PUT(request("PUT", { body }));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(readFileSync(settingsPath, "utf8"), before, `${JSON.stringify(body)} must not write`);
  }
});

test("PUT rejects bodies that are not JSON objects", async () => {
  const { PUT } = await jiti.import("./route.ts");
  const raw = (text) => PUT(new Request("http://127.0.0.1:30141/api/subagents", {
    method: "PUT",
    headers: {
      host: "127.0.0.1:30141",
      origin: "http://127.0.0.1:30141",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: text,
  }));

  for (const text of ["null", "5", '"yes"', "[]", "{"]) {
    const response = await raw(text);
    assert.equal(response.status, 400, text);
  }
});
