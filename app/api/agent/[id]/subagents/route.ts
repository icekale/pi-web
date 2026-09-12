import { attachSessionRelations } from "@/lib/session-relations";
import {
  buildSubagentTree,
  collectLiveSubagentRuns,
  collectLiveSubagentSessionIds,
  findOwnedSubagent,
} from "@/lib/subagent-tree";
import {
  abortSubagent,
  getRpcSession,
  listSubagentRuns,
  notifyRunningChange,
  startRpcSession,
  steerSubagent,
  type AgentSessionWrapper,
} from "@/lib/rpc-manager";
import { listAllSessions, resolveSessionPath } from "@/lib/session-reader";
import type { SubagentTreeResponse, SubagentControlResponse } from "@/lib/api-types";
import type { SessionInfo } from "@/lib/types";
import type { SubagentRunInfo } from "@/lib/subagents";

// ============================================================================
// GET  /api/agent/[rootId]/subagents
// POST /api/agent/[rootId]/subagents
//
// Root-scoped subagent tree and controls, served from the built-in in-process
// subagent runtime. The browser never supplies run ids or run directories: a
// child session id is resolved to an owned child before any control runs.
// ============================================================================

export interface SubagentRouteDeps {
  listSessions: () => Promise<SessionInfo[]>;
  getWrapper: (id: string) => AgentSessionWrapper | undefined;
  startWrapper: (id: string, filePath: string) => Promise<{ session: AgentSessionWrapper }>;
  resolveSessionPath: (id: string) => Promise<string | null>;
  isChildRunning: (id: string) => boolean;
  /** In-memory runs the controller still holds: exactly the queued and running children. */
  listSubagentRuns: () => readonly SubagentRunInfo[];
  steerSubagent: (childSessionId: string, message: string) => Promise<void>;
  abortSubagent: (childSessionId: string) => Promise<void>;
}

const defaultDeps: SubagentRouteDeps = {
  // The cached session list (30s TTL) is fresh enough for durable tree nodes;
  // forcing a full re-scan on every poll made 1.5s polling rebuild the whole
  // session index (including nested discovery) per tick.
  listSessions: () => listAllSessions(),
  getWrapper: (id) => getRpcSession(id),
  startWrapper: async (id, filePath) => startRpcSession(id, filePath, undefined),
  resolveSessionPath: async (id) => resolveSessionPath(id),
  // Built-in children run in-process, so the child's own wrapper is the truth.
  isChildRunning: (id) => getRpcSession(id)?.isRunning() === true,
  listSubagentRuns: () => listSubagentRuns(),
  steerSubagent,
  abortSubagent,
};

async function startRootWrapper(rootId: string, deps: SubagentRouteDeps): Promise<AgentSessionWrapper | null> {
  const existing = deps.getWrapper(rootId);
  if (existing?.isAlive()) return existing;
  const filePath = await deps.resolveSessionPath(rootId);
  if (!filePath) return null;
  try {
    return (await deps.startWrapper(rootId, filePath)).session;
  } catch {
    return null;
  }
}

/** Runtime metadata for the children the controller still holds, keyed by child session id. */
function heldRunMeta(deps: SubagentRouteDeps, sessions: SessionInfo[]): Map<string, SubagentRunInfo> {
  const held = new Map<string, SubagentRunInfo>();
  const related = new Set(
    attachSessionRelations(sessions)
      .filter((session) => session.sessionRole === "subagent")
      .map((session) => session.id),
  );
  for (const run of deps.listSubagentRuns()) {
    if (related.has(run.sessionId)) held.set(run.sessionId, run);
  }
  return held;
}

async function liveRuns(
  rootId: string,
  sessions: SessionInfo[],
  deps: SubagentRouteDeps,
): Promise<ReturnType<typeof collectLiveSubagentRuns>> {
  // The controller's run map is in memory and holds exactly the children that are
  // queued or running, so labeling and stating a live node costs no session read.
  const meta = heldRunMeta(deps, sessions);
  return collectLiveSubagentRuns(rootId, sessions, {
    isRunning: (sessionId) => deps.isChildRunning(sessionId),
    getRun: (sessionId) => meta.get(sessionId) ?? null,
  });
}

