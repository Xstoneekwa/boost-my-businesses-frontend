"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  COMMERCIAL_REJECTION_REASONS,
  COMMERCIAL_REVIEW_ANGLE_LABELS,
  COMMERCIAL_REVIEW_ANGLES,
  COMMERCIAL_REVIEW_CHANNELS,
  COMMERCIAL_REVIEW_PRIORITIES,
  type CommercialRejectionReason,
  type CommercialReviewAction,
  type CommercialReviewAngle,
  type CommercialReviewChannel,
  type CommercialReviewLead,
  type CommercialReviewMutationResult,
  type CommercialReviewPatch,
  type CommercialReviewPriority,
  type CommercialReviewQueue,
} from "@/lib/commercial/lead-review-contract";

type MutationResponse =
  | { ok: true; data: CommercialReviewMutationResult }
  | { ok: false; code?: string; error?: string };

function title(value: string | null) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase()) : "—";
}

function date(value: string | null) {
  if (!value) return "No activity recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No activity recorded";
  return new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" }).format(parsed);
}

function note(value: Record<string, unknown>) {
  return typeof value.review_note === "string" ? value.review_note : "";
}

function contextLines(value: Record<string, unknown>) {
  return Object.entries(value)
    .filter(([key]) => key !== "review_note")
    .slice(0, 4)
    .map(([key, raw]) => `${title(key)}: ${typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? raw : "Structured context"}`);
}

function safeHttpUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function reviewPageHref(returnPath: string, page: number) {
  const url = new URL(returnPath, "https://commercial.local");
  url.searchParams.set("review_page", String(Math.max(1, page)));
  return `${url.pathname}${url.search}#review-queue`;
}

