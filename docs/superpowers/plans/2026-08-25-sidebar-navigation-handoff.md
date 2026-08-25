# Pi Web Sidebar Navigation Handoff

**Date:** 2026-08-25  
**Repository:** `/Users/kale/pi-web`  
**Branch:** `main`  
**HEAD / origin/main:** `3b597b60`  
**Implementation plan:** `docs/superpowers/plans/2026-08-25-sidebar-navigation-layout.md`

## Objective

Finish the approved sidebar refinement:

1. Recent and Projects share one vertical scroll surface.
2. Recent keeps all eight rows in document flow; it has no independent scrollbar or 42% cap.
3. On fresh disclosure state, only the current project is expanded; inactive projects start collapsed.
4. Manual project disclosure remains persistent, including the “all projects expanded” state.
5. Recent and Projects are separated by spacing and heading hierarchy, not a divider.
6. The selected session carries the strong fill; its parent project is emphasized without a competing filled card.

The top search/add/hide toolbar must remain in its current position above Recent.

## Required Read Order

1. This handoff.
2. `docs/superpowers/plans/2026-08-25-sidebar-navigation-layout.md`.
3. `/Users/kale/.agents/skills/superpowers/executing-plans/SKILL.md`.
4. `/Users/kale/.agents/skills/superpowers/test-driven-development/SKILL.md`.
5. `/Users/kale/.agents/skills/superpowers/verification-before-completion/SKILL.md`.
6. `/Users/kale/.agents/skills/impeccable/reference/layout.md`.
7. `/Users/kale/.agents/skills/impeccable/reference/craft-floor.md` immediately before UI edits.

Run Impeccable context once from the repository before editing:

```bash
cd /Users/kale/pi-web
node /Users/kale/.agents/skills/impeccable/scripts/context.mjs --target components/CodexSidebar.tsx
```

Do not run Impeccable context a second time in the same agent session.

## Working Tree State

The source changes below are intentionally uncommitted. They are the approved baseline and must not be discarded:

```text
 M app/globals.css
 M components/CodexSidebar.test.mjs
 M components/CodexSidebar.tsx
 M lib/recent-sessions.test.mjs
 M lib/recent-sessions.ts
?? docs/superpowers/plans/2026-08-25-sidebar-navigation-layout.md
?? docs/superpowers/plans/2026-08-25-sidebar-navigation-handoff.md
?? docs/superpowers/plans/2026-08-25-sidebar-navigation-agent-prompt.md
```

Local/generated paths also exist and must not be staged:

```text
?? .impeccable/
?? .output
?? .tanstack/
```

Continue in `/Users/kale/pi-web`. Do not create a clean worktree unless the dirty changes above have first been preserved and transferred. Never run reset, checkout, restore, clean, or commands that discard these files.

## What Is Already Implemented Locally

The current diff already does the following:

- Renders Recent before Projects.
- Keeps search/add/hide controls above Recent.
- Places the Projects heading directly above its list.
- Keeps the top icon toolbar at the user-approved original position.
- Removes the divider between Recent and Projects.
- Adds more desktop row spacing.
- Filters Recent sessions with the same sidebar query used by Projects.
- Adds a Recent no-match state.
- Persists Recent disclosure under `pi-web:recent-open`.
- Adds tests for Recent search and disclosure persistence.

Preserve those behaviors unless the implementation plan explicitly replaces a temporary detail.

## Temporary Behavior That Must Be Replaced

`app/globals.css` currently contains a temporary nested-scroll solution:

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

Do not tune the percentage. Remove this ownership and give Recent + Projects one shared `.codex-sidebar-navigation` scroll owner exactly as specified in Task 1.

## Approved Visual Direction

At a 260px sidebar width:

```text
fixed: Pi Web / refresh
fixed: New task
fixed: search / add / hide

scrolls as one surface:
  Recent
    eight recent sessions

  Projects
    current project expanded
    inactive projects collapsed by default

fixed: Settings
```

