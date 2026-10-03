import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { listMcpServers, mutateMcpServer, type McpExposure, type McpScope } from "@/lib/mcp-settings";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return Response.json({ error: "cwd required" }, { status: 400 });
  if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    return Response.json(listMcpServers(cwd));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  const body = await req.json() as {
    cwd?: string;
    action?: "add" | "remove" | "toggle" | "exposure" | "check" | "login" | "logout" | "trust";
    name?: string;
    scope?: McpScope;
    enabled?: boolean;
    exposure?: McpExposure;
    paste?: string;
    trust?: boolean;
  };
  if (!body.cwd || !body.action) return Response.json({ error: "cwd and action required" }, { status: 400 });
  if (!isExistingFilePathAllowed(body.cwd, await getAllowedFileRoots())) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }
  try {
    return Response.json(await mutateMcpServer(body as { cwd: string; action: NonNullable<typeof body.action> }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
