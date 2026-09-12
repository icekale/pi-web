import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const loadSessionSource = source.slice(
  source.indexOf("const loadSession = useCallback"),
  source.indexOf("const loadContext = useCallback"),
);
const switchSource = source.slice(
  source.indexOf("const handleModelChange = useCallback"),
  source.indexOf("const handleCompact = useCallback"),
);
const thinkingSource = source.slice(
  source.indexOf("const applyDesiredThinkingLevel ="),
  source.indexOf("const handleModelChange = useCallback"),
);

test("existing-session model changes are optimistic and serialized", () => {
  const optimisticIndex = switchSource.indexOf("setCurrentModelOverride(target)");
  const requestIndex = switchSource.indexOf("await sendAgentCommand", optimisticIndex);

  assert.match(switchSource, /if \(!sid \|\| modelSwitchPendingRef\.current\) return/);
  assert.ok(optimisticIndex >= 0);
  assert.ok(requestIndex > optimisticIndex);
  assert.match(switchSource, /setModelSwitching\(true\)/);
  assert.match(switchSource, /setModelSwitching\(false\)/);
});

test("session reloads cannot clear an in-flight optimistic model", () => {
  assert.match(
    loadSessionSource,
    /setCurrentModelOverride\(\(current\) => modelSwitchPendingRef\.current \? current : null\)/,
  );
});

test("a completed model switch applies server thinking without reloading the session", () => {
  // The switch hands the server's clamped level to the shared helper, which applies
  // the pin rule and only then falls back to the server level.
  assert.match(switchSource, /await applyDesiredThinkingLevel\(sid, provider, modelId, result\.thinkingLevel\)/);
  assert.match(thinkingSource, /if \(serverLevel !== undefined\) setThinkingLevel\(serverLevel\)/);
  assert.doesNotMatch(switchSource, /modelSwitchPendingRef\.current = false;\s*await loadSession\(sid\)/);
  assert.match(switchSource, /setCurrentModelOverride\(previousOverride\)/);
  assert.match(switchSource, /Failed to switch model:/);
  assert.match(switchSource, /await loadSession\(sid\)/);
});

test("session reload applies thinking level including off", () => {
  assert.match(
    loadSessionSource,
    /if \(d\.context\.thinkingLevel\) \{\s*setThinkingLevel\(d\.context\.thinkingLevel as ThinkingLevelOption\);/,
  );
  assert.doesNotMatch(loadSessionSource, /thinkingLevel !== "off"/);
});

test("thinking changes adopt the clamped server level", () => {
  const thinkingSource = source.slice(
    source.indexOf("const handleThinkingLevelChange = useCallback"),
    source.indexOf("const handleToolPresetChange = useCallback"),
  );
  assert.match(thinkingSource, /if \(result\?\.level !== undefined\) setThinkingLevel\(result\.level\)/);
});
