import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { enLocale } = await jiti.import("./en.ts");
const { zhCNLocale } = await jiti.import("./zh-CN.ts");
const { zhTWLocale } = await jiti.import("./zh-TW.ts");

test("zh-CN and zh-TW cover every English message key", () => {
  const enKeys = Object.keys(enLocale.messages).sort();
  assert.deepEqual(Object.keys(zhCNLocale.messages).sort(), enKeys);
  assert.deepEqual(Object.keys(zhTWLocale.messages).sort(), enKeys);
});
