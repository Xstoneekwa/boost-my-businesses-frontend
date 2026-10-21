import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const dashboard = readFileSync(new URL("../../app/instagram-client/ClientDashboard.tsx", import.meta.url), "utf8");
const accounts = readFileSync(new URL("../../app/instagram-client/ClientAccountsSection.tsx", import.meta.url), "utf8");
const modal = readFileSync(new URL("../../app/instagram-client/ClientPasswordUpdateModal.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/instagram-client/accounts/[accountId]/credentials/update-password/route.ts", import.meta.url), "utf8");
const supabaseBrowser = readFileSync(new URL("../supabase/browser.ts", import.meta.url), "utf8");

test("both wrong-password CTAs open the shared password modal", () => {
  assert.match(dashboard, /setPasswordUpdateTarget\(\{/);
  assert.match(dashboard, /<ClientPasswordUpdateModal/);
  assert.match(dashboard, /onPasswordUpdateRequested=\{setPasswordUpdateTarget\}/);
  assert.match(dashboard, /liveAction\?\.action_type === "update_instagram_password"/);
  assert.match(dashboard, /passwordNotifications\.find\([\s\S]*row\.accountId === connectProgress\.account\.accountId/);
  assert.match(dashboard, /Mettre à jour le mot de passe/);
  assert.match(dashboard, /setPasswordUpdateTarget\(\{[\s\S]*actionId: progressPasswordTarget\.actionId/);
  assert.match(accounts, /onPasswordUpdateRequested\(\{ actionId, accountId, username \}\)/);
  assert.match(accounts, /connectProgress=\{processModal\?\.connectProgress \?\? null\}/);
  assert.doesNotMatch(accounts, /connectProgress = await syncConnectProgress\(account\.accountId, null\)/);
  assert.match(accounts, /if \(connectOperationToken\) \{[\s\S]*syncConnectProgress\(account\.accountId, connectOperationToken\)/);
  assert.doesNotMatch(accounts, /connectProgress=\{processModal\?\.mode === "connect"/);
  assert.doesNotMatch(accounts, /onUpdatePassword[\s\S]{0,240}router\.push\("\/instagram-client\?view=account"\)/);
});

test("browser Supabase client prefers the publishable key with legacy anon fallback", () => {
  assert.match(supabaseBrowser, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(supabaseBrowser, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(supabaseBrowser, /publishableKey \|\| legacyAnonKey/);
  assert.match(supabaseBrowser, /createClient\(supabaseUrl, browserKey\)/);
});

test("password modal is write-only, single-flight, and clears secret state", () => {
  assert.match(modal, /type=\{showPassword \? "text" : "password"\}/);
  assert.match(modal, /autoComplete="new-password"/);
  assert.match(modal, /inFlightRef\.current/);
  assert.match(modal, /clearSecret\(\)/);
  assert.match(modal, /setPassword\(""\)/);
  assert.doesNotMatch(modal, /localStorage|sessionStorage|console\.|telemetry/);
  assert.doesNotMatch(modal, /searchParams.*password|URLSearchParams.*password/);
});

test("owner API authenticates and authorizes before invoking the canonical service", () => {
  assert.match(route, /requireClientInstagramSession\(\)/);
  assert.match(route, /authorizeClientInstagramAccount\(session\.userId, normalizedAccountId\)/);
  assert.match(route, /updateClientInstagramPassword\(\{/);
  assert.match(route, /password_status: "write_only"/);
  assert.match(route, /login_started: false/);
  assert.match(route, /run_started: false/);
  assert.doesNotMatch(route, /console\.|password:\s*result|password:\s*payload/);
});

test("post-save projection removes client password CTA and requires user relaunch", () => {
  assert.match(dashboard, /filter\(\(notification\) => notification\.id !== actionId\)/);
  assert.match(dashboard, /Relancez la connexion Instagram/);
  assert.doesNotMatch(modal, /connect\/retry-attempt|account_run_requests|Auto Login/);
});

test("post-save retry CTA delegates to the canonical readiness and confirmed enqueue flow", () => {
  assert.match(modal, /Relancer la connexion Instagram/);
  assert.match(modal, /onRestart\(accountId\)/);
  assert.match(dashboard, /postPasswordRetryRequest=\{postPasswordRetryRequest\}/);
  assert.match(accounts, /runConnectProcess\(account, "check_readiness"\)/);
  assert.match(accounts, /processModal\?\.mode !== "check_readiness"/);
  assert.match(accounts, /runConnectProcess\(account, "connect", \{[\s\S]*confirmed: true/);
  assert.doesNotMatch(modal, /check-readiness|connect_enqueue|enqueue-client-connect/);
});
