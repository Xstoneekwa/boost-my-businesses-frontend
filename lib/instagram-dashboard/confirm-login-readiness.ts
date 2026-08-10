import type { createSupabaseClient } from "../supabase.ts";
import { runReadinessNow } from "./readiness-now.ts";

type Supabase = ReturnType<typeof createSupabaseClient>;
type Row = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function row(value: unknown): Row | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Row;
}

async function loadOpenOperatorAction(supabase: Supabase, accountId: string) {
  const { data, error } = await supabase
    .from("account_dashboard_actions")
    .select("id,incident_id,status,action_type,blocking_campaign,created_at")
    .eq("account_id", accountId)
    .eq("action_type", "operator_review_required")
    .in("status", ["pending", "acknowledged", "pending_verification", "resolved"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message || "operator_review_action_unavailable");
  return row(data);
}

async function loadIncident(supabase: Supabase, incidentId: string) {
  const { data, error } = await supabase
    .from("account_incidents")
    .select("id,account_id,status,lifecycle_version,incident_type,run_id")
    .eq("id", incidentId)
    .maybeSingle();
  if (error) throw new Error(error.message || "linked_incident_unavailable");
  return row(data);
}

export async function confirmLoginAndRefreshReadiness(
  supabase: Supabase,
  input: {
    accountId: string;
    operatorId: string;
    assignmentId?: string | null;
    expectedWorkerSha: string;
    causeFixedVersion: string;
    idempotencyKey: string;
  },
) {
  const action = await loadOpenOperatorAction(supabase, input.accountId);
  const incidentId = text(action?.incident_id);
  const incident = incidentId ? await loadIncident(supabase, incidentId) : null;
  if (incident && text(incident.account_id) !== input.accountId) {
    throw new Error("linked_incident_account_mismatch");
  }
  const operationKey = `${input.idempotencyKey}:${incidentId || "no-linked-incident"}`;

  const proofResult = await supabase.rpc("confirm_instagram_login_operator_v1", {
    p_account_id: input.accountId,
    p_operator_id: input.operatorId,
    p_assignment_id: input.assignmentId || null,
    p_incident_id: incidentId || null,
    p_idempotency_key: operationKey,
    p_expected_worker_sha: input.expectedWorkerSha,
    p_cause_fixed_version: input.causeFixedVersion,
  });
  if (proofResult.error) throw new Error(proofResult.error.message || "operator_login_confirmation_failed");
  const proof = row(proofResult.data) ?? {};
  if (proof.ok !== true || proof.ready !== true) {
    const readiness = await runReadinessNow(supabase, {
      accountId: input.accountId,
      audience: "admin",
      actorId: input.operatorId,
      dryRun: true,
    });
    return {
      ...readiness,
      confirmation_status: "blocked",
      operator_proof: proof,
      incident_resolved: false,
      dashboard_action_resolved: false,
      resume_authorization_created: false,
      next_tick_eligible: false,
      run_started: false,
    };
  }

  const readiness = await runReadinessNow(supabase, {
    accountId: input.accountId,
    audience: "admin",
    actorId: input.operatorId,
    dryRun: true,
  });
  return {
    ...readiness,
    confirmation_status: readiness.readiness_status === "ready" ? "confirmed_ready" : "confirmed_not_ready",
    operator_proof: proof,
    incident_id: incidentId || null,
    dashboard_action_id: text(action?.id) || null,
    incident_resolved: proof.incident_resolved === true,
    dashboard_action_resolved: proof.dashboard_action_resolved === true,
    resume_authorization_created: proof.resume_authorization_created === true,
    resume_authorization_id: proof.resume_authorization_id ?? null,
    next_tick_eligible: proof.next_tick_eligible === true,
    resume_blocked_reason: proof.blocked_reason ?? null,
    run_started: false,
  };
}
