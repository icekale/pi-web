import { createFileRoute } from "@tanstack/react-router";
import {
  GET as getSubagentsSettings,
  PUT as putSubagentsSettings,
} from "@/app/api/subagents/route";

export const Route = createFileRoute("/api/subagents")({
  server: {
    handlers: {
      GET: ({ request }) => getSubagentsSettings(request),
      PUT: ({ request }) => putSubagentsSettings(request),
    },
  },
});
