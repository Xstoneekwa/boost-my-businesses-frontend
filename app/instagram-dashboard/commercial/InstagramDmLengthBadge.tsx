import { instagramDmLengthGuard } from "@/lib/commercial/instagram-dm-length";
import styles from "./CommercialOutreachWorkspace.module.css";

export default function InstagramDmLengthBadge({ body, approved = false }: { body: string; approved?: boolean }) {
  const { character_count, limit_status } = instagramDmLengthGuard(body);
  const blocked = limit_status === "HARD_LIMIT_EXCEEDED";
  const warning = limit_status === "OVER_TARGET";
  return <span role="status" className={`${styles.metaBadge} ${blocked ? styles.dmLengthError : warning ? styles.dmLengthWarning : ""}`} title="Complete final DM · JavaScript UTF-16 count, including spaces, line breaks, emojis and booking URL">
    {character_count} / {blocked ? 1000 : 900} characters{blocked ? ` · ${approved ? "CRITICAL_LENGTH_ISSUE · " : ""}Blocked` : warning ? " · OVER_TARGET" : " · WITHIN_TARGET"}
  </span>;
}
