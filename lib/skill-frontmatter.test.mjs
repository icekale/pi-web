import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { setDisableModelInvocation } = await jiti.import("./skill-frontmatter.ts");

test("adds disable-model-invocation when enabling dormancy", () => {
  const updated = setDisableModelInvocation("---\nname: demo\n---\nbody\n", true);
  assert.equal(updated, "---\ndisable-model-invocation: true\nname: demo\n---\nbody\n");
});

test("replaces an explicit false instead of writing a duplicate key", () => {
  const source = "---\nname: demo\ndisable-model-invocation: false\n---\nbody\n";
  const updated = setDisableModelInvocation(source, true);
  assert.equal(updated, "---\nname: demo\ndisable-model-invocation: true\n---\nbody\n");
  assert.equal([...updated.matchAll(/disable-model-invocation:/g)].length, 1);
});

test("removes an explicit false when turning the skill back on", () => {
  const source = "---\nname: demo\ndisable-model-invocation: false\n---\nbody\n";
  assert.equal(setDisableModelInvocation(source, false), "---\nname: demo\n---\nbody\n");
});

test("creates frontmatter when the file has none", () => {
  assert.equal(
    setDisableModelInvocation("just a skill\n", true),
    "---\ndisable-model-invocation: true\n---\njust a skill\n",
  );
});
