import { assertActivatableBatch } from "../shadow-safety.ts";
import type { CtShadowValidationFinding, CtShadowValidationRun } from "./types.ts";

const finding = (run: Pick<CtShadowValidationRun, "scenario">, invariant: string, ok: boolean, message: string, evidence?: CtShadowValidationFinding["evidence"]): CtShadowValidationFinding | null => ok ? null : { scenarioId: run.scenario.id, invariant, verdict: "fail", message, evidence };

export function evaluateCtShadowInvariants(run: Omit<CtShadowValidationRun, "findings">): readonly CtShadowValidationFinding[] {
  const { scenario, report, rerun, deterministic, serializable } = run;
  const proposed = report.shadowBatch?.proposals ?? [];
  const usernames = proposed.map((proposal) => proposal.normalizedUsername);
  const uniqueUsernames = new Set(usernames);
  const active = new Set(report.snapshot?.activeTargetUsernames ?? []);
  const blacklist = new Set(report.snapshot?.blacklistUsernames ?? []);
  let shadowRejected = true;
  if (report.shadowBatch) {
    try { assertActivatableBatch(report.shadowBatch); shadowRejected = false; } catch { shadowRejected = true; }
  }
  const findings = [
    finding(run, "non_premium_never_batches", scenario.plan === "premium" || !report.shadowBatch, "Growth/Pro produced a Premium shadow batch."),
    finding(run, "stock_six_not_triggered", scenario.stock !== 6 || report.gate.action !== "prepare_premium_batch", "Stock 6 triggered Premium generation."),
    finding(run, "onboarding_distinct", scenario.lifecycle !== "onboarding_incomplete" || report.gate.action === "onboarding_incomplete", "Onboarding incomplete entered low-stock generation."),
    finding(run, "scope_isolation", report.tenantId === report.gate.tenantId && report.accountId === report.gate.accountId && (!report.snapshot || (report.snapshot.tenantId === report.tenantId && report.snapshot.accountId === report.accountId)), "Report or snapshot crossed its scope."),
    finding(run, "blacklist_exclusion", usernames.every((username) => !blacklist.has(username)), "Blacklisted username reached final proposals."),
    finding(run, "active_target_exclusion", usernames.every((username) => !active.has(username)), "Active target was reproposed."),
    finding(run, "final_deduplication", uniqueUsernames.size === usernames.length, "Final proposals contain duplicates."),
    finding(run, "shadow_not_activatable", shadowRejected, "Shadow batch passed the activation guard."),
    finding(run, "no_side_effects", report.mutationExecuted === false && report.activationAllowed === false, "Shadow report claims a mutation or activation."),
    finding(run, "deterministic_rerun", deterministic, "Same deterministic input produced a different result."),
    finding(run, "idempotent_retry", scenario.candidateMode !== "idempotency_conflict" || !report.shadowBatch || (rerun.status === "blocked" && rerun.errors.includes("idempotency_conflict")), "Idempotency conflict did not fail closed."),
    finding(run, "batch_maximum", report.proposedCount <= 20, "Batch exceeded 20 proposals.", { proposedCount: report.proposedCount }),
    finding(run, "batch_default", !report.shadowBatch || report.snapshot?.batchSize !== 10 || report.proposedCount <= 10, "Default batch exceeded 10 proposals."),
    finding(run, "score_range", proposed.every((proposal) => proposal.score.total >= 0 && proposal.score.total <= 100), "A score is outside 0..100."),
    finding(run, "stable_reason_codes", Boolean(report.gate.reasonCode) && report.gate.reasonCode === report.gate.reason, "Gate reason code is missing or unstable."),
    finding(run, "reasoned_exclusions", Object.entries(report.exclusionCounts).every(([reason, count]) => Boolean(reason) && count > 0), "An exclusion has no stable reason."),
    finding(run, "score_breakdowns", proposed.every((proposal) => Object.keys(proposal.score.breakdown).length === 10), "A retained score lacks its ten-signal breakdown."),
    finding(run, "report_serializable", serializable, "Shadow report is not serializable."),
    finding(run, "synthetic_only", !JSON.stringify(report).match(/rex_gen_boost_ai|service_role|supabase\.co|sk_live_|sk_test_/i), "Report contains a forbidden real identifier or secret marker."),
    finding(run, "snapshot_scope", !report.snapshot || (report.snapshot.tenantId === report.tenantId && report.snapshot.accountId === report.accountId), "Snapshot scope differs from report scope."),
    finding(run, "rejected_never_autoaccepted", proposed.every((proposal) => proposal.status === "pending"), "Generated proposal has an unexpected decision status."),
    finding(run, "commercial_blockers", !["paused", "canceled", "blocked", "ownership_inactive", "lifecycle_incompatible", "entitlement_absent", "entitlement_expired"].includes(scenario.lifecycle) || !report.shadowBatch, "Commercial/runtime blocker produced a batch."),
    finding(run, "material_snapshot_fingerprint", scenario.temporalMode !== "snapshot_materially_changed" || !run.previousSnapshot || run.previousSnapshot.fingerprint !== report.snapshot?.fingerprint, "Material snapshot change reused the previous fingerprint."),
    finding(run, "report_versions", !report.snapshot || Boolean(report.snapshot.scoringVersion && report.snapshot.searchStrategyVersion && (!report.providerResult || report.providerTrace?.version)), "Report misses scoring, strategy or provider version."),
    finding(run, "report_operator_context", Boolean(report.recommendationDetail.code) && report.recommendationDetail.requiresHumanReview, "Report lacks an operator recommendation."),
  ].filter((entry): entry is CtShadowValidationFinding => entry !== null);
  return Object.freeze(findings);
}
