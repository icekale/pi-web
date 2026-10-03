"use client";

import { useCallback, useEffect, useState } from "react";
import { Server } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

type Exposure = "codemode" | "deferred" | "direct" | "hidden";
type ServerRow = {
  name: string;
  scope: "global" | "project" | "extension";
  enabled: boolean;
  exposure: Exposure;
  transport: string;
  editable: boolean;
};
type Payload = {
  trusted: boolean;
  requiresTrust: boolean;
  servers: ServerRow[];
  errors: string[];
  output?: string;
  login?: { name: string; url?: string; done: boolean; error?: string };
};

const exposures: Exposure[] = ["codemode", "deferred", "direct", "hidden"];

export function McpSettings({ cwd, onReloaded }: { cwd?: string; onReloaded?: () => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [paste, setPaste] = useState("");
  const [scope, setScope] = useState<"global" | "project">("global");
  const [exposure, setExposure] = useState<Exposure>("codemode");
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!cwd) return;
    const response = await fetch(`/api/mcp?cwd=${encodeURIComponent(cwd)}`);
    const body = await response.json() as Payload & { error?: string };
    if (!response.ok) throw new Error(body.error || t("mcp.loadFailed"));
    setData(body);
  }, [cwd, t]);

  useEffect(() => {
    void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [load]);

  async function send(action: string, extra: Record<string, unknown> = {}) {
    if (!cwd) return;
    setBusy(action);
    setError("");
    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, action, ...extra }),
      });
      const body = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error || t("mcp.saveFailed"));
      setData(body);
      if (action === "add") { setName(""); setPaste(""); }
      if (action !== "check" && action !== "login") onReloaded?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  }

  if (!cwd) {
    return <div className="settings-page-empty"><Server size={20} aria-hidden="true" /><strong>{t("settings.projectRequired")}</strong></div>;
  }

  return (
    <div className="settings-form-page">
      <div className="settings-form-heading">
        <Server size={18} aria-hidden="true" />
        <div><h3>{t("mcp.title")}</h3><p>{t("mcp.description")}</p></div>
      </div>
      <section className="settings-form-section">
        <label className="settings-form-label" htmlFor="mcp-name"><div><strong>{t("mcp.add")}</strong><span>{t("mcp.addHint")}</span></div></label>
        <input id="mcp-name" value={name} placeholder={t("mcp.name")} onChange={(event) => setName(event.target.value)} />
        <textarea value={paste} placeholder={t("mcp.paste")} rows={4} onChange={(event) => setPaste(event.target.value)} />
        <select aria-label={t("mcp.scope")} value={scope} onChange={(event) => setScope(event.target.value as "global" | "project")}>
          <option value="global">{t("mcp.global")}</option>
          <option value="project">{t("mcp.project")}</option>
        </select>
        <select aria-label={t("mcp.exposure")} value={exposure} onChange={(event) => setExposure(event.target.value as Exposure)}>
          {exposures.map((item) => <option key={item} value={item}>{t(`mcp.exposure.${item}`)}</option>)}
        </select>
        {scope === "project" && data?.requiresTrust && !data.trusted && (
          <label><input type="checkbox" checked={trust} onChange={(event) => setTrust(event.target.checked)} /> {t("mcp.trust")}</label>
        )}
        <button type="button" disabled={busy !== "" || !name.trim() || !paste.trim()} onClick={() => void send("add", { name, paste, scope, exposure, trust })}>{t("mcp.add")}</button>
      </section>
      {(data?.servers ?? []).map((server) => (
        <section className="settings-form-section" key={`${server.scope}:${server.name}`}>
          <div className="settings-form-label"><div><strong>{server.name}</strong><span>{server.scope} · {server.transport}</span></div></div>
          <select aria-label={t("mcp.exposure")} value={server.exposure} disabled={!server.editable || busy !== ""} onChange={(event) => void send("exposure", { name: server.name, exposure: event.target.value })}>
            {exposures.map((item) => <option key={item} value={item}>{t(`mcp.exposure.${item}`)}</option>)}
          </select>
          <button type="button" role="switch" aria-checked={server.enabled} disabled={!server.editable || busy !== ""} onClick={() => void send("toggle", { name: server.name, enabled: !server.enabled })}>
            {server.enabled ? t("mcp.enabled") : t("mcp.disabled")}
          </button>
          <button type="button" disabled={busy !== ""} onClick={() => void send("check", { name: server.name })}>{t("mcp.test")}</button>
          <button type="button" disabled={busy !== ""} onClick={() => void send("login", { name: server.name })}>{t("mcp.login")}</button>
          <button type="button" disabled={busy !== ""} onClick={() => void send("logout", { name: server.name })}>{t("mcp.logout")}</button>
          <button type="button" disabled={!server.editable || busy !== ""} onClick={() => void send("remove", { name: server.name })}>{t("mcp.remove")}</button>
        </section>
      ))}
      {data?.login?.url && <p><a href={data.login.url} target="_blank" rel="noreferrer">{t("mcp.openLogin")}</a></p>}
      {data?.output && <pre>{data.output}</pre>}
      {data?.errors.map((item) => <div className="settings-inline-error" role="alert" key={item}>{item}</div>)}
      {error && <div className="settings-inline-error" role="alert">{error}</div>}
    </div>
  );
}
