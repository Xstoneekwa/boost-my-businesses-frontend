// Read-only UI verification. Never submits forms, books calls or starts payments.
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const [base, output, widthArg = "1440"] = process.argv.slice(2);
if (!base || !output) throw Error("Usage: node scripts/verify-marketing-copy.mjs BASE OUTPUT WIDTH");
const width = Number(widthArg);
const session = `copy-review-${width}`;
const executable = process.env.AGENT_BROWSER_BIN || "agent-browser";
export const routes = ["/", "/instagram-growth", "/instagram-growth-south-africa", "/instagram-growth/real-estate", "/instagram-growth/beauty-aesthetics", "/instagram-growth/restaurants", "/instagram-growth/fitness", "/partners", "/ai-automation", "/about", "/contact", "/privacy-policy", "/terms-and-conditions", "/refund-policy", "/agent/general", "/agent/restaurant-call-assistant", "/agent/whatsapp-lead-system", "/agent/ugc-ads-engine", "/agent/support", "/agent/sales", "/restaurant-call-test", "/instagram-growth/checkout"];
fs.mkdirSync(output, {recursive: true});
function browser(...args) {
  const raw = execFileSync(executable, ["--session", session, "--json", ...args], {encoding: "utf8", timeout: 45000, maxBuffer: 6e6});
  const data = JSON.parse(raw);
  if (!data.success) throw Error(raw);
  return data.data;
}
const evaluate = fn => browser("eval", `(${fn.toString()})()`).result;
const results = [];
try {
  browser("set", "viewport", String(width), "900");
  for (const route of routes.filter(r => !process.env.COPY_QA_ROUTES || process.env.COPY_QA_ROUTES.split(",").includes(r))) {
    const errorsBefore = browser("errors").errors.length;
    browser("open", base + route);
    browser("wait", "--fn", "!!document.querySelector('h1,h2,form') || !!document.querySelector('iframe[src*=\"/instagram-growth/index.html\"]')?.contentDocument?.querySelector('h1')");
    browser("wait", "600");
    // Snapshot the actual interactive UI before operating the language controls.
    browser("snapshot", "-i");
    for (const language of ["en", "fr"]) {
      if (route === "/instagram-growth/checkout") {
        browser("open", `${base}${route}?plan=growth&months=1&lang=${language}`);
        browser("wait", "--fn", "!!document.querySelector('input[type=email]')");
        browser("snapshot", "-i");
      }
      const changed = browser("eval", `(() => { const d=document.querySelector('iframe[src*="/instagram-growth/index.html"]')?.contentDocument||document; const b=[...d.querySelectorAll('button')].find(b=>b.textContent.trim().toLowerCase()==='${language}'); if(b) b.click(); return !!b; })()`).result;
      browser("wait", "600");
      const report = evaluate(() => {
        const d = document.querySelector('iframe[src*="/instagram-growth/index.html"]')?.contentDocument || document;
        const visible = e => {const s=getComputedStyle(e); return s.display !== "none" && s.visibility !== "hidden" && e.getClientRects().length;};
        const headings = [...d.querySelectorAll("h1,h2,h3")].filter(visible).map(e => ({text:e.textContent.trim(),width:e.getBoundingClientRect().width,scroll:e.scrollWidth,client:e.clientWidth}));
        const text = d.body.innerText;
        // Preserve the three official plan names, while still flagging stylistic dashes.
        const auditedText = text.replace(/^Boost AI — (Growth|Pro|Premium)$/gm, match => match.replace("—", " "));
        const meta = [...document.querySelectorAll('meta[name="description"],meta[property^="og:"],meta[name^="twitter:"]')].map(e=>[e.name||e.getAttribute("property"),e.content]);
        return {title:document.title,lang:d.documentElement.lang,storedLang:localStorage.getItem("bmb_lang"),headings,text,meta,canonical:document.querySelector('link[rel="canonical"]')?.href,overflow:d.documentElement.scrollWidth>d.documentElement.clientWidth+1,dimensions:[d.documentElement.scrollWidth,d.documentElement.clientWidth],headingOverflow:headings.filter(h=>h.scroll>h.client+1),links:[...d.querySelectorAll("a[href]")].map(a=>({text:a.textContent.trim(),href:a.getAttribute("href")})),gtmCount:document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"]').length,directGa4:document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]').length,styleDash:[...auditedText.matchAll(/—|(?<!\d)[–−‐‒]|(?<!\d) - (?!\d)/g)].map(m=>text.slice(Math.max(0,m.index-40),m.index+60)),overlay:!!document.querySelector("[data-nextjs-dialog]")};
      });
      const slug = route === "/" ? "home" : route.slice(1).replaceAll("/", "_");
      browser("screenshot", path.join(output, `${slug}-${language}-${width}.png`), "--full");
      results.push({route,width,language,languageControl:changed,...report,errors:browser("errors").errors.slice(errorsBefore)});
      console.log(JSON.stringify({route,width,language,overflow:report.overflow,headingOverflow:report.headingOverflow.length,styleDash:report.styleDash.length,languageControl:changed}));
    }
  }
} finally {
  fs.writeFileSync(path.join(output, `copy-qa-${width}.json`), JSON.stringify(results,null,2));
  browser("close");
}
