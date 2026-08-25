# Sidebar Navigation Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar's nested Recent/Projects scrolling with one navigation scroll, default inactive projects to collapsed, and create a clear Recent/Projects hierarchy without a divider.

**Architecture:** Keep the brand, New task button, workspace icon toolbar, optional search field, worktree tools, and Settings footer in their current ownership boundaries. Add one `codex-sidebar-navigation` wrapper around only Recent and Projects; that wrapper owns vertical scrolling while both lists size naturally. Preserve the current persisted Recent disclosure and shared search behavior, then initialize project disclosure so a fresh user sees only the current project expanded.

**Tech Stack:** React 19, TypeScript, CSS flexbox, browser `localStorage`, Node test runner, Jiti, Vite/TanStack Start, Impeccable detector.

---

## Scope And Current Baseline

The working tree already contains uncommitted sidebar work that must be preserved:

- Recent renders before Projects.
- Search/add/hide actions stay above Recent.
- Project heading sits above the project list.
- Search filters both Projects and Recent sessions.
- `recentOpen` persists under `pi-web:recent-open`.
- Desktop row heights are 36px project, 34px nested session, and 38px recent session.

The current temporary rule must be replaced, not retained:

```css
.codex-sidebar-recent {
  flex: 0 1 auto;
  max-height: 42%;
  overflow: hidden;
}
.codex-sidebar-recent > [role="list"] {
  overflow: auto;
}
```

Out of scope for this pass:

- Moving the top icon toolbar.
- Changing sidebar width or typography family.
- Showing project labels on every Recent row; duplicate-title-only labels remain a later P2.
- Changing hover-only session actions; coarse-pointer hardening remains a later P2.
- Redesigning worktree tools or Settings.
- Adding dependencies or new component abstractions.

Do not stage `.output`, `.tanstack/`, or `.impeccable/` in product commits.

## File Map

- Modify: `components/CodexSidebar.tsx`
  - Wrap Recent and Projects in the shared scroll owner.
  - Initialize collapsed project state on first load.
  - Preserve toolbar, search, Recent persistence, project actions, and worktrees.
- Modify: `app/globals.css`
  - Move overflow ownership to `.codex-sidebar-navigation`.
  - Remove the 42% Recent cap and list-level scrolling.
  - Create category hierarchy with spacing and type, not borders.
  - Reduce competing selected backgrounds.
- Modify: `components/CodexSidebar.test.mjs`
  - Lock wrapper ownership, no nested scroll, default project disclosure, category spacing, and selected-state hierarchy.
- Preserve: `lib/recent-sessions.ts`
  - Keep `filterRecentSessions`; no structural changes required.
- Preserve: `lib/recent-sessions.test.mjs`
  - Keep the current Recent search coverage.

---

### Task 1: Replace The 42% Recent Cap With One Navigation Scroll

**Files:**
- Modify: `components/CodexSidebar.test.mjs:133-190`
- Modify: `components/CodexSidebar.tsx:710-880`
- Modify: `app/globals.css:1130-1180`
- Test: `components/CodexSidebar.test.mjs`
- Test: `lib/recent-sessions.test.mjs`

- [ ] **Step 1: Write the failing structure and overflow tests**

Update the existing Recent/Projects order and spacing tests to assert one wrapper owns scrolling:

```js
test("recent and projects share one navigation scroll surface", () => {
  const navigationIndex = sidebar.indexOf('className="codex-sidebar-navigation"');
  const recentIndex = sidebar.indexOf('className="codex-sidebar-section codex-sidebar-recent"');
  const projectIndex = sidebar.indexOf('className="codex-sidebar-project-list"');

  assert.ok(navigationIndex >= 0, "missing sidebar navigation scroll owner");
  assert.ok(navigationIndex < recentIndex, "navigation should wrap recent");
  assert.ok(recentIndex < projectIndex, "recent should render before projects");
  assert.match(sidebar, /className="codex-sidebar-navigation"[\s\S]*?className="codex-sidebar-project-list"[\s\S]*?<\/section>\s*<\/div>\s*\{selectedProject/);

  assert.match(styles, /\.codex-sidebar-navigation \{[\s\S]*?min-height: 0;[\s\S]*?flex: 1 1 auto;[\s\S]*?overflow-y: auto;/);
  assert.doesNotMatch(styles, /\.codex-sidebar-recent \{[^}]*max-height:/);
  assert.match(styles, /\.codex-sidebar-recent \{[^}]*overflow: visible;/);
  assert.match(styles, /\.codex-sidebar-recent > \[role="list"\] \{[^}]*overflow: visible;/);
  assert.match(styles, /\.codex-sidebar-project-list \{[^}]*overflow: visible;/);
});
```

