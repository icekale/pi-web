import assert from "node:assert/strict";
import test from "node:test";
import { parseMcpPaste, projectAuthError } from "./mcp-paste.ts";

test("paste accepts one server config, a url, or a command", () => {
  assert.deepEqual(parseMcpPaste('{"url":"https://example.com/mcp"}'), { config: { url: "https://example.com/mcp" } });
  assert.deepEqual(parseMcpPaste('{"mcpServers":{"docs":{"command":"npx","args":["-y","pkg"]}}}'), {
    config: { command: "npx", args: ["-y", "pkg"] },
  });
  assert.equal(parseMcpPaste("npx -y pkg").command, "npx -y pkg");
  assert.equal(parseMcpPaste('{"mcpServers":{"a":{},"b":{}}}').error, "paste one server");
  assert.equal(parseMcpPaste("{").error, "invalid JSON");
});

test("project config cannot choose an auth provider", () => {
  assert.equal(projectAuthError({ url: "https://example.com", auth: { provider: "anthropic" } }), "project mcp.json cannot set auth");
  assert.equal(projectAuthError({ command: "npx" }), undefined);
});
