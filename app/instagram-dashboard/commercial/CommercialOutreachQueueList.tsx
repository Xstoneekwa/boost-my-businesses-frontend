import type { CommercialOutreachQueueItem } from "@/lib/commercial/outreach-contract";
import { outreachStateLabel } from "@/lib/commercial/outreach-ui";
import styles from "./CommercialOutreachWorkspace.module.css";

function stateClass(state: CommercialOutreachQueueItem["state"]) {
  if (state === "ready_for_review") return styles.stateReady;
  if (state === "queued_dry_run") return styles.stateApproved;
  if (state === "generation_failed") return styles.stateFailed;
  if (state === "cancelled") return styles.stateCancelled;
  return "";
}

function displayScore(value: number | null) {
  if (value === null) return null;
  return value > 10 ? `${Math.round(value)}%` : `${value.toFixed(1)}/10`;
}

export default function CommercialOutreachQueueList({
  items,
  selectedId,
  total,
  page,
  pageCount,
  navigating,
  onSelect,
  onPage,
}: {
  items: CommercialOutreachQueueItem[];
  selectedId: string | null;
  total: number;
  page: number;
  pageCount: number;
  navigating: boolean;
  onSelect: (id: string) => void;
  onPage: (page: number) => void;
}) {
  return <aside className={styles.queue} aria-label="Outreach preview queue">
    <header className={styles.panelHeader}>
      <div><small className={styles.panelEyebrow}>QUEUE</small><h3>{total} previews</h3></div>
      <span>J / K to navigate</span>
    </header>
    {items.length ? <div className={styles.queueList} role="listbox" aria-label="Message previews">
      {items.map((item) => {
        const selected = item.id === selectedId;
        const score = displayScore(item.score);
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
            {score ? <span className={styles.scoreBadge}>{score}</span> : null}
          </span>
          <span className={styles.queueExcerpt}>{item.messageExcerpt || "No generated copy yet. This item remains fail closed."}</span>
          <span className={styles.queueMeta}>
            <span className={`${styles.stateBadge} ${stateClass(item.state)}`}>{outreachStateLabel(item.state)}</span>
            <span>{outreachStateLabel(item.channel)}</span><span>Angle {item.angle}</span>
            {item.city ? <span>{item.city}</span> : null}
          </span>
        </button>;
      })}
    </div> : <div className={styles.empty}><p>No preview matches this status and the current filters.</p></div>}
    {pageCount > 1 ? <nav className={styles.pager} aria-label="Outreach queue pages">
      <button className={styles.pagerButton} type="button" onClick={() => onPage(page - 1)} disabled={page <= 1 || navigating}>← Previous</button>
      <span>{page} / {pageCount}</span>
      <button className={styles.pagerButton} type="button" onClick={() => onPage(page + 1)} disabled={page >= pageCount || navigating}>Next →</button>
    </nav> : null}
  </aside>;
}
