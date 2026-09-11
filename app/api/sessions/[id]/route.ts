import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
  listAllSessions,
  mergeSessionLists,
  buildSessionContext,
  readCachedSessionInfo,
  readSessionHeader,
  readSessionWindow,
} from "@/lib/session-reader";
import { sessionPathKey } from "@/lib/paths";
import { attachSessionRelations, isReservedSubagentSessionName } from "@/lib/session-relations";
import { getRpcSession, getRpcSessionInfos } from "@/lib/rpc-manager";
import { jsonResponse } from "@/lib/json-response";
import { projectTreeForResponse } from "@/lib/project-tree";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { parseSessionWindowParams, sliceSessionContext } from "@/lib/session-window";
import type { SessionInfo } from "@/lib/types";

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "ENOENT");
}

function readJsonlSessionName(filePath: string): string | undefined {
  const cached = readCachedSessionInfo(filePath)?.name;
  if (cached) return cached;
  try {
    const text = readFileSync(filePath, "utf8");
    for (const line of text.split("\n")) {
      if (!line.includes("session_info")) continue;
      const parsed = JSON.parse(line) as { type?: string; name?: string };
      if (parsed.type === "session_info" && typeof parsed.name === "string" && parsed.name.trim()) {
        return parsed.name;
      }
    }
  } catch { /* skip unreadable or malformed */ }
  return undefined;
}

function collectSubagentDescendants(sessions: SessionInfo[], rootId: string): SessionInfo[] {
  const byParent = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    if (session.sessionRole !== "subagent" || !session.parentSessionId) continue;
    const list = byParent.get(session.parentSessionId) ?? [];
    list.push(session);
    byParent.set(session.parentSessionId, list);
  }
  const found: SessionInfo[] = [];
  const queue = [rootId];
  const seen = new Set<string>([rootId]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of byParent.get(current) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      found.push(child);
      queue.push(child.id);
    }
  }
  return found;
}

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
      return jsonResponse(req, {
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

    return jsonResponse(req, {
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

    let header;
    try {
      header = readSessionHeader(filePath);
    } catch (error) {
      if (!isEnoent(error)) throw error;
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
    if (header?.id !== id) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    let related: SessionInfo[] = [];
    try {
      const persisted = await listAllSessions({ force: true });
      let runtime: SessionInfo[] = [];
      try { runtime = getRpcSessionInfos(); } catch { /* registry mocks have no inner session */ }
      related = attachSessionRelations(mergeSessionLists(persisted, runtime));
    } catch {
      related = [];
    }
    const descendants = collectSubagentDescendants(related, id);
    const descendantIds = new Set(descendants.map((session) => session.id));
    const descendantPathKeys = new Set(
      descendants.filter((session) => session.path).map((session) => sessionPathKey(session.path)),
    );
    for (const descendant of descendants) {
      await getRpcSession(descendant.id)?.shutdown();
      if (descendant.path) {
        try {
          unlinkSync(descendant.path);
        } catch (error) {
          if (!isEnoent(error)) throw error;
        }
        invalidateSessionPathCache(descendant.id);
      }
    }

    // Read only the bounded header before deleting.
    const parentSessionPath = header.parentSession;

    // Stop live child writers before rewriting their files, then re-attach
    // them to this session's parent (cascade re-parent). Subagent descendants
    // were deleted above instead of being reparented.
    const targetPathKey = sessionPathKey(filePath);
    const dir = dirname(filePath);
    const childPaths: string[] = [];
    try {
      const files = readdirSync(dir).filter(
        (file) => file.endsWith(".jsonl") && sessionPathKey(join(dir, file)) !== targetPathKey,
      );
      for (const file of files) {
        const childPath = join(dir, file);
        if (descendantPathKeys.has(sessionPathKey(childPath))) continue;
        const childHeader = readSessionHeader(childPath);
        if (childHeader?.id && descendantIds.has(childHeader.id)) continue;
        if (isReservedSubagentSessionName(readJsonlSessionName(childPath))) {
          const childId = childHeader?.id || await resolveSessionIdByPath(childPath);
          if (childId) {
            await getRpcSession(childId)?.shutdown();
            invalidateSessionPathCache(childId);
          }
          try {
            unlinkSync(childPath);
          } catch (error) {
            if (!isEnoent(error)) throw error;
          }
          continue;
        }
        if (
          childHeader?.parentSession &&
          sessionPathKey(childHeader.parentSession) === targetPathKey
        ) {
          childPaths.push(childPath);
          const childId = childHeader.id || await resolveSessionIdByPath(childPath);
          if (childId) await getRpcSession(childId)?.shutdown();
        }
      }
    } catch { /* skip if dir unreadable */ }

    for (const childPath of childPaths) {
      try {
        const content = readFileSync(childPath, "utf8");
        const lines = content.split("\n");
        const childHeader = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
        childHeader.parentSession = parentSessionPath;
        lines[0] = JSON.stringify(childHeader);
        writeFileSync(childPath, lines.join("\n"));
      } catch { /* skip malformed */ }
    }

    await getRpcSession(id)?.shutdown();
    try {
      unlinkSync(filePath);
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
    invalidateSessionPathCache(id);
    invalidateSessionListCache();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
