import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ModelRuntime, type SettingsManager } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { invalidateModelsCache } from "./models-cache";
import { readModelsConfig } from "./models-config-store";
import { resolveVisibleModels } from "./model-scope";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function customModelKeys(config: Record<string, unknown> = readModelsConfig()): string[] {
  if (!isRecord(config.providers)) return [];
  const keys: string[] = [];
  for (const [provider, value] of Object.entries(config.providers)) {
    if (!isRecord(value) || !Array.isArray(value.models)) continue;
    for (const model of value.models) {
      if (!isRecord(model) || typeof model.id !== "string" || model.id.trim().length === 0) continue;
      keys.push(`${provider}/${model.id.trim()}`);
    }
  }
  return keys;
}

export function missingCustomModelKeys(input: {
  customKeys: readonly string[];
  visibleKeys: ReadonlySet<string>;
  disabledKeys: ReadonlySet<string>;
}): string[] {
  return input.customKeys.filter((key) => !input.visibleKeys.has(key) && !input.disabledKeys.has(key));
}

export function removeMissingCustomModelKeys(
  patterns: readonly string[],
  customKeys: ReadonlySet<string>,
  availableKeys: ReadonlySet<string>,
): string[] {
  return patterns.filter((pattern) => {
    const normalized = pattern.trim();
    return !customKeys.has(normalized) || availableKeys.has(normalized);
  });
}

export function removeNoMatchPatterns(
  patterns: readonly string[],
  availableKeys: ReadonlySet<string>,
): string[] {
  const loadedProviders = new Set(
    [...availableKeys].map((key) => key.slice(0, key.indexOf("/"))).filter(Boolean),
  );
  return patterns.filter((pattern) => {
    const normalized = pattern.trim();
    if (!normalized || normalized.includes("*") || normalized.includes("?") || normalized.includes("[")) return true;
    const base = normalized.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, "");
    if ([...availableKeys].some((key) => key === base || key.endsWith(`/${base}`))) return true;
    const provider = base.slice(0, base.indexOf("/"));
    // A provider that failed to load must keep its patterns; only drop an exact
    // ref when that provider is present and this model is gone.
    return !provider || !loadedProviders.has(provider);
  });
}

function disabledPath(): string {
  return join(getAgentDir(), "model-picker-disabled.json");
}

export function readDisabledCustomModels(path = disabledPath()): string[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string" && key.length > 0) : [];
  } catch {
    return [];
  }
}

export function writeDisabledCustomModels(keys: readonly string[], path = disabledPath()): void {
  writePrivateFileAtomicSync(path, JSON.stringify([...new Set(keys)], null, 2));
}

export function rememberCustomModelToggle(keys: readonly string[], enabled: boolean): void {
  const custom = new Set(customModelKeys());
  const relevant = keys.filter((key) => custom.has(key));
  if (relevant.length === 0) return;
  const disabled = new Set(readDisabledCustomModels().filter((key) => custom.has(key)));
  for (const key of relevant) {
    if (enabled) disabled.delete(key);
    else disabled.add(key);
  }
  writeDisabledCustomModels([...disabled]);
}

/** Add models.json entries the allowlist has never been told to hide. */
export async function adoptCustomModels(
  settings: SettingsManager,
  modelRuntime: ModelRuntime,
): Promise<void> {
  if (settings.getProjectSettings().enabledModels !== undefined) return;
  const patterns = settings.getGlobalSettings().enabledModels;
  if (!patterns || patterns.length === 0) return;

  const custom = new Set(customModelKeys());
  const disabled = new Set(readDisabledCustomModels().filter((key) => custom.has(key)));
  const available = await modelRuntime.getAvailable();
  const availableKeys = new Set(available.map((model) => `${model.provider}/${model.id}`));
  const cleanedPatterns = removeNoMatchPatterns(
    removeMissingCustomModelKeys(patterns, custom, availableKeys),
    availableKeys,
  );
  const scope = await resolveVisibleModels(modelRuntime, cleanedPatterns);
  const visible = new Set(scope.visible.map((model) => `${model.provider}/${model.id}`));
  const missing = missingCustomModelKeys({
    customKeys: [...custom],
    visibleKeys: visible,
    disabledKeys: disabled,
  });
  const nextPatterns = [...new Set([...cleanedPatterns, ...missing])];
  if (nextPatterns.length === patterns.length && nextPatterns.every((pattern, index) => pattern === patterns[index])) return;
  settings.setEnabledModels(nextPatterns);
  await settings.flush();
  invalidateModelsCache();
}
