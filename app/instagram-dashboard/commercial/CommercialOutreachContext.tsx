"use client";

import { useState } from "react";
import {
  COMMERCIAL_OUTREACH_ANGLES,
  COMMERCIAL_OUTREACH_CHANNELS,
  type CommercialOutreachAngle,
  type CommercialOutreachChannel,
  type CommercialOutreachItem,
  type CommercialOutreachMutationAction,
} from "@/lib/commercial/outreach-contract";
import { outreachActionAvailability, outreachStateLabel } from "@/lib/commercial/outreach-ui";
import styles from "./CommercialOutreachWorkspace.module.css";

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" }).format(parsed);
}

function safeHttpUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function ContextRows({ rows }: { rows: Array<[string, string | number | null]> }) {
  return <dl className={styles.contextRows}>{rows.map(([name, value]) => <div className={styles.contextRow} key={name}><dt>{name}</dt><dd>{value ?? "—"}</dd></div>)}</dl>;
}

export default function CommercialOutreachContext({
  item,
  open,
  pending,
  onClose,
  onMutate,
}: {
  item: CommercialOutreachItem | null;
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onMutate: (item: CommercialOutreachItem, action: CommercialOutreachMutationAction, patch?: Record<string, unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [changingSelection, setChangingSelection] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [subject, setSubject] = useState(item?.subject ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [channel, setChannel] = useState<CommercialOutreachChannel>(item?.channel ?? "instagram");
  const [angle, setAngle] = useState<CommercialOutreachAngle>(item?.angle ?? "A");

  const availability = outreachActionAvailability(item);
  const website = safeHttpUrl(item?.website ?? null);
  const booking = safeHttpUrl(item?.bookingUrl ?? null);
  const instagram = item?.instagramHandle ? `https://www.instagram.com/${encodeURIComponent(item.instagramHandle.replace(/^@/, ""))}` : null;

  return <aside className={`${styles.context} ${open ? styles.contextOpen : ""}`} aria-label="Lead context, audit and decisions">
    <header className={styles.contextHeader}><h3>Context & decision</h3><button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close context panel">✕</button></header>
    {item ? <>
      {editing ? <div className={styles.editor}>
        <small className={styles.panelEyebrow}>MINOR_EDIT · EDIT PREVIEW</small>
        {item.channel === "email" ? <label><span className={styles.fieldLabel}>Subject</span><input maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} disabled={pending} /></label> : null}
        <label><span className={styles.fieldLabel}>Message</span><textarea maxLength={item.channel === "instagram" ? 900 : 2000} rows={10} value={body} onChange={(event) => setBody(event.target.value)} disabled={pending} /></label>
        <div className={styles.editorActions}><button type="button" className={styles.primaryButton} onClick={() => onMutate(item, "edit_message", { subject: item.channel === "email" ? subject : null, body })} disabled={pending || !body.trim()}>Validate & save edit</button><button type="button" className={styles.quietButton} onClick={() => setEditing(false)} disabled={pending}>Close</button></div>
      </div> : null}

      {changingSelection ? <div className={styles.selection}>
        <label><span className={styles.fieldLabel}>Channel</span><select value={channel} onChange={(event) => setChannel(event.target.value as CommercialOutreachChannel)} disabled={pending}>{COMMERCIAL_OUTREACH_CHANNELS.map((value) => <option key={value} value={value}>{outreachStateLabel(value)}</option>)}</select></label>
        <label><span className={styles.fieldLabel}>Angle</span><select value={angle} onChange={(event) => setAngle(event.target.value as CommercialOutreachAngle)} disabled={pending}>{COMMERCIAL_OUTREACH_ANGLES.map((value) => <option key={value} value={value}>Angle {value}</option>)}</select></label>
        <div className={styles.selectionActions}><button type="button" className={styles.primaryButton} onClick={() => onMutate(item, "change_selection", { channel, angle })} disabled={pending || (channel === item.channel && angle === item.angle)}>Apply selection</button><button type="button" className={styles.quietButton} onClick={() => setChangingSelection(false)} disabled={pending}>Close</button></div>
      </div> : null}

      <div className={styles.contextBody}>
        <section className={styles.contextSection}>
          <h4>Message quality review</h4>
          <p className={styles.contextValue}>SENDABLE_AS_IS approves this preview for dry run only. MINOR_EDIT opens the editor; save your change to record it. REJECT cancels this preview, not the approved lead. No message is sent.</p>
        </section>
        <section className={styles.contextSection}>
          <h4>Lead snapshot</h4>
          <ContextRows rows={[["Business", item.businessName], ["City", item.city], ["Subsegment", item.subsegment], ["Priority", outreachStateLabel(item.priority)], ["AI score", item.score], ["Instagram bio", item.instagramBio]]} />
          <div className={styles.linkRow}>{instagram ? <a href={instagram} target="_blank" rel="noreferrer">Instagram ↗</a> : null}{website ? <a href={website} target="_blank" rel="noreferrer">Website ↗</a> : null}{booking ? <a href={booking} target="_blank" rel="noreferrer">Booking ↗</a> : null}</div>
        </section>

        {item.personalizationSummary || item.personalizationContext.length || item.audienceContext.length ? <section className={styles.contextSection}>
          <h4>Why this message</h4>
          {item.personalizationSummary ? <p className={styles.contextValue}>{item.personalizationSummary}</p> : null}
          {[...item.personalizationContext, ...item.audienceContext].slice(0, 8).map((entry) => <p className={styles.contextValue} key={`${entry.label}:${entry.value}`}><b>{outreachStateLabel(entry.label)}:</b> {entry.value}</p>)}
        </section> : null}

        <section className={styles.contextSection}>
          <h4>Verified facts used</h4>
          {item.factsUsed.length ? <div className={styles.factList}>{item.factsUsed.map((fact) => <span key={`${fact.key}:${fact.value}`}>{outreachStateLabel(fact.key)}: {fact.value}</span>)}</div> : <p className={styles.contextValue}>No verified fact ledger entry is attached to this preview.</p>}
        </section>

        <section className={styles.contextSection}>
          <h4>Generation evidence</h4>
          <ContextRows rows={[["Template", `${item.templateKey} · ${item.templateVersion}`], ["Model", item.generationModel], ["Prompt", item.generationPromptVersion], ["Attempts", `${item.attemptCount}/${item.maxAttempts}`], ["Confidence", item.confidence === null ? null : `${Math.round(item.confidence * 100)}%`], ["Owner edited", item.ownerEdited ? "Yes" : "No"], ["Generated", formatDate(item.generatedAt)]]} />
          {item.validationCodes.length ? <div className={styles.factList}>{item.validationCodes.map((code) => <span key={code}>{code}</span>)}</div> : null}
        </section>

        <section className={styles.contextSection}>
          <h4>Audit timeline</h4>
          {item.history.length ? <div className={styles.timeline}>{item.history.map((event) => <div className={styles.timelineEvent} key={event.id}><b>{outreachStateLabel(event.eventType)}</b><span>{outreachStateLabel(event.actorType)} · {formatDate(event.occurredAt)}</span></div>)}</div> : <p className={styles.contextValue}>No audit event is available.</p>}
        </section>
      </div>

      <div className={styles.actionBar} aria-label="Selected preview actions">
        {availability.approve ? <button type="button" className={styles.primaryButton} onClick={() => onMutate(item, "approve_message")} disabled={pending}>SENDABLE_AS_IS · Approve dry run</button> : null}
        {availability.edit ? <button type="button" className={styles.secondaryButton} onClick={() => setEditing((current) => !current)} disabled={pending}>MINOR_EDIT</button> : null}
        {availability.changeSelection ? <button type="button" className={styles.secondaryButton} onClick={() => setChangingSelection((current) => !current)} disabled={pending}>Channel / angle</button> : null}
        {availability.regenerate ? <button type="button" className={styles.secondaryButton} onClick={() => onMutate(item, "regenerate")} disabled={pending}>Regenerate</button> : null}
        {availability.cancel && !confirmCancel ? <button type="button" className={styles.dangerButton} onClick={() => setConfirmCancel(true)} disabled={pending}>REJECT · Cancel preview</button> : null}
        {availability.cancel && confirmCancel ? <><button type="button" className={styles.dangerButton} onClick={() => onMutate(item, "cancel", { reason: "message_quality_reject" })} disabled={pending}>Confirm reject</button><button type="button" className={styles.quietButton} onClick={() => setConfirmCancel(false)} disabled={pending}>Keep</button></> : null}
      </div>
    </> : <div className={styles.empty}><p>Select a preview to inspect the lead context and audit history.</p></div>}
  </aside>;
}
