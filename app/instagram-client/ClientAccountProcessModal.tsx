"use client";

import type { ClientProcessProjection } from "@/lib/instagram-client/client-account-process-projection";
import type { ClientConnectProgressSnapshot } from "@/lib/instagram-client/connect-progress-projection";
import {
  isActiveClientConnectStatus,
  labelForActiveConnectStatus,
} from "@/lib/instagram-client/connect-operation-state";

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
  const runtimeStatus = connectProgress?.connect_status;
  const isTerminalConnectError = Boolean(
    connectProgress?.failed
    || runtimeStatus === "failed"
    || runtimeStatus === "blocked"
    || runtimeStatus === "not_created",
  );
  const statusChip = runtimeStatus === "verification_required"
    ? labelFor(lang, "Vérification requise", "Verification required")
    : runtimeStatus === "verification_resume_active" || runtimeStatus === "verification_code_submitted"
      ? labelFor(lang, "Vérification en cours", "Verification in progress")
      : runtimeStatus === "verification_code_accepted"
        ? labelFor(lang, "Code enregistré", "Code saved")
      : runtimeStatus === "connected"
        ? labelFor(lang, "Connecté", "Connected")
        : isTerminalConnectError
          ? labelFor(lang, "Erreur", "Error")
          : isActiveClientConnectStatus(runtimeStatus)
            ? labelForActiveConnectStatus(runtimeStatus, lang)
            : projection.statusChip;
  const statusToneClass = runtimeStatus === "verification_required"
    ? "action_required"
    : runtimeStatus === "verification_resume_active" || runtimeStatus === "verification_code_submitted" || runtimeStatus === "verification_code_accepted"
      ? "action_required"
      : runtimeStatus === "connected"
        ? "connected"
        : isTerminalConnectError
          ? "failed"
          : isActiveClientConnectStatus(runtimeStatus)
            ? "running"
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
