import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { enLocale } = await jiti.import("./en.ts");
const { zhCNLocale } = await jiti.import("./zh-CN.ts");
const { zhTWLocale } = await jiti.import("./zh-TW.ts");

test("zh-CN and zh-TW cover every English message key", () => {
  for (const key of Object.keys(enLocale.messages)) {
    assert.equal(typeof zhCNLocale.messages[key], "string", `zh-CN missing ${key}`);
    assert.equal(typeof zhTWLocale.messages[key], "string", `zh-TW missing ${key}`);
  }
});
