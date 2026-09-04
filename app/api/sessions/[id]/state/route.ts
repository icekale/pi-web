import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    if (rpc?.isAlive()) {
      const state = await rpc.send({ type: "get_state" });
      return Response.json({ running: true, state });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    // ponytail: don't load 15 extensions just to open history; widgets come back on first prompt
    return Response.json({ running: false });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
