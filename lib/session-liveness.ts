const DEFAULT_LEASE_TTL_MS = 45_000;
const DEFAULT_CLIENT_HEARTBEAT_MS = 15_000;

function envMs(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function getSessionLeaseTtlMs(): number {
  return envMs("PI_WEB_SESSION_LEASE_TTL_MS", DEFAULT_LEASE_TTL_MS);
}

export function getSessionLeaseHeartbeatMs(): number {
  return envMs("PI_WEB_SESSION_LEASE_HEARTBEAT_MS", DEFAULT_CLIENT_HEARTBEAT_MS);
}

export function leaseExpiresAt(now = Date.now(), ttlMs = getSessionLeaseTtlMs()): number {
  return now + ttlMs;
}

export function isSessionLeaseActive(
  expiresAt: number | undefined,
  now = Date.now(),
): boolean {
  return typeof expiresAt === "number" && expiresAt > now;
}
