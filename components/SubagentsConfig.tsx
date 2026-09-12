"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Gauge, Layers3, RefreshCw } from "lucide-react";
import { sendAgentCommand } from "@/lib/agent-client";
import { useI18n } from "@/hooks/useI18n";

interface SubagentSettingsSnapshot {
  builtInEnabled: boolean;
  maxConcurrent: number;
  maxConcurrentLimit: number;
}

interface SubagentProfileRow {
  name: string;
  displayName: string;
  description: string;
  scope: string;
  tools: string[];
  enabled: boolean;
}

interface SubagentsPayload {
  settings: SubagentSettingsSnapshot;
  profiles: SubagentProfileRow[];
}

interface Props {
  cwd: string;
  sessionId: string | null;
  onReloaded: () => void;
}

export function SubagentsConfig({ cwd, sessionId, onReloaded }: Props) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<SubagentSettingsSnapshot | null>(null);
  const [profiles, setProfiles] = useState<SubagentProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/subagents?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as SubagentsPayload;
      if (!data?.settings || !Array.isArray(data.profiles)) {
        throw new Error("Unexpected settings response");
      }
      setSettings(data.settings);
      setProfiles(data.profiles);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (update: { builtInEnabled?: boolean; maxConcurrent?: number }) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      const data = await response.json() as { settings?: SubagentSettingsSnapshot; error?: string };
      if (!response.ok || !data.settings) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSettings(data.settings);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // load() clears the error when it starts, so re-sync the server value first and
      // surface the failure after — otherwise a rejected save reverts with no message.
      await load();
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [load]);

  const reloadSession = useCallback(async () => {
    if (!sessionId) return;
    setReloading(true);
    setError(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      onReloaded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReloading(false);
    }
  }, [onReloaded, sessionId]);

  if (loading && !settings) {
    return <div className="settings-page-empty"><span>{t("sidebar.loading")}</span></div>;
  }

  // The Agent tool is registered when a session starts, so toggling the built-in
  // runtime only changes the tool list of the running session after a reload.
  const busy = saving || !settings;

  return (
    <div className="settings-form-page">
      <div className="settings-form-heading">
        <Bot size={18} aria-hidden="true" />
        <div><h3>{t("common.subagents")}</h3><p>{t("settings.subagentsDescription")}</p></div>
      </div>
      <section className="settings-form-section">
        <div className="settings-form-label">
          <Bot size={16} aria-hidden="true" />
          <div><strong>{t("settings.subagentsBuiltIn")}</strong><span>{t("settings.subagentsBuiltInDescription")}</span></div>
        </div>
        <button
          className="settings-switch"
          type="button"
          role="switch"
          aria-checked={settings?.builtInEnabled ?? false}
          disabled={busy}
          onClick={() => void save({ builtInEnabled: !settings?.builtInEnabled })}
          title={t("settings.subagentsBuiltIn")}
        >
          <span /><Bot size={15} aria-hidden="true" />
        </button>
      </section>
      <section className="settings-form-section">
        <label className="settings-form-label" htmlFor="settings-subagents-max-concurrent">
          <Gauge size={16} aria-hidden="true" />
          <div><strong>{t("settings.subagentsMaxConcurrent")}</strong><span>{t("settings.subagentsMaxConcurrentDescription")}</span></div>
        </label>
        <select
          id="settings-subagents-max-concurrent"
          value={settings?.maxConcurrent ?? 1}
          disabled={busy}
          onChange={(event) => void save({ maxConcurrent: Number(event.target.value) })}
        >
          {Array.from({ length: settings?.maxConcurrentLimit ?? 1 }, (_, index) => index + 1).map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </section>
      <section className="settings-form-section settings-form-section-stack">
        <div className="settings-form-label">
          <Layers3 size={16} aria-hidden="true" />
          <div><strong>{t("settings.subagentsProfiles")}</strong><span>{t("settings.subagentsProfilesDescription")}</span></div>
        </div>
        {profiles.length === 0 ? (
          <div className="settings-page-empty"><strong>{t("settings.subagentsProfilesEmpty")}</strong></div>
        ) : (
          <div className="settings-archived-list">
            {profiles.map((profile) => (
              <div className="settings-archived-row" key={profile.name}>
                <div>
                  <strong>{profile.displayName}{profile.enabled ? "" : ` · ${t("settings.subagentsProfileDisabled")}`}</strong>
                  <span title={profile.description}>{profile.description}</span>
                  <span title={profile.tools.join(", ")}>{t(`settings.subagentsScope.${profile.scope}`)} · {profile.tools.join(", ")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="settings-form-section">
        <div className="settings-form-label">
          <RefreshCw size={16} aria-hidden="true" />
          <div><strong>{t("i18n.reloadSession")}</strong><span>{t("settings.subagentsReloadDescription")}</span></div>
        </div>
        <button
          className="settings-secondary-button"
          type="button"
          onClick={() => void reloadSession()}
          disabled={!sessionId || reloading}
          title={sessionId ? t("i18n.reloadSession") : t("i18n.openSessionToReload")}
        >
          <RefreshCw size={14} aria-hidden="true" />{reloading ? t("i18n.reloading") : t("i18n.reloadSession")}
        </button>
      </section>
      {error && <div className="settings-inline-error" role="alert">{error}</div>}
    </div>
  );
}
