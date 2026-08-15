import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

const contractSource = read("./lead-review-contract.ts");
const compiledContract = ts.transpileModule(contractSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const contract = await import(`data:text/javascript;base64,${Buffer.from(compiledContract).toString("base64")}`);
const migration = read("../../supabase/migrations/20260814225656_commercial_lead_review_workflow_v1.sql");
const service = read("./lead-review.ts");
const route = read("../../app/api/instagram-dashboard/commercial/leads/[leadId]/review/route.ts");
const component = read("../../app/instagram-dashboard/commercial/CommercialLeadReviewQueue.tsx");
const detail = read("../../app/instagram-dashboard/commercial/CommercialLeadDetail.tsx");
const queueList = read("../../app/instagram-dashboard/commercial/CommercialLeadQueueList.tsx");
const workspaceStyles = read("../../app/instagram-dashboard/commercial/CommercialLeadReviewWorkspace.module.css");
const page = read("../../app/instagram-dashboard/commercial/page.tsx");
const detailPage = read("../../app/instagram-dashboard/commercial/leads/[leadId]/page.tsx");

test("channel, angle, and rejection contracts are stable and narrow", () => {
  assert.deepEqual(contract.COMMERCIAL_REVIEW_CHANNELS, ["instagram", "email"]);
  assert.deepEqual(contract.COMMERCIAL_REVIEW_ANGLES, ["A", "B"]);
  assert.equal(contract.COMMERCIAL_REJECTION_REASONS.length, 7);
  assert.match(contract.COMMERCIAL_REVIEW_ANGLE_LABELS.A, /competitors/i);
  assert.match(contract.COMMERCIAL_REVIEW_ANGLE_LABELS.B, /potential customers/i);
});

test("route and service independently invoke the canonical owner gate", () => {
  assert.match(route, /requireCommercialCrmAccess\(\)/);
  assert.match(service, /await requireCommercialCrmAccess\(\)/);
  assert.match(service, /const actor = await requireCommercialCrmAccess\(\)/);
  assert.doesNotMatch([route, service, component].join("\n"), /580d7856-d60f-4838-a5f9-3b405d6ae79b|email\s*[=!]==?\s*["']/i);
});

test("database review mutation is service-role-only, locked, versioned, and delegates decisions canonically", () => {
  assert.match(migration, /security invoker/i);
  assert.match(migration, /for update;/i);
  assert.match(migration, /commercial_review_stale_version/i);
  assert.match(migration, /public\.transition_commercial_lead_v1[\s\S]*'approve'/i);
  assert.match(migration, /public\.transition_commercial_lead_v1[\s\S]*'reject'/i);
  assert.match(migration, /revoke all on function public\.review_commercial_lead_v1[\s\S]*from public, anon, authenticated;/i);
  assert.match(migration, /grant execute on function public\.review_commercial_lead_v1[\s\S]*to service_role;/i);
});

test("the operational UI exposes review, edit, reject reason, next, and read-only ready state", () => {
  assert.match(detail, /Approve & next/);
  assert.match(detail, /Confirm reject & next/);
  assert.match(detail, /Save changes/);
  assert.match(component, /Ready for Outreach/);
  assert.match(component, /No send action exists/);
  assert.doesNotMatch(`${component}\n${detail}`, /Approve All/i);
  assert.match(page, /CommercialLeadReviewQueue/);
});

test("lead detail return path is constrained to the Commercial dashboard", () => {
  assert.match(detailPage, /startsWith\("\/instagram-dashboard\/commercial"\)/);
  assert.match(detailPage, /!candidate\.startsWith\("\/\/"\)/);
  assert.match(detail, /return_to=/);
});

test("review workspace uses compact queue rows and selected-only detail", () => {
  assert.match(component, /selectedLead/);
  assert.match(component, /review_lead/);
  assert.match(component, /review_priority/);
  assert.match(component, /review_city/);
  assert.match(component, /review_sort/);
  assert.match(component, /review_search/);
  assert.match(queueList, /role="listbox"/);
  assert.match(queueList, /reasoningExcerpt/);
  assert.doesNotMatch(queueList, /personalizationContext|audienceContext/);
  assert.match(detail, /Why this lead/);
  assert.match(detail, /Observed evidence/);
  assert.match(detail, /Potential audiences/);
  assert.match(workspaceStyles, /position:\s*sticky/);
  assert.match(workspaceStyles, /overflow-wrap:\s*anywhere/);
  assert.match(workspaceStyles, /word-break:\s*break-word/);
  assert.match(workspaceStyles, /@media \(max-width: 640px\)/);
});

test("review phase contains no real outreach or Phone Farm runtime", () => {
  const executable = [service, route, component, detail, page].join("\n");
  assert.doesNotMatch(executable, /sendEmail\(|sendDm\(|phoneFarm/i);
  assert.doesNotMatch(route, /POST|PUT|DELETE/);
});
