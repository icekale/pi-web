export type McpPasteConfig = { command?: string; url?: string; auth?: unknown; exposure?: string; enabled?: boolean };

export function parseMcpPaste(raw: string): { config?: McpPasteConfig; command?: string; error?: string } {
  const text = raw.trim();
  if (!text) return { error: "config required" };
  if (!text.startsWith("{")) return { command: text };
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const servers = parsed.mcpServers;
    if (servers && typeof servers === "object" && !Array.isArray(servers)) {
      const entries = Object.values(servers as Record<string, unknown>);
      if (entries.length !== 1 || !entries[0] || typeof entries[0] !== "object") return { error: "paste one server" };
      return { config: entries[0] as McpPasteConfig };
    }
    if (typeof parsed.command === "string" || typeof parsed.url === "string") return { config: parsed as McpPasteConfig };
    return { error: "paste a server config or command" };
  } catch {
    return { error: "invalid JSON" };
  }
}

export function projectAuthError(config: McpPasteConfig): string | undefined {
  return config.auth ? "project mcp.json cannot set auth" : undefined;
}
