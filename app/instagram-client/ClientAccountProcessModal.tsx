"use client";

import type { ClientProcessProjection } from "@/lib/instagram-client/client-account-process-projection";

type Props = {
  open: boolean;
  lang: "fr" | "en";
  username?: string;
  projection: ClientProcessProjection | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  onClose: () => void;
};

function labelFor(lang: "fr" | "en", fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

function stepIcon(status: string) {
  if (status === "done") return "✓";
  if (status === "failed") return "!";
  if (status === "action_required") return "!";
  return "…";
}

export default function ClientAccountProcessModal({
  open,
  lang,
  username,
  projection,
  refreshing = false,
  onRefresh,
  onClose,
}: Props) {
  if (!open || !projection) return null;

  const canClose = true;

  return (
    <div className="cd-progress-overlay" role="presentation" onMouseDown={() => canClose && onClose()}>
      <section
        className="cd-progress-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cd-client-process-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="cd-progress-header">
          <div>
            {username ? <span>@{username} · Instagram</span> : null}
            <h3 id="cd-client-process-title">{projection.title}</h3>
            <p>{projection.subtitle}</p>
          </div>
          <em className={`status-${projection.statusTone === "success" ? "connected" : projection.statusTone === "warning" ? "action_required" : projection.statusTone === "error" ? "failed" : "running"}`}>
            {projection.statusChip}
          </em>
        </header>

        <section className="cd-progress-steps">
          {projection.steps.map((step) => (
            <div key={step.id} className={`cd-progress-step status-${step.status}`}>
              <span aria-hidden="true">{stepIcon(step.status)}</span>
              <div>
                <strong>{step.label}</strong>
                {step.subtitle ? <small>{step.subtitle}</small> : null}
              </div>
            </div>
          ))}
        </section>

        {projection.finalMessage ? (
          <p className={`cd-progress-action${projection.outcome === "success" ? " cd-progress-action-success" : ""}`}>
            {projection.finalMessage}
          </p>
        ) : null}

        <div className="cd-connect-actions">
          {projection.showRefresh && onRefresh ? (
            <button type="button" className="cd-btn cd-btn-primary" disabled={refreshing} onClick={() => onRefresh()}>
              {refreshing
                ? labelFor(lang, "Actualisation…", "Refreshing…")
                : labelFor(lang, "Actualiser", "Refresh")}
            </button>
          ) : null}
          <button type="button" className="cd-btn cd-btn-soft" onClick={onClose}>
            {projection.outcome === "running"
              ? labelFor(lang, "Fermer", "Close")
              : labelFor(lang, "Fermer", "Close")}
          </button>
        </div>
      </section>
    </div>
  );
}
