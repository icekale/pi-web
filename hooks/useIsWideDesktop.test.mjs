import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const source = await readFile(new URL("./useIsMobile.ts", import.meta.url), "utf8");
test("uses the 1280px SSR-safe media query", () => {
  assert.match(source, /\(min-width: 1280px\)/);
  assert.match(source, /useSyncExternalStore/);
  assert.match(source, /useIsWideDesktop/);
});
