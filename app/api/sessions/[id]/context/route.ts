import { resolveSessionPath, buildSessionContext, readSessionWindow } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { parseSessionWindowParams, sliceSessionContext } from "@/lib/session-window";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");
  const deferToolResults = url.searchParams.has("deferToolResults");
  const { limit, before, leafId } = parseSessionWindowParams(url.searchParams);
  const defer = { deferThinking, deferToolResultImages, deferToolResults };

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    if (!liveRpc) {
      const window = readSessionWindow(filePath!, { limit, before, leafId, ...defer });
      return Response.json({ context: window.context, hasMore: window.hasMore });
    }

    const full = buildSessionContext(liveRpc.inner.sessionManager.getEntries() as never, leafId, defer);
    const { context, hasMore } = sliceSessionContext(full, { limit, before });
    return Response.json({ context, hasMore });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
