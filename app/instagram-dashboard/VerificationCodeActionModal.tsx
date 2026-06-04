"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  actionId: string;
  accountId: string;
  username: string;
  title: string;
  description: string;
  actionType: "enter_email_verification_code" | "review_login_challenge";
  status: string;
  resumeStatus?: string | null;
  autoOpen?: boolean;
};

function resumeMessage(status: string, resumeStatus?: string | null) {
  if (resumeStatus === "running") return "Login resume is running on the assigned device.";
  if (resumeStatus === "queued" || status === "code_submitted") {
    return "Login resume queued. The worker will enter the code automatically.";
  }
  if (resumeStatus === "needs_new_code") {
    return "Instagram still needs a verification code. Enter the latest code.";
  }
  if (resumeStatus === "preflight_failed") {
    return "Resume could not start because the device is not on the email code screen.";
  }
  return null;
}

export default function VerificationCodeActionModal({
  actionId,
  accountId,
  username,
  title,
  description,
  actionType,
  status,
  resumeStatus = null,
  autoOpen = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [autoOpenConsumed, setAutoOpenConsumed] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmitCode =
    actionType === "enter_email_verification_code" &&
    (status === "pending" ||
      status === "acknowledged" ||
      status === "pending_verification" ||
      resumeStatus === "needs_new_code");
  const resumeInProgress =
    actionType === "enter_email_verification_code" &&
    !canSubmitCode &&
    (status === "code_submitted" || resumeStatus === "queued" || resumeStatus === "running");

  const buttonLabel = useMemo(() => {
    if (actionType === "review_login_challenge") return "View details";
    if (resumeInProgress) {
      return resumeStatus === "running" ? "Resume running" : "Resume queued";
    }
    if (!canSubmitCode && status === "code_submitted") return "Code submitted";
    return "Enter code";
  }, [actionType, canSubmitCode, resumeInProgress, resumeStatus, status]);

  useEffect(() => {
    if (!autoOpen || autoOpenConsumed || !canSubmitCode) return;
    setOpen(true);
    setAutoOpenConsumed(true);
  }, [autoOpen, autoOpenConsumed, canSubmitCode]);

  async function submitCode() {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/instagram-dashboard/dashboard-actions/submit-verification-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action_id: actionId,
          account_id: accountId,
          verification_code: code.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        throw new Error(String(body.error || "submit_failed"));
      }
      const queued = body.data?.resume_queued === true;
      const alreadyQueued = body.data?.resume_already_queued === true;
      setMessage(
        queued
          ? "Code submitted. Login resume queued."
          : alreadyQueued
          ? "Code submitted. Login resume was already queued."
          : "Code submitted. Resume provisioning.",
      );
      setCode("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String((err as Error)?.message || "submit_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const statusMessage = resumeMessage(status, resumeStatus);

  return (
    <>
      <button
        type="button"
        className="ig-credentials-link-button"
        disabled={!canSubmitCode && !resumeInProgress && actionType === "enter_email_verification_code"}
        onClick={() => setOpen(true)}
      >
        {buttonLabel}
      </button>

      {open && (
        <div className="ig-verification-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="ig-verification-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`verification-modal-${actionId}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <span>Instagram verification</span>
              <strong id={`verification-modal-${actionId}`}>{title}</strong>
              <p>{username} · {description}</p>
            </header>

            {actionType === "review_login_challenge" ? (
              <p>This challenge is not automated yet. An operator must review the device screen and follow the manual recovery workflow.</p>
            ) : resumeInProgress ? (
              <p>{statusMessage}</p>
            ) : (
              <>
                <label htmlFor={`verification-code-${actionId}`}>Email verification code</label>
                <input
                  id={`verification-code-${actionId}`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6-digit code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                />
                <p className="ig-verification-modal-hint">The code is sent securely and is not stored in the dashboard UI after submission.</p>
              </>
            )}

            {error ? <p className="ig-verification-modal-error">{error}</p> : null}
            {message ? <p className="ig-verification-modal-success">{message}</p> : null}
            {statusMessage && !message ? <p className="ig-verification-modal-hint">{statusMessage}</p> : null}

            <div className="ig-verification-modal-actions">
              <button type="button" onClick={() => setOpen(false)} disabled={submitting}>Close</button>
              {canSubmitCode ? (
                <button type="button" onClick={submitCode} disabled={submitting || !/^\d{6}$/.test(code.trim())}>
                  {submitting ? "Sending..." : "Send code"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .ig-credentials-link-button {
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 999px;
          background: rgba(255,255,255,0.06);
          color: #f0f0ef;
          cursor: pointer;
          font-size: 12px;
          font-weight: 900;
          padding: 8px 12px;
        }

        .ig-credentials-link-button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .ig-verification-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.62);
          display: grid;
          place-items: center;
          padding: 20px;
          z-index: 80;
        }

        .ig-verification-modal {
          width: min(520px, 100%);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 18px;
          background: #111114;
          padding: 18px;
          display: grid;
          gap: 12px;
        }

        .ig-verification-modal header span,
        .ig-verification-modal label {
          color: rgba(255,255,255,0.42);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-verification-modal header strong,
        .ig-verification-modal header p,
        .ig-verification-modal p {
          margin: 0;
          color: rgba(255,255,255,0.78);
          line-height: 1.5;
        }

        .ig-verification-modal input {
          width: 100%;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 12px;
          background: rgba(255,255,255,0.04);
          color: #f0f0ef;
          padding: 12px 14px;
          font-size: 16px;
        }

        .ig-verification-modal-hint {
          color: rgba(255,255,255,0.42);
          font-size: 12px;
        }

        .ig-verification-modal-error {
          color: #FCA5A5;
        }

        .ig-verification-modal-success {
          color: #34D399;
        }

        .ig-verification-modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }

        .ig-verification-modal-actions button {
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 999px;
          background: rgba(255,255,255,0.06);
          color: #f0f0ef;
          cursor: pointer;
          font-size: 12px;
          font-weight: 900;
          padding: 8px 14px;
        }
      `}</style>
    </>
  );
}
