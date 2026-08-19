import type { AgentEventLike } from "./agent-event-wire";

export interface AgentEventSourceLike {
  readonly readyState: number;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export type AgentEventConnectionStatus = "ready_timeout" | "startup_error" | "closed";

export class AgentEventConnectionError extends Error {
  constructor(public readonly status: AgentEventConnectionStatus, message?: string) {
    super(message ?? (
      status === "ready_timeout"
        ? "Timed out starting the agent session. Please try again."
        : "Failed to connect to the agent event stream. Please try again."
    ));
    this.name = "AgentEventConnectionError";
  }
}

type Attempt = {
  promise: Promise<void>;
  ready: boolean;
  succeed(): void;
  fail(error: AgentEventConnectionError): void;
};

type Connection = {
  sessionId: string;
  source: AgentEventSourceLike;
  attempt: Attempt;
};

export interface AgentEventConnectionOptions {
  createSource(sessionId: string): AgentEventSourceLike;
  onEvent(event: AgentEventLike): void;
  shouldMaintain(sessionId: string): boolean;
  readinessTimeoutMs: number;
  reconnectDelayMs: number;
  staleAfterMs?: number;
  now?: () => number;
  onUnexpectedError?(error: unknown): void;
}

export interface EnsureConnectedOptions {
  force?: boolean;
}

const EVENT_SOURCE_OPEN = 1;
const DEFAULT_STALE_AFTER_MS = 45_000;

/** Owns the EventSource, agent-readiness handshake, and passive reconnect. */
export class AgentEventConnection {
  private current: Connection | null = null;
  private retry: { sessionId: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private retryGeneration = 0;
  private lastEventAt = 0;

  constructor(private readonly options: AgentEventConnectionOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private isStale(): boolean {
    const limit = this.options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    if (limit <= 0) return false;
    return this.now() - this.lastEventAt >= limit;
  }

  close(): void {
    this.stopRetrying();
    if (this.current) this.discard(this.current, new AgentEventConnectionError("closed"));
  }

  maintain(sessionId: string): void {
    if (!this.options.shouldMaintain(sessionId)) return;
    const retryGeneration = this.retryGeneration;
    void this.ensureConnected(sessionId).catch((error) => {
      if (retryGeneration !== this.retryGeneration) return;
      if (error instanceof AgentEventConnectionError) {
        if (error.status === "startup_error") this.stopRetrying();
        else this.scheduleRetry(sessionId);
      } else {
        this.options.onUnexpectedError?.(error);
      }
    });
  }

  async ensureConnected(sessionId: string, options: EnsureConnectedOptions = {}): Promise<void> {
    let force = Boolean(options.force);
    while (true) {
      let connection = this.current;
      if (!connection || connection.sessionId !== sessionId) {
        connection = this.open(sessionId);
        force = false;
      } else if (
        connection.attempt.ready
        && connection.source.readyState === EVENT_SOURCE_OPEN
        && !force
        && !this.isStale()
      ) {
        return;
      } else if (connection.attempt.ready && (force || this.isStale())) {
        this.discard(connection, new AgentEventConnectionError("closed"));
        force = false;
        continue;
      }

      await connection.attempt.promise;
      if (this.current !== connection) {
        if (this.current?.sessionId === sessionId) continue;
        throw new AgentEventConnectionError("closed");
      }
      if (connection.source.readyState === EVENT_SOURCE_OPEN && !this.isStale()) return;

      // A once-ready EventSource may otherwise remain CONNECTING indefinitely.
      this.discard(connection, new AgentEventConnectionError("closed"));
    }
  }

  private open(sessionId: string): Connection {
    if (this.current) this.discard(this.current, new AgentEventConnectionError("closed"));
    this.lastEventAt = this.now();

    let source: AgentEventSourceLike;
    try {
      source = this.options.createSource(sessionId);
    } catch (error) {
      throw new AgentEventConnectionError(
        "closed",
        error instanceof Error ? error.message : String(error),
      );
    }

    let settled = false;
    let resolve!: () => void;
    let reject!: (error: AgentEventConnectionError) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const timeout = setTimeout(() => {
      this.fail(connection, new AgentEventConnectionError("ready_timeout"));
    }, this.options.readinessTimeoutMs);
    const attempt: Attempt = {
      promise,
      ready: false,
      succeed() {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      },
      fail(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
    };
    const connection: Connection = { sessionId, source, attempt };
    this.current = connection;

    source.onmessage = (message) => {
      if (this.current !== connection) return;
      this.lastEventAt = this.now();
      let event: AgentEventLike;
      try {
        event = JSON.parse(message.data) as AgentEventLike;
      } catch {
        return;
      }

      if (event.type === "heartbeat") {
        return;
      }
      if (event.type === "connected") {
        attempt.ready = true;
        attempt.succeed();
        this.stopRetrying();
      } else if (event.type === "startup_error") {
        const message = typeof event.errorMessage === "string" ? event.errorMessage : undefined;
        this.fail(connection, new AgentEventConnectionError("startup_error", message));
        return;
      }
      this.options.onEvent(event);
    };
    source.onerror = () => {
      this.fail(connection, new AgentEventConnectionError("closed"));
    };

    return connection;
  }

  private fail(connection: Connection, error: AgentEventConnectionError): void {
    if (this.current !== connection) return;
    this.discard(connection, error);
    if (error.status === "startup_error") this.stopRetrying();
    else this.scheduleRetry(connection.sessionId);
  }

  private discard(connection: Connection, error: AgentEventConnectionError): void {
    connection.attempt.fail(error);
    connection.source.close();
    if (this.current === connection) this.current = null;
  }

  private scheduleRetry(sessionId: string): void {
    if (!this.options.shouldMaintain(sessionId)) return;
    if (this.retry?.sessionId === sessionId) return;
    this.clearRetry();

    const timer = setTimeout(() => {
      if (this.retry?.timer !== timer) return;
      this.retry = null;
      this.maintain(sessionId);
    }, this.options.reconnectDelayMs);
    this.retry = { sessionId, timer };
  }

  private stopRetrying(): void {
    this.retryGeneration += 1;
    this.clearRetry();
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry.timer);
    this.retry = null;
  }
}