function ReviewCard({
  lead,
  pending,
  returnPath,
  onMutate,
}: {
  lead: CommercialReviewLead;
  pending: boolean;
  returnPath: string;
  onMutate: (lead: CommercialReviewLead, action: CommercialReviewAction, patch: CommercialReviewPatch) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [channel, setChannel] = useState<CommercialReviewChannel>((lead.outreachChannel as CommercialReviewChannel) || "instagram");
  const [angle, setAngle] = useState<CommercialReviewAngle>((lead.messageAngle as CommercialReviewAngle) || "A");
  const [priority, setPriority] = useState<CommercialReviewPriority>((lead.priority as CommercialReviewPriority) || "normal");
  const [personalizationNote, setPersonalizationNote] = useState(note(lead.personalizationContext));
  const [audienceNote, setAudienceNote] = useState(note(lead.audienceContext));
  const [rejectionReason, setRejectionReason] = useState<CommercialRejectionReason | "">("");
  const [rejectionNote, setRejectionNote] = useState("");
  const why = contextLines(lead.personalizationContext);
  const audiences = contextLines(lead.audienceContext);
  const website = safeHttpUrl(lead.website);
  const reviewPatch = { outreachChannel: channel, messageAngle: angle, priority, personalizationNote, audienceNote };

  return <article className="review-card">
    <div className="review-card-top">
      <div className="review-score"><strong>{lead.score === null ? "—" : (lead.score / 10).toFixed(1)}</strong><small>/ 10</small></div>
      <span className={`review-priority review-priority-${priority}`}>{priority === "urgent" ? "P1" : priority === "high" ? "P2" : priority === "normal" ? "P3" : "P4"}</span>
      <span className="review-status">{title(lead.qualificationStatus)}</span>
    </div>
    <div className="review-business">
      <div><h3>{lead.businessName}</h3><p>{[lead.city, lead.subsegment].filter(Boolean).join(" · ") || "Location or segment not captured"}</p></div>
      <Link href={`/instagram-dashboard/commercial/leads/${lead.id}?return_to=${encodeURIComponent(returnPath)}`}>Full detail →</Link>
    </div>
    <div className="review-links">
      {lead.instagramHandle ? <a href={`https://www.instagram.com/${encodeURIComponent(lead.instagramHandle.replace(/^@/, ""))}`} target="_blank" rel="noreferrer">@{lead.instagramHandle.replace(/^@/, "")}</a> : <span>Instagram not captured</span>}
      {website ? <a href={website} target="_blank" rel="noreferrer">Website ↗</a> : <span>Website not captured</span>}
    </div>
    <div className="review-signal-grid">
      <section><small>WHY THIS LEAD</small>{why.length ? <ul>{why.map((line) => <li key={line}>{line}</li>)}</ul> : <p>No personalization context captured yet.</p>}</section>
      <section><small>POTENTIAL AUDIENCES</small>{audiences.length ? <ul>{audiences.map((line) => <li key={line}>{line}</li>)}</ul> : <p>No audience or competitor context captured yet.</p>}</section>
    </div>
    <div className="review-recommendation">
      <label><span>RECOMMENDED CHANNEL</span><select value={channel} onChange={(event) => setChannel(event.target.value as CommercialReviewChannel)} disabled={pending}>{COMMERCIAL_REVIEW_CHANNELS.map((value) => <option key={value} value={value}>{title(value)}</option>)}</select></label>
      <label><span>RECOMMENDED ANGLE</span><select value={angle} onChange={(event) => setAngle(event.target.value as CommercialReviewAngle)} disabled={pending}>{COMMERCIAL_REVIEW_ANGLES.map((value) => <option key={value} value={value}>Angle {value} · {COMMERCIAL_REVIEW_ANGLE_LABELS[value]}</option>)}</select></label>
    </div>
    <p className="review-last">Last activity: {title(lead.lastActivityType)} · {date(lead.lastActivityAt ?? lead.updatedAt)}</p>

    {editing ? <div className="review-edit" aria-label="Edit review context">
      <label><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value as CommercialReviewPriority)} disabled={pending}>{COMMERCIAL_REVIEW_PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>Personalization note</span><textarea maxLength={1000} rows={3} value={personalizationNote} onChange={(event) => setPersonalizationNote(event.target.value)} placeholder="Short human correction; source context remains preserved." disabled={pending} /></label>
      <label><span>Audience / competitor note</span><textarea maxLength={1000} rows={3} value={audienceNote} onChange={(event) => setAudienceNote(event.target.value)} placeholder="Potential audiences or competitors." disabled={pending} /></label>
      <div className="review-inline-actions"><button type="button" onClick={() => onMutate(lead, "update_context", reviewPatch)} disabled={pending}>{pending ? "Saving…" : "Save changes"}</button><button type="button" className="review-quiet" onClick={() => setEditing(false)} disabled={pending}>Cancel</button></div>
    </div> : null}

    {rejecting ? <div className="review-reject" role="group" aria-label="Reject lead">
      <label><span>Reason (optional)</span><select value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value as CommercialRejectionReason | "")} disabled={pending}><option value="">No reason selected</option>{COMMERCIAL_REJECTION_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {rejectionReason === "other" ? <label><span>Short note (optional)</span><textarea maxLength={500} rows={2} value={rejectionNote} onChange={(event) => setRejectionNote(event.target.value)} disabled={pending} /></label> : null}
      <div className="review-inline-actions"><button type="button" className="review-danger" onClick={() => onMutate(lead, "reject", { rejectionReason: rejectionReason || undefined, rejectionNote: rejectionReason === "other" ? rejectionNote : undefined })} disabled={pending}>{pending ? "Rejecting…" : "Confirm reject & next"}</button><button type="button" className="review-quiet" onClick={() => setRejecting(false)} disabled={pending}>Cancel</button></div>
    </div> : null}

    <div className="review-actions">
      <button type="button" className="review-approve" onClick={() => onMutate(lead, "approve", reviewPatch)} disabled={pending}>{pending ? "Working…" : "Approve & next"}</button>
      <button type="button" className="review-reject-button" onClick={() => { setRejecting(!rejecting); setEditing(false); }} disabled={pending}>Reject</button>
      <button type="button" className="review-edit-button" onClick={() => { setEditing(!editing); setRejecting(false); }} disabled={pending}>Edit</button>
    </div>
  </article>;
}

