import {
  SessionManager,
  buildContextEntries as piBuildContextEntries,
  buildSessionContext as piBuildSessionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, unlinkSync } from "fs";
import type { Stats } from "fs";
import { DatabaseSync } from "node:sqlite";
import { basename, dirname, join, normalize as normalizePath } from "path";
import type { AgentMessage, SessionEntry, SessionHeader, SessionInfo, SessionContext, SessionTreeNode } from "./types";
import type { SessionEntry as PiSessionEntry } from "@earendil-works/pi-coding-agent";
import { extractGoalFromEntries } from "./goal-panel";
import { normalizeToolCalls } from "./normalize";
import { sessionPathKey } from "./paths";
import { projectTreeForResponse } from "./project-tree";
import { SESSION_MESSAGE_WINDOW, SESSION_WINDOW_INITIAL_BYTES, SESSION_WINDOW_MAX_BYTES, sliceSessionContext } from "./session-window";
import { computeSessionTotalActiveMs } from "./session-timing";
import { resolveProject, type ProjectInfo } from "./worktree";

export { getAgentDir };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function attachSessionProjectInfo(sessions: SessionInfo[]): Promise<SessionInfo[]> {
  const uniqueCwds = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return sessions.map((session) => {
    const project = session.cwd ? projectByCwd.get(session.cwd) : undefined;
    return {
      ...session,
      projectRoot: project?.projectRoot ?? session.cwd,
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

export function mergeSessionLists(
  persistedSessions: SessionInfo[],
  supplementalSessions: SessionInfo[],
): SessionInfo[] {
  const byId = new Map(supplementalSessions.map((session) => [session.id, session]));
  // A disk scan is authoritative once the JSONL exists. In particular, this
  // replaces a transient registry snapshot without briefly rendering two rows.
  for (const session of persistedSessions) byId.set(session.id, session);
  return [...byId.values()].sort((a, b) => b.modified.localeCompare(a.modified));
}

const INDEX_VERSION = 3;
const START_SCAN_MAX_BYTES = 1024 * 1024;
const TAIL_SCAN_MAX_BYTES = 256 * 1024;
const FIRST_MESSAGE_MAX_CHARS = 200;

type SessionFileRecord = {
  size: number;
  mtimeMs: number;
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  firstMessage: string;
  messageCount: number | null;
  parentSession?: string;
};

type SessionIndexState = {
  files: Record<string, SessionFileRecord>;
  dirty: boolean;
};

function getSessionsDir(): string {
  return join(getAgentDir(), "sessions");
}

function getIndexPath(): string {
  return join(getAgentDir(), "sessions-index.sqlite");
}

function getLegacyIndexPath(): string {
  return join(getAgentDir(), "sessions-index.json");
}

type IndexFileRow = {
  path: string;
  size: number;
  mtimeMs: number;
  id: string;
  cwd: string;
  name: string | null;
  created: string;
  modified: string;
  firstMessage: string;
  messageCount: number | null;
  parentSession: string | null;
};

function withSessionIndexDb<T>(fn: (db: DatabaseSync) => T): T | null {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(getIndexPath());
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        mtimeMs REAL NOT NULL,
        id TEXT NOT NULL,
        cwd TEXT NOT NULL,
        name TEXT,
        created TEXT NOT NULL,
        modified TEXT NOT NULL,
        firstMessage TEXT NOT NULL,
        messageCount INTEGER,
        parentSession TEXT
      );
    `);
    const version = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value: string } | undefined;
    if (version?.value !== String(INDEX_VERSION)) {
      db.exec("DELETE FROM files");
      db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('version', ?)").run(String(INDEX_VERSION));
    }
    return fn(db);
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

function recordFromRow(row: IndexFileRow): SessionFileRecord {
  return {
    size: row.size,
    mtimeMs: row.mtimeMs,
    id: row.id,
    cwd: row.cwd,
    ...(row.name ? { name: row.name } : {}),
    created: row.created,
    modified: row.modified,
    firstMessage: row.firstMessage,
    messageCount: row.messageCount,
    ...(row.parentSession ? { parentSession: row.parentSession } : {}),
  };
}

function readSessionIndex(): SessionIndexState {
  const files = withSessionIndexDb((db) => {
    const rows = db.prepare("SELECT * FROM files").all() as IndexFileRow[];
    const mapped: Record<string, SessionFileRecord> = {};
    for (const row of rows) mapped[row.path] = recordFromRow(row);
    return mapped;
  });
  return { files: files ?? {}, dirty: false };
}

function writeSessionIndex(index: SessionIndexState): void {
  withSessionIndexDb((db) => {
    db.exec("BEGIN");
    try {
      db.exec("DELETE FROM files");
      const insert = db.prepare(`
        INSERT INTO files (
          path, size, mtimeMs, id, cwd, name, created, modified, firstMessage, messageCount, parentSession
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [path, rec] of Object.entries(index.files)) {
        insert.run(
          path,
          rec.size,
          rec.mtimeMs,
          rec.id,
          rec.cwd,
          rec.name ?? null,
          rec.created,
          rec.modified,
          rec.firstMessage,
          rec.messageCount,
          rec.parentSession ?? null,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* ignore */ }
      throw error;
    }
    return true;
  });
  try { unlinkSync(getLegacyIndexPath()); } catch { /* ignore */ }
}

function collectTopLevelJsonl(): string[] {
  const sessionsDir = getSessionsDir();
  let cwdDirs;
  try {
    cwdDirs = readdirSync(sessionsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const files: string[] = [];
  for (const dir of cwdDirs) {
    if (!dir.isDirectory()) continue;
    const cwdPath = join(sessionsDir, dir.name);
    let entries;
    try {
      entries = readdirSync(cwdPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of entries) {
      if (file.isFile() && file.name.endsWith(".jsonl")) files.push(join(cwdPath, file.name));
    }
  }
  return files;
}

async function listTopLevelSessionFiles(): Promise<string[]> {
  const override = globalThis.__piListSessionFiles;
  if (override) return await override();
  return collectTopLevelJsonl();
}

function extractUserText(entry: Record<string, unknown>): string {
  if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "user") return "";
  const content = entry.message.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => (
      isRecord(block) && block.type === "text" && typeof block.text === "string"
    ))
    .map((block) => block.text)
    .join(" ")
    .trim();
}

function consumeSessionLines(
  text: string,
  state: { header?: SessionHeader | null; name?: string; firstMessage: string; messageCount: number },
  options: { skipPartialFirst: boolean; dropPartialLast: boolean; countMessages: boolean },
): void {
  const lines = text.split("\n");
  if (options.skipPartialFirst && lines.length > 0) lines.shift();
  if (options.dropPartialLast && lines.length > 0 && !text.endsWith("\n")) lines.pop();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!state.header) {
      try {
        const header = JSON.parse(line) as SessionHeader;
        state.header = header.type === "session" ? header : null;
      } catch {
        state.header = null;
      }
      continue;
    }
    if (line.includes("session_info") && line.includes("name")) {
      try {
        const parsed = JSON.parse(line) as { type?: string; name?: string };
        if (parsed.type === "session_info" && typeof parsed.name === "string" && parsed.name.trim()) {
          state.name = parsed.name.trim();
        }
      } catch {
        // skip malformed session_info
      }
      continue;
    }
    if (!line.includes('"type":"message"') && !line.includes('"type": "message"')) continue;
    if (options.countMessages) state.messageCount += 1;
    if (state.firstMessage || (!line.includes('"role":"user"') && !line.includes('"role": "user"'))) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const textContent = extractUserText(parsed);
      if (textContent) {
        state.firstMessage = textContent.length > FIRST_MESSAGE_MAX_CHARS
          ? textContent.slice(0, FIRST_MESSAGE_MAX_CHARS)
          : textContent;
      }
    } catch {
      // skip malformed message
    }
  }
}

