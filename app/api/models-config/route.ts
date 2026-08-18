import { readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";


export async function GET() {
  return Response.json(readModelsConfig());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    writeModelsConfig(body);
    const { refreshRpcSessionModelConfigs } = await import("@/lib/rpc-manager");
    await refreshRpcSessionModelConfigs();
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
