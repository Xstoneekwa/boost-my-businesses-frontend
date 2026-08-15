import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relative) { return readFileSync(new URL(relative, import.meta.url), "utf8"); }

const migration = read("../../supabase/migrations/20260815112508_commercial_outreach_orchestration_v1.sql");
const processor = read("./outreach-processor.ts");
const service = read("./outreach-service.ts");
const itemRoute = read("../../app/api/instagram-dashboard/commercial/outreach/[itemId]/route.ts");
const processRoute = read("../../app/api/instagram-dashboard/commercial/outreach/process/route.ts");
const cronRoute = read("../../app/api/cron/commercial-outreach/route.ts");
const workspace = read("../../app/instagram-dashboard/commercial/CommercialOutreachQueue.tsx");
const queueList = read("../../app/instagram-dashboard/commercial/CommercialOutreachQueueList.tsx");
const preview = read("../../app/instagram-dashboard/commercial/CommercialMessagePreview.tsx");
const context = read("../../app/instagram-dashboard/commercial/CommercialOutreachContext.tsx");
const workspaceCss = read("../../app/instagram-dashboard/commercial/CommercialOutreachWorkspace.module.css");
const component = [workspace, queueList, preview, context].join("\n");

test("data model has one active path, a two-attempt bound, safe cancellation, and no transport state", () => {
  assert.match(migration, /commercial_outreach_one_active_path_v1_uidx[\s\S]*where state <> 'cancelled'/i);
  assert.match(migration, /max_generation_attempts integer not null default 2/i);
  assert.match(migration, /commercial_outreach_items_transport_forbidden_v1 check \(state not in \('sending', 'sent', 'delivery_failed'\)\)/i);
  assert.match(migration, /cancellation_reason = 'lead_no_longer_eligible'/i);
  assert.match(migration, /on conflict \(item_id, idempotency_key\) do nothing/i);
});

test("exactly four versioned template families are seeded", () => {
  for (const key of ["IG_BEAUTY_ANGLE_A_V1", "IG_BEAUTY_ANGLE_B_V1", "EMAIL_BEAUTY_ANGLE_A_V1", "EMAIL_BEAUTY_ANGLE_B_V1"]) assert.match(migration, new RegExp(key));
  assert.equal((migration.match(/'(?:IG|EMAIL)_BEAUTY_ANGLE_[AB]_V1'/g) ?? []).filter((value, index, values) => values.indexOf(value) === index).length, 4);
});

test("tables and RPCs are service-role-only and owner mutations re-check the canonical grant", () => {
  assert.match(migration, /revoke all on table[\s\S]*from public, anon, authenticated;/i);
  assert.match(migration, /revoke all on function public\.mutate_commercial_outreach_item_v1[\s\S]*from public, anon, authenticated;/i);
  assert.match(migration, /grant execute on function public\.mutate_commercial_outreach_item_v1[\s\S]*to service_role;/i);
  assert.match(migration, /commercial_crm_actor_authorized_v1\(p_actor_user_id\)/i);
  for (const source of [service, itemRoute, processRoute]) assert.match(source, /requireCommercialCrmAccess\(\)/);
});

test("runtime exposes generation and review only, with explicit delivery-off evidence", () => {
  const executable = [processor, service, itemRoute, processRoute, cronRoute, component].join("\n");
  assert.doesNotMatch(executable, /sendEmail\s*\(|sendDm\s*\(|postmark\.send|smtpTransport|executePhoneFarmDm/i);
  assert.match(processor, /realEmailSend: false/);
  assert.match(processor, /realInstagramDmSend: false/);
  assert.match(component, /No email or Instagram DM was sent/);
});

test("dashboard exposes preview, history, edit, approve, regenerate, cancel, and selection controls", () => {
  for (const copy of ["MESSAGE PREVIEW", "Audit timeline", "Validate & save edit", "Approve dry run", "Regenerate", "Cancel", "Apply selection"]) assert.match(component, new RegExp(copy));
  assert.match(component, /QUEUED_DRY_RUN/);
});

test("dashboard uses one selected full preview instead of a repeating card wall", () => {
  assert.match(workspace, /CommercialOutreachQueueList/);
  assert.match(workspace, /CommercialMessagePreview/);
  assert.match(workspace, /CommercialOutreachContext/);
  assert.doesNotMatch(workspace, /initialModel\.items\.map\([\s\S]*OutreachCard/);
  assert.doesNotMatch(queueList, /item\.body/);
  assert.match(preview, /item\.body/);
});

test("workspace has server pagination, durable URL filters, robust wrapping, and responsive panes", () => {
  assert.match(service, /itemsQuery\.range\(offset, offset \+ filters\.pageSize - 1\)/);
  assert.match(workspace, /outreach_tab/);
  assert.match(workspace, /outreach_item/);
  assert.match(workspace, /outreach_page/);
  assert.match(workspaceCss, /grid-template-columns:\s*minmax\(250px,.78fr\) minmax\(380px,1.42fr\) minmax\(280px,.88fr\)/);
  assert.match(workspaceCss, /white-space:\s*pre-wrap/);
  assert.match(workspaceCss, /overflow-wrap:\s*anywhere/);
  assert.match(workspaceCss, /word-break:\s*break-word/);
  assert.match(workspaceCss, /@media \(max-width: 1180px\)/);
  assert.match(workspaceCss, /@media \(max-width: 640px\)/);
});
