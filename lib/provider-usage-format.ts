import type { ProviderUsageId } from "./provider-usage-ids";

export interface ProviderUsageWindow {
  used: number;
  limit: number | null;
  remaining: number | null;
  resetAt: number | null;
}

export interface ProviderUsageSnapshot {
  provider: ProviderUsageId;
  windows: Record<string, ProviderUsageWindow>;
  plan?: string;
  fetchedAt: number;
}

export function percentUsed(window: ProviderUsageWindow): number | null {
  if (window.limit == null || window.limit <= 0) return null;
  return Math.min(100, Math.max(0, (window.used / window.limit) * 100));
}

export function formatUsageReset(resetAt: number | null, now = Date.now()): string | null {
  if (resetAt == null) return null;
  const ms = resetAt < 1e12 ? resetAt * 1000 - now : resetAt - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
