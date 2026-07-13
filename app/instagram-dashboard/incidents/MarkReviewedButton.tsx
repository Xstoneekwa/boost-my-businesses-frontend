"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export function MarkReviewedButton({ actionId, accountId }: { actionId: string; accountId: string }) {
  const router = useRouter();
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
          metadata_safe: { review_surface: "incidents", operator_review_completed: true },
        }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (response.ok && payload?.ok) {
        router.refresh();
        return;
      }
      setError(payload?.error || `HTTP ${response.status}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "network_error");
    } finally {
      setPending(false);
    }
  }, [accountId, actionId, pending, router]);

  return (
    <span className="ig-inc-ready-wrap">
      <button
        type="button"
        className="ig-inc-ready-btn"
        onClick={onClick}
        disabled={pending}
        data-testid="mark-reviewed-button"
      >
        {pending ? "Marking…" : "Mark reviewed"}
      </button>
      {error ? <code className="ig-inc-ready-refusal" role="alert">{error}</code> : null}
    </span>
  );
}