Keep the existing assertions that Recent has no `border-bottom`, search filters Recent, and Recent disclosure persists.

- [ ] **Step 2: Run the tests and verify the new assertions fail**

Run:

```bash
cd /Users/kale/pi-web
node --test components/CodexSidebar.test.mjs lib/recent-sessions.test.mjs
```

Expected: FAIL because `codex-sidebar-navigation` does not exist and Recent still has `max-height: 42%` with its own `overflow: auto` list.

- [ ] **Step 3: Add the shared navigation wrapper without changing either section's inner markup**

Insert this opening tag immediately before the current Recent section:

```tsx
      <div className="codex-sidebar-navigation">
```

The resulting unique start sequence must be:

```tsx
      <div className="codex-sidebar-navigation">
        <section className="codex-sidebar-section codex-sidebar-recent">
```

Then replace the boundary between the Projects section and worktree tools:

```tsx
      </section>

      {selectedProject && !selectedProject.archived && !selectedProject.removed && worktrees.length > 0 && (
```

with:

```tsx
      </section>
      </div>

      {selectedProject && !selectedProject.archived && !selectedProject.removed && worktrees.length > 0 && (
```

Do not move `codex-sidebar-project-tools`, project-menu portals, dialogs, or the Settings footer into the wrapper.

- [ ] **Step 4: Transfer overflow ownership in CSS**

Replace the current section sizing rules with:

```css
.codex-sidebar-navigation {
  min-height: 0;
  flex: 1 1 auto;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.codex-sidebar-navigation > .codex-sidebar-section {
  overflow: visible;
}
.codex-sidebar-navigation > .codex-sidebar-section:not(.codex-sidebar-recent) {
  flex: none;
}
.codex-sidebar-project-list {
  min-height: 0;
  padding: 4px 8px 10px;
  overflow: visible;
}
.codex-sidebar-recent {
  min-height: 0;
  overflow: visible;
}
.codex-sidebar-recent > [role="list"] {
  min-height: 0;
  padding: 6px 8px 4px;
  overflow: visible;
}
```

Delete these obsolete declarations:

```css
.codex-sidebar-section:not(.codex-sidebar-recent) { flex: 1 1 auto; }
flex: 0 1 auto;
max-height: 42%;
flex: 1 1 auto;
overflow: auto;
```