function scanSessionFileSync(filePath: string, st: Stats): SessionFileRecord | null {
  const fd = openSync(filePath, "r");
  try {
    const startLen = Math.min(st.size, START_SCAN_MAX_BYTES);
    const startBuf = Buffer.allocUnsafe(startLen);
    readSync(fd, startBuf, 0, startLen, 0);
    const isFull = st.size <= START_SCAN_MAX_BYTES;
    const state = { firstMessage: "", messageCount: 0 } as {
      header?: SessionHeader | null;
      name?: string;
      firstMessage: string;
      messageCount: number;
    };
    consumeSessionLines(startBuf.toString("utf8"), state, {
      skipPartialFirst: false,
      dropPartialLast: !isFull,
      countMessages: isFull,
    });
    if (!state.header?.id) return null;
    if (!isFull) {
      const tailLen = Math.min(TAIL_SCAN_MAX_BYTES, st.size);
      const tailBuf = Buffer.allocUnsafe(tailLen);
      readSync(fd, tailBuf, 0, tailLen, st.size - tailLen);
      consumeSessionLines(tailBuf.toString("utf8"), state, {
        skipPartialFirst: st.size > tailLen,
        dropPartialLast: false,
        countMessages: false,
      });
    }
    const created = typeof state.header.timestamp === "string" ? state.header.timestamp : st.mtime.toISOString();
    const parentSession = typeof state.header.parentSession === "string" ? state.header.parentSession : undefined;
    return {
      size: st.size,
      mtimeMs: st.mtimeMs,
      id: state.header.id,
      cwd: typeof state.header.cwd === "string" ? state.header.cwd : "",
      ...(state.name ? { name: state.name } : {}),
      created,
      modified: st.mtime.toISOString(),
      firstMessage: state.firstMessage || "(no messages)",
      messageCount: isFull ? state.messageCount : null,
      ...(parentSession ? { parentSession } : {}),
    };
  } finally {
    closeSync(fd);
  }
}

