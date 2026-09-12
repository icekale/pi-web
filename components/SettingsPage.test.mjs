import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./SettingsPage.tsx", import.meta.url), "utf8");
const picker = await readFile(new URL("./DirectoryPicker.tsx", import.meta.url), "utf8");
const subagents = await readFile(new URL("./SubagentsConfig.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const messagesEn = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const messagesZh = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

test("AppShell exposes one unified settings entry", () => {
  assert.match(shell, /<SettingsPage/);
  assert.equal((shell.match(/setSettingsOpen\(true\)/g) ?? []).length, 1);
  assert.doesNotMatch(shell, /<ModelsConfig|<SkillsConfig|<PluginsConfig/);
});

test("settings embeds the model, skill, plugin, and remote modules", () => {
  assert.match(settings, /<ModelsConfig onControllerChange=\{setModelsController\} \/>/);
  assert.match(settings, /<SkillsConfig cwd=\{cwd\} onControllerChange=\{setSkillsController\} \/>/);
  assert.match(settings, /onControllerChange=\{setPluginsController\}/);
  assert.match(settings, /<RemoteAccessConfig onControllerChange=\{setRemoteController\} \/>/);
  assert.match(settings, /type SettingsSection = "general" \| "remote" \| "archived" \| "models" \| "skills" \| "plugins"/);
  assert.doesNotMatch(settings, /VisionToolkit|vision-toolkit|ScanEye|section === "vision"/);
  assert.doesNotMatch(settings, /id: "project"/);
});

test("remote access follows plugins and does not require a project", () => {
  assert.match(settings, /id: "plugins"[\s\S]*id: "remote"/);
  assert.match(settings, /id: "remote", label: t\("remote\.nav"\), disabled: false/);
  assert.match(settings, /GlobeLock/);
  assert.match(settings, /section === "remote"/);
  assert.match(settings, /setRemoteController/);
});

test("settings guards every exit path behind one discard confirmation", () => {
  assert.match(settings, /const requestCloseOrNavigate = useCallback\(/);
  assert.match(settings, /if \(modelsController\?\.dirty \|\| remoteController\?\.dirty\)/);
  assert.match(settings, /setPendingExit\(\(\) => action\)/);
  assert.match(settings, /setDiscardDialogOpen\(true\)/);
  assert.match(settings, /onClick=\{\(\) => requestCloseOrNavigate\(close\)\}/);
  assert.match(settings, /onMouseDown=\{\(event\) => \{ if \(event\.target === event\.currentTarget\) requestCloseOrNavigate\(close\); \}\}/);
  assert.match(settings, /<DialogShell[\s\S]*?size="confirm"/);
  assert.match(settings, /t\("models\.unsavedChanges"\)/);
  assert.match(settings, /t\("models\.keepEditing"\)/);
  assert.match(settings, /t\("models\.discard"\)/);
});

test("Escape consumes Models layers before closing Settings", () => {
  assert.match(settings, /if \(activeController\?\.handleBack\(\)\) return;/);
  assert.match(settings, /if \(discardDialogOpen\) return;/);
});

test("Settings focuses the close button only on mount, not when the models draft becomes dirty", () => {
  assert.match(settings, /closeButtonRef\.current\?\.focus\(\);\s*\}, \[\]\);/);
  assert.doesNotMatch(settings, /closeButtonRef\.current\?\.focus\(\);\s*const onKeyDown/);
});

test("settings registers one combined back handler with AppShell", () => {
  assert.match(settings, /onRegisterSettingsBack\(handleSettingsBack\)/);
  assert.match(settings, /if \(activeController\?\.handleBack\(\)\) return true;/);
  assert.match(settings, /setPendingExit\(\(\) => close\)/);
});

test("discard restores the baseline before completing the pending navigation", () => {
  assert.match(settings, /modelsController\?\.discard\(\);/);
  assert.match(settings, /remoteController\?\.discard\(\);/);
  assert.match(settings, /setModelsController\(null\);/);
  assert.match(settings, /action\?\.\(\);/);
});

test("Settings category strip hides while a nested mobile detail is open", () => {
  assert.match(settings, /data-hidden-mobile=\{activeController\?\.mobileDetailOpen \? "true" : undefined\}/);
});

test("active Skills or Plugins controller consumes back before Settings closes", () => {
  assert.match(settings, /if \(activeController\?\.handleBack\(\)\) return/);
  assert.match(settings, /section === "skills"/);
  assert.match(settings, /setSkillsController/);
  assert.match(settings, /setPluginsController/);
});

test("settings lists archived projects and restores them through the project registry", () => {
  assert.match(settings, /fetch\("\/api\/projects", \{ cache: "no-store" \}\)/);
  assert.match(settings, /fetch\("\/api\/sessions", \{ cache: "no-store" \}\)/);
  assert.match(settings, /project\.archived && !project\.removed/);
  assert.match(settings, /archivedSessionIds\.has\(session\.id\)/);
  assert.match(settings, /method: "PATCH"/);
  assert.match(settings, /JSON\.stringify\(\{ path, update: \{ archived: false \} \}\)/);
  assert.match(settings, /disabled=\{restoringProjects\.has\(project\.path\)\}/);
  assert.match(settings, /loadProjects\(false\)/);
  assert.match(settings, /<ArchiveRestore size=\{14\}/);
  assert.match(settings, /onProjectsChanged\(\)/);
  assert.match(settings, /sidebar\.restoreSession/);
});

test("settings owns general preferences", () => {
  assert.match(settings, /useState<SettingsSection>\("general"\)/);
  assert.match(settings, /onThemeChange\(id\)/);
  assert.match(settings, /onLocaleChange\(event\.target\.value as Locale\)/);
  assert.match(settings, /role="switch" aria-checked=\{soundEnabled\}/);
  assert.match(settings, /settings\.completionSound[\s\S]*settings\.tokenSpeed/);
  assert.match(settings, /role="switch" aria-checked=\{tokenSpeedEnabled\}/);
  assert.doesNotMatch(settings, /onTrustProject/);
  assert.doesNotMatch(settings, /<svg/);
});

test("AppShell owns the token-speed preference like completion sound", () => {
  assert.match(shell, /useTokenSpeedPreference/);
  assert.match(shell, /tokenSpeedEnabled=\{tokenSpeedEnabled\}/);
  assert.match(shell, /onTokenSpeedToggle=\{onTokenSpeedToggle\}/);
});

test("directory picker creates a folder through the browse API", () => {
  assert.match(picker, /fetch\("\/api\/cwd\/browse", \{/);
  assert.match(picker, /method: "POST"/);
  assert.match(picker, /JSON\.stringify\(\{ parentPath: currentPath, name \}\)/);
  assert.match(picker, /await navigateTo\(data\.path\)/);
});

test("settings exposes the built-in subagent runtime and profiles", () => {
  assert.match(settings, /type SettingsSection = "general" \| "remote" \| "archived" \| "models" \| "skills" \| "plugins" \| "subagents"/);
  assert.match(settings, /id: "subagents", label: t\("common\.subagents"\), disabled: !cwd/);
  assert.match(settings, /section === "subagents"/);
  assert.match(settings, /<SubagentsConfig cwd=\{cwd\} sessionId=\{sessionId\} onReloaded=\{onSessionReloaded\} \/>/);
  assert.match(settings, /subagents: Bot/);
});

test("subagent settings read and write the runtime switches", () => {
  assert.match(subagents, /fetch\(`\/api\/subagents\?cwd=\$\{encodeURIComponent\(cwd\)\}`/);
  assert.match(subagents, /method: "PUT"/);
  assert.match(subagents, /role="switch"[\s\S]*?aria-checked=\{settings\?\.builtInEnabled \?\? false\}/);
  assert.match(subagents, /id="settings-subagents-max-concurrent"/);
  assert.match(subagents, /save\(\{ maxConcurrent: Number\(event\.target\.value\) \}\)/);
  // The list is a summary: system prompts must stay on the server.
  assert.doesNotMatch(subagents, /systemPrompt/);
});

test("every subagent settings label has both locales and a style", () => {
  const keys = [
    "common.subagents",
    "settings.subagentsDescription",
    "settings.subagentsBuiltIn",
    "settings.subagentsBuiltInDescription",
    "settings.subagentsMaxConcurrent",
    "settings.subagentsMaxConcurrentDescription",
    "settings.subagentsProfiles",
    "settings.subagentsProfilesDescription",
    "settings.subagentsProfilesEmpty",
    "settings.subagentsProfileDisabled",
    "settings.subagentsReloadDescription",
    "settings.subagentsScope.builtin",
    "settings.subagentsScope.global",
    "settings.subagentsScope.workspace",
    "settings.subagentsScope.project",
  ];
  for (const key of keys) {
    assert.ok(messagesEn.includes(`"${key}":`), `en missing ${key}`);
    assert.ok(messagesZh.includes(`"${key}":`), `zh-CN missing ${key}`);
  }
  const classes = [
    "settings-page-empty",
    "settings-form-page",
    "settings-form-heading",
    "settings-form-section",
    "settings-form-section-stack",
    "settings-form-label",
    "settings-switch",
    "settings-archived-list",
    "settings-archived-row",
    "settings-secondary-button",
    "settings-inline-error",
  ];
  for (const className of classes) {
    assert.match(subagents, new RegExp(`className="[^"]*${className}`), `component does not use ${className}`);
    assert.match(styles, new RegExp(`\\.${className}[\\s,{:.]`), `globals.css does not style ${className}`);
  }
});
