import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

const service = read("./dashboard-read-model.ts");
const page = read("../../app/instagram-dashboard/commercial/page.tsx");
const detailPage = read("../../app/instagram-dashboard/commercial/leads/[leadId]/page.tsx");
const overviewApi = read("../../app/api/instagram-dashboard/commercial/overview/route.ts");
const detailApi = read("../../app/api/instagram-dashboard/commercial/leads/[leadId]/route.ts");
const layout = read("../../app/instagram-dashboard/layout.tsx");
const shell = read("../../app/instagram-dashboard/AdminShell.tsx");
const sidebar = read("../../app/instagram-dashboard/AdminSidebar.tsx");
const migration = read("../../supabase/migrations/20260814212322_commercial_dashboard_read_model_v1.sql");

test("page, data service, APIs, and lead detail each invoke the canonical owner gate", () => {
  for (const [name, source] of Object.entries({ service, page, detailPage, overviewApi, detailApi })) {
    assert.match(source, /requireCommercialCrmAccess\(\)/, `${name} must invoke canonical gate`);
  }
});

test("navigation visibility comes from the server decision and remains owner-only", () => {
  assert.match(layout, /resolveCommercialCrmAccess\(\)/);
  assert.match(layout, /commercialAccess\s*=\s*commercialDecision\.allowed/);
  assert.match(sidebar, /ownerOnly:\s*true/);
  assert.match(sidebar, /!item\.ownerOnly\s*\|\|\s*commercialAccess/);
});

test("the shared admin shell collapses to an accessible rail on mobile", () => {
  assert.match(shell, /useSyncExternalStore/);
  assert.match(shell, /\(max-width: 760px\)/);
  assert.match(shell, /collapsed=\{effectiveCollapsed\}/);
  assert.match(shell, /onToggle=\{mobileSidebar \? undefined/);
  assert.match(sidebar, /aria-label=\{collapsed \? item\.label : undefined\}/);
});

test("commercial surfaces have no email, UUID, local bypass, or BotApp relay authorization", () => {
  const combined = [service, page, detailPage, overviewApi, detailApi].join("\n");
  assert.doesNotMatch(combined, /580d7856-d60f-4838-a5f9-3b405d6ae79b/i);
  assert.doesNotMatch(combined, /LOCAL_ADMIN|NODE_ENV|relay|botapp/i);
  assert.doesNotMatch(combined, /email\s*[=!]==?\s*["']/i);
});

test("read RPC and underlying tables fail closed outside service_role", () => {
  assert.match(migration, /security invoker/i);
  assert.match(migration, /revoke all on function public\.commercial_dashboard_read_model_v1[\s\S]*from public, anon, authenticated;/i);
  assert.match(migration, /grant execute on function public\.commercial_dashboard_read_model_v1[\s\S]*to service_role;/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to anon|grant execute[\s\S]*to authenticated/i);
});

test("read-only phase contains no outreach, discovery, or CRM mutation endpoint", () => {
  const combined = [overviewApi, detailApi, service].join("\n");
  assert.doesNotMatch(combined, /\.insert\(|\.update\(|\.delete\(|sendEmail|sendDm|discoveryRuntime/i);
});
