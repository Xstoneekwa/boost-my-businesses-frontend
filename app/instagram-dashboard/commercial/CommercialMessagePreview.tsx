import type { CommercialOutreachItem } from "@/lib/commercial/outreach-contract";
import { outreachStateLabel } from "@/lib/commercial/outreach-ui";
import styles from "./CommercialOutreachWorkspace.module.css";

function stateClass(state: CommercialOutreachItem["state"]) {
  if (state === "ready_for_review") return styles.stateReady;
  if (state === "queued_dry_run") return styles.stateApproved;
  if (state === "generation_failed") return styles.stateFailed;
  if (state === "cancelled") return styles.stateCancelled;
  return "";
}

export default function CommercialMessagePreview({
  item,
  mobileOpen,
  onBack,
  onOpenContext,
}: {
  item: CommercialOutreachItem | null;
  mobileOpen: boolean;
  onBack: () => void;
  onOpenContext: () => void;
}) {
  return <section className={`${styles.preview} ${mobileOpen ? "" : styles.previewHiddenMobile}`} aria-label="Selected message preview">
    {item ? <>
      <header className={styles.previewHeader}>
        <div>
          <button type="button" className={`${styles.quietButton} ${styles.mobileBack}`} onClick={onBack}>← Queue</button>
          <small className={styles.panelEyebrow}>MESSAGE PREVIEW</small>
          <h3>{item.businessName}</h3>
          <p>{[item.city, item.subsegment].filter(Boolean).join(" · ") || "Verified CRM lead"}</p>
        </div>
        <button type="button" className={styles.secondaryButton} onClick={onOpenContext}>Context & actions</button>
      </header>
      <div className={styles.previewMeta}>
        <span className={`${styles.stateBadge} ${stateClass(item.state)}`}>{outreachStateLabel(item.state)}</span>
        <span className={styles.channelBadge}>{outreachStateLabel(item.channel)}</span>
        <span className={styles.metaBadge}>Angle {item.angle}</span>
        <span className={styles.metaBadge}>{item.templateKey}</span>
        {item.confidence !== null ? <span className={styles.metaBadge}>{Math.round(item.confidence * 100)}% confidence</span> : null}
      </div>
      {item.body || item.subject ? <article className={styles.messagePaper} aria-label={`Full message for ${item.businessName}`}>
        {item.subject ? <div className={styles.messageSubject}><small className={styles.fieldLabel}>Subject</small><strong>{item.subject}</strong></div> : null}
        {item.body ? <pre className={styles.messageBody}>{item.body}</pre> : null}
      </article> : <div className={styles.waiting}>{item.state === "generation_failed" ? `Generation failed closed: ${item.validationCodes.join(", ") || "unknown validation failure"}.` : "This durable item is waiting for dry-run generation. Nothing will be sent."}</div>}
    </> : <div className={styles.empty}><p>Select a preview from the queue to review the complete message.</p></div>}
  </section>;
}
