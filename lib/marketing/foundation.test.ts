import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { marketingPages, marketingPaths, marketingMetadata, marketingStructuredData, PUBLIC_ORIGIN } from "./seo";
import { classifyLink, readAttribution, safeCampaign, COMMERCIAL_PATHS } from "./tracking";
import { GTM_CONTAINER_ID, GA4_MEASUREMENT_ID, GTM_HEAD_SCRIPT, CUSTOM_EVENT_ALLOWLIST, shouldForwardEvent } from "./gtm";
import { CONSENT_BOOTSTRAP, parseConsent, CONSENT_MAX_AGE } from "./consent";
import vm from "node:vm";
import { NextRequest } from "next/server";
import { GET } from "../../app/analytics/gtm-noscript/route";

test("nine public pages have unique metadata and actual BMB social assets", () => {
  assert.equal(marketingPaths.length, 9);
  assert.deepEqual(COMMERCIAL_PATHS, marketingPaths);
  assert.equal(new Set(marketingPaths.map(p => marketingPages[p].title)).size, 9);
  assert.equal(new Set(marketingPaths.map(p => marketingPages[p].description)).size, 9);
  for (const path of marketingPaths) {
    const metadata = marketingMetadata(path);
    assert.equal(metadata.alternates?.canonical, PUBLIC_ORIGIN + path);
    assert.equal(metadata.alternates?.languages, undefined);
    assert.deepEqual(metadata.robots, { index: true, follow: true });
    assert.equal(metadata.openGraph?.url, PUBLIC_ORIGIN + path);
    assert.equal(metadata.twitter?.title, marketingPages[path].title);
    assert.ok(existsSync(`public${marketingPages[path].image}`));
  }
});

test("schema graph stays factual; deep pages have a three-level breadcrumb", () => {
  for (const path of marketingPaths) {
    const graph = marketingStructuredData(path);
    assert.equal(graph["@context"], "https://schema.org");
    const serialized = JSON.stringify(graph);
    assert.doesNotMatch(serialized, /AggregateRating|Review|postalAddress|priceCurrency|ratingValue|vercel\.app/);
    if (path.startsWith("/instagram-growth/")) {
      const breadcrumb = graph["@graph"].find(g => g["@type"] === "BreadcrumbList");
      assert.equal((breadcrumb?.itemListElement as unknown[]).length, 3);
    }
  }
});

test("semantic link classification yields one event and strips sensitive URL parts", () => {
  const origin = "https://www.boostmybusinesses.com";
  assert.equal(classifyLink("/instagram-growth#pricing", "/", origin)?.event, "bmb_view_plans");
  assert.equal(classifyLink("#features", "/instagram-growth", origin)?.event, "bmb_cta_click");
  assert.equal(classifyLink("/instagram-growth/fitness", "/", origin)?.event, "bmb_vertical_click");
  assert.equal(classifyLink("https://calendly.com/boostmybusinesses/discovertheassistant?email=private", "/partners", origin)?.event, "bmb_partner_call");
  const result = classifyLink("/instagram-growth/checkout?plan=pro&months=3&email=private&session_id=secret", "/instagram-growth", origin);
  assert.deepEqual(result, { event: "bmb_checkout_start", fields: { cta_name: "choose_plan", destination: "/instagram-growth/checkout", plan: "pro", billing_duration: 3, months: 3 } });
  assert.equal(classifyLink("mailto:private@example.com", "/", origin), undefined);
  assert.equal(classifyLink("/instagram-dashboard", "/", origin), undefined);
  assert.equal(classifyLink("https://external.example/", "/", origin), undefined);
  assert.equal(classifyLink("/instagram-growth/checkout?plan=unknown&months=999", "/", origin)?.fields.plan, undefined);
});

test("UTMs are bounded campaign slugs; URLs, emails, phones and unrelated queries are rejected", () => {
  for (const bad of ["person@example.com", "https://example.com", "+27821234567", "27821234567", "secret-token", "a".repeat(65), "test&email=x"]) assert.equal(safeCampaign(bad), undefined);
  assert.deepEqual(readAttribution("?utm_source=google&utm_medium=cpc&utm_campaign=sa-fitness&utm_term=person%40example.com&email=private&gclid=secret"), { utm_source: "google", utm_medium: "cpc", utm_campaign: "sa-fitness" });
});

