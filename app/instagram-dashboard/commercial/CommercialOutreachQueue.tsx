"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  COMMERCIAL_OUTREACH_ANGLES,
  COMMERCIAL_OUTREACH_CHANNELS,
  type CommercialOutreachAngle,
  type CommercialOutreachChannel,
  type CommercialOutreachItem,
  type CommercialOutreachMutationAction,
  type CommercialOutreachReadModel,
} from "@/lib/commercial/outreach-contract";

type ApiResponse = { ok: true; data: Record<string, unknown> } | { ok: false; code?: string; error?: string };

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" }).format(parsed);
}

function OutreachCard({ item, pending, onMutate }: {
  item: CommercialOutreachItem;
  pending: boolean;
  onMutate: (item: CommercialOutreachItem, action: CommercialOutreachMutationAction, patch?: Record<string, unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(item.subject ?? "");
  const [body, setBody] = useState(item.body ?? "");
  const [channel, setChannel] = useState<CommercialOutreachChannel>(item.channel);
  const [angle, setAngle] = useState<CommercialOutreachAngle>(item.angle);
  const canReview = item.state === "ready_for_review";
  const canRegenerate = !["cancelled", "generating"].includes(item.state);
  const canChangeSelection = item.state !== "cancelled";
  return <article className="outreach-card">
    <header>
      <div><small>{item.templateKey}</small><h3>{item.businessName}</h3><p>{[item.city, item.subsegment].filter(Boolean).join(" · ") || "Verified CRM lead"}</p></div>
      <span className={`outreach-state outreach-state-${item.state}`}>{label(item.state)}</span>
    </header>
    <div className="outreach-meta">
      <span>{label(item.channel)}</span><span>Angle {item.angle}</span><span>{item.attemptCount}/{item.maxAttempts} attempts</span>
      {item.confidence !== null ? <span>{Math.round(item.confidence * 100)}% confidence</span> : null}
    </div>
    <details open={canReview}>
      <summary>Message preview and audit history</summary>
      {item.subject ? <div className="outreach-subject"><small>SUBJECT</small><strong>{item.subject}</strong></div> : null}
      {item.body ? <pre>{item.body}</pre> : <div className="outreach-waiting">{item.state === "generation_failed" ? `Generation failed closed: ${item.validationCodes.join(", ") || "unknown validation failure"}.` : "The durable item is waiting for dry-run generation. Nothing will be sent."}</div>}
      {item.personalizationSummary ? <p className="outreach-summary"><b>Personalization:</b> {item.personalizationSummary}</p> : null}
      {item.factsUsed.length ? <div className="outreach-facts"><small>VERIFIED FACTS USED</small>{item.factsUsed.map((fact) => <span key={`${fact.key}:${fact.value}`}>{label(fact.key)}: {fact.value}</span>)}</div> : null}
      <div className="outreach-history"><small>AUDIT HISTORY</small>{item.history.length ? item.history.map((event) => <p key={event.id}><b>{label(event.eventType)}</b><span>{label(event.actorType)} · {formatDate(event.occurredAt)}</span></p>) : <p><span>No event history available.</span></p>}</div>
    </details>

    {editing ? <div className="outreach-editor">
      {item.channel === "email" ? <label><span>Subject</span><input maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} disabled={pending} /></label> : null}
      <label><span>Message</span><textarea maxLength={item.channel === "instagram" ? 900 : 2000} rows={7} value={body} onChange={(event) => setBody(event.target.value)} disabled={pending} /></label>
      <div><button type="button" onClick={() => onMutate(item, "edit_message", { subject: item.channel === "email" ? subject : null, body })} disabled={pending}>Validate & save edit</button><button type="button" className="quiet" onClick={() => setEditing(false)} disabled={pending}>Close</button></div>
    </div> : null}

    {canChangeSelection ? <div className="outreach-selection">
      <label><span>Channel</span><select value={channel} onChange={(event) => setChannel(event.target.value as CommercialOutreachChannel)} disabled={pending}>{COMMERCIAL_OUTREACH_CHANNELS.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      <label><span>Angle</span><select value={angle} onChange={(event) => setAngle(event.target.value as CommercialOutreachAngle)} disabled={pending}>{COMMERCIAL_OUTREACH_ANGLES.map((value) => <option key={value} value={value}>Angle {value}</option>)}</select></label>
      <button type="button" onClick={() => onMutate(item, "change_selection", { channel, angle })} disabled={pending || (channel === item.channel && angle === item.angle)}>Apply selection</button>
    </div> : null}

    <div className="outreach-actions">
      {canReview ? <button type="button" className="approve" onClick={() => onMutate(item, "approve_message")} disabled={pending}>Approve dry run</button> : null}
      {canReview ? <button type="button" onClick={() => setEditing((current) => !current)} disabled={pending}>Edit</button> : null}
      {canRegenerate ? <button type="button" onClick={() => onMutate(item, "regenerate")} disabled={pending}>Regenerate</button> : null}
      {item.state !== "cancelled" ? <button type="button" className="danger" onClick={() => onMutate(item, "cancel", { reason: "owner_cancelled" })} disabled={pending}>Cancel</button> : null}
    </div>
  </article>;
}

export default function CommercialOutreachQueue({ initialModel }: { initialModel: CommercialOutreachReadModel }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function mutate(item: CommercialOutreachItem, action: CommercialOutreachMutationAction, patch: Record<string, unknown> = {}) {
    if (pendingId) return;
    setPendingId(item.id); setFeedback(null);
    try {
      const response = await fetch(`/api/instagram-dashboard/commercial/outreach/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedVersion: item.version, idempotencyKey: `commercial-outreach:${action}:${item.id}:${item.version}:${crypto.randomUUID()}`, patch }),
      });
      const payload = await response.json() as ApiResponse;
      if (!response.ok || !payload.ok) throw new Error(response.status === 409 ? "This preview changed in another tab. The latest state is being reloaded." : "The outreach action failed closed; nothing was sent.");
      setFeedback({ tone: "success", text: action === "approve_message" ? "Preview approved into QUEUED_DRY_RUN. No email or DM was sent." : "Dry-run outreach state updated. Nothing was sent." });
      router.refresh();
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "The request failed closed." });
      router.refresh();
    } finally { setPendingId(null); }
  }

  async function processNow() {
    if (processing) return;
    setProcessing(true); setFeedback(null);
    try {
      const response = await fetch("/api/instagram-dashboard/commercial/outreach/process", { method: "POST" });
      const payload = await response.json() as ApiResponse;
      if (!response.ok || !payload.ok) throw new Error("Dry-run generation failed closed. Nothing was sent.");
      setFeedback({ tone: "success", text: "The next approved leads were generated for review. No email or Instagram DM was sent." });
      router.refresh();
    } catch (error) { setFeedback({ tone: "error", text: error instanceof Error ? error.message : "Dry-run generation is unavailable." }); }
    finally { setProcessing(false); }
  }

  const m = initialModel.metrics;
  return <section className="outreach-workflow" aria-labelledby="outreach-title">
    <div className="outreach-heading"><div><small>OUTREACH · DRY RUN ONLY</small><h2 id="outreach-title">Message review queue</h2><p>One active channel per approved lead. Human approval never triggers a transport in V1.</p></div><button type="button" onClick={processNow} disabled={processing}>{processing ? "Generating…" : "Generate next previews"}</button></div>
    <div className="outreach-safety" role="note"><strong>DELIVERY LOCKED</strong><span>Real email: OFF</span><span>Instagram DM: OFF</span><span>Phone Farm DM: OFF</span></div>
    <div className="outreach-metrics"><span><b>{m.generated}</b> Generated</span><span><b>{m.readyForReview}</b> Ready</span><span><b>{m.approvedDryRun}</b> Approved dry run</span><span><b>{m.generationFailed}</b> Failed closed</span><span><b>{m.cancelled}</b> Cancelled</span></div>
    {feedback ? <div className={`outreach-feedback outreach-feedback-${feedback.tone}`} role="status">{feedback.text}</div> : null}
    {initialModel.items.length ? <div className="outreach-list">{initialModel.items.map((item) => <OutreachCard key={item.id} item={item} pending={pendingId === item.id} onMutate={mutate} />)}</div> : <div className="outreach-empty">No approved lead has an outreach path yet. Approve a qualified lead first.</div>}
    <style jsx>{`
      .outreach-workflow{margin-top:28px}.outreach-heading{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.outreach-heading small,.outreach-card small,.outreach-history>small,.outreach-facts>small{display:block;color:#fbbf24;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.1em}.outreach-heading h2{font:700 23px 'Syne',sans-serif;margin-top:5px}.outreach-heading p{color:#747a86;margin-top:5px}.outreach-heading>button,.outreach-selection button,.outreach-actions button,.outreach-editor button{border:0;border-radius:8px;padding:10px 13px;background:#6558f5;color:#fff;font-weight:800;cursor:pointer}.outreach-heading>button:disabled,.outreach-selection button:disabled,.outreach-actions button:disabled,.outreach-editor button:disabled{opacity:.5;cursor:wait}.outreach-safety{display:flex;gap:9px;flex-wrap:wrap;margin:14px 0;padding:11px;border:1px solid rgba(52,211,153,.18);border-radius:10px;background:rgba(52,211,153,.055);color:#77d9b5}.outreach-safety span,.outreach-safety strong{font-size:11px}.outreach-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:12px}.outreach-metrics span{display:grid;gap:2px;padding:11px;border-radius:10px;background:#15171c;color:#7c828e;font-size:11px}.outreach-metrics b{font:800 22px 'Syne',sans-serif;color:#f1f1ef}.outreach-feedback{padding:11px 13px;border-radius:9px;margin-bottom:10px}.outreach-feedback-success{background:rgba(52,211,153,.1);color:#6ee7b7}.outreach-feedback-error{background:rgba(248,113,113,.1);color:#fca5a5}.outreach-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.outreach-card{content-visibility:auto;contain-intrinsic-size:620px;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:#15171c;padding:15px;min-width:0}.outreach-card header{display:flex;justify-content:space-between;gap:12px}.outreach-card h3{font:700 19px 'Syne',sans-serif;margin-top:5px}.outreach-card header p{color:#777d88;margin-top:3px}.outreach-state{align-self:flex-start;border-radius:999px;padding:5px 8px;background:rgba(147,197,253,.1);color:#93c5fd;font-size:9px;font-weight:800}.outreach-state-ready_for_review{background:rgba(251,191,36,.1);color:#fbbf24}.outreach-state-queued_dry_run{background:rgba(52,211,153,.1);color:#34d399}.outreach-state-generation_failed,.outreach-state-cancelled{background:rgba(248,113,113,.1);color:#f87171}.outreach-meta{display:flex;gap:6px;flex-wrap:wrap;margin:11px 0}.outreach-meta span{padding:5px 7px;border-radius:6px;background:rgba(255,255,255,.04);color:#8d939e;font-size:10px}.outreach-card details{border-top:1px solid rgba(255,255,255,.06);padding-top:10px}.outreach-card summary{cursor:pointer;color:#a9aeb8;font-weight:700}.outreach-subject{display:grid;gap:5px;margin-top:10px}.outreach-card pre{white-space:pre-wrap;font:inherit;line-height:1.55;color:#d4d7dc;background:#0e1014;border-radius:9px;padding:12px;margin-top:10px}.outreach-waiting{border:1px dashed rgba(255,255,255,.1);border-radius:9px;padding:14px;color:#6b717d;margin-top:10px}.outreach-summary{color:#979da8;line-height:1.45;margin-top:9px}.outreach-facts{display:flex;gap:6px;flex-wrap:wrap;margin-top:11px}.outreach-facts>small{width:100%}.outreach-facts span{padding:5px 7px;border-radius:6px;background:rgba(255,255,255,.04);color:#898f9b;font-size:10px}.outreach-history{display:grid;gap:5px;margin-top:12px}.outreach-history p{display:flex;justify-content:space-between;gap:8px;color:#9da2ad;font-size:10px}.outreach-history p span{color:#656b76;text-align:right}.outreach-selection{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-top:12px}.outreach-selection label,.outreach-editor label{display:grid;gap:5px}.outreach-selection label>span,.outreach-editor label>span{color:#6d7380;font:600 9px 'JetBrains Mono',monospace;text-transform:uppercase}.outreach-selection select,.outreach-editor input,.outreach-editor textarea{width:100%;min-width:0;border:1px solid rgba(255,255,255,.09);border-radius:8px;background:#0e1014;color:#dfe1e5;padding:9px;font:inherit}.outreach-editor{display:grid;gap:8px;margin-top:12px;padding:11px;border:1px solid rgba(255,255,255,.07);border-radius:9px;background:#101217}.outreach-editor>div,.outreach-actions{display:flex;gap:7px;flex-wrap:wrap}.outreach-editor .quiet,.outreach-actions button:not(.approve):not(.danger){background:rgba(255,255,255,.07);color:#abb0ba}.outreach-actions{margin-top:12px}.outreach-actions .danger{background:rgba(248,113,113,.12);color:#f87171}.outreach-empty{border:1px dashed rgba(255,255,255,.1);border-radius:12px;padding:24px;text-align:center;color:#686e79}@media(max-width:980px){.outreach-list{grid-template-columns:1fr}.outreach-metrics{grid-template-columns:repeat(3,1fr)}}@media(max-width:620px){.outreach-heading{display:grid}.outreach-selection{grid-template-columns:1fr 1fr}.outreach-selection button{grid-column:1/-1}.outreach-metrics{grid-template-columns:repeat(2,1fr)}.outreach-actions button{flex:1}.outreach-history p{display:grid}.outreach-history p span{text-align:left}}
    `}</style>
  </section>;
}
