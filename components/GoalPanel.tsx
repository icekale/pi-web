"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { GoalEditMode, GoalPanelModel, GoalPanelStatus } from "@/lib/goal-panel";

const STATUS_COLORS: Record<GoalPanelStatus, string> = {
  active: "var(--ok)",
  paused: "var(--warning)",
  blocked: "var(--error)",
  budget_limited: "var(--error)",
  complete: "var(--text-dim)",
  unknown: "var(--text-muted)",
};

const RESUMABLE = new Set<GoalPanelStatus>(["paused", "blocked", "budget_limited"]);

export function GoalPanel({
  model,
  onAction,
  onEditSubmit,
}: {
  model: GoalPanelModel | null;
  onAction: (subcommand: string) => void;
  onEditSubmit: (objective: string, editMode: GoalEditMode) => void;
}) {
  const { t } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setIsEditing(false);
    setDraft("");
  }, [model?.objective, model?.status]);

  if (!model) return null;

  const dotColor = STATUS_COLORS[model.status];
  const meta = [model.timeLabel, model.budgetLabel].filter(Boolean).join(" · ");

  const startEdit = () => {
    setDraft(model.objective);
    setExpanded(true);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setDraft("");
  };

  const saveEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === model.objective) {
      cancelEdit();
      return;
    }
    onEditSubmit(trimmed, model.editMode);
    setIsEditing(false);
    setDraft("");
  };

  return (
    <div className={expanded ? "goal-panel" : "goal-panel is-collapsed"}>
      <div className="goal-panel-head">
        <button
          type="button"
          className="goal-panel-toggle"
          aria-expanded={expanded}
          title={t(expanded ? "i18n.collapse" : "i18n.expand")}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="goal-panel-dot" title={model.statusLabel} style={{ background: dotColor }} />
          <span className="goal-panel-status" style={{ color: dotColor }}>{model.statusLabel}</span>
          {meta && <span className="goal-panel-meta">{meta}{model.budgetLabel ? "t" : ""}</span>}
          <ChevronRight size={14} aria-hidden="true" className="goal-panel-chevron" />
        </button>
        <div className="goal-panel-actions">
          {model.status === "active" && (
            <button type="button" className="goal-panel-btn" onClick={() => onAction("pause")}>{t("chat.goalPause")}</button>
          )}
          {RESUMABLE.has(model.status) && (
            <button type="button" className="goal-panel-btn goal-panel-btn-primary" onClick={() => onAction("resume")}>{t("chat.goalResume")}</button>
          )}
          {!isEditing && (
            <button type="button" className="goal-panel-btn" onClick={startEdit}>{t("chat.goalEdit")}</button>
          )}
          <button type="button" className="goal-panel-btn" onClick={() => onAction("clear")}>{t("chat.goalClear")}</button>
        </div>
      </div>
      {expanded && isEditing ? (
        <div className="goal-panel-body">
          <textarea
            ref={textareaRef}
            className="goal-panel-editor"
            value={draft}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                saveEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
            }}
          />
          <div className="goal-panel-edit-row">
            <button type="button" className="goal-panel-btn" onClick={cancelEdit}>{t("chat.goalCancel")}</button>
            <button type="button" className="goal-panel-btn goal-panel-btn-primary" onClick={saveEdit}>{t("chat.goalSave")}</button>
          </div>
        </div>
      ) : (
        expanded && model.objective ? <div className="goal-panel-body">{model.objective}</div> : null
      )}
    </div>
  );
}
