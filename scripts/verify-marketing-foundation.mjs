// Read-only browser smoke. CTA default navigation is blocked for event probes;
// no Calendly booking, form data, checkout API or payment is submitted.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const base = process.argv[2] || "http://localhost:3014";
const session = "seo-foundation-smoke";
const paths = ["/", "/instagram-growth", "/instagram-growth-south-africa", "/instagram-growth/real-estate", "/instagram-growth/beauty-aesthetics", "/instagram-growth/restaurants", "/instagram-growth/fitness", "/partners", "/ai-automation"];
function browser(...args) {
  const output = execFileSync("npx", ["agent-browser", "--session", session, "--json", ...args], { encoding: "utf8", timeout: 45000, maxBuffer: 2e6 });
  const result = JSON.parse(output);
  if (!result.success) throw Error(output);
  return result.data;
}
function evaluate(fn) { return browser("eval", `(${fn.toString()})()`).result; }
const reports = [];
for (const width of [1440, 390]) {
  browser("set", "viewport", String(width), "900");
  for (const path of paths) {
    browser("open", `${base}${path}?bmb_debug=1&utm_source=smoke&utm_campaign=seo-v1`);
    browser("wait", "--fn", "!!window.bmbAnalyticsDebug?.some(e=>e.event==='bmb_page_view') && (!document.querySelector('iframe') || !!document.querySelector('iframe').contentDocument?.querySelector('h1'))");
    const report = evaluate(() => {
      const doc = document.querySelector("iframe")?.contentDocument || document;
      const q = selector => document.querySelector(selector)?.content;
      return { title: document.title, description: q('meta[name="description"]'), canonical: document.querySelector('link[rel="canonical"]')?.href, h1: doc.querySelectorAll("h1").length, og: ["title", "description", "url", "type", "image"].every(k => q(`meta[property="og:${k}"]`)), twitter: ["card", "title", "description", "image"].every(k => q(`meta[name="twitter:${k}"]`)), schema: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => JSON.parse(s.textContent)), overflow: doc.documentElement.scrollWidth > doc.documentElement.clientWidth + 1, overlay: !!document.querySelector("[data-nextjs-dialog]"), gtmLoaded: !!document.querySelector("#bmb-gtm"), pageViews: window.bmbAnalyticsDebug.filter(e => e.event === "bmb_page_view").length, links: [...new Set([...doc.querySelectorAll("a[href]")].map(a => a.getAttribute("href")))] };
    });
    assert.equal(report.canonical, `https://www.boostmybusinesses.com${path}`);
    assert.equal(report.h1, 1, `${path} H1`);
    assert.ok(report.og && report.twitter && report.schema.length, `${path} metadata`);
    assert.equal(report.pageViews, 1, `${path} pageview duplicates`);
    assert.equal(report.overflow, false, `${path} ${width} overflow`);
    assert.equal(report.overlay, false);
    assert.equal(report.gtmLoaded, true, "One global GTM bootstrap with denied defaults");
    const actions = evaluate(() => {
      const doc = document.querySelector("iframe")?.contentDocument || document;
      const results = [];
      for (const a of doc.querySelectorAll("a[href]")) {
        const href = a.getAttribute("href");
        if (!href.includes("#pricing") && !href.includes("#plans") && !href.includes("calendly.com") && !href.includes("/instagram-growth/checkout")) continue;
        const stop = e => { e.preventDefault(); e.stopImmediatePropagation(); };
        a.addEventListener("click", stop, { once: true, capture: true });
        const before = window.bmbAnalyticsDebug.length;
        a.click();
        const events = window.bmbAnalyticsDebug.slice(before);
        results.push({ href, events });
      }
      return results;
    });
    for (const action of actions) assert.equal(action.events.length, 1, `${path} ${action.href}: expected exactly one event`);
    for (const language of ["fr", "en"]) {
      browser("eval", `(() => { const d=document.querySelector('iframe')?.contentDocument||document; [...d.querySelectorAll('button')].find(b=>b.textContent.trim().toLowerCase()==='${language}')?.click(); })()`);
      browser("wait", "--fn", `(document.querySelector('iframe')?.contentDocument||document).documentElement.lang==='${language}'`);
    }
    const errors = browser("errors").errors;
    assert.deepEqual(errors, [], `${path} console errors`);
    reports.push({ path, width, ...report, actions, languages: ["fr", "en"], errors });
    console.log(JSON.stringify(reports.at(-1)));
  }
}
const resources = evaluate(async () => {
  const results = {};
  for (const path of ["/robots.txt", "/sitemap.xml"]) { const r=await fetch(path); results[path]={ status:r.status, body:await r.text() }; }
  return results;
});
assert.equal(resources["/robots.txt"].status, 200);
assert.equal(resources["/sitemap.xml"].status, 200);
assert.equal((resources["/sitemap.xml"].body.match(/<loc>/g) || []).length, 9);
assert.doesNotMatch(resources["/sitemap.xml"].body, /vercel\.app|\/checkout|\/api\//);
console.log(JSON.stringify({ resources, status: "PASS", pages: reports.length }));
browser("close");
