"use client";

import type { ClientProcessProjection } from "@/lib/instagram-client/client-account-process-projection";
import type { ClientConnectProgressSnapshot } from "@/lib/instagram-client/connect-progress-projection";

type Props = {
  open: boolean;
  lang: "fr" | "en";
  username?: string;
  projection: ClientProcessProjection | null;
  connectProgress?: ClientConnectProgressSnapshot | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  onClose: () => void;
  onOpenVerification?: () => void;
  onOpenBotAppPhone?: () => Promise<void> | void;
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
  connectProgress = null,
  refreshing = false,
  onRefresh,
  onClose,
  onOpenVerification,
  onOpenBotAppPhone,
}: Props) {
  if (!open || !projection) return null;

  const canClose = true;
  const runtimeSteps = connectProgress?.steps?.length
    ? connectProgress.steps.map((step) => ({
        id: step.id,
        label: step.label,
        subtitle: step.subtitle,
        status: step.status,
      }))
    : projection.steps;
  const statusChip = connectProgress?.connect_status === "verification_required"
    ? labelFor(lang, "Vérification requise", "Verification required")
    : connectProgress?.connect_status === "connected"
      ? labelFor(lang, "Connecté", "Connected")
      : projection.statusChip;
  const statusToneClass = connectProgress?.connect_status === "verification_required"
    ? "action_required"
    : connectProgress?.connect_status === "connected"
      ? "connected"
      : projection.statusTone === "success"
        ? "connected"
        : projection.statusTone === "warning"
          ? "action_required"
          : projection.statusTone === "error"
            ? "failed"
            : "running";
  const finalMessage = connectProgress?.message || projection.finalMessage;

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
          <em className={`status-${statusToneClass}`}>
            {statusChip}
          </em>
        </header>

        <section className="cd-progress-steps">
          {runtimeSteps.map((step) => (
            <div key={step.id} className={`cd-progress-step status-${step.status}`}>
              <span aria-hidden="true">{stepIcon(step.status)}</span>
              <div>
                <strong>{step.label}</strong>
                {step.subtitle ? <small>{step.subtitle}</small> : null}
              </div>
            </div>
          ))}
        </section>

        {finalMessage ? (
          <p className={`cd-progress-action${projection.outcome === "success" || connectProgress?.connected ? " cd-progress-action-success" : ""}`}>
            {finalMessage}
          </p>
        ) : null}

        <div className="cd-connect-actions">
          {connectProgress?.connect_status === "verification_required" && onOpenVerification ? (
            <button type="button" className="cd-btn cd-btn-primary" onClick={onOpenVerification}>
              {labelFor(lang, "Saisir le code", "Enter code")}
            </button>
          ) : null}
          {connectProgress?.connect_status === "verification_required" && onOpenBotAppPhone ? (
            <button type="button" className="cd-btn cd-btn-soft" onClick={() => void onOpenBotAppPhone()}>
              {labelFor(lang, "Ouvrir le téléphone dans BotApp", "Open phone in BotApp")}
            </button>
          ) : null}
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
