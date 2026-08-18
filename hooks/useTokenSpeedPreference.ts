"use client";

import { useCallback, useState } from "react";
import { isTokenSpeedEnabled, setTokenSpeedEnabled } from "@/lib/token-speed-preference";

export function useTokenSpeedPreference() {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return isTokenSpeedEnabled(window.localStorage);
  });

  const toggle = useCallback(() => {
    const next = !enabled;
    if (typeof window !== "undefined") setTokenSpeedEnabled(next, window.localStorage);
    setEnabled(next);
  }, [enabled]);

  return { tokenSpeedEnabled: enabled, onTokenSpeedToggle: toggle };
}
