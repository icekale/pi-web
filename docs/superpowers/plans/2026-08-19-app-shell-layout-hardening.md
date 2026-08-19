# App Shell Layout Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the new-session home and sidebar worktree section fully reachable when vertical space is constrained, without changing the established Codex/DSCode proportions.

**Architecture:** Make two local layout corrections. The new-session scroll container will stop centering an overflowing flex child and instead let the child center itself only when free space exists. The worktree section will become a min-height-zero flex column whose list owns vertical scrolling beneath a fixed heading.

**Tech Stack:** React 19, TypeScript, Tailwind utility classes, app-level CSS, Node's built-in test runner.

---

## File map

- Modify `components/ChatWindow.tsx`: apply overflow-safe centering to the new-session home.
- Modify `components/ChatWindow.process-details.test.mjs`: lock the safe-centering class contract.
- Modify `app/globals.css`: give the worktree block and list a bounded flex/scroll relationship.
- Modify `components/CodexSidebar.test.mjs`: lock the worktree overflow contract.

Do not change transcript/composer widths, sidebar breakpoints, panel behavior, colors, typography, or unrelated accessibility issues. Leave all implementation changes uncommitted unless the user separately requests a commit.

### Task 1: Make the new-session home safe at short heights

**Files:**
- Modify: `components/ChatWindow.process-details.test.mjs`
- Modify: `components/ChatWindow.tsx:699-702`

- [x] **Step 1: Add the failing regression check**

Append this test after `"renders a Codex-style new-session home"`:

```js
test("keeps new-session content reachable in short viewports", () => {
  assert.match(
    source,
    /className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-8"/,
  );
  assert.match(
    source,
    /className="my-auto w-full max-w-\[720px\] text-center"/,
  );
  assert.doesNotMatch(source, /items-center justify-center overflow-y-auto/);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --experimental-strip-types --test components/ChatWindow.process-details.test.mjs
```

Expected: one failure in `"keeps new-session content reachable in short viewports"` because the scroll container still contains `justify-center` and the content block has no auto block margin.

- [x] **Step 3: Implement the minimal class changes**

In `components/ChatWindow.tsx`, replace:

```tsx
<div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
  <div className="w-full max-w-[720px] text-center">
```

with:

```tsx
<div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-8">
  <div className="my-auto w-full max-w-[720px] text-center">
```

`my-auto` consumes positive free space and centers the block, but resolves to zero when the block is taller than the scroller, keeping its leading edge reachable.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --experimental-strip-types --test components/ChatWindow.process-details.test.mjs
```

Expected: all tests in the file pass.

### Task 2: Make long worktree lists scroll below their heading

**Files:**
- Modify: `components/CodexSidebar.test.mjs`
- Modify: `app/globals.css:1328-1357`

- [x] **Step 1: Add the failing regression check**

Append this test after `"sidebar recomposition preserves worktree switching and creation"`:

```js
test("long worktree lists scroll below a fixed heading", () => {
  const block = styles.match(/\.codex-worktree-block \{([^}]*)\}/)?.[1];
  const list = styles.match(/\.codex-worktree-list \{([^}]*)\}/)?.[1];

  assert.ok(block, "missing .codex-worktree-block layout rule");
  assert.match(block, /display:\s*flex/);
  assert.match(block, /flex-direction:\s*column/);
  assert.match(block, /min-height:\s*0/);

  assert.ok(list, "missing .codex-worktree-list layout rule");
  assert.match(list, /min-height:\s*0/);
  assert.match(list, /overflow-y:\s*auto/);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --experimental-strip-types --test components/CodexSidebar.test.mjs
```

Expected: one failure in `"long worktree lists scroll below a fixed heading"` because `.codex-worktree-block` has no layout rule and the list does not own overflow.

- [x] **Step 3: Implement the bounded flex/scroll relationship**

Add this rule immediately before `.codex-worktree-list`:

```css
.codex-worktree-block {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
```

Expand the existing list rule to:

```css
.codex-worktree-list {
  min-height: 0;
  overflow-y: auto;
  padding: 0 6px 6px 20px;
}
```

Do not move the heading into the scrolling element; it must remain visible while the list scrolls.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --experimental-strip-types --test components/CodexSidebar.test.mjs
```

Expected: all tests in the file pass.

### Task 3: Verify the complete layout change

**Files:**
- Verify: `components/ChatWindow.tsx`
- Verify: `components/CodexSidebar.tsx`
- Verify: `app/globals.css`

- [x] **Step 1: Run both focused regression files together**

Run:

```bash
node --experimental-strip-types --test \
  components/ChatWindow.process-details.test.mjs \
  components/CodexSidebar.test.mjs
```

Expected: all tests pass with zero failures.

- [x] **Step 2: Run static project checks**

Run:

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

Expected: both commands exit 0.

- [x] **Step 3: Run the broader suite without the repository-output invariant**

The running local service intentionally uses an untracked `.output` symlink, so the single test named `"staging never writes .output into the repository"` cannot pass in this active workspace. Run every other test without moving that live symlink:

```bash
node --experimental-strip-types --test \
  --test-name-pattern='^(?!staging never writes \.output into the repository$).*' \
  "app/**/*.test.mjs" \
  "components/**/*.test.mjs" \
  "hooks/**/*.test.mjs" \
  "lib/**/*.test.mjs" \
  "public/**/*.test.mjs"
```

Expected: zero failures; exactly the named environment-invariant test is skipped.

- [x] **Step 4: Run the final mechanical layout detector once**

Run:

```bash
node /Users/kale/.agents/skills/impeccable/scripts/detect.mjs \
  --json \
  --scope layout \
  components/ChatWindow.tsx \
  components/CodexSidebar.tsx \
  app/globals.css
```

Expected: `[]`. Any finding must be explained or fixed before visual verification.

- [x] **Step 5: Perform one bounded rendered inspection**

Start a loopback-only development server on an unused port:

```bash
if lsof -nP -iTCP:30144 -sTCP:LISTEN >/dev/null; then
  echo "Port 30144 is already in use" >&2
  exit 1
fi
PI_WEB_PASSWORD="" npm run dev -- --port 30144 --strictPort
```

Inspect these states together:

1. `1440×900`: new-session content remains vertically centered.
2. `900×420` and 200% zoom: the first line of new-session content is reachable and the region scrolls.
3. Expanded worktrees: the heading remains fixed while a long list scrolls inside the existing 46% sidebar cap. If local data has too few rows, clone existing rows in browser DevTools only; do not create worktrees.
4. `375×812`: mobile sidebar animation, transcript width, and composer sizing are unchanged.
5. Keyboard traversal: DOM/focus order is unchanged because only classes and CSS rules moved.

Capture desktop and narrow-height screenshots in the same pass. Fix all observed structural defects in one batch, then perform at most one confirmation pass.

- [x] **Step 6: Review the final diff without committing**

Run:

```bash
git diff --check
git diff -- \
  components/ChatWindow.tsx \
  components/ChatWindow.process-details.test.mjs \
  components/CodexSidebar.test.mjs \
  app/globals.css
```

Expected: no whitespace errors and only the two approved layout fixes plus their regression checks. Leave the changes uncommitted for user review.