function sessionInfoFromFile(filePath: string, index: SessionIndexState): SessionInfo | null {
  let st: Stats;
  try {
    st = statSync(filePath);
  } catch {
    return null;
  }
  const key = normalizePath(filePath);
  const cached = index.files[key];
  let rec: SessionFileRecord | null = null;
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs && typeof cached.id === "string") {
    rec = cached;
  } else {
    rec = scanSessionFileSync(filePath, st);
    if (rec) {
      index.files[key] = rec;
      index.dirty = true;
    }
  }
  if (!rec) return null;
  return {
    path: key,
    id: rec.id,
    cwd: rec.cwd,
    ...(rec.name ? { name: rec.name } : {}),
    created: rec.created,
    modified: rec.modified,
    messageCount: rec.messageCount,
    firstMessage: rec.firstMessage || "(no messages)",
    transient: false,
  };
}

function applyParentSessionIds(
  sessions: SessionInfo[],
  index: SessionIndexState,
  extraPathToId?: Map<string, string>,
): void {
  const pathToId = extraPathToId ? new Map(extraPathToId) : new Map<string, string>();
  for (const session of sessions) pathToId.set(sessionPathKey(session.path), session.id);
  for (const session of sessions) {
    const rec = index.files[session.path];
    const parentPath = rec?.parentSession || inferParentSessionPath(session.path);
    const parentId = parentPath ? pathToId.get(sessionPathKey(parentPath)) : undefined;
    if (parentId && parentId !== session.id) session.parentSessionId = parentId;
  }
}

async function loadAllSessions(): Promise<SessionInfo[]> {
  const index = readSessionIndex();
  const used = new Set<string>();
  const sessions: SessionInfo[] = [];
  const seenIds = new Set<string>();

  for (const filePath of await listTopLevelSessionFiles()) {
    const info = sessionInfoFromFile(filePath, index);
    if (!info) continue;
    used.add(info.path);
    if (seenIds.has(info.id)) continue;
    seenIds.add(info.id);
    cacheSessionPath(info.id, info.path);
    sessions.push(info);
  }

  for (const nested of discoverNestedSessions(sessions, index)) {
    used.add(nested.path);
    if (seenIds.has(nested.id)) continue;
    seenIds.add(nested.id);
    cacheSessionPath(nested.id, nested.path);
    sessions.push(nested);
  }

  for (const path of Object.keys(index.files)) {
    if (used.has(path)) continue;
    delete index.files[path];
    index.dirty = true;
  }

  applyParentSessionIds(sessions, index);
  sessions.sort((a, b) => b.modified.localeCompare(a.modified));
  if (index.dirty) writeSessionIndex(index);
  return attachSessionProjectInfo(sessions);
}

