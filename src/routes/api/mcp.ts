import { createFileRoute } from "@tanstack/react-router";
import { GET as getMcp, POST as postMcp } from "@/app/api/mcp/route";

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => getMcp(request),
      POST: ({ request }) => postMcp(request),
    },
  },
});