test("embedded source is not a competing standalone indexed landing; checkout source untouched", () => {
  const html = readFileSync("public/instagram-growth/index.html", "utf8");
  assert.match(html, /noindex,indexifembedded/);
  assert.match(html, /rel="canonical" href="https:\/\/www\.boostmybusinesses\.com\/instagram-growth"/);
  assert.doesNotMatch(html, /<h4/);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  const analytics = readFileSync("app/components/MarketingAnalytics.tsx", "utf8");
  assert.match(analytics, /enabled: GTM_ENABLED/);
  assert.doesNotMatch(analytics, /GTM-[A-Z0-9]{6,}/);
});

test("one global GTM integration with owner IDs, no direct GA4 and no enhanced-measurement duplicate", () => {
  assert.equal(GTM_CONTAINER_ID, "GTM-TW42V8MQ");
  assert.equal(GA4_MEASUREMENT_ID, "G-BFWT2ZDXJ1");
  assert.equal(GTM_HEAD_SCRIPT.match(/googletagmanager.com\/gtm.js/g)?.length, 1);
  assert.doesNotMatch(GTM_HEAD_SCRIPT, /gtag\/js|G-BFWT2ZDXJ1/);
  const layout = readFileSync("app/layout.tsx", "utf8");
  assert.match(layout, /<head>\s*<GoogleTagManagerHead \/>/);
  assert.match(layout, /<body[^>]*>\s*<GoogleTagManagerNoScript \/>/);
  const tracker = readFileSync("lib/marketing/tracking.ts", "utf8");
  assert.doesNotMatch(tracker, /createElement\("script"\)|gtag\(/);
  for (const event of ["bmb_page_view", "bmb_form_submit", "bmb_book_call", "bmb_partner_call", "bmb_faq_open", "bmb_language_change", "bmb_pricing_section_view", "purchase"]) assert.equal(CUSTOM_EVENT_ALLOWLIST.has(event), false);
  assert.equal(shouldForwardEvent("bmb_book_call", "/instagram-growth"), true);
  assert.equal(shouldForwardEvent("bmb_book_call", "/partners"), false);
});

test("native Consent Mode denies all four categories first, persists explicit choices and permits withdrawal", () => {
  const win = { dataLayer: [] as unknown[], dispatchEvent() {}, bmbSetConsent: undefined as undefined | ((a: boolean,b: boolean) => void) };
  const document = { cookie: "" };
  vm.runInNewContext(CONSENT_BOOTSTRAP, { window: win, document, location: { protocol: "https:", hostname: "www.boostmybusinesses.com" }, CustomEvent: class {} });
  const commands = () => JSON.parse(JSON.stringify(win.dataLayer)) as Record<string, unknown>[];
  assert.equal(commands()[0][0], "consent");
  assert.equal(commands()[0][1], "default");
  assert.deepEqual(commands()[0][2], { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  assert.equal(document.cookie, "");
  win.bmbSetConsent!(true, false);
  assert.deepEqual(commands().at(-1)![2], { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  assert.match(document.cookie, /bmb_consent_v1=/);
  const count = commands().length;
  win.bmbSetConsent!(true, false);
  assert.equal(commands().length, count, "Same choice does not emit a duplicate consent command");
  win.bmbSetConsent!(false, false);
  assert.equal((commands().at(-1)![2] as Record<string,string>).analytics_storage, "denied");
});

test("noscript fails closed for missing, expired, malformed and selective consent", () => {
  const expires = Date.now() + CONSENT_MAX_AGE * 1000;
  for (const value of [undefined, "broken", JSON.stringify({v:1,analytics:true,ads:true,expires:1}), JSON.stringify({v:1,analytics:true,ads:false,expires})]) {
    const r = GET(new NextRequest("https://www.boostmybusinesses.com/analytics/gtm-noscript", { headers: value ? {Cookie:`bmb_consent_v1=${encodeURIComponent(value)}`} : {} }));
    assert.equal(r.status, 204);
    assert.match(r.headers.get("Cache-Control")!, /no-store/);
  }
  assert.equal(parseConsent(encodeURIComponent(JSON.stringify({v:1,analytics:"yes",ads:true,expires}))), null);
  const response=GET(new NextRequest("https://www.boostmybusinesses.com/analytics/gtm-noscript", {headers:{Cookie:`bmb_consent_v1=${encodeURIComponent(JSON.stringify({v:1,analytics:true,ads:true,expires}))}`}}));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "https://www.googletagmanager.com/ns.html?id=GTM-TW42V8MQ");
});
