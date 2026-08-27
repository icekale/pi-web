import type { ContextUsage, SessionStatsInfo } from "./pi-types";

export interface ConversationContextModel {
  percent: number | null;
  usedTokens: number | null;
  contextWindow: number;
  availableTokens: number;
  userMessages: number;
  toolCalls: number;
  cacheHitRate: number | null;
}

// Stay aligned with pi SDK `calculateContextTokens`. Do not import that helper
// here — it lives in a Node-only package and would break the browser bundle.
export function contextTokensFromUsage(usage: {
  totalTokens?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}): number {
  return usage.totalTokens || (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

export function contextUsageFromAssistant(
  usage: {
    totalTokens?: number;
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  } | undefined,
  contextWindow: number,
  stopReason?: string,
): ContextUsage | null {
  if (!usage || contextWindow <= 0) return null;
  if (stopReason === "aborted" || stopReason === "error") return null;
  const tokens = contextTokensFromUsage(usage);
  if (tokens <= 0) return null;
  return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
}

export function buildConversationContextModel({
  stats,
  contextUsage,
}: {
  stats: SessionStatsInfo;
  contextUsage: ContextUsage | null;
}) {
  const ctx = contextUsage ?? stats.contextUsage ?? null;
  const contextWindow = Math.max(0, ctx?.contextWindow ?? 0);
  const usedTokens = ctx?.tokens == null ? null : Math.max(0, ctx.tokens);
  const percent = ctx?.percent == null ? null : Math.min(100, Math.max(0, ctx.percent));
  const cacheHitDenominator = stats.tokens.input + stats.tokens.cacheRead + stats.tokens.cacheWrite;
  const cacheHitRate = stats.tokens.cacheRead + stats.tokens.cacheWrite > 0 && cacheHitDenominator > 0
    ? Number((stats.tokens.cacheRead / cacheHitDenominator * 100).toFixed(1))
    : null;
  return {
    percent,
    usedTokens,
    contextWindow,
    availableTokens: Math.max(0, contextWindow - (usedTokens ?? 0)),
    userMessages: stats.userMessages,
    toolCalls: stats.toolCalls,
    cacheHitRate,
  };
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 100_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}
