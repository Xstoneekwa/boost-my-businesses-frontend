"use client";

import { useEffect, useMemo, useState } from "react";
import { parseClientApiResponse } from "@/lib/instagram-client/read-api-response";
import type { ClientConnectProgressAction } from "@/lib/instagram-client/connect-progress-projection";

type Props = {
  open: boolean;
  lang: "fr" | "en";
  username: string;
  accountId: string;
  action: ClientConnectProgressAction | null;
  connectStatus?: string | null;
  onClose: () => void;
  onSubmitted?: () => void;
};

function labelFor(lang: "fr" | "en", fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

function challengeStatusMessage(lang: "fr" | "en", status: string | null | undefined, resumeStatus?: string | null) {
  if (resumeStatus === "running") {
    return labelFor(lang, "Vérification en cours.", "Verification in progress.");
  }
  if (resumeStatus === "queued") {
    return labelFor(lang, "Vérification en cours. Reprise automatique en cours.", "Verification in progress. Automatic resume in progress.");
  }
  if (resumeStatus === "needs_new_code") {
    return labelFor(lang, "Instagram demande un nouveau code.", "Instagram still needs a new verification code.");
  }
  if (resumeStatus === "preflight_failed") {
    return labelFor(lang, "La reprise n'a pas pu démarrer. Saisissez le dernier code reçu.", "Resume could not start. Enter the latest code received.");
  }
  return null;
}

export default function ClientVerificationModal({
  open,
  lang,
  username,
  accountId,
  action,
  connectStatus,
  onClose,
  onSubmitted,
}: Props) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmitCode = Boolean(
    action?.can_submit_code
    && connectStatus !== "verification_resume_active"
    && connectStatus !== "verification_code_submitted"
    && connectStatus !== "verification_code_accepted",
  );
  const resumeInProgress = Boolean(
    action
    && !canSubmitCode
    && (action.status === "code_submitted"
      || action.resume_status === "queued"
      || action.resume_status === "running"
      || connectStatus === "verification_resume_active"
      || connectStatus === "verification_code_submitted"
      || connectStatus === "verification_code_accepted"),
  );

  const statusMessage = useMemo(
    () => challengeStatusMessage(lang, action?.status, action?.resume_status),
    [action?.resume_status, action?.status, lang],
  );

  useEffect(() => {
    if (!open) {
      setCode("");
      setMessage(null);
      setError(null);
    }
  }, [open]);

  if (!open || !action) return null;

  async function submitCode() {
    if (!action?.id || !canSubmitCode) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const trimmed = code.trim();
    try {
      const response = await fetch(
        `/api/instagram-client/accounts/${encodeURIComponent(accountId)}/connect/submit-verification-code`,
        {
        method: "POST",
        headers: { "content-type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action_id: action.id,
          verification_code: trimmed,
        }),
      });
      const payload = await parseClientApiResponse<{
        status?: string;
        resume_queued?: boolean;
        resume_already_queued?: boolean;
        resume_request_status?: string | null;
        message?: string;
      }>(response, lang);
      if (!response.ok || payload.ok === false) {
        const safeError = payload.message || payload.error;
        if (safeError?.toLowerCase().includes("invalid")) {
          throw new Error(labelFor(lang, "Code invalide ou expiré.", "Invalid or expired code."));
        }
        throw new Error(safeError || labelFor(lang, "Impossible d'envoyer le code.", "Could not submit the code."));
      }
      setCode("");
      const resumeStarted = payload.data?.resume_queued === true
        || payload.data?.resume_already_queued === true
        || ["queued", "claimed", "starting", "running"].includes(String(payload.data?.resume_request_status || "").toLowerCase());
      setMessage(
        resumeStarted
          ? labelFor(lang, "Vérification en cours. Nous reprenons la connexion automatiquement.", "Verification in progress. We are resuming the connection automatically.")
          : labelFor(lang, "Code enregistré. Nous préparons la reprise de la connexion.", "Code saved. We are preparing to resume the connection."),
      );
      onSubmitted?.();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : labelFor(lang, "Impossible d'envoyer le code.", "Could not submit the code."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="cd-progress-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="cd-progress-modal cd-verification-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cd-verification-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="cd-progress-header">
          <div>
            <span>@{username} · Instagram</span>
            <h3 id="cd-verification-title">
              {labelFor(lang, "Vérification requise", "Verification required")}
            </h3>
            <p>
              {labelFor(
                lang,
                "Instagram demande une vérification avant de terminer la connexion de votre compte.",
                "Instagram requires verification before your account connection can finish.",
              )}
            </p>
          </div>
          <em className="status-action_required">
            {labelFor(lang, "Vérification", "Verification")}
          </em>
        </header>

        {resumeInProgress ? (
          <p className="cd-progress-action">{statusMessage}</p>
        ) : (
          <>
            <label className="cd-verification-label" htmlFor="cd-verification-code">
              {labelFor(lang, "Code de vérification", "Verification code")}
            </label>
            <input
              id="cd-verification-code"
              className="cd-verification-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              disabled={!canSubmitCode || submitting}
            />
            <p className="cd-verification-hint">
              {labelFor(
                lang,
                "Le code est transmis de façon sécurisée et n'est pas conservé dans l'interface.",
                "The code is sent securely and is not kept in the interface.",
              )}
            </p>
          </>
        )}

        {statusMessage && !message ? <p className="cd-verification-hint">{statusMessage}</p> : null}
        {message ? <p className="cd-progress-action cd-progress-action-success">{message}</p> : null}
        {error ? <p className="cd-verification-error">{error}</p> : null}

        <div className="cd-connect-actions">
          {canSubmitCode ? (
            <button
              type="button"
              className="cd-btn cd-btn-primary"
              disabled={submitting || !/^\d{6}$/.test(code.trim())}
              onClick={() => void submitCode()}
            >
              {submitting
                ? labelFor(lang, "Envoi…", "Sending…")
                : labelFor(lang, "Valider le code", "Submit code")}
            </button>
          ) : null}
          <button type="button" className="cd-btn cd-btn-soft" onClick={onClose} disabled={submitting}>
            {labelFor(lang, "Fermer", "Close")}
          </button>
        </div>
      </section>
    </div>
  );
}
