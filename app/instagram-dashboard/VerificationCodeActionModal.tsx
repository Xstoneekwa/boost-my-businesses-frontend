"use client";

import { useMemo, useState } from "react";

type Props = {
  actionId: string;
  accountId: string;
  username: string;
  title: string;
  description: string;
  actionType: "enter_email_verification_code" | "review_login_challenge";
  status: string;
};

export default function VerificationCodeActionModal({
  actionId,
  accountId,
  username,
  title,
  description,
  actionType,
  status,
}: Props) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmitCode = actionType === "enter_email_verification_code" && status !== "code_submitted";
  const buttonLabel = useMemo(() => {
    if (actionType === "review_login_challenge") return "View details";
    if (status === "code_submitted") return "Code submitted";
    return "Enter code";
  }, [actionType, status]);

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
      setMessage("Code submitted securely. The worker can now resume login.");
      setCode("");
      setOpen(false);
    } catch (err) {
      setError(String((err as Error)?.message || "submit_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="ig-credentials-link-button"
        disabled={!canSubmitCode && actionType === "enter_email_verification_code" && status === "code_submitted"}
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
            ) : (
              <>
                <label htmlFor={`verification-code-${actionId}`}>Email verification code</label>
                <input
                  id={`verification-code-${actionId}`}
                  type="text"
                  inputMode="text"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Enter the code from email"
                  maxLength={32}
                />
                <p className="ig-verification-modal-hint">The code is sent securely and is not stored in the dashboard UI after submission.</p>
              </>
            )}

            {error ? <p className="ig-verification-modal-error">{error}</p> : null}
            {message ? <p className="ig-verification-modal-success">{message}</p> : null}

            <div className="ig-verification-modal-actions">
              <button type="button" onClick={() => setOpen(false)} disabled={submitting}>Close</button>
              {actionType === "enter_email_verification_code" ? (
                <button type="button" onClick={submitCode} disabled={submitting || !code.trim()}>
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
