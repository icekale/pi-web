# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers using the local Pi coding agent in a browser. They move repeatedly between projects, sessions, worktrees, and project files while monitoring active agent work.

## Product Purpose

Pi Web provides a local graphical workspace for finding, starting, and continuing Pi coding sessions. Success means project and session navigation stays fast, predictable, and consistent with the Codex desktop workflow without changing the underlying project directories or Pi session files.

## Positioning

Same `~/.pi/agent` config and JSONL session files as the pi TUI, with Codex-style project and session navigation in the browser. It does not replace Codex and does not mutate project directories.

## Operating Context

Used as a local browser workspace alongside the pi TUI. Projects, sessions, worktrees, and files stay in one place. Navigation density and project management follow Codex desktop habits so developers can switch context without learning a new model.

## Capabilities and Constraints

Confirmed capabilities: project and session search, pin, archive, rename, export, and delete; live agent streaming; queue and steer; fork and in-session branch; subagent visualization; file browse/preview; Git worktrees; in-browser settings.

Session files and `~/.pi/agent` stay pi-compatible. Management metadata must never implicitly rename or delete them. Keep projects scannable in a sidebar; do not restore the project-selector dropdown as primary navigation.

Undecided: none recorded this pass.

## Brand Commitments

Quiet, precise, familiar. Codex desktop is the primary interaction reference for navigation density, hierarchy, and project management behavior.

Do not retain the previous project-selector dropdown as the primary navigation model. Avoid decorative dashboard styling, oversized controls, card-based project navigation, and custom interactions where a standard sidebar, menu, disclosure, or drag-and-drop pattern is expected.

## Evidence on Hand

Product copy and install path: `README.md`, `README.zh-CN.md`. Workspace screenshot: `docs/pi-web-workspace.png`. Do not fabricate testimonials, customers, benchmarks, or pricing.

## Product Principles

- Keep projects visible and directly scannable.
- Preserve context while moving between projects and sessions.
- Make state and actions discoverable without adding persistent visual noise.
- Treat filesystem and session data as durable user data; management metadata must never rename or delete them implicitly.
- Keep frequent actions one click away and destructive actions explicit.

## Accessibility & Inclusion

Target WCAG 2.1 AA. Support keyboard navigation, visible focus, screen-reader labels, sufficient contrast, reduced motion, and layouts that remain usable on mobile and narrow desktop widths.