Do not add a custom scrollbar or divider.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd /Users/kale/pi-web
node --test components/CodexSidebar.test.mjs lib/recent-sessions.test.mjs
```

Expected: all focused tests PASS; current baseline is 33 tests.

- [ ] **Step 6: Run the layout detector**

Run:

```bash
node /Users/kale/.agents/skills/impeccable/scripts/detect.mjs --json --scope layout /Users/kale/pi-web/components/CodexSidebar.tsx
```

Expected: `[]`, exit code 0.

- [ ] **Step 7: Commit the coherent sidebar baseline**

This commit intentionally includes the already-tested search/persistence work plus the replacement of the temporary 42% cap:

```bash
cd /Users/kale/pi-web
git add app/globals.css components/CodexSidebar.tsx components/CodexSidebar.test.mjs lib/recent-sessions.ts lib/recent-sessions.test.mjs docs/superpowers/plans/2026-08-25-sidebar-navigation-layout.md docs/superpowers/plans/2026-08-25-sidebar-navigation-handoff.md docs/superpowers/plans/2026-08-25-sidebar-navigation-agent-prompt.md
git commit -m "fix: unify sidebar navigation scrolling"
```

Verify `.output`, `.tanstack/`, and `.impeccable/` are not staged:

```bash
git status --short
git diff --cached --stat
```

Expected staged diff after commit: none.

---

### Task 2: Default Inactive Projects To Collapsed

**Files:**
- Modify: `components/CodexSidebar.test.mjs:145-175`
- Modify: `components/CodexSidebar.tsx:58-82, 160-190, 325-350`
- Test: `components/CodexSidebar.test.mjs`

- [ ] **Step 1: Write the failing disclosure-default test**

Add:

```js
test("fresh project disclosure keeps only the current project open", () => {
  assert.match(sidebar, /pi-web:project-disclosure-initialized/);
  assert.match(sidebar, /function hasStorageValue\(key: string\): boolean/);
  assert.match(sidebar, /projectDisclosureInitializedRef = useRef\([\s\S]*?hasStorageValue\(PROJECT_DISCLOSURE_INITIALIZED_KEY\)[\s\S]*?hasStorageValue\(COLLAPSED_STORAGE_KEY\)/);
  assert.match(sidebar, /collapseDefaultsInitializedRef = useRef\(false\)/);
  assert.match(sidebar, /if \(projectDisclosureInitializedRef\.current\) return/);
  assert.match(sidebar, /project\.path !== currentPath/);
  assert.match(sidebar, /setCollapsed\(new Set\(inactivePaths\)\)/);
});
```

Do not delete the existing assertions for click/keyboard project expansion, add-project expansion, quick-switcher expansion, and `pi-web:collapsed-projects` persistence.

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
cd /Users/kale/pi-web
node --test components/CodexSidebar.test.mjs
```

Expected: FAIL because no fresh-state initializer exists.

- [ ] **Step 3: Add a durable initialization marker and storage-presence helper**

Add beside the existing storage keys:

```ts
const PROJECT_DISCLOSURE_INITIALIZED_KEY = "pi-web:project-disclosure-initialized";
```

Place beside `readStringSet`:

```ts
function hasStorageValue(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}
```

The marker is required because `writeStringSet` removes `pi-web:collapsed-projects` when the set is empty. Without a separate marker, “the user explicitly expanded every project” is indistinguishable from “fresh profile.”

- [ ] **Step 4: Capture whether disclosure state existed before mount effects write storage**

Add beside the existing refs:

```ts
const projectDisclosureInitializedRef = useRef(
  hasStorageValue(PROJECT_DISCLOSURE_INITIALIZED_KEY)
    || hasStorageValue(COLLAPSED_STORAGE_KEY),
);
const collapseDefaultsInitializedRef = useRef(false);
```

Do not replace the existing `collapsed` set or its storage key. This preserves all current click, keyboard, add-project, and quick-switcher behavior.

- [ ] **Step 5: Initialize a fresh sidebar after projects load**

Place this effect after `selectedProject` is derived:

```ts
useEffect(() => {
  if (loading || collapseDefaultsInitializedRef.current || activeProjects.length === 0) return;
  collapseDefaultsInitializedRef.current = true;
  try {
    localStorage.setItem(PROJECT_DISCLOSURE_INITIALIZED_KEY, "1");
  } catch {
    // Browser storage is best-effort.
  }
  if (projectDisclosureInitializedRef.current) return;

  const currentPath = selectedProject?.path ?? activeProjects[0]?.path;
  if (!currentPath) return;
  const inactivePaths = activeProjects
    .filter((project) => project.path !== currentPath)
    .map((project) => project.path);
  setCollapsed(new Set(inactivePaths));
}, [activeProjects, loading, selectedProject?.path]);
```

Behavior contract:

- Existing non-empty `pi-web:collapsed-projects` state wins unchanged and receives the new marker.
- On the first load after this release, a profile with no collapsed-project state sees the selected project open and inactive projects collapsed.
- After initialization, expanding every project remains stable across reload because the marker survives when the collapsed set becomes empty.
- Adding a project still opens it because the existing `addProject` path removes it from `collapsed`.
- Search still temporarily opens matching projects because `filterQuery` already overrides `collapsed`.
- Users can still manually open multiple projects and persistence keeps that choice.

- [ ] **Step 6: Run tests**

Run:

```bash
cd /Users/kale/pi-web
node --test components/CodexSidebar.test.mjs lib/recent-sessions.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/kale/pi-web
git add components/CodexSidebar.tsx components/CodexSidebar.test.mjs
git commit -m "fix: collapse inactive sidebar projects by default"
```

---

### Task 3: Create Category Hierarchy Without A Divider

**Files:**
- Modify: `components/CodexSidebar.test.mjs:175-205`
- Modify: `app/globals.css:950-970, 1130-1210, 1295-1310, 4145-4160`
- Test: `components/CodexSidebar.test.mjs`

- [ ] **Step 1: Write the failing hierarchy and selected-state tests**

Replace spacing assertions that encode the temporary `14px 10px 4px` project-title padding with:

```js
test("recent and projects use spacing instead of a divider", () => {
  assert.match(styles, /\.codex-sidebar-section-heading,[\s\S]*?\.codex-sidebar-workspace-title \{[\s\S]*?font-size: var\(--text-ui\);[\s\S]*?font-weight: var\(--weight-semibold\);/);
  assert.match(styles, /\.codex-sidebar-workspace-title \{[\s\S]*?height: 32px;[\s\S]*?margin-top: 10px;[\s\S]*?padding: 0 10px;/);
  assert.match(styles, /\.codex-sidebar-recent > \[role="list"\] \{[\s\S]*?padding: 6px 8px 4px;/);
  assert.doesNotMatch(styles, /\.codex-sidebar-recent \{[^}]*border-bottom:/);
  assert.doesNotMatch(styles, /\.codex-sidebar-workspace-title \{[^}]*border-/);
});

test("selected session leads over its selected project", () => {
  assert.match(styles, /\.codex-project-row\[data-selected="true"\] \{ color: var\(--text\); background: transparent; \}/);
  assert.match(styles, /\.codex-project-row\[data-selected="true"\] \.codex-project-name \{ font-weight: var\(--weight-semibold\); \}/);
  assert.match(styles, /\.codex-session-row\[data-selected="true"\] \{ color: var\(--text\); background: var\(--bg-selected\); \}/);
});
```

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
cd /Users/kale/pi-web
node --test components/CodexSidebar.test.mjs
```

Expected: FAIL because headings still use `--text-meta`, the project title uses padding instead of margin, and selected projects still receive a filled background.

- [ ] **Step 3: Give both category labels one restrained heading recipe**

Use:

```css
.codex-sidebar-section-heading,
.codex-sidebar-workspace-title {
  color: var(--text-muted);
  font-size: var(--text-ui);
  font-weight: var(--weight-semibold);
}
```

Keep the existing button-reset, hover, focus, Chevron, and mobile behavior for `.codex-sidebar-section-heading`.

- [ ] **Step 4: Separate Projects with rhythm, not a rule**

Set the Projects title layout to:

```css
.codex-sidebar-workspace-title {
  height: 32px;
  margin-top: 10px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
```

Keep Recent list bottom padding at 4px and Projects list top padding at 4px. Do not add a border, background band, card, shadow, uppercase transform, or letter spacing.

At `@media (max-width: 640px)`, retain usable touch sizing:

```css
.codex-sidebar-section-heading {
  height: 44px;
}
.codex-sidebar-workspace-title {
  height: 44px;
  margin-top: 8px;
}
```

- [ ] **Step 5: Make the selected leaf carry the visual selection**

Replace the combined project hover/selected background rule with:

```css
.codex-project-row:hover { background: var(--bg-hover); }
.codex-project-row[data-selected="true"] { color: var(--text); background: transparent; }
.codex-project-row[data-selected="true"] .codex-project-name { font-weight: var(--weight-semibold); }
.codex-session-row[data-selected="true"] { color: var(--text); background: var(--bg-selected); }
```

This keeps the current project recognizable without creating a second filled rectangle around the selected child session.

- [ ] **Step 6: Run focused tests and detector**

Run:

```bash
cd /Users/kale/pi-web
node --test components/CodexSidebar.test.mjs lib/recent-sessions.test.mjs
node /Users/kale/.agents/skills/impeccable/scripts/detect.mjs --json --scope layout components/CodexSidebar.tsx
```

Expected: tests PASS; detector prints `[]` and exits 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/kale/pi-web
git add app/globals.css components/CodexSidebar.test.mjs
git commit -m "fix: clarify sidebar category hierarchy"
```

---

### Task 4: Verify Responsive Behavior And Production Output

**Files:**
- Verify: `components/CodexSidebar.tsx`
- Verify: `app/globals.css`
- Verify: `components/CodexSidebar.test.mjs`
- Verify: `lib/recent-sessions.ts`
- Verify: `lib/recent-sessions.test.mjs`
- Generated locally only: `/tmp/pi-web-0.14.5-sidebar-navigation-output`

- [ ] **Step 1: Run focused tests**

```bash
cd /Users/kale/pi-web
node --test components/CodexSidebar.test.mjs lib/recent-sessions.test.mjs
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run the full suite without the deployment symlink or service password contaminating tests**

```bash
cd /Users/kale/pi-web
bash -lc '
set -e
target=""
if [ -L .output ]; then
  target=$(readlink .output)
  rm .output
fi
restore_output() {
  if [ -n "$target" ]; then ln -sfn "$target" .output; fi
}
trap restore_output EXIT
env -u PI_WEB_PASSWORD npm test
'
```

Expected: exit 0. The repository-only packaging assertion sees no `.output`; auth tests do not inherit the launchd password.

- [ ] **Step 3: Run lint and diff hygiene**

```bash
cd /Users/kale/pi-web
npm run lint
git diff --check
git status --short
```

Expected: lint has 0 errors and no new warnings; `git diff --check` has no output. Only local build directories and the optional Impeccable snapshot remain untracked.

- [ ] **Step 4: Run the final mechanical detector**

```bash
node /Users/kale/.agents/skills/impeccable/scripts/detect.mjs --json --scope layout /Users/kale/pi-web/components/CodexSidebar.tsx
```

Expected: `[]`, exit code 0.

- [ ] **Step 5: Build publication output**

```bash
cd /Users/kale/pi-web
OUT=/tmp/pi-web-0.14.5-sidebar-navigation-output
rm -rf "$OUT"
mkdir -p "$OUT"
PI_WEB_TANSTACK_OUTPUT_DIR="$OUT" \
PI_WEB_TANSTACK_OUTPUT_MODE=publication \
npm run build:tanstack
node scripts/verify-tanstack-output.mjs --mode publication "$OUT"
ln -sfn "$OUT" /Users/kale/pi-web/.output
```

Expected: build and output verification exit 0.

- [ ] **Step 6: Restart and smoke-test the local service**

```bash
UID_NUM=$(id -u)
launchctl kickstart -k "gui/${UID_NUM}/com.kale.pi-web"
sleep 3
launchctl print "gui/${UID_NUM}/com.kale.pi-web" 2>&1 | awk '/state =|pid =|runs =/'
PASSWORD=$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:PI_WEB_PASSWORD' \
  "$HOME/Library/LaunchAgents/com.kale.pi-web.plist")
curl -sS -o /dev/null -w 'root=%{http_code}\n' --max-time 8 \
  -u "pi:${PASSWORD}" http://127.0.0.1:30141/
unset PASSWORD
```

Expected: launchd reports `state = running`; HTTP status is `200`.

- [ ] **Step 7: Perform one bounded visual inspection pass**

Inspect the shipped service at these viewport/sidebar combinations:

1. Desktop viewport 1440×900, sidebar width 260px.
2. Desktop viewport 1440×900, sidebar width 320px.
3. Mobile viewport 390×844 with the sidebar drawer open.

Acceptance criteria:

- One scrollbar serves Recent and Projects; there is no scrollbar that ends above the Projects heading.
- The top icon toolbar remains above Recent.
- All eight Recent rows remain in document flow; scrolling the navigation reveals Projects naturally.
- On fresh localStorage, only the current project is expanded.
- Existing stored project disclosure choices remain intact after reload.
- Search filters both Recent and Projects and shows the shared no-match state.
- Projects is separated from Recent by whitespace only; no divider or background band appears.
- The selected session has the only strong filled selection; its project remains readable through weight.
- Mobile category headings retain 44px touch height.
- Settings remains fixed and reachable.
- Long Chinese and English titles truncate without overlapping relative time or action controls.

Fix all defects found in this pass together, rerun focused tests once, rebuild once, and stop polishing after the confirmation pass.

- [ ] **Step 8: Final repository check**

```bash
cd /Users/kale/pi-web
git status --short
git log -3 --oneline
git diff --check
```

Expected: product source is committed; `.output`, `.tanstack/`, and `.impeccable/` are not included in product commits. Push only after explicit user approval.

---

## Self-Review

- Spec coverage: single Recent/Projects scroll is Task 1; fresh inactive-project collapse is Task 2; no-divider hierarchy and selected-state simplification are Task 3; responsive, test, detector, build, and service validation are Task 4.
- Existing P1 work preserved: top toolbar position, Recent search filtering, Recent disclosure persistence, row heights, and no divider remain covered by focused tests.
- Scope control: no new dependency, helper module, card, custom scrollbar, project-label redesign, or touch-action redesign is introduced.
- State safety: existing `pi-web:collapsed-projects` data wins; fresh initialization runs once only after active projects load.
- Commit safety: generated `.output`, `.tanstack/`, and critique snapshots stay out of product commits.
