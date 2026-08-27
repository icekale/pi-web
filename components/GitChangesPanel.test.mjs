import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("./GitChangesPanel.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./CodexSidebar.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const en = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zh = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

test("opens file tabs in diff mode and hides when git status is unavailable", () => {
  assert.match(panel, /if \(!visible \|\| !cwd \|\| !status\) return null;/);
  assert.match(panel, /onOpenFile\?\.\(row\.file\.filePath, row\.fileName, \{ modeHint: "diff" \}\)/);
  assert.match(panel, /files\.changeStats/);
  assert.match(panel, /sidebar\.refreshChanges/);
  assert.match(panel, /useState\(false\)/);
  assert.doesNotMatch(panel, /setOpen\(fileCount > 0\)/);
  assert.doesNotMatch(panel, /FileExplorer/);
});

test("sidebar mounts the changes panel on selectedCwd without restoring FileExplorer", () => {
  assert.match(sidebar, /<GitChangesPanel/);
  assert.match(sidebar, /cwd=\{selectedCwd\}/);
  assert.match(sidebar, /refreshKey=\{gitRefreshKey\}/);
  assert.match(sidebar, /onOpenFile=\{onOpenFile\}/);
  assert.doesNotMatch(sidebar, /<FileExplorer/);
  assert.doesNotMatch(sidebar, /files\.explorer/);
  assert.doesNotMatch(sidebar, /saveExplorerOpen/);
});

test("AppShell reuses explorerRefreshKey and handleOpenFile for the changes panel", () => {
  assert.match(shell, /gitRefreshKey=\{explorerRefreshKey\}/);
  assert.match(shell, /onOpenFile=\{handleOpenFile\}/);
});

test("en and zh-CN include the changes-panel copy", () => {
  for (const key of ["sidebar.changes", "sidebar.refreshChanges", "sidebar.moreChangedFiles"]) {
    assert.match(en, new RegExp(`"${key}":`));
    assert.match(zh, new RegExp(`"${key}":`));
  }
});
