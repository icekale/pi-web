import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { isProviderUsageId } from "./provider-usage-ids";
import {
  type ProviderUsageSnapshot,
  type ProviderUsageWindow,
} from "./provider-usage-format";

export type { ProviderUsageSnapshot, ProviderUsageWindow } from "./provider-usage-format";
export { formatUsageReset, percentUsed } from "./provider-usage-format";

export class ProviderUsageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderUsageError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function windowFromUsedLimit(
  used: number | null,
  limit: number | null,
  resetAt: number | null = null,
): ProviderUsageWindow | null {
  if (used == null && limit == null) return null;
  const safeUsed = used ?? 0;
  const remaining = limit == null ? null : Math.max(0, limit - safeUsed);
  return { used: safeUsed, limit, remaining, resetAt };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init);
  return { status: res.status, body: await readJson(res) };
}

function requireOk(status: number, body: unknown, fallback: string): void {
  if (status >= 200 && status < 300) return;
  const rec = asRecord(body);
  const message =
    asString(rec?.error) ??
    asString(asRecord(rec?.error)?.message) ??
    asString(rec?.message) ??
    fallback;
  throw new ProviderUsageError(message, status);
}

function oauthHeaders(token: string, extra?: Record<string, string>): HeadersInit {
  return { Authorization: `Bearer ${token}`, ...extra };
}

async function tokenFor(
  runtime: ModelRuntime,
  provider: string,
): Promise<{ kind: "oauth" | "api_key"; value: string } | null> {
  const result = await runtime.getAuth(provider);
  if (!result) return null;
  const headers = result.auth.headers ?? {};
  const headerAuth = headers.Authorization ?? headers.authorization;
  const bearer = typeof headerAuth === "string" && /^Bearer\s+/i.test(headerAuth)
    ? headerAuth.replace(/^Bearer\s+/i, "").trim()
    : "";
  const value = result.auth.apiKey || bearer;
  if (!value) return null;
  return {
    kind: runtime.isUsingOAuth?.(provider) || /oauth/i.test(result.source ?? "") ? "oauth" : "api_key",
    value,
  };
}

async function fetchAnthropicUsage(auth: { kind: "oauth" | "api_key"; value: string }): Promise<ProviderUsageSnapshot> {
  if (auth.kind === "oauth") {
    const { status, body } = await fetchJson("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        ...oauthHeaders(auth.value),
        "anthropic-beta": "oauth-2025-04-20",
      },
    });
    requireOk(status, body, "Anthropic usage request failed");
    const rec = asRecord(body) ?? {};
    const five = asRecord(rec.five_hour);
    const seven = asRecord(rec.seven_day);
    return {
      provider: "anthropic",
      plan: asString(rec.plan) ?? undefined,
      fetchedAt: Date.now(),
      windows: {
        five_hour: windowFromUsedLimit(
          asNumber(five?.utilization),
          100,
          asNumber(five?.resets_at),
        ) ?? { used: 0, limit: 100, remaining: 100, resetAt: null },
        seven_day: windowFromUsedLimit(
          asNumber(seven?.utilization),
          100,
          asNumber(seven?.resets_at),
        ) ?? { used: 0, limit: 100, remaining: 100, resetAt: null },
      },
    };
  }

  const { status, body } = await fetchJson("https://api.anthropic.com/api/usage_cost/limits", {
    headers: {
      "x-api-key": auth.value,
      "anthropic-version": "2023-06-01",
    },
  });
  requireOk(status, body, "Anthropic usage request failed");
  const rec = asRecord(body) ?? {};
  const five = asRecord(rec.five_hour);
  const seven = asRecord(rec.seven_day);
  return {
    provider: "anthropic",
    fetchedAt: Date.now(),
    windows: Object.fromEntries(
      [
        ["five_hour", five],
        ["seven_day", seven],
      ].flatMap(([key, win]) => {
        const parsed = windowFromUsedLimit(
          asNumber(asRecord(win)?.used),
          asNumber(asRecord(win)?.limit),
          asNumber(asRecord(win)?.resets_at),
        );
        return parsed ? [[key, parsed]] : [];
      }),
    ),
  };
}

