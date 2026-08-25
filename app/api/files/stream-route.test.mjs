import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./[...path]/route.ts", import.meta.url), "utf8");

test("SVG previews send a restrictive CSP and nosniff", () => {
  assert.match(source, /X-Content-Type-Options": "nosniff"/);
  assert.match(source, /contentType === "image\/svg\+xml"/);
  assert.match(source, /default-src 'none'/);
  assert.match(source, /frame-ancestors 'self'/);
});

test("large text files return a truncated preview instead of 413", () => {
  assert.match(source, /function readTextPreview/);
  assert.match(source, /truncated: true/);
  assert.doesNotMatch(source, /File too large for preview \(>256KB\)/);
});
