import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  MAX_SUBAGENT_MAX_CONCURRENT,
  readSubagentSettings,
  writeBuiltInSubagentsEnabled,
  writeSubagentMaxConcurrent,
} from "@/lib/subagent-settings";
import { listSubagentProfiles } from "@/lib/subagents";

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
  let cwd: string | null;
  try {
    cwd = new URL(req.url).searchParams.get("cwd");
  } catch {
    return Response.json({ error: "Invalid request URL" }, { status: 400 });
  }
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
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return Response.json({ error: "Body must be a JSON object" }, { status: 400 });
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return Response.json({ error: "Body must be a JSON object" }, { status: 400 });
    }
    const body = raw as { builtInEnabled?: unknown; maxConcurrent?: unknown };

    // Validate every field before writing any of them: a rejected request must not
    // mutate the file, and a partial apply would be invisible to the caller.
    let nextBuiltInEnabled: boolean | undefined;
    if (body.builtInEnabled !== undefined) {
      if (typeof body.builtInEnabled !== "boolean") {
        return Response.json({ error: "builtInEnabled must be a boolean" }, { status: 400 });
      }
      nextBuiltInEnabled = body.builtInEnabled;
    }

    let nextMaxConcurrent: number | undefined;
    if (body.maxConcurrent !== undefined) {
      const maxConcurrent = body.maxConcurrent;
      if (typeof maxConcurrent !== "number"
        || !Number.isInteger(maxConcurrent)
        || maxConcurrent < 1
        || maxConcurrent > MAX_SUBAGENT_MAX_CONCURRENT) {
        return Response.json({
          error: `maxConcurrent must be an integer between 1 and ${MAX_SUBAGENT_MAX_CONCURRENT}`,
        }, { status: 400 });
      }
      nextMaxConcurrent = maxConcurrent;
    }

    if (nextBuiltInEnabled !== undefined) writeBuiltInSubagentsEnabled(nextBuiltInEnabled);
    if (nextMaxConcurrent !== undefined) writeSubagentMaxConcurrent(nextMaxConcurrent);
    return Response.json({ settings: settingsSnapshot() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
