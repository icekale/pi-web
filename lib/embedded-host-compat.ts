import { AsyncLocalStorage } from "async_hooks";
import { createRequire } from "module";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { resolvePiInvocation, rewriteEmbeddedHostPiInvocation } from "./pi-cli";

// Stock @cortexkit/pi-magic-context uses a process-global latch so in-process
// subagent children do not re-init. In pi-web that latch also suppresses the
// second browser session. PR 350 replaces it with ALS; this host layer installs
// the same ALS key and makes the old latch read it.
export const MAGIC_CONTEXT_ACTIVE_LATCH = Symbol.for("magic-context.pi.active");
export const MAGIC_CONTEXT_CHILD_INIT_CONTEXT = Symbol.for("magic-context.pi.child-init-context");
export const MAGIC_CONTEXT_HOST_ADAPTER = Symbol.for("magic-context.pi.host-adapter");
export const MAGIC_CONTEXT_HOST_ADAPTERS = Symbol.for("magic-context.pi.host-adapters");

const SUBAGENT_CHILD_SESSION_CREATED = "subagents:child:session-created";
const SUBAGENT_CHILD_DISPOSED = "subagents:child:disposed";

export interface MagicContextPiHostAdapter {
  readonly id: string;
  readonly mode: "standalone" | "embedded-multi-session";
  getRuntimeKey(pi: object): object;
  resolveSessionCwd(session: { cwd?: string }): string;
  resolvePiInvocation?: () => { command: string; prefixArgs: string[] };
}

type ChildProcessModule = {
  spawn: (...args: unknown[]) => unknown;
  spawnSync: (...args: unknown[]) => unknown;
  execFile: (...args: unknown[]) => unknown;
  execFileSync: (...args: unknown[]) => unknown;
};

type EventBusLike = {
  on(channel: string, handler: (data: unknown) => void): () => void;
};

type ExtensionApiLike = {
  events: EventBusLike;
  on?(event: string, handler: (...args: unknown[]) => unknown): void;
};

declare global {
  var __piEmbeddedHostCompat: EmbeddedHostCompatState | undefined;
}

interface EmbeddedHostCompatState {
  installed: boolean;
  originals?: {
    spawn: ChildProcessModule["spawn"];
    spawnSync: ChildProcessModule["spawnSync"];
    execFile: ChildProcessModule["execFile"];
    execFileSync: ChildProcessModule["execFileSync"];
  };
}

function getCompatState(): EmbeddedHostCompatState {
  if (!globalThis.__piEmbeddedHostCompat) {
    globalThis.__piEmbeddedHostCompat = { installed: false };
  }
  return globalThis.__piEmbeddedHostCompat;
}

export function getPiChildInitContext(): AsyncLocalStorage<boolean> {
  const globals = globalThis as Record<symbol, unknown>;
  const existing = globals[MAGIC_CONTEXT_CHILD_INIT_CONTEXT];
  if (existing instanceof AsyncLocalStorage) return existing;
  const context = new AsyncLocalStorage<boolean>();
  globals[MAGIC_CONTEXT_CHILD_INIT_CONTEXT] = context;
  return context;
}

export function getHostAdapterRegistry(): Map<object, MagicContextPiHostAdapter> {
  const globals = globalThis as Record<symbol, unknown>;
  const existing = globals[MAGIC_CONTEXT_HOST_ADAPTERS];
  if (existing instanceof Map) return existing as Map<object, MagicContextPiHostAdapter>;
  const registry = new Map<object, MagicContextPiHostAdapter>();
  globals[MAGIC_CONTEXT_HOST_ADAPTERS] = registry;
  return registry;
}

function installActiveLatchBridge(): void {
  const context = getPiChildInitContext();
  const current = Object.getOwnPropertyDescriptor(globalThis, MAGIC_CONTEXT_ACTIVE_LATCH);
  if (current?.get && current.set) return;

  Object.defineProperty(globalThis, MAGIC_CONTEXT_ACTIVE_LATCH, {
    configurable: true,
    enumerable: false,
    get() {
      return context.getStore() === true;
    },
    set() {
      // Ignore process-global writes from stock Magic Context. Independent
      // browser sessions must still initialize; only ALS-marked in-process
      // children should look "already active".
    },
  });
}

