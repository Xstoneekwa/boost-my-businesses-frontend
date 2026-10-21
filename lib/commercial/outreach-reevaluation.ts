import { hasBmbValueProposition, hasUnresolvedOutreachPlaceholder } from "./outreach-quality";
import type { CommercialOutreachAngle } from "./outreach-contract";

// Read-only release planner. Execution must additionally recheck the version,
// approval and body under a DB row lock immediately before the existing RPC.
export function planCommercialOutreachV3(item: {
  state: string; approved_at?: string | null; approved_by?: string | null;
  owner_edited?: boolean; body: string | null; subject: string | null; angle: string;
}) {
  const placeholder = hasUnresolvedOutreachPlaceholder(`${item.subject ?? ""}\n${item.body ?? ""}`);
  const approved = Boolean(item.approved_at || item.approved_by) || ["approved_for_send", "queued_dry_run", "sending", "sent"].includes(item.state);
  if (approved) return { classification: "OWNER_APPROVED", action: "PRESERVE", reasons: placeholder ? ["critical_placeholder_review_required"] : [] } as const;
  if (item.state === "cancelled") return { classification: "CANCELLED", action: "PRESERVE", reasons: [] } as const;
  if (item.state === "generation_failed") return { classification: "FAILED", action: "PRESERVE", reasons: [] } as const;
  if (item.state !== "ready_for_review") return { classification: "OTHER", action: "PRESERVE", reasons: [] } as const;
  const reasons: string[] = [];
  if (placeholder) reasons.push("unresolved_placeholder");
  if (!item.body || !["A", "B"].includes(item.angle) || !hasBmbValueProposition(item.body, item.angle as CommercialOutreachAngle)) reasons.push("bmb_value_proposition_missing");
  // An owner's saved edit is never silently overwritten, even before approval.
  return { classification: "READY_NOT_APPROVED", action: reasons.length ? item.owner_edited ? "OWNER_REVIEW_REQUIRED" : "REGENERATE" : "PRESERVE", reasons } as const;
}