async function fetchOpenAIUsage(provider: "openai" | "openai-codex", token: string): Promise<ProviderUsageSnapshot> {
  const url =
    provider === "openai-codex"
      ? "https://chatgpt.com/backend-api/wham/usage"
      : "https://api.openai.com/v1/dashboard/billing/credit_grants";
  const { status, body } = await fetchJson(url, { headers: oauthHeaders(token) });
  requireOk(status, body, "OpenAI usage request failed");
  const rec = asRecord(body) ?? {};
  if (provider === "openai-codex") {
    const rate = asRecord(rec.rate_limit) ?? rec;
    return {
      provider,
      plan: asString(rec.plan) ?? undefined,
      fetchedAt: Date.now(),
      windows: {
        primary: windowFromUsedLimit(
          asNumber(rate.used_percent) ?? asNumber(rate.used),
          asNumber(rate.limit) ?? 100,
          asNumber(rate.reset_after) ?? asNumber(rate.resets_at),
        ) ?? { used: 0, limit: 100, remaining: 100, resetAt: null },
      },
    };
  }
  const used = asNumber(rec.total_used);
  const granted = asNumber(rec.total_granted);
  return {
    provider,
    fetchedAt: Date.now(),
    windows: {
      credit: windowFromUsedLimit(used, granted) ?? { used: 0, limit: granted, remaining: granted, resetAt: null },
    },
  };
}

async function fetchGithubCopilotUsage(token: string): Promise<ProviderUsageSnapshot> {
  const { status, body } = await fetchJson("https://api.github.com/copilot_internal/user", {
    headers: {
      ...oauthHeaders(token),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  requireOk(status, body, "GitHub Copilot usage request failed");
  const rec = asRecord(body) ?? {};
  const quota = asRecord(rec.quota_snapshots) ?? rec;
  const chat = asRecord(quota.premium_interactions) ?? asRecord(quota.chat);
  return {
    provider: "github-copilot",
    plan: asString(rec.copilot_plan) ?? undefined,
    fetchedAt: Date.now(),
    windows: {
      premium: windowFromUsedLimit(
        asNumber(chat?.used_percent) ?? asNumber(chat?.used),
        asNumber(chat?.entitlement) ?? 100,
        asNumber(chat?.reset_date) ?? asNumber(chat?.resets_at),
      ) ?? { used: 0, limit: 100, remaining: 100, resetAt: null },
    },
  };
}

async function fetchGeminiCliUsage(token: string): Promise<ProviderUsageSnapshot> {
  const { status, body } = await fetchJson(
    "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
    {
      method: "POST",
      headers: { ...oauthHeaders(token), "Content-Type": "application/json" },
      body: "{}",
    },
  );
  requireOk(status, body, "Gemini CLI usage request failed");
  const rec = asRecord(body) ?? {};
  const buckets = Array.isArray(rec.buckets) ? rec.buckets : [];
  const windows: Record<string, ProviderUsageWindow> = {};
  for (const bucket of buckets) {
    const item = asRecord(bucket);
    if (!item) continue;
    const name = asString(item.name) ?? asString(item.modelId) ?? "quota";
    const parsed = windowFromUsedLimit(
      asNumber(item.currentUsage) ?? asNumber(item.used),
      asNumber(item.limit) ?? asNumber(item.quota),
      asNumber(item.resetTime) ?? asNumber(item.resets_at),
    );
    if (parsed) windows[name] = parsed;
  }
  return { provider: "google-gemini-cli", fetchedAt: Date.now(), windows };
}

async function fetchAntigravityUsage(token: string): Promise<ProviderUsageSnapshot> {
  const { status, body } = await fetchJson(
    "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
    {
      method: "POST",
      headers: { ...oauthHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ project: "antigravity" }),
    },
  );
  requireOk(status, body, "Antigravity usage request failed");
  const rec = asRecord(body) ?? {};
  const parsed = windowFromUsedLimit(
    asNumber(rec.used) ?? asNumber(rec.utilization),
    asNumber(rec.limit) ?? 100,
    asNumber(rec.resets_at),
  );
  return {
    provider: "google-antigravity",
    fetchedAt: Date.now(),
    windows: parsed ? { primary: parsed } : {},
  };
}

export async function getProviderUsage(
  runtime: ModelRuntime,
  provider: string,
): Promise<ProviderUsageSnapshot> {
  if (!isProviderUsageId(provider)) {
    throw new ProviderUsageError(`Usage is not supported for ${provider}`, 404);
  }
  const auth = await tokenFor(runtime, provider);
  if (!auth) throw new ProviderUsageError(`Not authenticated for ${provider}`, 401);

  switch (provider) {
    case "anthropic":
      return fetchAnthropicUsage(auth);
    case "openai":
    case "openai-codex":
      return fetchOpenAIUsage(provider, auth.value);
    case "github-copilot":
      return fetchGithubCopilotUsage(auth.value);
    case "google-gemini-cli":
      return fetchGeminiCliUsage(auth.value);
    case "google-antigravity":
      return fetchAntigravityUsage(auth.value);
    default:
      throw new ProviderUsageError(`Usage is not supported for ${provider}`, 404);
  }
}
