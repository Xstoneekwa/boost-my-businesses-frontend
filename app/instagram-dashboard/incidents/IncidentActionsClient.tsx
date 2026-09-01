"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type IncidentActionsClientProps = {
  incidentId: string;
  status: string;
};

export default function IncidentActionsClient({ incidentId, status }: IncidentActionsClientProps) {
  const router = useRouter();
  const [resolutionNote, setResolutionNote] = useState("");
  const [resumeScheduling, setResumeScheduling] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function runAction(action: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/instagram-dashboard/incidents/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          incident_id: incidentId,
          action,
          resolution_note: resolutionNote,
          resume_scheduling: resumeScheduling,
          source: "admin_dashboard",
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        setMessage(body.error || "Incident action failed.");
        return;
      }
      setMessage(`Action ${action} recorded.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Incident action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ig-incident-actions" data-testid="admin-incident-human-actions">
      <h2>Human actions</h2>
      <p>Acknowledge never resumes automation. Resolve requires an audit note. Manual retry uses the normal run-start gates.</p>
      <label>
        Resolution / audit note
        <textarea data-testid="incident-resolution-note" value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} rows={4} />
      </label>
      <label className="ig-incident-checkbox" data-testid="incident-resume-scheduling">
        <input type="checkbox" checked={resumeScheduling} onChange={(event) => setResumeScheduling(event.target.checked)} />
        Resume scheduling after resolve
      </label>
      <div className="ig-incident-actions-row">
        <button type="button" data-testid="incident-action-acknowledge" disabled={busy || status === "resolved"} onClick={() => void runAction("acknowledge")}>Acknowledge</button>
        <button type="button" data-testid="incident-action-resolve" disabled={busy || status === "resolved"} onClick={() => void runAction("resolve")}>Resolve</button>
        <button type="button" data-testid="incident-action-keep-paused" disabled={busy || status === "resolved"} onClick={() => void runAction("keep_paused")}>Keep paused</button>
        <button type="button" data-testid="incident-action-manual-retry" disabled={busy} onClick={() => void runAction("manual_retry")}>Manual retry</button>
      </div>
      {message ? <p className="ig-incident-actions-message">{message}</p> : null}
      <style>{`
        .ig-incident-actions { display: grid; gap: 12px; margin-top: 18px; padding: 16px; border: 1px solid rgba(255,255,255,.07); border-radius: 10px; background: #161820; }
        .ig-incident-actions h2 { margin: 0; color: #f0f0ee; font-size: 16px; }
        .ig-incident-actions p { margin: 0; color: #8a8f98; font-size: 13px; line-height: 1.5; }
        .ig-incident-actions label { display: grid; gap: 6px; color: #8a8f98; font-size: 12px; }
        .ig-incident-actions textarea { width: 100%; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: #101218; color: #f0f0ee; padding: 10px; }
        .ig-incident-checkbox { display: flex; align-items: center; gap: 8px; }
        .ig-incident-actions-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .ig-incident-actions-row button { border: 1px solid rgba(255,255,255,.12); background: #101218; color: #f0f0ee; border-radius: 8px; padding: 8px 12px; cursor: pointer; }
        .ig-incident-actions-row button:disabled { opacity: .45; cursor: not-allowed; }
        .ig-incident-actions-message { color: #c4b5fd; font-size: 13px; }
      `}</style>
    </section>
  );
}
