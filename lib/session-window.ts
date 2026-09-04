import type { SessionContext } from "./types";

export const SESSION_MESSAGE_WINDOW = 80;
export const SESSION_WINDOW_INITIAL_BYTES = 512 * 1024;

export function parseSessionWindowParams(searchParams: URLSearchParams): {
  limit: number;
  before?: string;
} {
  const before = searchParams.get("before") || undefined;
  const raw = searchParams.get("limit");
  if (raw == null) return { limit: SESSION_MESSAGE_WINDOW, ...(before ? { before } : {}) };
  const parsed = Number.parseInt(raw, 10);
  const limit = Number.isFinite(parsed)
    ? Math.min(500, Math.max(1, parsed))
    : SESSION_MESSAGE_WINDOW;
  return { limit, ...(before ? { before } : {}) };
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
