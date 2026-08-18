import { getRunningRpcSessionIds } from "@/lib/rpc-manager";


// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
export async function GET() {
  return Response.json(
    { runningSessionIds: getRunningRpcSessionIds() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