const NESTED_SESSION_MAX_DEPTH = 6;

function collectNestedJsonl(rootDir: string): string[] {
  const files: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || current.depth > NESTED_SESSION_MAX_DEPTH) continue;
    let entries;
    try {
      entries = readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current.dir, entry.name);
      if (entry.isDirectory()) stack.push({ dir: path, depth: current.depth + 1 });
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  }
  return files;
}

function inferParentSessionPath(filePath: string): string | undefined {
  let dir = dirname(filePath);
  for (let i = 0; i < NESTED_SESSION_MAX_DEPTH + 2; i += 1) {
    const candidate = `${dir}.jsonl`;
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Finds child JSONL files stored under `{parentStem}/.../session.jsonl`. */
export function discoverNestedSessions(
  parents: Array<Pick<SessionInfo, "id" | "path">>,
  index: SessionIndexState = { files: {}, dirty: false },
): SessionInfo[] {
  const pathToId = new Map(parents.map((parent) => [sessionPathKey(parent.path), parent.id]));
  const found: SessionInfo[] = [];
  for (const parent of parents) {
    const nestedDir = parent.path.replace(/\.jsonl$/i, "");
    if (!existsSync(nestedDir)) continue;
    try {
      if (!statSync(nestedDir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const filePath of collectNestedJsonl(nestedDir)) {
      if (pathToId.has(sessionPathKey(filePath))) continue;
      const info = sessionInfoFromFile(filePath, index);
      if (!info || pathToId.has(sessionPathKey(info.path))) continue;
      pathToId.set(sessionPathKey(info.path), info.id);
      found.push(info);
    }
  }
  applyParentSessionIds(found, index, pathToId);
  return found;
}

export async function listAllSessions(options: { force?: boolean } = {}): Promise<SessionInfo[]> {
  if (options.force) invalidateSessionListCache();
  const generation = globalThis.__piSessionListGeneration ?? 0;

  // Coalescing dedup: concurrent callers share the same in-flight promise
  // only while it belongs to the current cache generation.
  if (globalThis.__piSessionListPromise && globalThis.__piSessionListPromiseGeneration === generation) {
    return globalThis.__piSessionListPromise;
  }

  const loadPromise = loadAllSessions().then((data) => {
    // If a mutation invalidated this scan, make this caller join (or start) a
    // scan for the current generation. Returning the stale result here made a
    // refresh race indistinguishable from a successful refresh.
    if ((globalThis.__piSessionListGeneration ?? 0) !== generation) {
      return listAllSessions();
    }
    return data;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (globalThis.__piSessionListPromise === trackedPromise) {
      globalThis.__piSessionListPromise = undefined;
      globalThis.__piSessionListPromiseGeneration = undefined;
    }
  });

  globalThis.__piSessionListPromise = trackedPromise;
  globalThis.__piSessionListPromiseGeneration = generation;
  return trackedPromise;
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToSessionIdCache: Map<string, string> | undefined;
  var __piSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __piSessionListPromiseGeneration: number | undefined;
  var __piSessionListGeneration: number | undefined;
  var __piSessionListCache: { data: SessionInfo[]; ts: number } | undefined;
  var __piListSessionFiles: (() => string[] | Promise<string[]>) | undefined;
}

export function invalidateSessionListCache(): void {
  globalThis.__piSessionListGeneration = (globalThis.__piSessionListGeneration ?? 0) + 1;
  globalThis.__piSessionListCache = undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__piPathToSessionIdCache) globalThis.__piPathToSessionIdCache = new Map();
  return globalThis.__piPathToSessionIdCache;
}

function findSessionPathOnDisk(sessionId: string): string | null {
  const index = readSessionIndex();
  for (const [file, rec] of Object.entries(index.files)) {
    if (rec.id === sessionId && existsSync(file)) return file;
  }
  const files = collectNestedJsonl(getSessionsDir());
  const hinted: string[] = [];
  const rest: string[] = [];
  for (const file of files) {
    if (basename(file).includes(sessionId)) hinted.push(file);
    else rest.push(file);
  }
  for (const file of hinted) {
    if (readSessionHeader(file)?.id === sessionId) return file;
  }
  for (const file of rest) {
    if (readSessionHeader(file)?.id === sessionId) return file;
  }
  return null;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  const found = findSessionPathOnDisk(sessionId);
  if (found) {
    cacheSessionPath(sessionId, found);
    return found;
  }

  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = sessionPathKey(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  if (existsSync(filePath)) {
    const header = readSessionHeader(filePath);
    if (header?.id) {
      cacheSessionPath(header.id, filePath);
      return header.id;
    }
    return undefined;
  }

  await listAllSessions();
  return getPathToIdCache().get(pathKey);
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  const normalizedPath = normalizePath(filePath);
  const pathKey = sessionPathKey(normalizedPath);
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const previousPath = pathCache.get(sessionId);
  const previousPathKey = previousPath ? sessionPathKey(previousPath) : undefined;
  const previousSessionId = reverseCache.get(pathKey);
  const previousOwnerPath = previousSessionId ? pathCache.get(previousSessionId) : undefined;
  if (previousPathKey && previousPathKey !== pathKey && reverseCache.get(previousPathKey) === sessionId) {
    reverseCache.delete(previousPathKey);
  }
  if (
    previousSessionId &&
    previousSessionId !== sessionId &&
    previousOwnerPath &&
    sessionPathKey(previousOwnerPath) === pathKey
  ) {
    pathCache.delete(previousSessionId);
  }
  pathCache.set(sessionId, normalizedPath);
  reverseCache.set(pathKey, sessionId);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const filePath = pathCache.get(sessionId);
  pathCache.delete(sessionId);
  const pathKey = filePath ? sessionPathKey(filePath) : undefined;
  if (pathKey && reverseCache.get(pathKey) === sessionId) {
    reverseCache.delete(pathKey);
  }
}

export function readSessionHeader(filePath: string): SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    const maxHeaderBytes = 64 * 1024;
    let position = 0;
    let foundNewline = false;

    while (position < maxHeaderBytes && !foundNewline) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxHeaderBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const data = buffer.subarray(0, bytesRead);
      const newlineIndex = data.indexOf(0x0a);
      chunks.push(newlineIndex === -1 ? data : data.subarray(0, newlineIndex));
      position += bytesRead;
      foundNewline = newlineIndex !== -1;
    }

    if (!foundNewline && position >= maxHeaderBytes) return null;
    const firstLine = Buffer.concat(chunks).toString("utf8").trimEnd();
    if (!firstLine) return null;
    try {
      const header = JSON.parse(firstLine) as SessionHeader;
      return header.type === "session" ? header : null;
    } catch {
      return null;
    }
  } finally {
    closeSync(fd);
  }
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = SessionManager.open(filePath).getEntries();
  return entries as unknown as SessionEntry[];
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean; deferToolResults?: boolean } = {},
): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  const contextEntries = piBuildContextEntries(
    piEntries,
    leafId,
    byId as unknown as Map<string, PiSessionEntry>,
  );

  // Convert the SDK-selected context entries and their IDs together. This keeps
  // fork/navigation targets aligned while preserving pi's compaction ordering.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of contextEntries) {
    const localEntry = entry as unknown as SessionEntry;
    const m = entryToUiMessage(localEntry, options);
    if (m) {
      messages.push(m);
      entryIds.push(localEntry.id);
    }
  }

  return {
    messages,
    entryIds,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
    goal: extractGoalFromEntries(entries),
  };
}

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof block.data === "string") {
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
  }
  if (!data) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}

