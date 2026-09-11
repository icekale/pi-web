import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { test } from "node:test";

const jiti = createJiti(import.meta.url);

test("provider usage ids stay explicit", async () => {
  const { PROVIDER_USAGE_IDS, isProviderUsageId } = await jiti.import(
    new URL("./provider-usage-ids.ts", import.meta.url).pathname,
  );

  assert.deepEqual([...PROVIDER_USAGE_IDS], [
    "anthropic",
    "openai",
    "openai-codex",
    "github-copilot",
    "google-gemini-cli",
    "google-antigravity",
  ]);
  assert.equal(isProviderUsageId("anthropic"), true);
  assert.equal(isProviderUsageId("commandcode"), false);
});
