---
name: Pi Web
description: Local Codex-density workbench for Pi coding sessions
colors:
  accent: "#2563eb"
  accent-hover: "#1d4ed8"
  on-accent: "#ffffff"
  bg: "#ffffff"
  bg-panel: "#f5f5f5"
  bg-hover: "#eeeeee"
  bg-selected: "#e8e8e8"
  border: "#e0e0e0"
  text: "#1a1a1a"
  text-muted: "#4b5563"
  text-dim: "#6b7280"
  warning: "#b45309"
  error: "#b91c1c"
  ok: "#166534"
  user-bg: "#eff6ff"
  tool-bg: "#f9fafb"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "0.875rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
  meta:
    fontFamily: "\"Noto Sans Mono Variable\", \"JetBrains Mono\", \"Fira Code\", Consolas, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "5px"
  lg: "8px"
  dialog: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "14px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "5px 14px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    padding: "0"
    height: "28px"
    width: "28px"
  input:
    backgroundColor: "{colors.bg-panel}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "6px 8px"
  session-row:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 8px"
  session-row-selected:
    backgroundColor: "{colors.bg-selected}"
    textColor: "{colors.text}"
  dialog:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: "16px"
---

# Design System: Pi Web

## Overview

**Creative North Star: "The Codex Workbench"**

Pi Web is a quiet instrument: a dense local coding desk where the sidebar is the tool rack, the conversation is the bench, and files sit in a drawer. It is familiar to Codex desktop users on purpose. Personality lives in restraint, not decoration.

Surfaces are paper and charcoal. One Workbench Blue marks selection, focus, and the rare filled action. Type stays at UI scale. There is no marketing display face and no card grid of projects.

**Key Characteristics:**

- Codex-density sidebar of rows, not cards
- Neutral canvas; one accent used sparingly
- Flat surfaces at rest; shadow only on floating layers
- System UI sans + monospace for data
- Light and dark remap the same roles (`:root` / `html.dark`)

## Colors

A cool neutral field with one functional blue. Status colors are ink, not badges.

### Primary

- **Workbench Blue** (`#2563eb`, dark `#60a5fa`): selection, focus rings, links, and the primary filled action. Hover is `#1d4ed8` (dark `#93c5fd`).

### Neutral

- **Canvas** (`#ffffff` / dark `#171717`): app background and assistant transcript.
- **Panel** (`#f5f5f5` / dark `#1f1f1f`): sidebar, inputs, recessed chrome.
- **Hover / Selected** (`#eeeeee` / `#e8e8e8`): list-row states, not new surfaces.
- **Hairline** (`#e0e0e0` / dark `#333333`): 1px structure.
- **Ink** (`#1a1a1a` / dark `#e8e8e8`): primary text.
- **Secondary ink** (`#4b5563`): body-adjacent UI copy (AA on canvas).
- **Dim ink** (`#6b7280`): metadata only.

### Status

- **Warning** (`#b45309` / dark `#f59e0b`): trust, pause, near-limit.
- **Error** (`#b91c1c` / dark `#f87171`): failure, destructive text.
- **OK** (`#166534` / dark `#4ade80`): connected, complete, success.

User bubbles tint with `#eff6ff` (dark `#1e293b`). Tool chrome uses `#f9fafb` (dark `#202020`).

**The Workbench Blue Rule.** Accent occupies a small fraction of any screen. If a layout needs color to look finished, the layout is wrong.

**The Token Role Rule.** Use `--accent`, `--error`, `--warning`, `--ok`. Do not introduce a second red or green.

## Typography

**Display Font:** none. Chrome titles use the UI sans at 0.875rem.
**Body Font:** system UI sans (`-apple-system`, Segoe UI, PingFang SC, Microsoft YaHei)
**Label/Mono Font:** Noto Sans Mono Variable, then JetBrains Mono / Fira Code / Consolas

**Character:** Working type, not brand type. Sans for chrome and chat; mono for paths, counts, keys, and diffs.

### Hierarchy

- **Title** (650, 0.875rem, 1.25): project names, panel headings.
- **Body** (400, 0.9375rem, 1.55): conversation prose.
- **Label** (400, 0.8125rem, 1.35): sidebar, buttons, forms.
- **Meta** (400, 0.75rem, 1.35, mono or sans): timestamps, counts, hints.