const DEFERRED_TOOL_RESULT_CHARS = 20_000;

function deferToolResultContent(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult") return message;
  const contentLength = JSON.stringify({
    content: message.content,
    details: message.details,
  }).length;
  if (contentLength <= DEFERRED_TOOL_RESULT_CHARS) return message;
  return {
    ...message,
    content: [],
    details: undefined,
    deferred: true,
    contentLength,
  };
}

function omitToolResultBase64Images(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult") return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const content = message.content.filter((block) => {
    const image = base64ImageInfo(block);
    if (!image) return true;
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return false;
  });
  if (omitted === 0) return message;

  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
  });
  return { ...message, content };
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
function entryToUiMessage(
  entry: SessionEntry,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean; deferToolResults?: boolean },
): AgentMessage | null {
  // Supported message roles: user, assistant, toolResult, bashExecution.
  // bashExecution messages enter the case "message" branch (entry.type === "message").
  // The early return at line below ("!options.deferThinking || message.role !== "assistant"")
  // passes non-assistant messages — including bashExecution — through unchanged.
  // normalizeToolCalls is a secondary guard (returns non-assistant messages as-is).
  switch (entry.type) {
    case "message": {
      const normalized = options.deferToolResultImages
        ? omitToolResultBase64Images(normalizeToolCalls(entry.message))
        : normalizeToolCalls(entry.message);
      const message = options.deferToolResults
        ? deferToolResultContent(normalized)
        : normalized;
      if (!options.deferThinking || message.role !== "assistant") return message;
      return {
        ...message,
        content: message.content.map((block) => (
          block.type === "thinking" && block.thinking.trim() !== ""
            ? { ...block, thinking: "", deferred: true }
            : block
        )),
      };
    }
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: entry.summary,
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    default:
      return null;
  }
}

