import { createFileRoute } from "@tanstack/react-router";
import { GET as getProviderUsage } from "@/app/api/providers/[provider]/usage/route";

export const Route = createFileRoute("/api/providers/$provider/usage")({
  server: {
    handlers: {
      GET: ({ request, params }) => getProviderUsage(request, {
        params: Promise.resolve({ provider: params.provider }),
      }),
    },
  },
});
