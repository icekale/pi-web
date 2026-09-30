import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { editModelScope } = await createJiti(import.meta.url).import("./model-scope-edit.ts");

const catalog = ["anthropic/a", "anthropic/b", "openai/c"];

test("disabling one model from an open scope writes the rest", () => {
  assert.deepEqual(
    editModelScope({
      patterns: undefined,
      catalog,
      matches: new Map(),
      disable: ["openai/c"],
    }),
    ["anthropic/a", "anthropic/b"],
  );
});

test("a glob pin expands only around the model that was turned off", () => {
  const patterns = ["anthropic/*:high", "gone/*"];
  assert.deepEqual(
    editModelScope({
      patterns,
      catalog,
      matches: new Map([
        ["anthropic/*:high", ["anthropic/a", "anthropic/b"]],
        ["gone/*", []],
      ]),
      disable: ["anthropic/b"],
    }),
    ["gone/*", "anthropic/a:high"],
  );
});

test("enabling the last missing model clears a plain explicit list", () => {
  assert.equal(
    editModelScope({
      patterns: ["anthropic/a", "anthropic/b"],
      catalog,
      matches: new Map([
        ["anthropic/a", ["anthropic/a"]],
        ["anthropic/b", ["anthropic/b"]],
      ]),
      enable: ["openai/c"],
    }),
    undefined,
  );
});

test("an explicit thinking pin stays when every model is enabled", () => {
  assert.deepEqual(
    editModelScope({
      patterns: ["anthropic/a:high", "anthropic/b", "openai/c"],
      catalog,
      matches: new Map([
        ["anthropic/a:high", ["anthropic/a"]],
        ["anthropic/b", ["anthropic/b"]],
        ["openai/c", ["openai/c"]],
      ]),
    }),
    ["anthropic/a:high", "anthropic/b", "openai/c"],
  );
});

test("dead exact patterns are dropped while unmatched globs stay", () => {
  assert.deepEqual(
    editModelScope({
      patterns: ["one2api/gpt-5.5", "anthropic/*:high", "gone/*"],
      catalog,
      matches: new Map([
        ["one2api/gpt-5.5", []],
        ["anthropic/*:high", ["anthropic/a", "anthropic/b"]],
        ["gone/*", []],
      ]),
      disable: ["anthropic/b"],
    }),
    ["gone/*", "anthropic/a:high"],
  );
});

test("the last enabled model cannot be turned off", () => {
  assert.throws(
    () => editModelScope({
      patterns: ["openai/c"],
      catalog,
      matches: new Map([["openai/c", ["openai/c"]]]),
      disable: ["openai/c"],
    }),
    /keep-one/,
  );
});
