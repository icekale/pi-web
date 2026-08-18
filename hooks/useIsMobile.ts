"use client";

import { useSyncExternalStore } from "react";

const MOBILE_QUERY = "(max-width: 640px)";
const WIDE_DESKTOP_QUERY = "(min-width: 1280px)";

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => {
      if (typeof window === "undefined" || !window.matchMedia) return false;
      return window.matchMedia(query).matches;
    },
    () => false,
  );
}

/** Viewport at or below 640px. SSR and first paint are desktop (false). */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}

export function useIsWideDesktop(): boolean {
  return useMediaQuery(WIDE_DESKTOP_QUERY);
}
