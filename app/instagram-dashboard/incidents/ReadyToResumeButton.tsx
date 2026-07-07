"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * P3.1/P3.2 — Admin "Ready to resume" button.
 *
 * Status/recovery action only: it calls the existing audited incident action
 * route (admin session auth, no relay key) which arms ONE durable
 * authorization. It never creates a run, never forces a tick, never contacts
 * a worker. Refusals surface the stable safe reason returned by the backend.
 */
export function ReadyToResumeButton({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [refusalReason, setRefusalReason] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    if (pending) return;
    setPending(true);
    setRefusalReason(null);
    try {
      const response = await fetch("/api/instagram-dashboard/incidents/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ incident_id: incidentId, action: "ready_to_resume" }),
      });
      const payload = await response.json().catch(() => null) as
        | { ok?: boolean; reason?: string; error?: string }
        | null;
      if (response.ok && payload?.ok) {
        router.refresh();
        return;
      }
      setRefusalReason(payload?.reason || payload?.error || `HTTP ${response.status}`);
    } catch (error) {
      setRefusalReason(error instanceof Error ? error.message : "network_error");
    } finally {
      setPending(false);
    }
  }, [incidentId, pending, router]);

  return (
    <span className="ig-inc-ready-wrap">
      <button
        type="button"
        className="ig-inc-ready-btn"
        onClick={onClick}
        disabled={pending}
        data-testid="ready-to-resume-button"
      >
        {pending ? "Arming…" : "Ready to resume"}
      </button>
      {refusalReason ? (
        <code className="ig-inc-ready-refusal" role="alert">{refusalReason}</code>
      ) : null}
    </span>
  );
}
