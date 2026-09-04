import type { SessionContext } from "./types";

export const SESSION_MESSAGE_WINDOW = 80;
export const SESSION_WINDOW_INITIAL_BYTES = 512 * 1024;

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

export function mergeWindowedHistory<T>(
  current: T[],
  currentIds: string[],
  incoming: T[],
  incomingIds: string[],
): { items: T[]; entryIds: string[] } {
  if (currentIds.length === 0 || incomingIds.length === 0) {
    return { items: incoming, entryIds: incomingIds };
  }
  const incomingSet = new Set(incomingIds);
  const overlap = currentIds.findIndex((id) => incomingSet.has(id));
  if (overlap <= 0) return { items: incoming, entryIds: incomingIds };
  return {
    items: [...current.slice(0, overlap), ...incoming],
    entryIds: [...currentIds.slice(0, overlap), ...incomingIds],
  };
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
