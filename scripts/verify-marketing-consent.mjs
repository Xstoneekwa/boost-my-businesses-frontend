// Browser checks against localhost or an authorized Preview. No business writes.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const base = process.argv[2] || "http://localhost:3014";
const session = "bmb-consent-verification";
function browser(...args) {
  const result = JSON.parse(execFileSync("npx", ["agent-browser", "--session", session, "--json", ...args], { encoding: "utf8", timeout: 45000, maxBuffer: 2e6 }));
  if (!result.success) throw Error(JSON.stringify(result));
  return result.data;
}
const evaluate = fn => browser("eval", `(${fn.toString()})()`).result;
const click = name => browser("find", "role", "button", "click", "--name", name, "--exact");
function ready() { browser("wait", "--fn", "!!window.google_tag_data?.ics?.entries && !!document.querySelector('#bmb-consent-panel, [aria-controls=\"bmb-consent-panel\"]')"); }
function state() { return evaluate(() => ({
  choice: window.bmbConsentChoice,
  states: Object.fromEntries(Object.entries(window.google_tag_data.ics.entries).map(([key, value]) => [key, value.update ?? value.default])),
  gtm: document.querySelectorAll('script[src*="googletagmanager.com/gtm.js?id=GTM-TW42V8MQ"]').length,
  gaSdkScripts: [...document.scripts].filter(s => s.src.includes("/gtag/js")).length,
  panel: !!document.querySelector("#bmb-consent-panel"),
  gaCookies: document.cookie.split("; ").filter(c => /^(_ga|_gid|_gat|_gcl_|_gac_)/.test(c)),
  commands: window.dataLayer.filter(x => x?.[0] === "consent").map(x => [x[1], x[2]]),
  customPageViews: window.dataLayer.filter(x => x.event === "bmb_page_view" || x.event === "page_view").length,
})); }
function check(a, b) {
  const s = state();
  assert.deepEqual(s.states, { analytics_storage: a, ad_storage: b, ad_user_data: b, ad_personalization: b });
  assert.equal(s.gtm, 1);
  // GTM may load the Google tag once after it is configured; source-level tests
  // separately assert that the application never installs a direct GA4 SDK.
  assert.ok(s.gaSdkScripts <= 1);
  assert.equal(s.customPageViews, 0);
  return s;
}
browser("set", "viewport", "1440", "900");
browser("open", base + "/?bmb_debug=1");
evaluate(() => { document.cookie = "bmb_consent_v1=; Max-Age=0; Path=/"; localStorage.setItem("bmb_lang", "en"); });
browser("reload"); ready();
assert.equal(check(false, false).choice, null);
assert.equal(state().panel, true);
const source = evaluate(() => ({
  consentBeforeGtm: window.dataLayer.findIndex(x => x?.[0] === "consent" && x[1] === "default") < window.dataLayer.findIndex(x => x?.event === "gtm.js"),
  // React 19 prepends an empty hidden Suspense marker. It is framework output,
  // not application content; noscript must precede every application node.
  firstBody: [...document.body.children].find(el => !(el.tagName === "DIV" && el.hasAttribute("hidden") && el.children.length === 0 && !el.textContent))?.tagName,
  noscripts: document.querySelectorAll("body > noscript").length,
  headGtm: !!document.head.querySelector("#bmb-gtm"),
}));
assert.deepEqual(source, { consentBeforeGtm: true, firstBody: "NOSCRIPT", noscripts: 1, headGtm: true });
assert.equal(evaluate(async () => (await fetch("/analytics/gtm-noscript")).status), 204);
click("Customize");
browser("find", "role", "checkbox", "check", "--name", "Audience measurement (Google Analytics)");
click("Save my choices");
check(true, false);
assert.equal(evaluate(async () => (await fetch("/analytics/gtm-noscript")).status), 204);
browser("reload"); ready();
assert.equal(check(true, false).panel, false);
click("Privacy choices"); click("Accept all"); check(true, true);
evaluate(() => { document.cookie = "_ga_BMB_TEST=consent_cleanup_probe; Path=/"; document.cookie = "_gcl_au=consent_cleanup_probe; Path=/"; });
click("Privacy choices"); click("Reject all");
assert.deepEqual(check(false, false).gaCookies, []);
browser("reload"); ready();
assert.equal(check(false, false).panel, false);
// Re-entry on another route retains consent and cannot create a second GTM.
browser("open", base + "/partners?bmb_debug=1"); ready(); check(false, false);
browser("set", "viewport", "390", "844");
click("Privacy choices");
assert.equal(evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
browser("screenshot", "/private/tmp/bmb-consent-verified-mobile.png");
console.log(JSON.stringify({ status: "PASS", base, source, final: check(false, false), scenarios: ["default-denied-before-GTM", "selective-analytics", "reload-persistence", "all-granted", "withdrawal-cookie-cleanup", "no-script-gate", "cross-route", "mobile"] }));
browser("close");
