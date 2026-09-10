export const THINKING_LEVEL_RANK = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type RankedThinkingLevel = (typeof THINKING_LEVEL_RANK)[number];

export function highestThinkingLevel(
  levels: readonly string[] | null | undefined,
): RankedThinkingLevel | "auto" {
  if (!levels?.length) return "auto";
  let best: RankedThinkingLevel | undefined;
  let bestRank = -1;
  for (const level of levels) {
    const rank = THINKING_LEVEL_RANK.indexOf(level as RankedThinkingLevel);
    if (rank > bestRank) {
      bestRank = rank;
      best = level as RankedThinkingLevel;
    }
  }
  return best ?? "auto";
}

export function sessionPathHasThinkingLevelChange(
  entries: { id: string; parentId?: string | null; type: string }[],
  leafId?: string | null,
): boolean {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let id: string | undefined = leafId ?? entries.at(-1)?.id;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const entry = byId.get(id);
    if (!entry) break;
    if (entry.type === "thinking_level_change") return true;
    id = entry.parentId ?? undefined;
  }
  return false;
}
