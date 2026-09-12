import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  MAX_SUBAGENT_MAX_CONCURRENT,
  readSubagentSettings,
  writeBuiltInSubagentsEnabled,
  writeSubagentMaxConcurrent,
} from "@/lib/subagent-settings";
import { listSubagentProfiles } from "@/lib/subagents";

// readSubagentSettings() stores maxConcurrent as a non-enumerable property, so the
// snapshot has to read it explicitly instead of spreading the object.
function settingsSnapshot() {
  const settings = readSubagentSettings();
  return {
    builtInEnabled: settings.builtInEnabled,
    maxConcurrent: settings.maxConcurrent,
    maxConcurrentLimit: MAX_SUBAGENT_MAX_CONCURRENT,
  };
}

// GET /api/subagents?cwd=<path> — built-in subagent settings plus the profile list
// the runtime would resolve for this cwd. The UI only needs a summary of each
// profile, so system prompts never leave the server.
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return Response.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return Response.json({ error: "cwd required" }, { status: 400 });
  try {
    if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }
    return Response.json({
      settings: settingsSnapshot(),
      profiles: listSubagentProfiles(cwd).map((profile) => ({
        name: profile.name,
        displayName: profile.displayName,
        description: profile.description,
        scope: profile.scope,
        tools: profile.tools,
        enabled: profile.enabled,
      })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

// PUT /api/subagents — { builtInEnabled?: boolean, maxConcurrent?: number }
export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return Response.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await req.json() as { builtInEnabled?: unknown; maxConcurrent?: unknown };
    if (body.builtInEnabled !== undefined) {
      if (typeof body.builtInEnabled !== "boolean") {
        return Response.json({ error: "builtInEnabled must be a boolean" }, { status: 400 });
      }
      writeBuiltInSubagentsEnabled(body.builtInEnabled);
    }
    if (body.maxConcurrent !== undefined) {
      const maxConcurrent = Number(body.maxConcurrent);
      if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > MAX_SUBAGENT_MAX_CONCURRENT) {
        return Response.json({
          error: `maxConcurrent must be an integer between 1 and ${MAX_SUBAGENT_MAX_CONCURRENT}`,
        }, { status: 400 });
      }
      writeSubagentMaxConcurrent(maxConcurrent);
    }
    return Response.json({ settings: settingsSnapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