Visual constraints:

- No divider above Projects.
- No card around either section.
- No custom scrollbar.
- No new color palette, typeface, dependency, or component abstraction.
- Keep existing desktop row heights: 36px project, 34px nested session, 38px Recent.
- Keep mobile category touch height at 44px.
- Use approximately 10px top spacing before Projects and shared 13px semibold category labels.
- Keep session title truncation and relative time collision-free.

## State Semantics

Keep `pi-web:collapsed-projects` and its current `Set<string>` semantics.

Add the initialization marker specified in the plan:

```text
pi-web:project-disclosure-initialized
```

Reason: `writeStringSet` removes the collapsed-project key when the set is empty. The marker is required to distinguish a fresh profile from a user who deliberately expanded every project.

Expected migration:

- Existing non-empty collapsed state is preserved.
- A profile with no prior collapsed state receives the new default once.
- After initialization, manually expanding every project survives reload.
- Search continues to temporarily open matching projects.
- Adding a project continues to open and select it.

## Test Evidence At Handoff

Fresh commands run on 2026-08-25:

```bash
cd /Users/kale/pi-web
node --test components/CodexSidebar.test.mjs lib/recent-sessions.test.mjs
```

Result:

```text
33 tests
33 pass
0 fail
```

Detector:

```bash
node /Users/kale/.agents/skills/impeccable/scripts/detect.mjs --json --scope layout components/CodexSidebar.tsx
```

Result:

```json
[]
```

Exit code: `0`.

`git diff --check` also passed with no output.

## Execution Rules

- Follow the implementation plan task by task.
- Use red-green TDD for each behavioral change.
- Exactly one writer owns `/Users/kale/pi-web`.
- Work with the existing dirty files; do not revert them.
- Keep edits scoped to the five current source/test files plus the plan/handoff docs.
- No new runtime or development dependency.
- Do not stage `.output`, `.tanstack/`, or `.impeccable/`.
- Local commits are allowed as specified by the plan.
- Do not push to GitHub until the user explicitly approves the final visual result.
- Do not claim completion until focused tests, full tests, lint, detector, production build, service smoke test, and bounded visual checks have evidence.

## Build And Service Context

LaunchAgent:

```text
~/Library/LaunchAgents/com.kale.pi-web.plist
label: com.kale.pi-web
URL: http://127.0.0.1:30141/
```

The current running service must not be treated as proof of the latest source. A previous build/restart command was interrupted and returned no result. Rebuild and restart during Task 4.

Use a publication build under `/tmp`, point `.output` to it, then restart launchd. Read the local password from the LaunchAgent at smoke-test time; do not place credentials in documentation or commits.

## Acceptance Checklist

- [ ] Recent and Projects have one shared vertical scrollbar.
- [ ] Recent has no `max-height` and no list-level `overflow: auto`.
- [ ] Projects follows all Recent rows in normal document flow.
- [ ] Fresh state opens only the current project.
- [ ] Existing/manual disclosure state persists, including all-open.
- [ ] Search filters both sections and preserves no-match feedback.
- [ ] No divider or background band separates the categories.
- [ ] Projects has clear whitespace and heading hierarchy.
- [ ] Parent project does not compete with selected child session fill.
- [ ] Top toolbar remains above Recent.
- [ ] Worktree tools and Settings remain behaviorally unchanged.
- [ ] Desktop 260px/320px and mobile 390px visual checks pass.
- [ ] Focused tests, full suite, lint, detector, build, and HTTP smoke pass.
- [ ] Generated directories are absent from commits.
- [ ] GitHub push waits for user approval.

## Final Report Required From Implementing Agent

Return:

1. Files changed and behavior delivered.
2. Focused/full test counts and commands.
3. Lint/detector/build/service results.
4. Visual checks performed and any residual risk.
5. Commit hashes created locally.
6. Confirmation that nothing was pushed.
