import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(new URL("./ClientDashboard.tsx", import.meta.url), "utf8");

const importedJsxComponents = [
  "ClientNotificationsPanel",
  "ClientAccountsSection",
  "ClientOverviewRecentFeed",
  "ClientActivityPanel",
  "TargetAvatar",
  "ClientDmTemplatesSection",
  "ClientAccountTargetsDrawer",
  "LogOut",
];

const localJsxComponents = ["FollowerChart", "PaymentBillingDrawer"];

test("ClientDashboard imports every external JSX component it renders", () => {
  for (const name of importedJsxComponents) {
    assert.match(dashboardSource, new RegExp(`import\\s+${name}\\b|import\\s+[^;]*\\b${name}\\b[^;]*from`));
    assert.match(dashboardSource, new RegExp(`<${name}\\b`));
  }
});

test("ClientDashboard local overview components remain defined in file", () => {
  for (const name of localJsxComponents) {
    assert.match(dashboardSource, new RegExp(`function ${name}\\b`));
    assert.match(dashboardSource, new RegExp(`<${name}\\b`));
  }
});

test("ClientDashboard imports ClientInstagramAccountView type alias source", () => {
  assert.match(dashboardSource, /import ClientAccountsSection, \{ type ClientInstagramAccountView \} from "\.\/ClientAccountsSection"/);
});
