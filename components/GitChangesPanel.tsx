"use client";

import { useMemo, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useGitStatus } from "@/hooks/useGitStatus";
import { useI18n } from "@/hooks/useI18n";
import { buildGitChangeRows } from "@/lib/git-changes-ui";
import { getFileIcon } from "./FileIcons";

export interface GitChangesOpenFileOptions {
  modeHint?: "diff";
}

interface Props {
  cwd: string | null | undefined;
  refreshKey?: number;
  onOpenFile?: (filePath: string, fileName: string, options?: GitChangesOpenFileOptions) => void;
}

function Chevron({ open }: { open: boolean }) {
  return <ChevronRight className="codex-sidebar-chevron" data-open={open} size={14} strokeWidth={2} aria-hidden="true" />;
}

export function GitChangesPanel({ cwd, refreshKey, onOpenFile }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { status, visible, loading, refresh } = useGitStatus({ cwd, refreshKey, open });

  const { rows, omitted } = useMemo(
    () => (status && cwd ? buildGitChangeRows(status.files, cwd) : { rows: [], omitted: 0 }),
    [cwd, status],
  );

  if (!visible || !cwd || !status) return null;

  const statsTitle = t("files.changeStats", {
    count: status.files.length,
    additions: status.additions,
    deletions: status.deletions,
  });

  return (
    <div className="codex-changes-block">
      <div className="codex-changes-heading-row">
        <button
          type="button"
          className="codex-sidebar-tool-heading"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          title={statsTitle}
        >
          <Chevron open={open} />
          <span>{t("sidebar.changes")}</span>
          <span className="codex-sidebar-count">{status.files.length}</span>
        </button>
        <button
          type="button"
          className="codex-sidebar-icon-button"
          aria-label={t("sidebar.refreshChanges")}
          title={t("sidebar.refreshChanges")}
          disabled={loading}
          onClick={() => { void refresh(); }}
        >
          <RefreshCw size={13} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="codex-sidebar-files" role="list">
          {rows.length === 0 && (
            <div className="codex-sidebar-empty">{t("i18n.noChanges")}</div>
          )}
          {rows.map((row) => (
            <button
              key={row.file.filePath}
              type="button"
              role="listitem"
              className="codex-changes-row"
              data-status={row.file.status}
              title={row.relativePath}
              onClick={() => onOpenFile?.(row.file.filePath, row.fileName, { modeHint: "diff" })}
            >
              <span className="codex-changes-letter" aria-label={t(row.labelKey)}>{row.letter}</span>
              {getFileIcon(row.fileName, 12)}
              <span className="codex-changes-name">{row.fileName}</span>
              {row.directory ? <span className="codex-changes-dir">{row.directory}</span> : null}
            </button>
          ))}
          {omitted > 0 && (
            <div className="codex-sidebar-empty">{t("sidebar.moreChangedFiles", { count: omitted })}</div>
          )}
        </div>
      )}
    </div>
  );
}