function loadChildProcess(): ChildProcessModule {
  const require = createRequire(import.meta.url);
  return require("child_process") as ChildProcessModule;
}

function patchChildProcessFn(
  name: "spawn" | "spawnSync" | "execFile" | "execFileSync",
): (...args: unknown[]) => unknown {
  return function patched(this: unknown, ...fnArgs: unknown[]) {
    const original = getCompatState().originals?.[name];
    if (!original) throw new Error(`embedded host compat is missing ${name}`);
    const [command, args, options] = fnArgs;
    if (Array.isArray(args)) {
      const rewritten = rewriteEmbeddedHostPiInvocation(command, args);
      if (rewritten.rewritten) {
        return original.call(this, rewritten.command, rewritten.args, options);
      }
    }
    return original.apply(this, fnArgs);
  };
}

export function uninstallEmbeddedHostCompat(): void {
  const state = getCompatState();
  if (state.originals) {
    const childProcess = loadChildProcess();
    childProcess.spawn = state.originals.spawn;
    childProcess.spawnSync = state.originals.spawnSync;
    childProcess.execFile = state.originals.execFile;
    childProcess.execFileSync = state.originals.execFileSync;
    state.originals = undefined;
  }
  state.installed = false;
}

function installChildProcessRewrite(): void {
  const state = getCompatState();
  if (state.originals) return;

  const childProcess = loadChildProcess();
  state.originals = {
    spawn: childProcess.spawn,
    spawnSync: childProcess.spawnSync,
    execFile: childProcess.execFile,
    execFileSync: childProcess.execFileSync,
  };
  childProcess.spawn = patchChildProcessFn("spawn");
  childProcess.spawnSync = patchChildProcessFn("spawnSync");
  childProcess.execFile = patchChildProcessFn("execFile");
  childProcess.execFileSync = patchChildProcessFn("execFileSync");
}

function announceEmbeddedHostMode(): void {
  if (!process.env.MAGIC_CONTEXT_PI_HOST_MODE) {
    process.env.MAGIC_CONTEXT_PI_HOST_MODE = "embedded-multi-session";
  }
}

export function installEmbeddedHostCompat(): void {
  const state = getCompatState();
  installActiveLatchBridge();
  announceEmbeddedHostMode();
  if (state.installed) return;
  installChildProcessRewrite();
  state.installed = true;
}

export function createEmbeddedHostCompatExtension(options: { cwd: string }): InlineExtension {
  return {
    name: "pi-web-embedded-host",
    hidden: true,
    factory(pi) {
      installEmbeddedHostCompat();
      const api = pi as ExtensionApiLike;
      const context = getPiChildInitContext();
      const unsubscribeCreated = api.events.on(SUBAGENT_CHILD_SESSION_CREATED, () => {
        context.enterWith(true);
      });
      const unsubscribeDisposed = api.events.on(SUBAGENT_CHILD_DISPOSED, () => {
        context.enterWith(false);
      });

      const adapter: MagicContextPiHostAdapter = {
        id: "pi-web",
        mode: "embedded-multi-session",
        getRuntimeKey: (runtime) => runtime,
        resolveSessionCwd: (session) => session.cwd || options.cwd,
        resolvePiInvocation,
      };
      getHostAdapterRegistry().set(api, adapter);
      (globalThis as Record<symbol, unknown>)[MAGIC_CONTEXT_HOST_ADAPTER] = adapter;

      const cleanup = () => {
        unsubscribeCreated();
        unsubscribeDisposed();
        getHostAdapterRegistry().delete(api);
        const current = (globalThis as Record<symbol, unknown>)[MAGIC_CONTEXT_HOST_ADAPTER];
        if (current === adapter) {
          delete (globalThis as Record<symbol, unknown>)[MAGIC_CONTEXT_HOST_ADAPTER];
        }
      };
      api.on?.("session_shutdown", cleanup);
    },
  };
}
