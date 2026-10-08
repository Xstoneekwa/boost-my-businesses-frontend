import type { FeedbackRate, HumanReviewFeedback } from "@/lib/commercial/human-review-feedback";
import { COMMERCIAL_REJECTION_REASONS } from "@/lib/commercial/lead-review-contract";
import styles from "./CommercialReviewQuality.module.css";

function Rate({ value, unit = "decisions" }: { value: FeedbackRate; unit?: string }) {
  return <><strong>{value.percent === null ? "—" : `${Math.round(value.percent)}%`}</strong><small>{value.count}/{value.total} {unit}</small></>;
}
const seconds = (value: number | null) => value === null ? "—" : `${Math.round(value)}s`;

export default function CommercialReviewQuality({ model }: { model: HumanReviewFeedback }) {
  return <section className={styles.quality} aria-labelledby="review-quality-title">
    <header><div><small>REVIEW QUALITY</small><h2 id="review-quality-title">Human review canary</h2><p>15 P1 + 10 best-scored P2 · frozen baseline · real Liam decisions only</p></div><span>{model.complete ? "Review complete" : `${model.reviewed}/${model.cohortSize} reviewed`}</span></header>
    <div className={styles.progress} role="progressbar" aria-label="Canary reviewed" aria-valuemin={0} aria-valuemax={25} aria-valuenow={model.reviewed}><span style={{ width: `${model.reviewed / 25 * 100}%` }} /></div>
    <div className={styles.totals}><span><b>{model.reviewed}</b> Reviewed</span><span><b>{model.pending}</b> Pending</span><span><b>{model.approved}</b> Approved</span><span><b>{model.rejected}</b> Rejected</span></div>
    <dl className={styles.metrics}>
      <div><dt>P1 approval</dt><dd><Rate value={model.p1} /></dd></div><div><dt>P2 approval</dt><dd><Rate value={model.p2} /></dd></div>
      <div><dt>Channel agreement</dt><dd><Rate value={model.channelAgreement} unit="approved leads" /></dd></div><div><dt>Angle agreement</dt><dd><Rate value={model.angleAgreement} unit="approved leads" /></dd></div>
      <div><dt>Decision time</dt><dd><strong>{seconds(model.medianSeconds)}</strong><small>Median · P90 {seconds(model.p90Seconds)}</small></dd></div><div><dt>Edit rate</dt><dd><Rate value={model.editRate} /></dd></div>
    </dl>
    {model.reviewed === 0 ? <p className={styles.note}>Awaiting your decisions. No historical approvals are counted. Start review in the lead detail when you are ready.</p> : <p className={styles.note}>Approval {Math.round(model.approveRate.percent ?? 0)}% · rejection {Math.round(model.rejectRate.percent ?? 0)}% · elapsed time includes breaks, across {model.timedReviews} timed decisions.</p>}
    {model.missingItems || model.inconsistentPending ? <p role="alert">Consistency issue: {model.missingItems} missing outreach items · {model.inconsistentPending} untracked decisions. Investigate before continuing.</p> : null}
    <details><summary>Score bands, rejection reasons & dry-run funnel</summary>
      <div className={styles.insights}><div><h3>Approval by original AI score</h3><ul>{model.scoreBands.map((band) => <li key={band.label}><span>{band.label}</span><Rate value={band} /></li>)}</ul></div>
        <div><h3>Top rejection reasons</h3>{model.rejectionReasons.length ? <ul>{model.rejectionReasons.map(({ reason, count }) => <li key={reason}><span>{COMMERCIAL_REJECTION_REASONS.find(([key]) => key === reason)?.[1] ?? reason}</span><b>{count}</b></li>)}</ul> : <p>No human rejections yet.</p>}</div></div>
      <h3>Canary funnel · cohort only</h3><ol className={styles.funnel}>{model.funnel.map((step) => <li key={step.label}><span>{step.label}</span><b>{step.count}</b></li>)}</ol>
      <p className={styles.note}>The first three stages count entry into the cohort, not current queue size. Preview counts require a current valid preview. {model.approvedWithoutPreview} approved without a valid preview · {model.terminalFailures} terminal generation failures.</p>
    </details>
    <footer>Scoring & recommendation logic frozen · auto-approval OFF · all real outreach OFF</footer>
  </section>;
}
