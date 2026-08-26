import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { GIT_CHANGES_LIST_LIMIT, buildGitChangeRows, gitStatusLabelKey, sortGitChangeFiles } =
  await jiti.import("./git-changes-ui.ts");

function file(status, filePath, code = status[0].toUpperCase()) {
  return {
    filePath,
    status,
    code: status === "untracked" ? "U" : status === "conflict" ? "C" : code,
    indexStatus: status === "untracked" ? "?" : " ",
    worktreeStatus: status === "untracked" ? "?" : "M",
  };
}

test("sorts conflicts first, then edits, additions, deletions, and untracked", () => {
  const cwd = "/repo";
  const sorted = sortGitChangeFiles([
    file("untracked", "/repo/z.txt"),
    file("deleted", "/repo/gone.ts"),
    file("added", "/repo/new.ts"),
    file("renamed", "/repo/renamed.ts", "R"),
    file("modified", "/repo/b.ts"),
    file("modified", "/repo/a.ts"),
    file("conflict", "/repo/conflict.ts"),
  ], cwd);

  assert.deepEqual(sorted.map((entry) => `${entry.status}:${entry.filePath}`), [
    "conflict:/repo/conflict.ts",
    "modified:/repo/a.ts",
    "modified:/repo/b.ts",
    "renamed:/repo/renamed.ts",
    "added:/repo/new.ts",
    "deleted:/repo/gone.ts",
    "untracked:/repo/z.txt",
  ]);
});

test("builds relative rows and caps the visible list at 200", () => {
  const cwd = "/repo/app";
  const files = [
    file("modified", "/repo/app/src/index.ts"),
    ...Array.from({ length: GIT_CHANGES_LIST_LIMIT }, (_, index) => (
      file("untracked", `/repo/app/tmp/file-${String(index).padStart(3, "0")}.txt`)
    )),
  ];

  const { rows, omitted } = buildGitChangeRows(files, cwd);
  assert.equal(rows.length, GIT_CHANGES_LIST_LIMIT);
  assert.equal(omitted, 1);
  assert.equal(rows[0].relativePath, "src/index.ts");
  assert.equal(rows[0].fileName, "index.ts");
  assert.equal(rows[0].directory, "src");
  assert.equal(rows[0].letter, "M");
  assert.equal(rows[0].labelKey, "files.modified");
  assert.equal(gitStatusLabelKey("untracked"), "files.untracked");
});
