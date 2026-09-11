"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { isProviderUsageId } from "@/lib/provider-usage-ids";
import { formatUsageReset, percentUsed, type ProviderUsageSnapshot } from "@/lib/provider-usage-format";

function windowLabel(t: (key: string) => string, name: string): string {
  const key = `models.usage.window.${name}`;
  const label = t(key);
  return label === key ? name : label;
}

export function ProviderUsageSummary({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const [usage, setUsage] = useState<ProviderUsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isProviderUsageId(providerId)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/usage`);
      const body = await res.json() as ProviderUsageSnapshot & { error?: string };
      if (!res.ok) throw new Error(body.error || t("models.usageError"));
      setUsage(body);
    } catch (err) {
      setUsage(null);
      setError(err instanceof Error ? err.message : t("models.usageError"));
    } finally {
      setLoading(false);
    }
  }, [providerId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isProviderUsageId(providerId)) return null;

  const windows = usage ? Object.entries(usage.windows) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", fontWeight: 600 }}>
          {t("models.usageTitle")}
          {usage?.plan ? ` · ${t("models.usagePlan", { plan: usage.plan })}` : ""}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: "3px 8px",
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: 5,
            color: "var(--text-muted)",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: "var(--text-meta)",
          }}
        >
          {loading ? t("i18n.loading") : t("models.usageRefresh")}
        </button>
      </div>
      {error && <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--error)" }}>{error}</p>}
      {!error && !loading && windows.length === 0 && (
        <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--text-dim)" }}>{t("models.usageEmpty")}</p>
      )}
      {windows.map(([name, window]) => {
        const percent = percentUsed(window);
        const reset = formatUsageReset(window.resetAt);
        return (
          <div key={name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "var(--text-meta)", color: "var(--text-muted)" }}>
              <span>{windowLabel(t, name)}</span>
              <span>
                {percent == null ? `${window.used}` : t("models.usageWindowUsed", { percent: String(Math.round(percent)) })}
                {reset ? ` · ${t("models.usageReset", { when: reset })}` : ""}
              </span>
            </div>
            {percent != null && (
              <div style={{ height: 4, background: "var(--bg)", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ width: `${percent}%`, height: "100%", background: "var(--accent)" }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
