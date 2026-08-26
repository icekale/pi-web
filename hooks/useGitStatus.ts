"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GitStatusResponse } from "@/lib/git-types";

export const GIT_STATUS_POLL_INTERVAL_MS = 8_000;

export function shouldPollGitStatus(input: { open: boolean; tabVisible: boolean }): boolean {
  return input.open && input.tabVisible;
}

function isHiddenStatus(status: number): boolean {
  return status === 400 || status === 403 || status === 404;
}

function isGitStatusResponse(value: unknown): value is GitStatusResponse {
  return typeof value === "object"
    && value !== null
    && "isGitRepository" in value
    && typeof value.isGitRepository === "boolean"
    && Array.isArray((value as GitStatusResponse).files);
}

export function useGitStatus(input: {
  cwd: string | null | undefined;
  refreshKey?: number;
  open: boolean;
}): {
  status: GitStatusResponse | null;
  visible: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const { cwd, refreshKey = 0, open } = input;
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [tabVisible, setTabVisible] = useState(() => (
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  ));

  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const nextCwd = cwdRef.current;
    if (!nextCwd) {
      abortRef.current?.abort();
      setStatus(null);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/git/status?cwd=${encodeURIComponent(nextCwd)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted || cwdRef.current !== nextCwd) return;
      if (isHiddenStatus(response.status)) {
        setStatus(null);
        return;
      }
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (controller.signal.aborted || cwdRef.current !== nextCwd) return;
      setStatus(isGitStatusResponse(body) && body.isGitRepository ? body : null);
    } catch {
      if (controller.signal.aborted || cwdRef.current !== nextCwd) return;
    } finally {
      if (!controller.signal.aborted && cwdRef.current === nextCwd) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setStatus(null);
  }, [cwd]);

  useEffect(() => {
    void refresh();
  }, [cwd, refreshKey, refresh]);

  useEffect(() => {
    const onVisibility = () => {
      const visible = document.visibilityState === "visible";
      setTabVisible(visible);
      if (visible) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh]);

  useEffect(() => {
    if (!shouldPollGitStatus({ open, tabVisible })) return;
    const timer = setInterval(() => {
      void refresh();
    }, GIT_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [open, refresh, tabVisible]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    status,
    visible: status?.isGitRepository === true,
    loading,
    refresh,
  };
}