**The UI-Scale Rule.** Do not add a display or headline size. The largest chrome type is 0.875rem.

## Layout

Three columns on a workbench: session sidebar (default 260px), conversation (`main#conversation`), optional files/context gutter. Rows are 28–36px (session 34px, project 36px). Coarse pointers raise icon and row hit areas to 44px.

Breakpoints observed: 641px (desktop sidebar width animation), 960px (files panel joins the split), 1280px (context card). Below that, panels overlay instead of compressing the transcript.

Spacing rhythm is 4 / 8 / 12 / 14px. Flex children that clip text use `min-width: 0` and ellipsis.

**The Row-Not-Card Rule.** Projects and sessions are list rows. Do not wrap them in equal-height cards.

## Elevation & Depth

Resting UI is flat: tone (`--bg` vs `--bg-panel`) plus a 1px hairline. Depth is not a card shadow system.

### Shadow Vocabulary

- **Dialog** (`box-shadow: 0 10px 28px rgba(15, 23, 42, .18)`): modal workbench layers.
- **Switcher** (`box-shadow: 0 8px 18px rgba(0, 0, 0, .28)`): command palette.
- **Menu** (`box-shadow: 0 6px 8px rgba(0, 0, 0, .14)`): project/session menus.

**The Flat-By-Default Rule.** Shadows appear only on floating layers (dialog, menu, switcher). Never to make a list look like a dashboard.

## Shapes

Gentle tool radii: 5px on rows and compact chrome, 8px on fields and most popovers, 12px on dialogs, pills only for tiny counts and progress. Hairline borders, not thick strokes. Focus is a 2px `--accent` outline, offset 2px.

**The Quiet Corner Rule.** Rows stay at 5px. Do not pill an entire session row.

## Components

Refined and restrained. Ghost and icon controls in chrome; filled Workbench Blue only for the primary action.

### Buttons

- **Shape:** icon chrome 28×28px at 5px; filled actions ~32px tall at 8px.
- **Primary:** `--accent` fill, `#ffffff` label, 5px 14px padding.
- **Hover / Focus:** `--accent-hover`; `:focus-visible` 2px accent outline.
- **Ghost:** transparent, `--text-muted`, hover `--bg-hover`. Destructive label uses `--error`, not a filled red by default.

### Cards / Containers

- **Corner Style:** 5px rows; 12px dialogs.
- **Background:** `--bg` canvas, `--bg-panel` recessed.
- **Shadow Strategy:** none at rest; overlay vocabulary only.
- **Border:** 1px `--border`.
- **Internal Padding:** 8–14px in chrome; dialogs ~16px.

### Inputs / Fields

- **Style:** `--bg-panel` or transparent in toolbars, 1px `--border`, 8px radius.
- **Focus:** accent outline or parent `focus-within` border.
- **Error:** `--error` text; do not invent a second danger token.

### Navigation

Sidebar `nav#session-sidebar`: scannable project groups and 34px session rows. Selected row uses `--bg-selected` and `--text`. Running work is an icon + label, not color alone. Skip link `skip-to-chat` reveals on focus.

### Session row (signature)

Compact list row, 34px, 5px radius, ellipsis title. It is a real `button` unless renaming. Hover `--bg-hover`; selected `--bg-selected`. Unread and running are meta, not a new surface.

## Do's and Don'ts

### Do:

- **Do** keep projects visible as sidebar rows at 28–36px.
- **Do** use `--accent` for selection, focus, and one primary action.
- **Do** keep resting surfaces flat with 1px `--border`.
- **Do** respect `prefers-reduced-motion` (no sidebar/panel width animation).
- **Do** map light/dark through the same token roles.

### Don't:

- **Don't** restore the project-selector dropdown as primary navigation.
- **Don't** use card grids, hero metrics, or decorative dashboards for projects.
- **Don't** add display type, gradient text, or glass panels.
- **Don't** hardcode status hex; use `--error` / `--warning` / `--ok`.
- **Don't** put a drop shadow under a list row to “lift” it.
