import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scriptSource = readFileSync(new URL("./restore-wide-client-identity.mjs", import.meta.url), "utf8");
const clientAccountsSource = readFileSync(new URL("../app/instagram-dashboard/client-accounts-data.ts", import.meta.url), "utf8");
const manageSource = readFileSync(new URL("../app/instagram-dashboard/manage-data.ts", import.meta.url), "utf8");

test("restore script only mutates wide client identity", () => {
  assert.match(scriptSource, /from\("clients"\)/);
  assert.match(scriptSource, /holding_pool: true/);
  assert.match(scriptSource, /internal_test_client/);
  assert.match(scriptSource, /dedicated client does not contain only i_m_your_traker/);
  assert.doesNotMatch(scriptSource, /\.from\("client_instagram_accounts"\)\s*\.update/);
  assert.doesNotMatch(scriptSource, /\.from\("account_assignments"\)/);
});

test("client accounts projection keeps clientName from manage account without hardcoded client mapping", () => {
  assert.match(clientAccountsSource, /clientName: account\.clientName/);
  assert.match(manageSource, /clientName: readString\(row, \["client_name"\]/);
  assert.doesNotMatch(clientAccountsSource, /Entry 2A Test Client/);
  assert.doesNotMatch(clientAccountsSource, /if \(.*clientId.*Liam Ekwa/);
});
