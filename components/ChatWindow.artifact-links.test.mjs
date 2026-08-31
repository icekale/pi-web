import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");


test("passes the session id to streaming artifact renderers", () => {
  const start = source.indexOf("{streamState.isStreaming && hasStreamingContent");
  const end = source.indexOf("{agentRunning && agentPhase", start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(
    block,
    /onOpenFile=\{onOpenFile\}\s+sessionId=\{session\?\.id \?\? sessionIdRef\.current \?\? undefined\}/,
  );
});
