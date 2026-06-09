"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import VerificationCodeActionModal from "./VerificationCodeActionModal";

type EmailVerificationAction = {
  id: string;
  accountId: string;
  username: string;
  actionType: "enter_email_verification_code";
  status: string;
  resumeStatus?: string | null;
  resumeRequestId?: string | null;
  title: string;
  description: string;
};

type Props = {
  initialActions?: EmailVerificationAction[];
};

const POLL_INTERVAL_MS = 15_000;
const AUTO_OPEN_STORAGE_KEY = "instagram-dashboard-email-code-auto-opened-actions";
export const EMAIL_VERIFICATION_REFRESH_EVENT = "instagram-dashboard:refresh-email-verification";

function normalizeActions(value: unknown): EmailVerificationAction[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): EmailVerificationAction | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : "";
      const accountId = typeof row.accountId === "string" ? row.accountId : "";
      const username = typeof row.username === "string" ? row.username : "Instagram account";
      const status = typeof row.status === "string" ? row.status : "pending";
      if (!id || !accountId || row.actionType !== "enter_email_verification_code") return null;
      return {
        id,
        accountId,
        username,
        actionType: "enter_email_verification_code",
        status,
        resumeStatus: typeof row.resumeStatus === "string" ? row.resumeStatus : null,
        resumeRequestId: typeof row.resumeRequestId === "string" ? row.resumeRequestId : null,
        title: typeof row.title === "string" && row.title ? row.title : "Email verification code required",
        description:
          typeof row.description === "string" && row.description
            ? row.description
            : "Instagram is waiting for an email verification code.",
      };
    })
    .filter((item): item is EmailVerificationAction => Boolean(item));
}

function readAutoOpenedActionIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(AUTO_OPEN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function resumeStatusLabel(action: EmailVerificationAction) {
  if (action.status === "pending" || action.status === "acknowledged" || action.status === "pending_verification") {
    return action.status;
  }
  if (action.resumeStatus === "running") return "resume running";
  if (action.resumeStatus === "queued") return "resume queued";
  if (action.resumeStatus === "needs_new_code") return "new code required";
  if (action.status === "code_submitted") return "resume queued";
  return action.status;
}

function actionNeedsCodeInput(action: EmailVerificationAction) {
  if (action.status === "pending" || action.status === "acknowledged" || action.status === "pending_verification") {
    return true;
  }
  return action.resumeStatus === "needs_new_code";
}

function writeAutoOpenedActionIds(ids: Set<string>) {
  try {
    window.localStorage.setItem(AUTO_OPEN_STORAGE_KEY, JSON.stringify([...ids].slice(-100)));
  } catch {
    // Best effort only: a disabled localStorage should not block the operator flow.
  }
}

export default function EmailVerificationActionBanner({ initialActions = [] }: Props) {
  const router = useRouter();
  const [actions, setActions] = useState<EmailVerificationAction[]>(initialActions);
  const [lastActionIds, setLastActionIds] = useState(() => initialActions.map((action) => action.id).join(","));
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  const [autoOpenActionId, setAutoOpenActionId] = useState<string | null>(null);
  const actionLabel = useMemo(() => {
    if (actions.length === 1) return "1 action required";
    return `${actions.length} actions required`;
  }, [actions.length]);

  const refreshActions = useCallback(async () => {
    const res = await fetch("/api/instagram-dashboard/dashboard-actions/email-verification", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return;

    const body = (await res.json().catch(() => null)) as { data?: { actions?: unknown } } | null;
    const nextActions = normalizeActions(body?.data?.actions);
    const nextIds = nextActions.map((action) => action.id).join(",");
    setActions(nextActions);
    if (nextIds !== lastActionIds) {
      setLastActionIds(nextIds);
      router.refresh();
    }
  }, [lastActionIds, router]);

  useEffect(() => {
    void refreshActions();
    const timer = window.setInterval(() => {
      void refreshActions();
    }, POLL_INTERVAL_MS);
    const onRefreshRequested = () => {
      void refreshActions();
    };
    window.addEventListener(EMAIL_VERIFICATION_REFRESH_EVENT, onRefreshRequested);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(EMAIL_VERIFICATION_REFRESH_EVENT, onRefreshRequested);
    };
  }, [refreshActions]);

  useEffect(() => {
    if (actions.length === 0) {
      setAutoOpenActionId(null);
      return;
    }
    if (autoOpenActionId && actions.some((action) => action.id === autoOpenActionId)) return;

    const openedActionIds = readAutoOpenedActionIds();
    const nextAction = actions.find(
      (action) => actionNeedsCodeInput(action) && !openedActionIds.has(action.id),
    );
    if (!nextAction) {
      setAutoOpenActionId(null);
      return;
    }

    openedActionIds.add(nextAction.id);
    writeAutoOpenedActionIds(openedActionIds);
    setAutoOpenActionId(nextAction.id);
  }, [actions, autoOpenActionId]);

  async function dismissAction(action: EmailVerificationAction) {
    const confirmed = window.confirm(`Remove stale email verification request for ${action.username}?`);
    if (!confirmed) return;

    setDeletingIds((current) => new Set(current).add(action.id));
    try {
      const res = await fetch("/api/instagram-dashboard/dashboard-actions/email-verification", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action_id: action.id,
          account_id: action.accountId,
        }),
      });
      if (!res.ok) return;

      setActions((current) => {
        const next = current.filter((item) => item.id !== action.id);
        setLastActionIds(next.map((item) => item.id).join(","));
        return next;
      });
      router.refresh();
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(action.id);
        return next;
      });
    }
  }

  if (actions.length === 0) return null;

  return (
    <section className="ig-email-verification-banner" role="status" aria-live="polite">
      <div className="ig-email-verification-copy">
        <span>{actionLabel}</span>
        <strong>
          {actions.length === 1
            ? `Email verification code required for ${actions[0].username}`
            : "Email verification codes required"}
        </strong>
        <p>
          {actions.length === 1
            ? actions[0].description
            : "Choose the matching account before entering a code."}
        </p>
      </div>
      <div className="ig-email-verification-actions">
        {actions.map((action) => (
          <article className="ig-email-verification-action" key={action.id}>
            <div>
              <strong>{action.username}</strong>
              <small>{resumeStatusLabel(action)}</small>
            </div>
            <div className="ig-email-verification-controls">
              <VerificationCodeActionModal
                actionId={action.id}
                accountId={action.accountId}
                username={action.username}
                title={action.title}
                description={action.description}
                actionType="enter_email_verification_code"
                status={action.status}
                resumeStatus={action.resumeStatus}
                autoOpen={autoOpenActionId === action.id}
              />
              <button
                type="button"
                className="ig-email-verification-delete"
                aria-label={`Remove stale email verification request for ${action.username}`}
                disabled={deletingIds.has(action.id)}
                onClick={() => void dismissAction(action)}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M7 3h6l1 2h3v2H3V5h3l1-2Zm1 6h2v7H8V9Zm4 0h2v7h-2V9ZM5 8h10l-1 10H6L5 8Z" />
                </svg>
              </button>
            </div>
          </article>
        ))}
      </div>

      <style jsx>{`
        .ig-email-verification-banner {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
          padding: 16px;
          border: 1px solid rgba(251,191,36,0.34);
          border-radius: 18px;
          background:
            radial-gradient(circle at top left, rgba(251,191,36,0.16), transparent 38%),
            rgba(113,63,18,0.18);
          box-shadow: 0 18px 42px rgba(0,0,0,0.18);
        }

        .ig-email-verification-copy {
          display: grid;
          gap: 5px;
        }

        .ig-email-verification-copy span {
          width: max-content;
          border-radius: 999px;
          background: rgba(251,191,36,0.16);
          color: #FBBF24;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.08em;
          padding: 5px 9px;
          text-transform: uppercase;
        }

        .ig-email-verification-copy strong {
          color: #FEF3C7;
          font-family: 'Syne', sans-serif;
          font-size: 18px;
        }

        .ig-email-verification-copy p {
          color: rgba(255,255,255,0.66);
          font-size: 13px;
          line-height: 1.5;
          margin: 0;
        }

        .ig-email-verification-actions {
          display: grid;
          gap: 8px;
          min-width: min(420px, 100%);
        }

        .ig-email-verification-action {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 14px;
          background: rgba(15,23,42,0.46);
          padding: 9px 10px;
        }

        .ig-email-verification-action div {
          display: grid;
          gap: 2px;
          min-width: 0;
        }

        .ig-email-verification-action strong {
          color: #FEF3C7;
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .ig-email-verification-action small {
          color: rgba(255,255,255,0.42);
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
        }

        .ig-email-verification-controls {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex: 0 0 auto;
        }

        .ig-email-verification-delete {
          display: inline-grid;
          place-items: center;
          width: 34px;
          height: 34px;
          border: 1px solid rgba(248,113,113,0.28);
          border-radius: 999px;
          background: rgba(127,29,29,0.16);
          color: #FCA5A5;
          cursor: pointer;
        }

        .ig-email-verification-delete:hover,
        .ig-email-verification-delete:focus-visible {
          border-color: rgba(248,113,113,0.48);
          background: rgba(127,29,29,0.28);
          outline: none;
        }

        .ig-email-verification-delete:disabled {
          cursor: wait;
          opacity: 0.48;
        }

        .ig-email-verification-delete svg {
          width: 16px;
          height: 16px;
          fill: currentColor;
        }

        @media (max-width: 720px) {
          .ig-email-verification-banner {
            align-items: stretch;
            flex-direction: column;
          }
        }
      `}</style>
    </section>
  );
}
