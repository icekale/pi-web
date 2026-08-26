import { existsSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getPackageDir } from "@earendil-works/pi-coding-agent";

export interface PiInvocation {
  command: string;
  prefixArgs: string[];
}

const PI_CLI_SCRIPT_RE = /\/@(?:earendil-works|oh-my-pi)\/pi-coding-agent\/dist\/cli\.js$/;
const PI_CHILD_FLAGS = new Set(["--print", "--no-session", "--export", "--mode"]);

export function isPiCliScript(scriptPath: string | undefined | null): boolean {
  if (!scriptPath) return false;
  return PI_CLI_SCRIPT_RE.test(scriptPath.replaceAll("\\", "/"));
}

export function resolvePiCliPath(): string | null {
  const candidates = new Set<string>();

  try {
    candidates.add(join(getPackageDir(), "dist", "cli.js"));
  } catch {
    // The SDK helper can throw in incomplete test installs.
  }

  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve("@earendil-works/pi-coding-agent/package.json");
    candidates.add(join(dirname(pkgJson), "dist", "cli.js"));
  } catch {
    // The package is not resolvable from this module graph.
  }

  try {
    const resolver = (import.meta as ImportMeta & {
      resolve?: (specifier: string) => string;
    }).resolve;
    if (typeof resolver === "function") {
      const indexUrl = resolver("@earendil-works/pi-coding-agent");
      if (typeof indexUrl === "string") {
        candidates.add(join(dirname(fileURLToPath(indexUrl)), "cli.js"));
      }
    }
  } catch {
    // import.meta.resolve is not always available.
  }

  candidates.add(join(
    process.cwd(),
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  ));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolvePiInvocation(): PiInvocation {
  const cliPath = resolvePiCliPath();
  if (cliPath) return { command: process.execPath, prefixArgs: [cliPath] };
  return { command: "pi", prefixArgs: [] };
}

export function looksLikePiChildArgs(args: readonly unknown[]): boolean {
  return args.some((arg) => typeof arg === "string" && PI_CHILD_FLAGS.has(arg));
}

/**
 * Rewrite a spawn that reused the embedded host's `argv[1]` (Vite / pi-web)
 * as if it were the Pi CLI. Matches the plugin-side guard from
 * cortexkit/magic-context#350.
 */
export function rewriteEmbeddedHostPiInvocation(
  command: unknown,
  args: unknown,
  hostScript = process.argv[1],
  execPath = process.execPath,
): { command: unknown; args: unknown; rewritten: boolean } {
  if (typeof command !== "string" || !Array.isArray(args) || args.length === 0) {
    return { command, args, rewritten: false };
  }
  if (command !== execPath) return { command, args, rewritten: false };

  const script = args[0];
  if (typeof script !== "string" || isPiCliScript(script)) {
    return { command, args, rewritten: false };
  }
  if (!hostScript || script !== hostScript) return { command, args, rewritten: false };
  if (!looksLikePiChildArgs(args.slice(1))) return { command, args, rewritten: false };

  const cliPath = resolvePiCliPath();
  if (!cliPath) return { command, args, rewritten: false };

  return {
    command,
    args: [cliPath, ...args.slice(1)],
    rewritten: true,
  };
}
