type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** A completed physical check permits fresh live planning, never a fabricated business checkpoint. */
export function restrictionPreflightContinuationAuthorized(input: {
  run: unknown; request: unknown; plan: unknown; holds: unknown[];
}): boolean {
  const r=row(input.run), q=row(input.request), p=row(input.plan), m=row(q.metadata_safe);
  const policy=row(m.resume_plan), s=row(r.performance_summary), plan=row(p.plan);
  if (!nonempty(r.id) || !nonempty(r.account_id) || !nonempty(q.id)
    || q.run_id!==r.id || q.account_id!==r.account_id || q.status!=="completed"
    || q.requested_run_type!=="account_session" || q.cancel_requested_at
    || !nonempty(q.completed_at) || !nonempty(r.finished_at)
    || p.run_id!==r.id || p.run_request_id!==q.id || p.account_id!==r.account_id
    || p.resume_state!=="completed" || p.restart_allowed!==false
    || m.recovery_mode!=="human_confirmed_resume" || m.restriction_preflight_only!==true
    || policy.restriction_preflight_only!==true || policy.account_id!==r.account_id
    || !nonempty(m.incident_id) || policy.incident_id!==m.incident_id
    || !nonempty(m.authorization_id) || policy.authorization_id!==m.authorization_id
    || !nonempty(m.resume_plan_id) || policy.resume_plan_id!==m.resume_plan_id
    || s.reason!=="restriction_physical_preflight_passed" || s.physical_preflight_passed!==true
    || s.restriction_preflight_only!==true || s.business_actions_executed!==0
    || ["total_follow","total_like","total_dm","total_story"].some(k=>r[k]!==0)
    || ["welcome","follow","unfollow"].some(k=>row(policy.phases_to_run)[k]!==false)) return false;
  const holds=input.holds.map(row).filter(h=>h.account_id===r.account_id && h.incident_id===m.incident_id
    && h.verified_by_run_id===r.id && h.status==="cleared" && nonempty(h.verified_cleared_at));
  if (holds.length!==1) return false;
  const h=holds[0], proof=row(s.restriction_preflight_terminal_contract);
  const bindings={run_id:r.id,request_id:q.id,account_id:r.account_id,incident_id:m.incident_id,
    authorization_id:m.authorization_id,resume_plan_id:m.resume_plan_id,hold_id:h.id};
  if (r.status==="completed" && s.preflight_cleanup_completed===true
    && proof.schema==="RESTRICTION_PREFLIGHT_TERMINAL_V1"
    && Object.entries(bindings).every(([k,v])=>nonempty(v)&&proof[k]===v)) return true;
  // Explicit audited historical reconciliation is distinct from new Worker proof.
  const old=row(plan.historical_preflight_reconciliation);
  return r.status==="failed" && old.schema==="HISTORICAL_RESTRICTION_PREFLIGHT_RECONCILIATION_V1"
    && old.run_id===r.id && old.request_id===q.id && old.hold_id===h.id
    && old.physical_hold_cleared_at===h.verified_cleared_at
    && old.historical_run_status_preserved===true && old.business_quota_completion_asserted===false
    && /^[a-f0-9]{40}$/.test(String(old.repair_worker_sha))
    && /^[a-f0-9]{64}$/.test(String(old.original_run_sha256))
    && /^[a-f0-9]{64}$/.test(String(old.original_request_sha256));
}