function durableTree(rootId: string, sessions: SessionInfo[]): SubagentTreeResponse {
  return buildSubagentTree({
    rootId,
    sessions,
    runs: null,
    rpcAvailable: false,
    unavailableReason: "offline",
    polledAt: Date.now(),
  });
}

function rememberLiveChildren(wrapper: AgentSessionWrapper, sessions: SessionInfo[], runs: Parameters<typeof collectLiveSubagentSessionIds>[1]): void {
  if (typeof wrapper.setLiveSubagentSessionIds !== "function") return;
  if (wrapper.setLiveSubagentSessionIds(collectLiveSubagentSessionIds(sessions, runs))) {
    notifyRunningChange();
  }
}

export function createSubagentHandlers(deps: SubagentRouteDeps = defaultDeps) {
  async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const { id: rootId } = await params;
    try {
      const sessions = await deps.listSessions();
      const related = attachSessionRelations(sessions);
      const root = related.find((session) => session.id === rootId);
      if (!root) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }
      if (root.sessionRole !== "primary") {
        return Response.json({ error: "Subagent tree requires a primary root session" }, { status: 400 });
      }

      const fallback = durableTree(rootId, sessions);
      const wrapper = await startRootWrapper(rootId, deps);
      if (!wrapper) {
        return Response.json(fallback);
      }

      const runs = await liveRuns(rootId, sessions, deps);
      rememberLiveChildren(wrapper, sessions, runs);
      return Response.json(buildSubagentTree({
        rootId,
        sessions,
        runs,
        rpcAvailable: true,
        polledAt: Date.now(),
      }));
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }

  async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const { id: rootId } = await params;
    try {
      const body = await req.json() as {
        childSessionId?: unknown;
        action?: unknown;
        message?: unknown;
      };
      const action = body.action;
      if (action !== "steer" && action !== "interrupt") {
        return Response.json({ error: "Unsupported subagent control action" }, { status: 400 });
      }
      if (typeof body.childSessionId !== "string" || body.childSessionId.length === 0) {
        return Response.json({ error: "childSessionId is required" }, { status: 400 });
      }
      if (action === "interrupt") {
        if (body.message !== undefined && body.message !== null && String(body.message).trim().length > 0) {
          return Response.json({ error: "interrupt does not accept a message" }, { status: 400 });
        }
      } else if (typeof body.message !== "string" || body.message.trim().length === 0) {
        return Response.json({ error: `${action} requires a non-empty message` }, { status: 400 });
      }

      const sessions = await deps.listSessions();
      const child = findOwnedSubagent(rootId, body.childSessionId, sessions);
      if (!child) {
        return Response.json({ error: "Child session does not belong to this root" }, { status: 400 });
      }

      const wrapper = await startRootWrapper(rootId, deps);
      if (!wrapper) {
        return Response.json({ error: "Root session is offline" }, { status: 409 });
      }

      try {
        if (action === "interrupt") {
          await deps.abortSubagent(body.childSessionId);
        } else {
          await deps.steerSubagent(body.childSessionId, (body.message as string).trim());
        }

        const runs = await liveRuns(rootId, sessions, deps);
        rememberLiveChildren(wrapper, sessions, runs);
        const tree = buildSubagentTree({
          rootId,
          sessions,
          runs,
          rpcAvailable: true,
          polledAt: Date.now(),
        });
        return Response.json({
          success: true,
          data: {
            action,
            childSessionId: body.childSessionId,
            tree,
          },
        } satisfies SubagentControlResponse);
      } catch (error) {
        // The controller reports invalid state (not running, no longer queued)
        // and missing children as plain errors; a conflict is the honest answer.
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
      }
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }

  return { GET, POST };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return createSubagentHandlers().GET(req, ctx);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return createSubagentHandlers().POST(req, ctx);
}
