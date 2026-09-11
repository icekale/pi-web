import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { isProviderUsageId } from "@/lib/provider-usage-ids";
import { getProviderUsage, ProviderUsageError } from "@/lib/provider-usage";

type Params = { params: Promise<{ provider: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  if (!isProviderUsageId(provider)) {
    return Response.json({ error: `Usage is not supported for ${provider}` }, { status: 404 });
  }
  try {
    const usage = await getProviderUsage(await ModelRuntime.create(), provider);
    return Response.json(usage);
  } catch (error) {
    const status = error instanceof ProviderUsageError ? (error.status ?? 500) : 500;
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
