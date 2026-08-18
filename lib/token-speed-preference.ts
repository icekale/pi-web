export const TOKEN_SPEED_PREF_KEY = "pi-token-speed-enabled";

type ReadableStorage = Pick<Storage, "getItem"> | null | undefined;
type WritableStorage = Pick<Storage, "setItem"> | null | undefined;

export function isTokenSpeedEnabled(storage?: ReadableStorage): boolean {
  if (!storage) return true;
  const stored = storage.getItem(TOKEN_SPEED_PREF_KEY);
  return stored === null ? true : stored === "true";
}

export function setTokenSpeedEnabled(enabled: boolean, storage?: WritableStorage): void {
  storage?.setItem(TOKEN_SPEED_PREF_KEY, String(enabled));
}
