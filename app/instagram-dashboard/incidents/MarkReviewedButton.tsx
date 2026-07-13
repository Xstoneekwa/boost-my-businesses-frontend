"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export function MarkReviewedButton({ actionId, accountId }: { actionId: string; accountId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/instagram-dashboard/dashboard-actions/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action_id: actionId,
          account_id: accountId,
          review_status: "reviewed",
          source: "admin_dashboard",
          note: note.trim() || null,
          metadata_safe: { review_surface: "incidents", operator_review_completed: true },
        }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (response.ok && payload?.ok) {
        setConfirming(false);
        router.refresh();
        return;
      }
      setError(payload?.error || `HTTP ${response.status}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "network_error");
    } finally {
      setPending(false);
    }
  }, [accountId, actionId, note, pending, router]);

  if (confirming) {
    return (
      <span className="ig-inc-review-confirm" role="group" aria-label="Confirm operator review">
        <span className="ig-inc-review-confirm-copy">Confirm this action has been reviewed by a human operator.</span>
        <label className="ig-inc-review-note-label">
          Review note (optional)
          <textarea
            className="ig-inc-review-note"
            value={note}
            maxLength={500}
            rows={2}
            onChange={(event) => setNote(event.target.value)}
            disabled={pending}
          />
        </label>
        <span className="ig-inc-review-actions">
          <button type="button" className="ig-inc-ready-btn" onClick={onClick} disabled={pending}>
            {pending ? "Marking…" : "Confirm review"}
          </button>
          <button
            type="button"
            className="ig-inc-review-cancel"
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
            disabled={pending}
          >
            Cancel
          </button>
        </span>
        {error ? <code className="ig-inc-ready-refusal" role="alert">{error}</code> : null}
      </span>
    );
  }

  return (
    <span className="ig-inc-ready-wrap">
      <button
        type="button"
        className="ig-inc-ready-btn"
        onClick={() => setConfirming(true)}
        disabled={pending}
        data-testid="mark-reviewed-button"
      >
        {pending ? "Marking…" : "Mark reviewed"}
      </button>
      {error ? <code className="ig-inc-ready-refusal" role="alert">{error}</code> : null}
    </span>
  );
}
