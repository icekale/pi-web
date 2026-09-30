import { stat } from "fs/promises";
import { resolve } from "path";
import { createAgentSessionServices, getAgentDir, type SettingsManager } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { adoptCustomModels, rememberCustomModelToggle } from "@/lib/custom-model-scope";
import { invalidateModelsCache } from "@/lib/models-cache";
import { matchModelPatterns, resolveVisibleModels } from "@/lib/model-scope";
import { editModelScope, modelKey } from "@/lib/model-scope-edit";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { projectTrustReloadOptions } from "@/lib/project-trust";
import { refreshRpcSessionModelConfigs } from "@/lib/rpc-manager";

interface ScopeModel {
  provider: string;
  id: string;
  name: string;
  key: string;
}

async function allowedCwd(req: Request, bodyCwd?: unknown): Promise<string | Response> {
  const url = new URL(req.url);
  const requested = (typeof bodyCwd === "string" && bodyCwd) || url.searchParams.get("cwd") || process.cwd();
  const cwd = resolve(requested);
  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }
  return cwd;
}

async function openServices(cwd: string) {
  const agentDir = getAgentDir();
  const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
  return createAgentSessionServices({
    cwd,
    agentDir,
    ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
  });
}

function catalogOf(models: readonly Model<Api>[]): ScopeModel[] {
  return models
    .map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name || model.id,
      key: modelKey(model.provider, model.id),
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

async function readScope(cwd: string) {
  const services = await openServices(cwd);
  const settings: SettingsManager = services.settingsManager;
  await adoptCustomModels(settings, services.modelRuntime);
  const available = await services.modelRuntime.getAvailable();
  const models = catalogOf(available);
  const projectPatterns = settings.getProjectSettings().enabledModels;
  const patterns = settings.getGlobalSettings().enabledModels;
  const scope = await resolveVisibleModels(services.modelRuntime, settings.getEnabledModels());
  const visible = new Set(scope.visible.map((model) => modelKey(model.provider, model.id)));
  return {
    models,
    patterns: patterns ?? null,
    projectPatterns: projectPatterns ?? null,
    readOnly: projectPatterns !== undefined,
    enabled: models.filter((model) => visible.has(model.key)).map((model) => model.key),
  };
}

export async function GET(req: Request) {
  const cwd = await allowedCwd(req);
  if (cwd instanceof Response) return cwd;
  try {
    return Response.json(await readScope(cwd));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null) as {
    cwd?: unknown;
    provider?: unknown;
    id?: unknown;
    ids?: unknown;
    enabled?: unknown;
  } | null;
  const cwd = await allowedCwd(req, body?.cwd);
  if (cwd instanceof Response) return cwd;
  if (!body || typeof body.provider !== "string" || !body.provider || typeof body.enabled !== "boolean") {
    return Response.json({ error: "Expected provider and enabled" }, { status: 400 });
  }
  const provider = body.provider;
  const enabled = body.enabled;
  if (body.id !== undefined && typeof body.id !== "string") {
    return Response.json({ error: "Expected model id" }, { status: 400 });
  }
  if (body.ids !== undefined && (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string"))) {
    return Response.json({ error: "Expected model ids" }, { status: 400 });
  }

  try {
    const services = await openServices(cwd);
    const settings = services.settingsManager;
    if (settings.getProjectSettings().enabledModels !== undefined) {
      return Response.json({ error: "read-only" }, { status: 409 });
    }
    const available = await services.modelRuntime.getAvailable();
    const catalog = catalogOf(available).map((model) => model.key);
    const providerPrefix = `${provider}/`;
    const requestedIds = Array.isArray(body.ids)
      ? body.ids.filter((id): id is string => typeof id === "string")
      : undefined;
    const target = requestedIds
      ? requestedIds.map((id) => modelKey(provider, id))
      : typeof body.id === "string"
        ? [modelKey(provider, body.id)]
        : catalog.filter((key) => key.startsWith(providerPrefix));
    if (target.length === 0 || target.some((key) => !catalog.includes(key))) {
      return Response.json({ error: "Unknown model" }, { status: 400 });
    }
    const patterns = (settings.getGlobalSettings().enabledModels ?? []).map((pattern) => pattern.trim()).filter(Boolean);
    const matches = patterns.length > 0
      ? await matchModelPatterns(services.modelRuntime, patterns, available)
      : new Map<string, string[]>();
    rememberCustomModelToggle(target, enabled);
    const next = editModelScope({
      patterns,
      catalog,
      matches,
      ...(body.enabled ? { enable: target } : { disable: target }),
    });
    settings.setEnabledModels(next);
    await settings.flush();
    invalidateModelsCache();
    return Response.json(await readScope(cwd));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "keep-one") return Response.json({ error: "keep-one" }, { status: 400 });
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { cwd?: unknown } | null;
  const cwd = await allowedCwd(req, body?.cwd);
  if (cwd instanceof Response) return cwd;
  try {
    const services = await openServices(cwd);
    const result = await services.modelRuntime.refresh({ allowNetwork: true, force: true });
    invalidateModelsCache();
    await refreshRpcSessionModelConfigs();
    const errors = [...result.errors.entries()].map(([provider, error]) => ({
      provider,
      message: error instanceof Error ? error.message : String(error),
    }));
    return Response.json({ ok: !result.aborted && errors.length === 0, aborted: result.aborted, errors });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