export default function CommercialLeadReviewQueue({ initialQueue, returnPath }: { initialQueue: CommercialReviewQueue; returnPath: string }) {
  const router = useRouter();
  const [queue, setQueue] = useState(initialQueue);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => setQueue(initialQueue), [initialQueue]);

  async function mutate(lead: CommercialReviewLead, action: CommercialReviewAction, patch: CommercialReviewPatch) {
    if (pendingId) return;
    setPendingId(lead.id);
    setFeedback(null);
    const idempotencyKey = `commercial-review:${action}:${lead.id}:${lead.version}:${crypto.randomUUID()}`;
    try {
      const response = await fetch(`/api/instagram-dashboard/commercial/leads/${lead.id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedVersion: lead.version, idempotencyKey, patch }),
      });
      const payload = await response.json() as MutationResponse;
      if (!response.ok || !payload.ok) {
        const code = payload.ok ? "commercial_review_unavailable" : payload.code;
        if (response.status === 409) router.refresh();
        throw new Error(code === "commercial_review_conflict" ? "This lead changed in another tab. The queue was refreshed; review the latest state before retrying." : "The decision was not saved. No CRM state was changed.");
      }
      const result = payload.data;
      setQueue((current) => {
        if (action === "update_context") return {
          ...current,
          needsApproval: {
            ...current.needsApproval,
            rows: current.needsApproval.rows.map((item) => item.id === lead.id ? {
              ...item,
              version: result.version,
              priority: result.priority,
              outreachChannel: result.outreachChannel,
              messageAngle: result.messageAngle,
              personalizationContext: { ...item.personalizationContext, review_note: patch.personalizationNote ?? "" },
              audienceContext: { ...item.audienceContext, review_note: patch.audienceNote ?? "" },
            } : item),
          },
        };
        const needsRows = current.needsApproval.rows.filter((item) => item.id !== lead.id);
        if (action === "approve") {
          const readyLead = { ...lead, version: result.version, qualificationStatus: "approved", outreachStatus: "not_started", outreachChannel: result.outreachChannel, messageAngle: result.messageAngle, priority: result.priority, updatedAt: new Date().toISOString() };
          return {
            needsApproval: { ...current.needsApproval, rows: needsRows, total: Math.max(0, current.needsApproval.total - 1) },
            readyForOutreach: { ...current.readyForOutreach, rows: [readyLead, ...current.readyForOutreach.rows].slice(0, current.readyForOutreach.pageSize), total: current.readyForOutreach.total + 1 },
          };
        }
        return { ...current, needsApproval: { ...current.needsApproval, rows: needsRows, total: Math.max(0, current.needsApproval.total - 1) } };
      });
      setFeedback({ tone: "success", message: action === "approve" ? `${lead.businessName} approved and moved to Ready for Outreach. Nothing was sent.` : action === "reject" ? `${lead.businessName} rejected. The decision is terminal for this lead.` : `Review context saved for ${lead.businessName}.` });
      router.refresh();
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "The review request failed closed." });
    } finally {
      setPendingId(null);
    }
  }

  return <section id="review-queue" className="review-workflow" aria-labelledby="review-workflow-title">
    <div className="review-heading"><div><small>REVIEW</small><h2 id="review-workflow-title">Needs Approval</h2><p>Human decision queue · P1/P2 first · no outreach is sent here.</p></div><strong>{queue.needsApproval.total}</strong></div>
    {feedback ? <div className={`review-feedback review-feedback-${feedback.tone}`} role="status">{feedback.message}</div> : null}
    {queue.needsApproval.rows.length ? <div className="review-list">{queue.needsApproval.rows.map((lead) => <ReviewCard key={lead.id} lead={lead} pending={pendingId === lead.id} returnPath={returnPath} onMutate={mutate} />)}</div> : <div className="review-empty"><strong>Queue clear</strong><p>No qualified leads are waiting for Liam’s approval under the current filters.</p></div>}
    {queue.needsApproval.total > queue.needsApproval.pageSize ? <nav className="review-pagination" aria-label="Needs Approval pages">
      {queue.needsApproval.page > 1 ? <Link href={reviewPageHref(returnPath, queue.needsApproval.page - 1)}>← Previous</Link> : <span>← Previous</span>}
      <b>Page {queue.needsApproval.page} · {queue.needsApproval.total} leads</b>
      {queue.needsApproval.page * queue.needsApproval.pageSize < queue.needsApproval.total ? <Link href={reviewPageHref(returnPath, queue.needsApproval.page + 1)}>Next →</Link> : <span>Next →</span>}
    </nav> : null}

    <div className="ready-summary" role="note">
      <div><small>APPROVED · READ ONLY</small><h3>Ready for Outreach</h3><p>Approved CRM leads move into the message workspace below. This section never exposes a send action.</p></div>
      <div className="ready-summary-meta"><strong>{queue.readyForOutreach.total}</strong><span>{queue.readyForOutreach.total === 1 ? "lead ready" : "leads ready"}</span><a href="#outreach-workspace">Review previews ↓</a></div>
    </div>

    <style jsx>{`
      .review-workflow{margin-top:14px}.review-heading{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:12px}.review-heading small,.ready-summary small,.review-signal-grid small{display:block;color:#fbbf24;font:600 10px 'JetBrains Mono',monospace;letter-spacing:.12em;margin-bottom:6px}.review-heading h2{font:700 23px 'Syne',sans-serif}.review-heading p,.ready-summary p{color:#737884;margin-top:4px}.review-heading>strong{display:grid;place-items:center;min-width:34px;height:34px;padding:0 9px;border-radius:999px;background:rgba(101,88,245,.16);color:#b2aaff}.review-list{display:grid;gap:12px}.review-card{content-visibility:auto;contain-intrinsic-size:720px;border:1px solid rgba(255,255,255,.09);background:#15171c;border-radius:16px;padding:16px;min-width:0}.review-card-top{display:flex;gap:9px;align-items:center}.review-score strong{font:800 32px 'Syne',sans-serif;color:#fbbf24}.review-score small{color:#737884}.review-priority,.review-status{border-radius:999px;padding:5px 8px;font-size:10px;font-weight:800}.review-priority{background:rgba(251,191,36,.1);color:#fbbf24}.review-priority-urgent{background:rgba(248,113,113,.12);color:#f87171}.review-status{margin-left:auto;background:rgba(147,197,253,.1);color:#93c5fd}.review-business{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-top:10px}.review-business h3{font:700 21px 'Syne',sans-serif}.review-business p{color:#8a909b;margin-top:4px}.review-business a,.review-links a{color:#a99fff;text-decoration:none}.review-links{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;font-size:12px}.review-links span{color:#606673}.review-signal-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.review-signal-grid section{border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.025);border-radius:10px;padding:11px}.review-signal-grid p,.review-signal-grid li{color:#9da2ac;line-height:1.45}.review-signal-grid ul{padding-left:16px;display:grid;gap:3px}.review-recommendation{display:grid;grid-template-columns:.7fr 1.3fr;gap:10px;margin-top:10px}.review-recommendation label,.review-edit label,.review-reject label{display:grid;gap:5px}.review-recommendation label>span,.review-edit label>span,.review-reject label>span{color:#737985;font:600 9px 'JetBrains Mono',monospace;letter-spacing:.08em}.review-recommendation select,.review-edit select,.review-edit textarea,.review-reject select,.review-reject textarea{width:100%;min-width:0;border:1px solid rgba(255,255,255,.09);border-radius:8px;background:#0e1014;color:#e1e3e7;padding:9px 10px;font:inherit}.review-edit textarea,.review-reject textarea{resize:vertical}.review-last{color:#5f6571;font-size:11px;margin-top:9px}.review-edit,.review-reject{display:grid;gap:10px;margin-top:12px;padding:12px;border-radius:10px;background:#101217;border:1px solid rgba(255,255,255,.07)}.review-edit{grid-template-columns:.35fr 1fr 1fr}.review-edit .review-inline-actions{grid-column:1/-1}.review-inline-actions,.review-actions{display:flex;gap:8px;flex-wrap:wrap}.review-actions{margin-top:13px}.review-actions button,.review-inline-actions button{border:0;border-radius:8px;padding:9px 13px;font-weight:800;cursor:pointer}.review-actions button:disabled,.review-inline-actions button:disabled{opacity:.55;cursor:wait}.review-approve,.review-inline-actions>button:first-child{background:#6558f5;color:white}.review-reject-button,.review-danger{background:rgba(248,113,113,.12)!important;color:#f87171}.review-edit-button,.review-quiet{background:rgba(255,255,255,.06)!important;color:#aeb3bd}.review-feedback{border-radius:10px;padding:11px 13px;margin-bottom:12px}.review-feedback-success{background:rgba(52,211,153,.1);color:#6ee7b7}.review-feedback-error{background:rgba(248,113,113,.1);color:#fca5a5}.review-empty{border:1px dashed rgba(255,255,255,.1);border-radius:14px;padding:28px;text-align:center;color:#6d7380}.review-empty strong{display:block;color:#aeb3bc;margin-bottom:4px}.review-pagination{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px}.review-pagination a,.review-pagination span{border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 11px;color:#9298a3;text-decoration:none}.review-pagination span{opacity:.35}.review-pagination b{font-size:11px;color:#686e79}.ready-summary{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:24px 0 0;padding:14px 16px;border:1px solid rgba(52,211,153,.16);border-radius:13px;background:linear-gradient(90deg,rgba(52,211,153,.055),rgba(21,23,28,.7));min-width:0}.ready-summary h3{font:700 17px 'Syne',sans-serif}.ready-summary-meta{display:flex;align-items:center;gap:9px;flex:0 0 auto}.ready-summary-meta strong{font:800 24px 'Syne',sans-serif;color:#6ee7b7}.ready-summary-meta span{color:#78808a;font-size:11px}.ready-summary-meta a{border-radius:8px;background:rgba(255,255,255,.07);padding:8px 10px;color:#d7d9dd;text-decoration:none;font-size:11px;font-weight:700}.review-empty-compact{padding:18px}
      @media(max-width:760px){.review-signal-grid,.review-recommendation,.review-edit{grid-template-columns:1fr}.review-edit .review-inline-actions{grid-column:auto}.review-business{display:grid}.review-business a{order:-1}.review-actions button{flex:1}.review-heading h2{font-size:21px}.ready-summary{align-items:flex-start}.ready-summary-meta{display:grid;text-align:right}}
      @media(max-width:520px){.ready-summary{display:grid}.ready-summary-meta{grid-template-columns:auto 1fr;text-align:left}.ready-summary-meta a{grid-column:1/-1;text-align:center}}
    `}</style>
  </section>;
}
