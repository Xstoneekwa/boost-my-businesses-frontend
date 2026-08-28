"use client";

import Link from "next/link";
import { useState } from "react";
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
  type CommercialReviewPatch,
  type CommercialReviewPriority,
} from "@/lib/commercial/lead-review-contract";
import {
  commercialReviewContextEntries,
  commercialReviewDate,
  commercialReviewLabel,
  commercialReviewNote,
  commercialReviewPriorityLabel,
  commercialReviewScore,
  safeCommercialReviewUrl,
} from "@/lib/commercial/lead-review-ui";
import styles from "./CommercialLeadReviewWorkspace.module.css";
import type { HumanReviewFeedback } from "@/lib/commercial/human-review-feedback";

function ContextSection({ title, entries, empty }: { title: string; entries: Array<{ label: string; value: string }>; empty: string }) {
  return <section className={styles.contextSection}>
    <h4>{title}</h4>
    {entries.length ? <dl className={styles.contextRows}>{entries.map((entry, index) => <div className={styles.contextRow} key={`${entry.label}:${index}`}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl> : <p className={styles.contextEmpty}>{empty}</p>}
  </section>;
}

export default function CommercialLeadDetail({
  lead,
  pending,
  returnPath,
  mobileOpen,
  previousDisabled,
  nextDisabled,
  onBack,
  onPrevious,
  onNext,
  onMutate,
  canaryMember,
  reviewReady = true,
  starting = false,
  onStartReview,
}: {
  lead: CommercialReviewLead | null;
  pending: boolean;
  returnPath: string;
  mobileOpen: boolean;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onBack: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onMutate: (lead: CommercialReviewLead, action: CommercialReviewAction, patch: CommercialReviewPatch) => Promise<boolean>;
  canaryMember?: HumanReviewFeedback["members"][number];
  reviewReady?: boolean;
  starting?: boolean;
  onStartReview?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [channel, setChannel] = useState<CommercialReviewChannel>((lead?.outreachChannel as CommercialReviewChannel) || "instagram");
  const [angle, setAngle] = useState<CommercialReviewAngle>((lead?.messageAngle as CommercialReviewAngle) || "A");
  const [priority, setPriority] = useState<CommercialReviewPriority>((lead?.priority as CommercialReviewPriority) || "normal");
  const [personalizationNote, setPersonalizationNote] = useState(lead ? commercialReviewNote(lead.personalizationContext) : "");
  const [audienceNote, setAudienceNote] = useState(lead ? commercialReviewNote(lead.audienceContext) : "");
  const [rejectionReason, setRejectionReason] = useState<CommercialRejectionReason | "">("");
  const [rejectionNote, setRejectionNote] = useState("");

  if (!lead) return <article className={`${styles.detail} ${mobileOpen ? "" : styles.detailHiddenMobile}`}><div className={styles.empty}><p>Select a lead to review its qualification evidence.</p></div></article>;

  const personalization = commercialReviewContextEntries(lead.personalizationContext);
  const audiences = commercialReviewContextEntries(lead.audienceContext);
  const why = personalization.filter((entry) => /reason|why|summary|fit|signal|score/i.test(entry.label));
  const evidence = personalization.filter((entry) => !why.includes(entry));
  const website = safeCommercialReviewUrl(lead.website);
  const reviewPatch = { outreachChannel: channel, messageAngle: angle, priority, personalizationNote, audienceNote };
  const detailHref = `/instagram-dashboard/commercial/leads/${lead.id}?return_to=${encodeURIComponent(returnPath)}`;
  function cancelEdit() {
    setChannel((lead!.outreachChannel as CommercialReviewChannel) || "instagram");
    setAngle((lead!.messageAngle as CommercialReviewAngle) || "A");
    setPriority((lead!.priority as CommercialReviewPriority) || "normal");
    setPersonalizationNote(commercialReviewNote(lead!.personalizationContext));
    setAudienceNote(commercialReviewNote(lead!.audienceContext));
    setEditing(false);
  }

  return <article className={`${styles.detail} ${mobileOpen ? "" : styles.detailHiddenMobile}`} aria-label={`Review ${lead.businessName}`}>
    <header className={styles.detailHeader}>
      <button type="button" className={`${styles.iconButton} ${styles.mobileBack}`} onClick={onBack} aria-label="Back to lead queue">←</button>
      <div className={styles.detailHeading}>
        <span className={styles.detailScore}>{commercialReviewScore(lead.score)}<small>/10</small></span>
        <span className={`${styles.priorityBadge} ${lead.priority === "urgent" ? styles.priorityUrgent : ""}`}>{commercialReviewPriorityLabel(lead.priority)}</span>
        <div><h3>{lead.businessName}</h3><p>{[lead.city, lead.subsegment].filter(Boolean).join(" · ") || "Location or segment not captured"}</p></div>
      </div>
      <nav className={styles.detailNavigation} aria-label="Selected lead navigation">
        <button type="button" className={styles.iconButton} onClick={onPrevious} disabled={previousDisabled || pending} aria-label="Previous lead">←</button>
        <button type="button" className={styles.iconButton} onClick={onNext} disabled={nextDisabled || pending} aria-label="Next lead">→</button>
      </nav>
    </header>

    <div className={styles.detailBody}>
      {canaryMember ? <section className={styles.recommendation} aria-label="Canary review tracking"><h4>Canary · original AI baseline</h4><p>{commercialReviewPriorityLabel(canaryMember.aiPriority)} · {commercialReviewScore(canaryMember.aiScore)}/10 · {commercialReviewLabel(canaryMember.aiChannel)} · Angle {canaryMember.aiAngle}</p>
        {reviewReady ? <p role="status">Review in progress. Elapsed time includes breaks. The next lead starts automatically in this session.</p> : <><p>Start when ready to read the evidence. Merely opening this dashboard records no review.</p><button type="button" className={styles.primaryButton} disabled={starting || pending} onClick={onStartReview}>{starting ? "Starting…" : canaryMember.startedAt ? "Resume review" : "Start review"}</button></>}
      </section> : null}
      <div className={styles.linkRow}>
        {lead.instagramHandle ? <a href={`https://www.instagram.com/${encodeURIComponent(lead.instagramHandle.replace(/^@/, ""))}`} target="_blank" rel="noreferrer">@{lead.instagramHandle.replace(/^@/, "")} ↗</a> : <span>Instagram not captured</span>}
        {website ? <a href={website} target="_blank" rel="noreferrer">Website ↗</a> : <span>Website not captured</span>}
        <Link href={detailHref}>Full CRM detail →</Link>
      </div>

      <ContextSection title="Why this lead" entries={why.length ? why : personalization.slice(0, 2)} empty="No qualification reasoning was captured." />
      <ContextSection title="Observed evidence" entries={evidence.length ? evidence : personalization.slice(2)} empty="No additional observed evidence was captured." />
      <ContextSection title="Potential audiences" entries={audiences} empty="No audience or competitor context was captured." />

      <section className={styles.recommendation}>
        <h4>Outreach recommendation</h4>
        <div className={styles.recommendationGrid}>
          <div><span>Recommended channel</span><strong>{commercialReviewLabel(lead.outreachChannel ?? channel)}</strong></div>
          <div><span>Recommended angle</span><strong>Angle {lead.messageAngle ?? angle}</strong><small>{COMMERCIAL_REVIEW_ANGLE_LABELS[(lead.messageAngle as CommercialReviewAngle) || angle]}</small></div>
        </div>
        <p>Last activity: {commercialReviewLabel(lead.lastActivityType)} · {commercialReviewDate(lead.lastActivityAt ?? lead.updatedAt)}</p>
      </section>

      {editing ? <section className={styles.editor} aria-label="Edit review context">
        <h4>Edit review context</h4>
        <div className={styles.editorGrid}>
          <label><span>Channel</span><select value={channel} onChange={(event) => setChannel(event.target.value as CommercialReviewChannel)} disabled={pending}>{COMMERCIAL_REVIEW_CHANNELS.map((value) => <option key={value} value={value}>{commercialReviewLabel(value)}</option>)}</select></label>
          <label><span>Angle</span><select value={angle} onChange={(event) => setAngle(event.target.value as CommercialReviewAngle)} disabled={pending}>{COMMERCIAL_REVIEW_ANGLES.map((value) => <option key={value} value={value}>Angle {value}</option>)}</select></label>
          <label><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value as CommercialReviewPriority)} disabled={pending}>{COMMERCIAL_REVIEW_PRIORITIES.map((value) => <option key={value} value={value}>{commercialReviewPriorityLabel(value)} · {commercialReviewLabel(value)}</option>)}</select></label>
        </div>
        <label><span>Personalization note</span><textarea maxLength={1000} rows={3} value={personalizationNote} onChange={(event) => setPersonalizationNote(event.target.value)} disabled={pending} /></label>
        <label><span>Audience / competitor note</span><textarea maxLength={1000} rows={3} value={audienceNote} onChange={(event) => setAudienceNote(event.target.value)} disabled={pending} /></label>
        <div className={styles.inlineActions}><button type="button" className={styles.primaryButton} onClick={async () => { if (await onMutate(lead, "update_context", reviewPatch)) setEditing(false); }} disabled={pending || !reviewReady}>{pending ? "Saving…" : "Save changes"}</button><button type="button" className={styles.quietButton} onClick={cancelEdit} disabled={pending}>Cancel</button></div>
      </section> : null}

      {rejecting ? <section className={styles.rejectPanel} role="dialog" aria-modal="false" aria-labelledby="reject-lead-title">
        <h4 id="reject-lead-title">Why reject this lead?</h4>
        <label><span>Reason</span><select value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value as CommercialRejectionReason | "")} disabled={pending}><option value="">Select a reason</option>{COMMERCIAL_REJECTION_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Optional note</span><textarea maxLength={500} rows={2} value={rejectionNote} onChange={(event) => setRejectionNote(event.target.value)} disabled={pending} /></label>
        <div className={styles.inlineActions}><button type="button" className={styles.dangerButton} onClick={() => onMutate(lead, "reject", { rejectionReason: rejectionReason || undefined, rejectionNote })} disabled={pending || !rejectionReason || !reviewReady}>{pending ? "Rejecting…" : "Confirm reject & next"}</button><button type="button" className={styles.quietButton} onClick={() => setRejecting(false)} disabled={pending}>Cancel</button></div>
      </section> : null}
    </div>

    <footer className={styles.decisionBar} aria-label="Lead decision controls">
      <button type="button" className={styles.primaryButton} onClick={() => onMutate(lead, "approve", reviewPatch)} disabled={pending || !reviewReady || editing || rejecting}>{pending ? "Saving…" : "Approve & next"}</button>
      <button type="button" className={styles.dangerButton} onClick={() => { cancelEdit(); setRejecting(true); }} disabled={pending || !reviewReady}>Reject</button>
      <button type="button" className={styles.secondaryButton} onClick={() => { setEditing(true); setRejecting(false); }} disabled={pending || !reviewReady}>Edit</button>
      <span>No outreach is sent here.</span>
    </footer>
  </article>;
}
