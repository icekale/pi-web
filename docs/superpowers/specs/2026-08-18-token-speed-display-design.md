# Token Speed Display Design

## Status

Locked for implementation after the 2026-08-18 design review.

## Objective

Make the streaming t/s figure comparable across models (especially hidden-reasoning models), let the user hide it from Settings → General, and render it in the current Codex chat chrome instead of the old traffic-light pill.

## Context

`AssistantMessageView` estimates tokens from visible thinking/text/tool args (CJK ≈ 1, else ≈ 4 chars/token) and divides by time since the first token (`lib/token-speed.ts`). The badge is a colored pill (`#53b3cb` / `#9bc53d` / `#f9c22e` / `#e01a4f`) on the model row and clears when the stream ends.

A 2026-08-18 live probe of DeepSeek V4 Flash vs Grok 4.5 showed the clock fix is not enough: Flash streams full thinking into the numerator; Grok shows a short thinking summary while `usage.reasoning` is ~1500 tokens. The badge read ~135 t/s vs ~8.6 t/s. The same turns billed at `usage.output / wall` were ~80 vs ~64 t/s. `usage.output` is usually absent until `message_end`.

Settings → General already has appearance, language, and a completion-sound switch (`pi-sound-enabled` via `hooks/useAudio.ts`).

## Goals

- While streaming, keep a live estimate so the row is not empty.
- When `usage` arrives, recompute t/s from billed output tokens and keep that number on the usage line.
- Add a General switch that hides every t/s figure. Default on. The streaming `↓` count stays visible.
- Replace the colored pill with dim monospace text that matches the model row and usage line.
- English and Chinese copy stay in sync.

## Non-goals

- Do not persist per-message t/s into session JSONL.
- Do not send the preference to the server or `settings.json`.
- Do not color-code speed tiers.
- Do not change how usage cost or in/out counts are billed.
- Do not hide the streaming estimated-token count when t/s is off.

## Approaches considered

1. **Browser preference + existing token-speed helper (chosen).** Same shape as completion sound. Math stays in `lib/token-speed.ts`. Smallest change that hits Settings, live estimate, and billed snap.
2. **Fold the flag into theme or another settings blob.** Couples unrelated state.
3. **Write the flag into `~/.pi/agent` / `pi-web.json`.** A display toggle does not belong on the server.

## Decisions

| Topic | Choice |
|---|---|
| Live vs billed | Estimate while streaming; snap to billed tokens at end and keep the figure |
| Look | Quiet dim mono. Stream: model row `↓ N` + `61.5 t/s`. Done: model row is name only; usage line gets `80.0 t/s` |
| Toggle | Settings → General, under completion sound. Default on. Hides t/s only |
| Storage | `localStorage` key `pi-token-speed-enabled`. Missing key = on |
| Billed count | `billedOutputTokens(usage)`: use `usage.output` when it is ≥ `usage.reasoning` (Grok folds reasoning into output). If `reasoning > output`, use `output + reasoning` |
| Clock | First visible token to `now` (live) or first token to usage arrival (final). If the message was not streamed in this page, use `prevTimestamp → message.timestamp` when both exist; otherwise omit t/s |
| Minimum window | Still 0.5s before showing a rate |

## Architecture

```
AppShell
  useTokenSpeedPreference()       same lift as useAudio
        │
        ├─ SettingsPage             enabled + toggle
        └─ ChatWindow → MessageView enabled only
                │
                ▼
lib/token-speed-preference.ts     read/write pi-token-speed-enabled
lib/token-speed.ts
  estimateStreamingTokens()       live numerator
  billedOutputTokens()            final numerator
  computeStreamingTps()           live and final rate
        │
        ▼
model row (streaming)             ↓ count + optional dim t/s
usage row (complete)              in / out / optional t/s / cost
```

Preference follows `useAudio`: AppShell owns the hook, Settings gets `enabled` + `toggle`, ChatWindow/MessageView get `enabled` only. Default `true` when the key is missing. No React context and no server read. Same-tab updates go through AppShell state, not the `storage` event.

`AssistantMessage.usage` may gain an optional `reasoning?: number` so billed math can see Grok-style fields. Do not display a separate reasoning count on the usage line in this slice.

## UI

Streaming model row (switch on):

```
DeepSeek V4 Flash    ↓ 198    61.5 t/s
```

Same type, size, and dim color as the model name. Tabular nums. No background pill.

Completed usage line (switch on):

```
2,577 in · 821 out · 80.0 t/s · $0.0002
```

`formatUsage` appends the rate only when a value exists and the switch is on. Switch off: no `t/s` anywhere; `↓ N` still shows while streaming.

## Copy

| Key | en | zh-CN |
|---|---|---|
| `settings.tokenSpeed` | Token speed | Token 速度 |
| `settings.tokenSpeedDescription` | Show tokens per second while streaming and on the usage line. | 在流式输出和用量行显示每秒 token 数。 |

`title` / `aria` on the live rate: reuse or add a short string that it is estimated until the turn ends. Final rate title: billed output tokens ÷ generation time.

## Error handling and edge cases

- `usage` missing at end: drop t/s; do not keep a stale estimate on the usage line.
- `usage.output` is 0: omit t/s.
- Stream abort: if usage is present, snap; otherwise omit.
- Refresh mid-history: no first-token clock; use file timestamps or omit.
- Multiple assistant messages in one turn: each message has its own clock and usage.

## Testing

- `billedOutputTokens`: Grok-shaped `{output: 1617, reasoning: 1493}` → 1617; completion-only `{output: 124, reasoning: 1493}` → 1617; Flash `{output: 821, reasoning: 0}` → 821.
- `computeStreamingTps` unchanged: first-token clock, 0.5s gate.
- Preference: missing key is on; `"false"` hides t/s.
- `MessageView` source: no traffic-light hex colors; completed usage includes `t/s` when a rate is passed; model row does not render a pill.
- `SettingsPage`: General contains the token-speed switch next to completion sound.

## Files

| File | Change |
|---|---|
| `lib/token-speed.ts` | `billedOutputTokens`; keep estimate + tps helpers |
| `lib/token-speed.test.mjs` | billed cases + preference if colocated |
| `lib/token-speed-preference.ts` | storage helper (or fold into `token-speed.ts` if it stays tiny) |
| `hooks/useTokenSpeedPreference.ts` | AppShell-owned read/toggle |
| `components/AppShell.tsx` / `ChatWindow.tsx` | pass `tokenSpeedEnabled` like `soundEnabled` |
| `components/MessageView.tsx` | quiet live rate; usage-line final rate; honor preference |
| `components/SettingsPage.tsx` | General switch |
| `lib/types.ts` | optional `usage.reasoning` |
| `lib/i18n/messages/en.ts` / `zh-CN.ts` | copy |
| `components/SettingsPage.test.mjs` / `MessageView.test.mjs` | switch + chrome locks |