export function readCachedSessionInfo(filePath: string): SessionInfo | null {
  const index = readSessionIndex();
  const info = sessionInfoFromFile(filePath, index);
  if (index.dirty) writeSessionIndex(index);
  return info;
}

export type SessionWindow = {
  context: SessionContext;
  hasMore: boolean;
  leafId: string | null;
  tree: SessionTreeNode[];
  totalActiveMs: number;
};

function nextLineStart(filePath: string, pos: number, limit: number): number {
  if (pos <= 0) return 0;
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(64 * 1024);
    let offset = pos;
    while (offset < limit) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, limit - offset), offset);
      if (n <= 0) break;
      const nl = buf.subarray(0, n).indexOf(0x0a);
      if (nl !== -1) return offset + nl + 1;
      offset += n;
    }
    return pos;
  } finally {
    closeSync(fd);
  }
}

function parseJsonlRange(filePath: string, start: number, end: number): SessionEntry[] {
  if (end <= start) return [];
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(end - start);
    const n = readSync(fd, buf, 0, buf.length, start);
    const text = buf.subarray(0, n).toString("utf8");
    const entries: SessionEntry[] = [];
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { type?: string; id?: string };
        if (parsed?.type && parsed.type !== "session" && typeof parsed.id === "string") {
          entries.push(parsed as SessionEntry);
        }
      } catch {
        // skip malformed or split lines
      }
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

