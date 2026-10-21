import assert from "node:assert/strict";
import test from "node:test";
import { restrictionPreflightContinuationAuthorized as authorized } from "./restriction-preflight-continuation.ts";
import { resolveRestartNeed } from "./auto-restart-candidate-policy.ts";

function fixture() {
  const binding={run_id:"run",request_id:"request",account_id:"account",incident_id:"incident",authorization_id:"authorization",resume_plan_id:"source-plan",hold_id:"hold"};
  return {
    run:{id:"run",account_id:"account",status:"completed",finished_at:"2026-09-15T00:00:00Z",total_follow:0,total_like:0,total_dm:0,total_story:0,
      performance_summary:{reason:"restriction_physical_preflight_passed",physical_preflight_passed:true,restriction_preflight_only:true,business_actions_executed:0,preflight_cleanup_completed:true,restriction_preflight_terminal_contract:{schema:"RESTRICTION_PREFLIGHT_TERMINAL_V1",...binding}}},
    request:{id:"request",run_id:"run",account_id:"account",status:"completed",completed_at:"2026-09-15T00:00:00Z",requested_run_type:"account_session",cancel_requested_at:null as string|null,
      metadata_safe:{recovery_mode:"human_confirmed_resume",restriction_preflight_only:true,incident_id:"incident",authorization_id:"authorization",resume_plan_id:"source-plan",
        resume_plan:{...binding,restriction_preflight_only:true,phases_to_run:{welcome:false,follow:false,unfollow:false}}}},
    plan:{run_id:"run",run_request_id:"request",account_id:"account",resume_state:"completed",restart_allowed:false,plan:{} as Record<string,unknown>},
    holds:[{id:"hold",account_id:"account",incident_id:"incident",verified_by_run_id:"run",status:"cleared",verified_cleared_at:"2026-09-15T00:00:00Z"}],
  };
}
test("completed physical-only verification authorizes live planning",()=>assert.equal(authorized(fixture()),true));
const mutations: Record<string,(f:ReturnType<typeof fixture>)=>void>={
  "running request":f=>{f.request.status="running"},
  "canceled request":f=>{f.request.cancel_requested_at="2026-09-15T00:00:00Z"},
  "cross-account request":f=>{f.request.account_id="other"},
  "wrong run":f=>{f.request.run_id="other"},
  "wrong plan":f=>{f.plan.run_request_id="other"},
  "unfinished plan":f=>{f.plan.resume_state="run_active"},
  "restartable old plan":f=>{f.plan.restart_allowed=true},
  "ordinary request":f=>{f.request.metadata_safe.restriction_preflight_only=false},
  "business phase":f=>{f.request.metadata_safe.resume_plan.phases_to_run.follow=true},
  "business actions":f=>{f.run.performance_summary.business_actions_executed=1},
  "business counter":f=>{f.run.total_dm=1},
  "missing physical proof":f=>{f.run.performance_summary.physical_preflight_passed=false},
  "cleanup failed":f=>{f.run.performance_summary.preflight_cleanup_completed=false},
  "unknown proof":f=>{f.run.performance_summary.restriction_preflight_terminal_contract.schema="unknown"},
  "cross-authorization proof":f=>{f.run.performance_summary.restriction_preflight_terminal_contract.authorization_id="other"},
  "cross-source plan":f=>{f.request.metadata_safe.resume_plan.resume_plan_id="other"},
  "uncleared hold":f=>{f.holds[0].status="active"},
  "wrong hold run":f=>{f.holds[0].verified_by_run_id="other"},
  "wrong hold incident":f=>{f.holds[0].incident_id="other"},
  "ambiguous holds":f=>{f.holds.push({...f.holds[0]})},
  "failed without historical reconciliation":f=>{f.run.status="failed"},
};
for(const [name,mutate] of Object.entries(mutations)) test(`rejects ${name}`,()=>{const f=fixture();mutate(f);assert.equal(authorized(f),false)});
test("historical reconciliation is explicit and does not forge a new terminal proof",()=>{
 const f=fixture();f.run.status="failed";f.run.performance_summary.preflight_cleanup_completed=false;
 const h={schema:"HISTORICAL_RESTRICTION_PREFLIGHT_RECONCILIATION_V1",run_id:"run",request_id:"request",hold_id:"hold",physical_hold_cleared_at:f.holds[0].verified_cleared_at,historical_run_status_preserved:true,business_quota_completion_asserted:false,repair_worker_sha:"a".repeat(40),original_run_sha256:"b".repeat(64),original_request_sha256:"c".repeat(64)};
 f.plan.plan.historical_preflight_reconciliation=h;assert.equal(authorized(f),true);
 h.business_quota_completion_asserted=true;assert.equal(authorized(f),false);
});
test("ordinary missing plans and exhausted quotas retain their prior gates",()=>{
 const base={lastRunId:"run",sessionTerminationClass:"unknown",restartAllowed:false,restartBlockReason:"resume_plan_missing",totalRemainingQuota:10};
 assert.equal(resolveRestartNeed(base).needed,false);
 assert.equal(resolveRestartNeed({...base,restrictionPreflightContinuationAuthorized:true}).needed,true);
 assert.equal(resolveRestartNeed({...base,totalRemainingQuota:0,restrictionPreflightContinuationAuthorized:true}).needed,false);
});
