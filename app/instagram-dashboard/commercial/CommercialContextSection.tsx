import styles from "./CommercialLeadReviewWorkspace.module.css";
export default function CommercialContextSection({ title, entries, empty }: { title: string; entries: Array<{ label: string; value: string }>; empty: string }) {
  return <section className={styles.contextSection}>
    <h4>{title}</h4>
    {entries.length ? <dl className={styles.contextRows}>{entries.map((entry, index) => <div className={styles.contextRow} key={`${entry.label}:${index}`}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl> : <p className={styles.contextEmpty}>{empty}</p>}
  </section>;
}
