import type { SessionContext } from "./types";

export const SESSION_MESSAGE_WINDOW = 80;
export const SESSION_WINDOW_INITIAL_BYTES = 512 * 1024;
export const SESSION_WINDOW_MAX_BYTES = 2 * 1024 * 1024;

export function parseSessionWindowParams(searchParams: URLSearchParams): {
  limit: number;
  before?: string;
  leafId?: string;
} {
  const before = searchParams.get("before") || undefined;
  const leafId = searchParams.get("leafId") || undefined;
  const extra = {
    ...(before ? { before } : {}),
    ...(leafId ? { leafId } : {}),
  };
  const raw = searchParams.get("limit");
  if (raw == null) return { limit: SESSION_MESSAGE_WINDOW, ...extra };
  const parsed = Number.parseInt(raw, 10);
  const limit = Number.isFinite(parsed)
    ? Math.min(500, Math.max(1, parsed))
    : SESSION_MESSAGE_WINDOW;
  return { limit, ...extra };
}

export function historyItemKey(item: unknown): string {
  if (!item || typeof item !== "object") return String(item);
  const message = item as { role?: unknown; content?: unknown };
  const role = typeof message.role === "string" ? message.role : "";
  const content = message.content;
  if (typeof content === "string") return `${role}:${content}`;
  if (Array.isArray(content)) {
    const text = content
      .filter((block): block is { type?: unknown; text?: unknown } => !!block && typeof block === "object")
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
    return `${role}:${text}`;
  }
  return role;
}

function appendUnindexedTail<T>(items: T[], unindexed: T[]): T[] {
  if (unindexed.length === 0) return items;
  const incomingKeys = items.map((item) => historyItemKey(item));
  let skip = 0;
  for (let n = Math.min(unindexed.length, items.length); n > 0; n--) {
    const liveKeys = unindexed.slice(0, n).map((item) => historyItemKey(item));
    const suffix = incomingKeys.slice(-n);
    if (liveKeys.every((key, i) => key === suffix[i])) {
      skip = n;
      break;
    }
  }
  return skip === unindexed.length ? items : [...items, ...unindexed.slice(skip)];
}

export function mergeWindowedHistory<T>(
  current: T[],
  currentIds: string[],
  incoming: T[],
  incomingIds: string[],
): { items: T[]; entryIds: string[] } {
  if (incomingIds.length === 0) {
    return { items: current, entryIds: currentIds };
  }
  const unindexedTail = current.length > currentIds.length
    ? current.slice(currentIds.length)
    : [];
  let items: T[];
  let entryIds: string[];
  if (currentIds.length === 0) {
    items = incoming;
    entryIds = incomingIds;
  } else {
    const incomingSet = new Set(incomingIds);
    const overlap = currentIds.findIndex((id) => incomingSet.has(id));
    if (overlap <= 0) {
      items = incoming;
      entryIds = incomingIds;
    } else {
      items = [...current.slice(0, overlap), ...incoming];
      entryIds = [...currentIds.slice(0, overlap), ...incomingIds];
    }
  }
  return { items: appendUnindexedTail(items, unindexedTail), entryIds };
}

export function sliceSessionContext(
  context: SessionContext,
  options: { limit: number; before?: string } = { limit: SESSION_MESSAGE_WINDOW },
): { context: SessionContext; hasMore: boolean } {
  const ids = context.entryIds;
  let end = ids.length;
  if (options.before) {
    const idx = ids.indexOf(options.before);
    if (idx <= 0) {
      return {
        context: { ...context, messages: [], entryIds: [] },
        hasMore: false,
      };
    }
    end = idx;
  }
  const start = Math.max(0, end - options.limit);
  return {
    context: {
      ...context,
      messages: context.messages.slice(start, end),
      entryIds: ids.slice(start, end),
    },
    hasMore: start > 0,
  };
}
