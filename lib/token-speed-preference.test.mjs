import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  TOKEN_SPEED_PREF_KEY,
  isTokenSpeedEnabled,
  setTokenSpeedEnabled,
} = await jiti.import("./token-speed-preference.ts");

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.hasOwn(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
  };
}

test("missing token-speed preference defaults to on", () => {
  assert.equal(isTokenSpeedEnabled(memoryStorage()), true);
  assert.equal(isTokenSpeedEnabled(null), true);
});

test("stored false hides token speed", () => {
  const storage = memoryStorage({ [TOKEN_SPEED_PREF_KEY]: "false" });
  assert.equal(isTokenSpeedEnabled(storage), false);
});

test("toggle writes the localStorage flag", () => {
  const storage = memoryStorage();
  setTokenSpeedEnabled(false, storage);
  assert.equal(storage.getItem(TOKEN_SPEED_PREF_KEY), "false");
  assert.equal(isTokenSpeedEnabled(storage), false);
  setTokenSpeedEnabled(true, storage);
  assert.equal(isTokenSpeedEnabled(storage), true);
});
