import { certifiedCopyFixtures } from "@/lib/commercial/copy-certification";
import InstagramDmLengthBadge from "./InstagramDmLengthBadge";
import styles from "./CommercialOutreachWorkspace.module.css";

export default function CommercialCopyCertification() {
  const previews = certifiedCopyFixtures();
  return <details className={styles.messagePaper} id="copy-certification">
    <summary>EN / FR · Direct Calendly template certification · {previews.filter(p => p.validation.ok).length}/8 technical PASS</summary>
    <p>FIXTURE ONLY — fictional examples, not CRM prospects. No human approval, no live send. France real-lead quality: NOT_YET_TESTED.</p>
    {previews.map(p => <details key={p.template_version} className={styles.messagePaper}>
      <summary>{p.language.toUpperCase()} · {p.channel} · Angle {p.angle} · FIXTURE · {p.validation.ok ? "PASS" : "FAIL"}</summary>
      {p.channel === "instagram" ? <InstagramDmLengthBadge body={p.body} approved={false} /> : null}
      {p.subject ? <strong>{p.subject}</strong> : null}
      <pre className={styles.messageBody}>{p.body}</pre>
      <small>Technical example only. LIVE_SEND_ELIGIBLE=NO.</small>
    </details>)}
  </details>;
}
