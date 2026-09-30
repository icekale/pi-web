const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export interface ModelScopeEdit {
  patterns: readonly string[] | undefined;
  catalog: readonly string[];
  /** Each configured pattern mapped to the `provider/id` keys it enables. */
  matches: ReadonlyMap<string, readonly string[]>;
  enable?: readonly string[];
  disable?: readonly string[];
}

export function modelKey(provider: string, id: string): string {
  return `${provider}/${id}`;
}

export function thinkingSuffix(pattern: string): string {
  const index = pattern.lastIndexOf(":");
  if (index < 0) return "";
  const suffix = pattern.slice(index + 1);
  return THINKING_LEVELS.has(suffix) ? `:${suffix}` : "";
}

function patternBody(pattern: string): string {
  const suffix = thinkingSuffix(pattern);
  return suffix ? pattern.slice(0, -suffix.length) : pattern;
}

function suffixFor(
  patterns: readonly string[],
  matches: ReadonlyMap<string, readonly string[]>,
  key: string,
): string {
  let globSuffix = "";
  for (const pattern of patterns) {
    if (!(matches.get(pattern) ?? []).includes(key)) continue;
    const suffix = thinkingSuffix(pattern);
    if (!suffix) continue;
    if (patternBody(pattern).toLowerCase() === key.toLowerCase()) return suffix;
    if (!globSuffix) globSuffix = suffix;
  }
  return globSuffix;
}

function hasGlob(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

/**
 * Toggle models without dropping globs or thinking-level suffixes.
 * Exact patterns that match nothing are stale catalogue entries; keeping
 * them makes the scope warning impossible to clear.
 *
 * ponytail: disabling the last exact `provider/id:level` drops that pin;
 * turning it back on adds a bare ref. Per-model thinking levels still live
 * in settings.modelThinkingLevels.
 */
export function editModelScope(input: ModelScopeEdit): string[] | undefined {
  const cleaned = (input.patterns ?? []).map((pattern) => pattern.trim()).filter(Boolean);
  const catalog = [...new Set(input.catalog)];
  const catalogSet = new Set(catalog);
  const enabled = new Set<string>();
  if (cleaned.length === 0) {
    for (const key of catalog) enabled.add(key);
  } else {
    for (const pattern of cleaned) {
      for (const key of input.matches.get(pattern) ?? []) {
        if (catalogSet.has(key)) enabled.add(key);
      }
    }
  }
  for (const key of input.enable ?? []) {
    if (catalogSet.has(key)) enabled.add(key);
  }
  for (const key of input.disable ?? []) enabled.delete(key);
  if (enabled.size === 0) throw new Error("keep-one");

  const covered = new Set<string>();
  const kept: string[] = [];
  for (const pattern of cleaned) {
    const matched = (input.matches.get(pattern) ?? []).filter((key) => catalogSet.has(key));
    if (matched.length === 0) {
      if (hasGlob(patternBody(pattern))) kept.push(pattern);
      continue;
    }
    if (matched.every((key) => enabled.has(key))) {
      kept.push(pattern);
      for (const key of matched) covered.add(key);
    }
  }
  for (const key of catalog) {
    if (!enabled.has(key) || covered.has(key)) continue;
    kept.push(`${key}${suffixFor(cleaned, input.matches, key)}`);
  }

  if (kept.length === 0) return undefined;
  const allEnabled = catalog.every((key) => enabled.has(key));
  const canonical = new Set(catalog.map((key) => key.toLowerCase()));
  const onlyExact = kept.every((pattern) => canonical.has(patternBody(pattern).toLowerCase()));
  const hasPin = kept.some((pattern) => thinkingSuffix(pattern) !== "");
  if (allEnabled && onlyExact && !hasPin) return undefined;
  return kept;
}
