import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const accountLoaderSource = fs.readFileSync(
  new URL("./load-client-instagram-accounts.ts", import.meta.url),
  "utf8",
);
const workspaceLoaderSource = fs.readFileSync(
  new URL("./workspace-data.ts", import.meta.url),
  "utf8",
);
const dashboardSource = fs.readFileSync(
  new URL("../../app/instagram-client/ClientDashboard.tsx", import.meta.url),
  "utf8",
);

test("initial accounts and reloaded workspace share the canonical lifecycle filter", () => {
  assert.match(accountLoaderSource, /filterClientSelectableInstagramAccounts/);
  assert.match(workspaceLoaderSource, /filterClientSelectableInstagramAccounts/);
});

test("account projection never filters rollback rows by username", () => {
  assert.doesNotMatch(accountLoaderSource, /rb_test_/);
  assert.doesNotMatch(workspaceLoaderSource, /rb_test_/);
});

test("password update CTA opens the shared secure password editor", () => {
  assert.match(
    dashboardSource,
    /setPasswordUpdateTarget\(\{/,
  );
  assert.match(dashboardSource, /<ClientPasswordUpdateModal/);
  assert.doesNotMatch(
    dashboardSource,
    /handleNotificationNavigate\(notification\.actionHref\)/,
  );
});
