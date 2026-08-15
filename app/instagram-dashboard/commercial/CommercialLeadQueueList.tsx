import type { CommercialReviewQueueItem } from "@/lib/commercial/lead-review-contract";
import { commercialReviewDate, commercialReviewLabel, commercialReviewPriorityLabel, commercialReviewScore } from "@/lib/commercial/lead-review-ui";
import styles from "./CommercialLeadReviewWorkspace.module.css";

export default function CommercialLeadQueueList({
  items,
  selectedId,
  total,
  page,
  pageCount,
  navigating,
  onSelect,
  onPage,
}: {
  items: CommercialReviewQueueItem[];
  selectedId: string | null;
  total: number;
  page: number;
  pageCount: number;
  navigating: boolean;
  onSelect: (id: string) => void;
  onPage: (page: number) => void;
}) {
  return <aside className={styles.queue} aria-label="Lead qualification queue">
    <header className={styles.panelHeader}>
      <div><small className={styles.panelEyebrow}>QUEUE</small><h3>{total} leads</h3></div>
      <span>J / K to navigate</span>
    </header>
    {items.length ? <div className={styles.queueList} role="listbox" aria-label="Leads awaiting approval">
      {items.map((item) => {
        const selected = item.id === selectedId;
        return <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={selected}
          className={`${styles.queueItem} ${selected ? styles.queueItemSelected : ""}`}
          onClick={() => onSelect(item.id)}
          disabled={navigating && !selected}
        >
          <span className={styles.queueItemTop}>
            <strong>{item.businessName}</strong>
            <span className={styles.scoreBadge}>{commercialReviewScore(item.score)}<small>/10</small></span>
          </span>
          <span className={styles.queueMeta}>
            <span className={`${styles.priorityBadge} ${item.priority === "urgent" ? styles.priorityUrgent : ""}`}>{commercialReviewPriorityLabel(item.priority)}</span>
            <span>{[item.city, item.subsegment].filter(Boolean).join(" · ") || "Location or segment missing"}</span>
          </span>
          <span className={styles.queueHandle}>{item.instagramHandle ? `@${item.instagramHandle.replace(/^@/, "")}` : "Instagram not captured"}</span>
          <span className={styles.queueMeta}>
            <span>{commercialReviewLabel(item.outreachChannel)}</span><span>Angle {item.messageAngle ?? "—"}</span>
            <span>{commercialReviewDate(item.lastActivityAt ?? item.updatedAt)}</span>
          </span>
          {item.reasoningExcerpt ? <span className={styles.queueExcerpt}>{item.reasoningExcerpt}</span> : null}
        </button>;
      })}
    </div> : <div className={styles.empty}><strong>Queue clear</strong><p>No qualified leads match the current review filters.</p></div>}
    {pageCount > 1 ? <nav className={styles.pager} aria-label="Needs Approval pages">
      <button className={styles.pagerButton} type="button" onClick={() => onPage(page - 1)} disabled={page <= 1 || navigating}>← Previous</button>
      <span>{page} / {pageCount}</span>
      <button className={styles.pagerButton} type="button" onClick={() => onPage(page + 1)} disabled={page >= pageCount || navigating}>Next →</button>
    </nav> : null}
  </aside>;
}
