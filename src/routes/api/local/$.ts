import { createFileRoute } from "@tanstack/react-router";
import { DELETE, GET, HEAD, PATCH, POST, PUT } from "@/app/api/local/[...path]/route";

export const Route = createFileRoute("/api/local/$")({
  server: {
    handlers: {
      GET: ({ request }) => GET(request),
      HEAD: ({ request }) => HEAD(request),
      POST: ({ request }) => POST(request),
      PUT: ({ request }) => PUT(request),
      PATCH: ({ request }) => PATCH(request),
      DELETE: ({ request }) => DELETE(request),
    },
  },
});