function treeFromEntries(entries: SessionEntry[]): SessionTreeNode[] {
  const nodeMap = new Map<string, SessionTreeNode>();
  const roots: SessionTreeNode[] = [];
  for (const entry of entries) {
    nodeMap.set(entry.id, { entry, children: [] });
  }
  for (const entry of entries) {
    const node = nodeMap.get(entry.id)!;
    const parent = entry.parentId ? nodeMap.get(entry.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return projectTreeForResponse(roots);
}

const EMPTY_CONTEXT: SessionContext = {
  messages: [],
  entryIds: [],
  thinkingLevel: "off",
  model: null,
};

function windowFromEntries(
  entries: SessionEntry[],
  options: {
    limit: number;
    before?: string;
    leafId?: string | null;
    reachedStart: boolean;
    hitByteCap?: boolean;
    deferThinking?: boolean;
    deferToolResultImages?: boolean;
    deferToolResults?: boolean;
  },
): { ready: boolean; context: SessionContext; hasMore: boolean; leafId: string | null } {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  if (options.before && !byId.has(options.before)) {
    return { ready: false, context: EMPTY_CONTEXT, hasMore: true, leafId: null };
  }
  if (options.leafId && !byId.has(options.leafId) && !options.reachedStart && !options.hitByteCap) {
    return { ready: false, context: EMPTY_CONTEXT, hasMore: true, leafId: options.leafId };
  }
  const leafId = options.leafId && byId.has(options.leafId)
    ? options.leafId
    : (entries.at(-1)?.id ?? null);

  let current = leafId ? byId.get(leafId) : undefined;
  let compactionFirstKept: string | undefined;
  while (current) {
    if (current.type === "compaction" && typeof current.firstKeptEntryId === "string") {
      compactionFirstKept = current.firstKeptEntryId;
    }
    if (!current.parentId) break;
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  if (compactionFirstKept && !byId.has(compactionFirstKept) && !options.reachedStart && !options.hitByteCap) {
    return { ready: false, context: EMPTY_CONTEXT, hasMore: true, leafId };
  }

  const context = buildSessionContext(entries, leafId, {
    deferThinking: options.deferThinking,
    deferToolResultImages: options.deferToolResultImages,
    deferToolResults: options.deferToolResults,
  });
  const sliced = sliceSessionContext(context, { limit: options.limit, before: options.before });
  const firstId = sliced.context.entryIds[0];
  const firstEntry = firstId ? byId.get(firstId) : undefined;
  const hasMore = sliced.hasMore
    || (firstEntry?.type !== "compaction" && firstEntry?.parentId != null && !options.reachedStart);
  const ready = options.reachedStart
    || sliced.context.messages.length >= options.limit
    || Boolean(options.hitByteCap && sliced.context.messages.length > 0 && !options.before);
  return { ready, context: sliced.context, hasMore, leafId };
}

export function readSessionWindow(
  filePath: string,
  options: {
    limit?: number;
    before?: string;
    leafId?: string | null;
    deferThinking?: boolean;
    deferToolResultImages?: boolean;
    deferToolResults?: boolean;
  } = {},
): SessionWindow {
  const st = statSync(filePath);
  const limit = options.limit ?? SESSION_MESSAGE_WINDOW;
  const fileEnd = st.size;
  let start = nextLineStart(filePath, Math.max(0, fileEnd - SESSION_WINDOW_INITIAL_BYTES), fileEnd);
  let entries = parseJsonlRange(filePath, start, fileEnd);
  while (true) {
    const reachedStart = start === 0;
    const nextStartGuess = Math.max(0, start - SESSION_WINDOW_INITIAL_BYTES);
    const hitByteCap = fileEnd - nextStartGuess >= SESSION_WINDOW_MAX_BYTES;
    const result = windowFromEntries(entries, {
      limit,
      before: options.before,
      leafId: options.leafId,
      reachedStart,
      hitByteCap,
      deferThinking: options.deferThinking,
      deferToolResultImages: options.deferToolResultImages,
      deferToolResults: options.deferToolResults,
    });
    if (result.ready || reachedStart) {
      return {
        context: result.context,
        hasMore: result.hasMore,
        leafId: result.leafId,
        tree: treeFromEntries(entries),
        totalActiveMs: computeSessionTotalActiveMs(entries),
      };
    }
    const prev = start;
    const raw = Math.max(0, prev - SESSION_WINDOW_INITIAL_BYTES);
    start = raw === 0 ? 0 : nextLineStart(filePath, raw, prev);
    if (start >= prev) {
      if (!options.before && fileEnd >= SESSION_WINDOW_MAX_BYTES) {
        const capped = windowFromEntries(entries, {
          limit,
          before: options.before,
          leafId: options.leafId,
          reachedStart: false,
          hitByteCap: true,
          deferThinking: options.deferThinking,
          deferToolResultImages: options.deferToolResultImages,
          deferToolResults: options.deferToolResults,
        });
        return {
          context: capped.context,
          hasMore: true,
          leafId: capped.leafId,
          tree: treeFromEntries(entries),
          totalActiveMs: computeSessionTotalActiveMs(entries),
        };
      }
      start = 0;
    }
    entries = parseJsonlRange(filePath, start, prev).concat(entries);
  }
}

export function findSessionEntry(filePath: string, entryId: string): SessionEntry | undefined {
  const st = statSync(filePath);
  let end = st.size;
  let start = Math.max(0, end - SESSION_WINDOW_INITIAL_BYTES);
  while (true) {
    const found = parseJsonlRange(filePath, start, end).find((entry) => entry.id === entryId);
    if (found) return found;
    if (start === 0) return undefined;
    end = start;
    start = Math.max(0, start - SESSION_WINDOW_INITIAL_BYTES);
  }
}
