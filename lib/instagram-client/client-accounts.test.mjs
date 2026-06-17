import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clientMaxAccountsLimit,
  projectClientAccountRow,
  rejectTechnicalClientFields,
} from "./guards.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("rejectTechnicalClientFields blocks device and clone fields", () => {
  assert.equal(rejectTechnicalClientFields({ username: "botapp" }), null);
  assert.match(
    rejectTechnicalClientFields({ username: "botapp", device_id: "phone-1" }) || "",
    /Technical assignment fields are not allowed/,
  );
  assert.match(
    rejectTechnicalClientFields({ clone_index: 2 }) || "",
    /Technical assignment fields are not allowed/,
  );
});

test("client account projection hides technical details", () => {
  const row = projectClientAccountRow({
    accountId: "acct-1",
    username: "botapp",
    packageLabel: "Growth",
    loginStatus: "unknown",
    assignmentStatus: "pending_assignment",
  });
  assert.equal(row.username, "botapp");
  assert.equal(row.connected, false);
  assert.match(row.readinessLabel, /pending|setup|waiting/i);
});

test("client create route requires tenant session and rejects technical fields", () => {
  const routeSource = source("../../app/api/instagram-client/accounts/route.ts");
  assert.match(routeSource, /requireClientInstagramSession/);
  assert.match(routeSource, /rejectTechnicalClientFields/);
  assert.match(routeSource, /createClientInstagramAccount/);
});

test("client readiness and connect routes enforce ownership", () => {
  const readinessRoute = source("../../app/api/instagram-client/accounts/[accountId]/check-readiness/route.ts");
  const connectRoute = source("../../app/api/instagram-client/accounts/[accountId]/connect/route.ts");
  assert.match(readinessRoute, /authorizeClientInstagramAccount/);
  assert.match(connectRoute, /authorizeClientInstagramAccount/);
  assert.match(readinessRoute, /checkClientAccountReadiness/);
  assert.match(connectRoute, /connectClientInstagramAccount/);
});

test("client dashboard UI exposes one add CTA per context", () => {
  const sectionSource = source("../../app/instagram-client/ClientAccountsSection.tsx");
  const dashboardSource = source("../../app/instagram-client/ClientDashboard.tsx");
  assert.match(sectionSource, /canAddAccount && !isEmpty/);
  assert.match(sectionSource, /isEmpty \?/);
  assert.match(sectionSource, /Add Instagram account|Ajouter un compte Instagram/);
  assert.match(sectionSource, /Check readiness/);
  assert.match(sectionSource, /Connect/);
  assert.doesNotMatch(sectionSource, /device_id|clone_index|Start run|Stop worker/i);
  assert.match(dashboardSource, /ClientAccountsSection/);
});

test("create account supports dry_run flag in route and service", () => {
  const createSource = source("./create-account.ts");
  const routeSource = source("../../app/api/instagram-client/accounts/route.ts");
  assert.match(createSource, /dryRun/);
  assert.match(routeSource, /dry_run/);
});

test("clientMaxAccountsLimit defaults to 5", () => {
  assert.equal(clientMaxAccountsLimit(), 5);
});
