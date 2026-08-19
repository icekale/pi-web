# App Shell Layout Hardening

## Goal

Preserve the current Codex/DSCode visual proportions while making two constrained
regions robust when their content is taller than the available space.

## Spatial thesis

The app remains a dense, center-gravity workspace:

- the 760px transcript is the primary reading path;
- the 780px composer is the primary action surface;
- the project/session sidebar stays compact and independently navigable;
- narrow layouts preserve access by scrolling or overlaying instead of shrinking
  content into unreadable columns.

The existing transcript/composer widths and mobile sidebar transition are
intentional and remain unchanged.

## Changes

### New-session home

Replace `justify-center` on the scrolling flex container with safe centering on
its content block. The welcome content remains vertically centered when space is
available, but its leading edge stays reachable when viewport height, zoom,
localization, or dynamic notices make it taller than the viewport.

### Worktree section

Make the worktree block a min-height-zero flex column and the worktree list its
scrollable region. The section heading remains visible while long worktree lists,
the create form, and errors scroll inside the existing 46% sidebar allocation.

## Non-goals

- No new breakpoint or intermediate sidebar mode.
- No changes to the 760px transcript or 780px composer widths.
- No visual identity, typography, color, or interaction redesign.
- No unrelated tab, panel-focus, popover, or touch-target changes.

## Verification

- Add source-level regression checks that fail against the current unsafe
  centering and clipped worktree-list structure.
- Run the focused checks, typecheck, and the relevant layout detector.
- Inspect desktop and narrow-height new-session states plus a long worktree-list
  state in one visual pass; make at most one corrective pass.
- Confirm keyboard and DOM order are unchanged.
