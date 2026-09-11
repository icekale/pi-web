import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { test } from "node:test";

const jiti = createJiti(import.meta.url, { moduleCache: false });

async function loadSubject() {
  return jiti.import(new URL("./session-liveness.ts", import.meta.url).pathname);
}

test("session-liveness defaults stay in the expected range", async () => {
  const {
    getSessionLeaseTtlMs,
    getSessionLeaseHeartbeatMs,
    leaseExpiresAt,
    isSessionLeaseActive,
  } = await loadSubject();

  assert.equal(getSessionLeaseTtlMs(), 45_000);
  assert.equal(getSessionLeaseHeartbeatMs(), 15_000);
  assert.equal(leaseExpiresAt(1_000, 45_000), 46_000);
  assert.equal(isSessionLeaseActive(2_000, 1_000), true);
  assert.equal(isSessionLeaseActive(1_000, 1_000), false);
  assert.equal(isSessionLeaseActive(undefined, 1_000), false);
});
