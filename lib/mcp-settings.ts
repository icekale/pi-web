import { createRequire } from "node:module";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parseMcpPaste, projectAuthError, type McpPasteConfig } from "./mcp-paste";
import { getProjectTrustStatus, trustProject } from "./project-trust";

export type McpScope = "global" | "project" | "extension";
export type McpExposure = "codemode" | "deferred" | "direct" | "hidden";

export interface McpServerView {
  name: string;
  scope: McpScope;
  source: string;
  enabled: boolean;
  exposure: McpExposure;
  transport: string;
  editable: boolean;
}

export interface McpListResult {
  cwd: string;
  trusted: boolean;
  requiresTrust: boolean;
  servers: McpServerView[];
  errors: string[];
  login?: { name: string; url?: string; done: boolean; error?: string };
}

type McpConfig = McpPasteConfig & { exposure?: McpExposure };
type Loaded = { servers: Array<{ name: string; config: McpConfig; source: string; scope?: McpScope }>; errors: string[] };

const pendingLogins = new Map<string, { url?: string; done: boolean; error?: string; promise: Promise<void> }>();

function mcpModules() {
  // CJS resolve ignores the package's import-only export and fails in the standalone server.
  const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const local = createRequire(entry);
  return {
    config: local("./extensions/mcp/config.js") as {
      loadMcpConfig(options: { agentDir: string; cwd: string; projectTrusted: boolean }): Loaded;
      addMcpServerConfig(path: string, name: string, config: McpConfig): boolean;
      updateMcpServerConfig(path: string, name: string, patch: { enabled?: boolean; exposure?: McpExposure }): void;
      removeMcpServerConfig(path: string, name: string): boolean;
    },
    cli: local("./extensions/mcp/cli.js") as {
      runMcpCommand(args: string[], options: {
        cwd: string;
        agentDir: string;
        openUrl?: (url: string) => void;
        log?: (line: string) => void;
        error?: (line: string) => void;
      }): Promise<number>;
    },
  };
}

function transportOf(config: McpConfig): string {
  if (config.url) return config.url;
  const args = (config as { args?: string[] }).args ?? [];
  return [config.command, ...args].filter(Boolean).join(" ");
}

export function listMcpServers(cwd: string): McpListResult {
  const agentDir = getAgentDir();
  const trust = getProjectTrustStatus(cwd, agentDir);
  const loaded = mcpModules().config.loadMcpConfig({
    agentDir,
    cwd,
    projectTrusted: trust.trusted,
  });
  const login = [...pendingLogins.entries()].find(([, value]) => !value.done);
  return {
    cwd,
    trusted: trust.trusted,
    requiresTrust: trust.requiresTrust,
    errors: loaded.errors,
    servers: loaded.servers.map((server) => ({
      name: server.name,
      scope: server.scope ?? "global",
      source: server.source,
      enabled: server.config.enabled !== false,
      exposure: server.config.exposure ?? "codemode",
      transport: transportOf(server.config),
      editable: server.scope !== "extension",
    })),
    login: login ? { name: login[0], url: login[1].url, done: login[1].done, error: login[1].error } : undefined,
  };
}

function configPath(cwd: string, scope: McpScope): string {
  return scope === "project" ? join(cwd, ".pi", "mcp.json") : join(getAgentDir(), "mcp.json");
}

function findServer(cwd: string, name: string) {
  return listMcpServers(cwd).servers.find((server) => server.name === name);
}

export async function mutateMcpServer(options: {
  cwd: string;
  action: "add" | "remove" | "toggle" | "exposure" | "check" | "login" | "logout" | "trust";
  name?: string;
  scope?: McpScope;
  enabled?: boolean;
  exposure?: McpExposure;
  paste?: string;
  trust?: boolean;
}): Promise<McpListResult & { output?: string; exitCode?: number }> {
  const cwd = options.cwd;
  const agentDir = getAgentDir();
  if (options.trust) trustProject(cwd, agentDir);
  if (options.action === "trust") return listMcpServers(cwd);

  const { config, cli } = mcpModules();
  const name = options.name?.trim();
  const scope = options.scope === "project" ? "project" : "global";
  if (scope === "project" && options.action !== "check" && !getProjectTrustStatus(cwd, agentDir).trusted) {
    throw new Error("project must be trusted");
  }

  if (options.action === "add") {
    if (!name) throw new Error("name required");
    const parsed = parseMcpPaste(options.paste ?? "");
    if (parsed.error) throw new Error(parsed.error);
    if (scope === "project" && parsed.config && projectAuthError(parsed.config)) {
      throw new Error(projectAuthError(parsed.config));
    }
    if (parsed.config) {
      config.addMcpServerConfig(configPath(cwd, scope), name, {
        ...parsed.config,
        ...(options.exposure ? { exposure: options.exposure } : {}),
      } as McpConfig);
    } else {
      const args = ["add", name, ...(scope === "project" ? ["-l"] : []), ...(options.exposure ? ["--exposure", options.exposure] : [])];
      if (parsed.command!.startsWith("http://") || parsed.command!.startsWith("https://")) args.push("--url", parsed.command!);
      else args.push("--", ...parsed.command!.split(/\s+/));
      const lines: string[] = [];
      const code = await cli.runMcpCommand(args, {
        cwd,
        agentDir,
        openUrl: () => {},
        log: (line) => lines.push(line),
        error: (line) => lines.push(line),
      });
      if (code !== 0) throw new Error(lines.join("\n") || "add failed");
    }
    return listMcpServers(cwd);
  }

  if (!name) throw new Error("name required");
  const current = findServer(cwd, name);
  if (!current && options.action !== "logout") throw new Error("server not found");
  if (current && !current.editable && options.action !== "check" && options.action !== "login" && options.action !== "logout") {
    throw new Error("extension server is read-only");
  }

  if (options.action === "remove") {
    if (!config.removeMcpServerConfig(current!.source, name)) throw new Error("remove failed");
  } else if (options.action === "toggle") {
    config.updateMcpServerConfig(current!.source, name, { enabled: options.enabled ?? !current!.enabled });
  } else if (options.action === "exposure") {
    if (!options.exposure) throw new Error("exposure required");
    config.updateMcpServerConfig(current!.source, name, { exposure: options.exposure });
  } else if (options.action === "check" || options.action === "logout") {
    const lines: string[] = [];
    const args = options.action === "check" ? ["list", "--json"] : ["logout", name];
    const code = await cli.runMcpCommand(args, {
      cwd,
      agentDir,
      openUrl: () => {},
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
    });
    const output = lines.join("\n");
    if (code !== 0 && options.action === "logout") throw new Error(output || "logout failed");
    return { ...listMcpServers(cwd), output, exitCode: code };
  } else if (options.action === "login") {
    const existing = pendingLogins.get(name);
    if (existing && !existing.done) return listMcpServers(cwd);
    const pending = { url: undefined as string | undefined, done: false, error: undefined as string | undefined, promise: Promise.resolve() };
    pending.promise = cli.runMcpCommand(["login", name, "--timeout", "300"], {
      cwd,
      agentDir,
      openUrl: (url) => { pending.url = url; },
      log: (line) => {
        const match = line.match(/https?:\/\/\S+/);
        if (match && !pending.url) pending.url = match[0];
      },
      error: (line) => { pending.error = line; },
    }).then((code) => {
      pending.done = true;
      if (code !== 0 && !pending.error) pending.error = "login failed";
    }).catch((error: unknown) => {
      pending.done = true;
      pending.error = error instanceof Error ? error.message : String(error);
    });
    pendingLogins.set(name, pending);
  }
  return listMcpServers(cwd);
}
