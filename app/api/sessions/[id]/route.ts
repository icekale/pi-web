import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
  buildSessionContext,
  readCachedSessionInfo,
  readSessionHeader,
  readSessionWindow,
} from "@/lib/session-reader";
import { sessionPathKey } from "@/lib/paths";
import { isReservedSubagentSessionName } from "@/lib/session-relations";
import { getRpcSession } from "@/lib/rpc-manager";
import { projectTreeForResponse } from "@/lib/project-tree";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { parseSessionWindowParams, sliceSessionContext } from "@/lib/session-window";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const resolvedPath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !resolvedPath) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const searchParams = new URL(req.url).searchParams;
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const deferToolResults = searchParams.has("deferToolResults");
    const { limit, before, leafId: leafIdParam } = parseSessionWindowParams(searchParams);
    const defer = { deferThinking, deferToolResultImages, deferToolResults };

    if (!liveRpc) {
      const filePath = resolvedPath!;
      const window = readSessionWindow(filePath, { limit, before, leafId: leafIdParam, ...defer });
      const header = readSessionHeader(filePath);
      const listInfo = readCachedSessionInfo(filePath);
      let modified = header?.timestamp ?? new Date().toISOString();
      try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }
      const parentSessionId = header?.parentSession
        ? await resolveSessionIdByPath(header.parentSession)
        : undefined;
      const info = header ? {
        path: filePath,
        id: header.id,
        cwd: header.cwd ?? "",
        name: listInfo?.name,
        created: header.timestamp,
        modified: listInfo?.modified ?? modified,
        messageCount: listInfo?.messageCount != null
          ? listInfo.messageCount
          : (window.hasMore ? null : window.context.messages.length),
        firstMessage: listInfo?.firstMessage ?? "(no messages)",
        parentSessionId,
        transient: false,
      } : null;
      return Response.json({
        sessionId: id,
        filePath,
        info,
        leafId: window.leafId,
        tree: window.tree,
        context: window.context,
        totalActiveMs: window.totalActiveMs,
        hasMore: window.hasMore,
      });
    }

    const sm = liveRpc.inner.sessionManager;
    const filePath = liveRpc.sessionFile || sm.getSessionFile() || "";
    const entries = sm.getEntries();
    const leafId = leafIdParam || sm.getLeafId();
    const full = buildSessionContext(entries as never, leafId, defer);
    const { context, hasMore } = sliceSessionContext(full, { limit, before });
    const header = sm.getHeader();
    let modified = header?.timestamp ?? new Date().toISOString();
    try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }
    const parentSessionId = header?.parentSession
      ? await resolveSessionIdByPath(header.parentSession)
      : undefined;
    const info = header ? {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: sm.getSessionName(),
      created: header.timestamp,
      modified,
      messageCount: full.messages.length,
      firstMessage: full.messages.find((m) => m.role === "user")
        ? (() => {
            const msg = full.messages.find((m) => m.role === "user")!;
            const c = (msg as { content: unknown }).content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      parentSessionId,
      transient: !filePath || !existsSync(filePath),
    } : null;

    return Response.json({
      sessionId: id,
      filePath,
      info,
      leafId,
      tree: projectTreeForResponse(sm.getTree()),
      context,
      totalActiveMs: computeSessionTotalActiveMs(entries),
      hasMore,
    });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name } = await req.json() as { name?: string };
    if (typeof name !== "string") {
      return Response.json({ error: "name is required" }, { status: 400 });
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }
    // A live wrapper owns the in-memory session tree; a file-level append would
    // be invisible to it and could be dropped by its next compact/rewrite.
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;

    // Resolve the current session name before applying the rename: a rename may
    // not enter or leave the reserved subagent identity namespace.
    let filePath: string | null = null;
    let currentName: string | undefined;
    if (liveRpc?.inner?.sessionManager) {
      currentName = liveRpc.inner.sessionManager.getSessionName();
    } else {
      filePath = liveRpc ? liveRpc.sessionFile ?? await resolveSessionPath(id) : await resolveSessionPath(id);
      if (!liveRpc && !filePath) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }
      currentName = filePath ? SessionManager.open(filePath).getSessionName() : undefined;
    }
    const currentReserved = isReservedSubagentSessionName(currentName);
    const nextReserved = isReservedSubagentSessionName(trimmedName);
    if (currentReserved !== nextReserved) {
      return Response.json({ error: "subagent session names are reserved" }, { status: 409 });
    }

    if (liveRpc) {
      await liveRpc.send({ type: "set_session_name", name: trimmedName });
    } else {
      // filePath is resolved above whenever !liveRpc passes the 404 check.
      SessionManager.open(filePath!).appendSessionInfo(trimmedName);
    }
    invalidateSessionListCache();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      // Transient session that has not been persisted yet: stop the live
      // wrapper so it cannot outlive the delete or later flush a ghost file.
      const rpc = getRpcSession(id);
      if (!rpc?.isAlive()) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }
      await rpc.shutdown();
      invalidateSessionPathCache(id);
      invalidateSessionListCache();
      return Response.json({ ok: true });
    }
    // The path cache is an index, not an ownership record. Verify the header
    // actually belongs to this id before unlinking or reparenting anything.
    if (readSessionHeader(filePath)?.id !== id) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    // Read only the bounded header before deleting.
    const parentSessionPath = readSessionHeader(filePath)?.parentSession;

    // Stop live child writers before rewriting their files, then re-attach
    // them to this session's parent (cascade re-parent).
    const targetPathKey = sessionPathKey(filePath);
    const dir = dirname(filePath);
    const childPaths: string[] = [];
    try {
      const files = readdirSync(dir).filter(
        (file) => file.endsWith(".jsonl") && sessionPathKey(join(dir, file)) !== targetPathKey,
      );
      for (const file of files) {
        const childPath = join(dir, file);
        const header = readSessionHeader(childPath);
        if (
          header?.parentSession &&
          sessionPathKey(header.parentSession) === targetPathKey
        ) {
          childPaths.push(childPath);
          const childId = header.id || await resolveSessionIdByPath(childPath);
          if (childId) await getRpcSession(childId)?.shutdown();
        }
      }
    } catch { /* skip if dir unreadable */ }

    for (const childPath of childPaths) {
      try {
        const content = readFileSync(childPath, "utf8");
        const lines = content.split("\n");
        const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
        header.parentSession = parentSessionPath;
        lines[0] = JSON.stringify(header);
        writeFileSync(childPath, lines.join("\n"));
      } catch { /* skip malformed */ }
    }

    await getRpcSession(id)?.shutdown();
    unlinkSync(filePath);
    invalidateSessionPathCache(id);
    invalidateSessionListCache();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
