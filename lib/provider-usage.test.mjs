import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { test } from "node:test";

const jiti = createJiti(import.meta.url, { moduleCache: false });

test("percentUsed and formatUsageReset stay bounded", async () => {
  const { percentUsed, formatUsageReset } = await jiti.import(
    new URL("./provider-usage-format.ts", import.meta.url).pathname,
  );

  assert.equal(percentUsed({ used: 25, limit: 100, remaining: 75, resetAt: null }), 25);
  assert.equal(percentUsed({ used: 10, limit: null, remaining: null, resetAt: null }), null);
  const now = 1_700_000_000_000;
  assert.equal(formatUsageReset(now + 5 * 60_000, now), "5m");
  assert.equal(formatUsageReset(now, now), null);
});

test("getProviderUsage rejects unsupported providers", async () => {
  const { getProviderUsage, ProviderUsageError } = await jiti.import(
    new URL("./provider-usage.ts", import.meta.url).pathname,
  );
  await assert.rejects(
    () => getProviderUsage({ getAuth: async () => null }, "commandcode"),
    (error) => error instanceof ProviderUsageError && error.status === 404,
  );
});

test("getProviderUsage maps Anthropic oauth windows", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    plan: "Max",
    five_hour: { utilization: 12, resets_at: 1_700_000_000 },
    seven_day: { utilization: 40, resets_at: 1_700_100_000 },
  }), { status: 200 });
  try {
    const { getProviderUsage } = await jiti.import(
      new URL("./provider-usage.ts", import.meta.url).pathname,
    );
    const usage = await getProviderUsage({
      getAuth: async () => ({ source: "OAuth", auth: { apiKey: "token" } }),
    }, "anthropic");
    assert.equal(usage.provider, "anthropic");
    assert.equal(usage.plan, "Max");
    assert.equal(usage.windows.five_hour.used, 12);
    assert.equal(usage.windows.seven_day.used, 40);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
