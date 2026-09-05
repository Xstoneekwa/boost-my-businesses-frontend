// Marketing-only event adapter. The ONLY GTM installation is in RootLayout.
import { shouldForwardEvent } from "./gtm";
export const COMMERCIAL_PATHS = ["/", "/instagram-growth", "/instagram-growth-south-africa", "/instagram-growth/real-estate", "/instagram-growth/beauty-aesthetics", "/instagram-growth/restaurants", "/instagram-growth/fitness", "/partners", "/ai-automation"];
export type Payload = Record<string, string | number>;
export type MarketingEvent = { event: string } & Payload;
type Attribution = Record<string, string>;
const ATTRIBUTION_KEY = "bmb_marketing_attribution_v1";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const KNOWN_PLANS = ["growth", "pro", "premium", "outreach_standard", "outreach_ai"];
declare global {
  interface Window {
    dataLayer?: unknown[];
    bmbAnalyticsConsent?: boolean;
    bmbAnalyticsDebug?: MarketingEvent[];
    bmbMarketingAttribution?: Attribution;
    bmbMarketingPreviousPath?: string;
  }
}

export function safeCampaign(value: string | null): string | undefined {
  // Slugs only: reject email, URLs, phone numbers, encoded/nested query strings.
  if (!value || !/^[a-zA-Z0-9][a-zA-Z0-9_. -]{0,63}$/.test(value) || /\d{7}|(?:token|password|email|secret)/i.test(value)) return;
  return value;
}
export function readAttribution(search: string): Attribution {
  const query = new URLSearchParams(search);
  return Object.fromEntries(UTM_KEYS.flatMap(key => { const value = safeCampaign(query.get(key)); return value ? [[key, value]] : []; }));
}
export function pageType(path: string): string {
  if (path === "/") return "home";
  if (path.startsWith("/instagram-growth/")) return "vertical";
  return path.slice(1).replaceAll("-", "_");
}
export function classifyLink(href: string, path: string, origin: string): { event: string; fields: Payload } | undefined {
  let url: URL;
  try { url = new URL(href, origin + path); } catch { return; }
  if (url.hostname === "calendly.com" && url.pathname === "/boostmybusinesses/discovertheassistant") {
    return { event: path === "/partners" ? "bmb_partner_call" : "bmb_book_call", fields: { cta_name: "book_call", destination: "https://calendly.com/boostmybusinesses/discovertheassistant" } };
  }
  if (url.origin !== origin && url.origin !== "https://www.boostmybusinesses.com") return;
  if (url.pathname === "/instagram-growth/checkout") {
    const plan = url.searchParams.get("plan") || url.searchParams.get("outreach") || "";
    const months = Number(url.searchParams.get("months"));
    return { event: "bmb_checkout_start", fields: { cta_name: "choose_plan", destination: url.pathname, ...(KNOWN_PLANS.includes(plan) ? { plan } : {}), ...([1, 3, 6, 12].includes(months) ? { billing_duration: months, months } : {}) } };
  }
  if (![...COMMERCIAL_PATHS, "/contact"].includes(url.pathname)) return;
  const destination = url.pathname + (["#pricing", "#plans"].includes(url.hash) ? url.hash : "");
  const event = ["#pricing", "#plans"].includes(url.hash) ? "bmb_view_plans" : url.pathname === path && url.hash ? "bmb_cta_click" : url.pathname === "/instagram-growth" ? "bmb_instagram_growth_click" : url.pathname === "/instagram-growth-south-africa" ? "bmb_south_africa_click" : url.pathname.startsWith("/instagram-growth/") ? "bmb_vertical_click" : "bmb_cta_click";
  return { event, fields: { cta_name: event.replace("bmb_", ""), destination } };
}

export function startMarketingTracking(path: string, config: { enabled?: boolean }) {
  if (!COMMERCIAL_PATHS.includes(path)) return () => {};
  const debug = new URLSearchParams(location.search).get("bmb_debug") === "1" && !["www.boostmybusinesses.com", "boostmybusinesses.com"].includes(location.hostname);
  const configured = config.enabled === true;
  let granted = window.bmbAnalyticsConsent === true;
  let currentLang = path === "/instagram-growth" ? "fr" : "en";
  try { const savedLanguage = localStorage.getItem("bmb_lang"); if (savedLanguage === "fr" || savedLanguage === "en") currentLang = savedLanguage; } catch { /* Existing functional preference may be unavailable. */ }
  let stopped = false;
  const cleanups: (() => void)[] = [];
  let attribution = window.bmbMarketingAttribution || {};
  const incoming = readAttribution(location.search);
  if (Object.keys(incoming).length) attribution = incoming;
  window.bmbMarketingAttribution = attribution; // tab memory only before consent
  const referrerPath = (() => { try { const ref = new URL(document.referrer); return ref.origin === location.origin && COMMERCIAL_PATHS.includes(ref.pathname) ? ref.pathname : ""; } catch { return ""; } })();
  const source = COMMERCIAL_PATHS.includes(window.bmbMarketingPreviousPath || "") ? window.bmbMarketingPreviousPath! : referrerPath;
  const referrerHost = (() => { try { return new URL(document.referrer).hostname; } catch { return ""; } })();
  const sourceCategory = !referrerHost ? "direct" : /(^|\.)google\./.test(referrerHost) ? "google" : /(^|\.)(instagram|facebook|linkedin)\.com$/.test(referrerHost) ? "social" : referrerHost === location.hostname ? "internal" : "referral";

  const persistAttribution = () => {
    if (!granted || !configured) return;
    try {
      if (!Object.keys(attribution).length) {
        const saved = JSON.parse(sessionStorage.getItem(ATTRIBUTION_KEY) || "{}");
        if (saved.expires > Date.now()) attribution = readAttribution(new URLSearchParams(saved.values).toString());
      }
      sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify({ expires: Date.now() + 30 * 60 * 1000, values: attribution }));
      window.bmbMarketingAttribution = attribution;
    } catch { /* Tracking must not affect navigation if storage is unavailable. */ }
  };
  const emit = (event: string, fields: Payload = {}) => {
    if (stopped) return;
    const data: MarketingEvent = { event, page_path: path, page_type: pageType(path), language: currentLang, analytics_consent: granted ? "granted" : "denied", source_page: source, source_category: sourceCategory, ...(pageType(path) === "vertical" ? { vertical: path.split("/").pop()! } : {}), ...attribution, ...fields };
    if (debug) {
      window.bmbAnalyticsDebug ||= [];
      window.bmbAnalyticsDebug.push(data);
      if (window.bmbAnalyticsDebug.length > 100) window.bmbAnalyticsDebug.shift();
    }
    if (!granted || !configured || !shouldForwardEvent(event, path)) return;
    window.dataLayer ||= [];
    // Clear optional fields first: GTM's data model otherwise retains old plan/CTA values.
    window.dataLayer.push({ plan: null, months: null, billing_duration: null, destination: null, cta_name: null, cta_location: null, vertical: null, ...Object.fromEntries(UTM_KEYS.map(key => [key, null])) });
    window.dataLayer.push(data);
  };
  const onConsent = (event: Event) => {
    const next = (event as CustomEvent).detail?.analytics === "granted";
    if (next === granted) return;
    granted = next; window.bmbAnalyticsConsent = next;
    if (next) { persistAttribution(); }
    else {
      try { sessionStorage.removeItem(ATTRIBUTION_KEY); } catch {}
      attribution = {}; window.bmbMarketingAttribution = {};
    }
  };
  window.addEventListener("bmb:consent", onConsent);
  cleanups.push(() => window.removeEventListener("bmb:consent", onConsent));
  persistAttribution();

  const attach = (doc: Document) => {
    currentLang = doc.documentElement.lang === "fr" ? "fr" : "en";
    const languageObserver = new MutationObserver(() => {
      currentLang = doc.documentElement.lang === "fr" ? "fr" : "en";
      if (doc !== document) document.documentElement.lang = currentLang;
    });
    languageObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ["lang"] });
    if (doc !== document) document.documentElement.lang = currentLang;
    const onClick = (event: Event) => {
      const element = event.target as Element;
      if (!element?.closest) return;
      const button = element.closest("button");
      const language = button?.textContent?.trim().toLowerCase();
      if ((language === "fr" || language === "en") && language !== currentLang) {
        currentLang = language; emit("bmb_language_change"); return;
      }
      const anchor = element.closest("a[href]");
      if (!anchor) return;
      const link = classifyLink(anchor.getAttribute("href") || "", path, location.origin);
      if (!link) return;
      const section = anchor.closest("section");
      const position = anchor.closest("header") ? "header" : anchor.closest("footer") ? "footer" : section?.id || (section ? `section_${[...doc.querySelectorAll("section")].indexOf(section) + 1}` : "body");
      // Capture phase runs before the existing checkout redirect. No preventDefault,
      // URL rewrite, timeout, payment call or callback is added to the product flow.
      emit(link.event, { ...link.fields, cta_location: position });
    };
    const onToggle = (event: Event) => {
      const details = event.target as HTMLDetailsElement;
      if (details.tagName === "DETAILS" && details.open) emit("bmb_faq_open", { cta_name: `faq_${[...doc.querySelectorAll("details")].indexOf(details) + 1}` });
    };
    const onFaqClick = (event: Event) => {
      const q = (event.target as Element)?.closest?.(".faq-q");
      if (q && !q.closest(".faq-item")?.classList.contains("open")) emit("bmb_faq_open", { cta_name: `faq_${[...doc.querySelectorAll(".faq-q")].indexOf(q) + 1}` });
    };
    const onSubmit = (event: Event) => {
      const form = event.target as HTMLFormElement;
      // Future opt-in hook. Never read values, action URLs or user-entered fields.
      const id = form.getAttribute("data-analytics-form");
      if (id && /^[a-z][a-z0-9_]{0,40}$/.test(id)) emit("bmb_form_submit", { cta_name: id });
    };
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("click", onFaqClick, true);
    doc.addEventListener("toggle", onToggle, true);
    doc.addEventListener("submit", onSubmit, true);
    const seen = new Set<Element>();
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting && !seen.has(entry.target)) { seen.add(entry.target); emit("bmb_pricing_section_view", { cta_location: entry.target.id }); }
    }), { threshold: 0.15 });
    doc.querySelectorAll("#pricing, #plans").forEach(section => observer.observe(section));
    return () => { observer.disconnect(); languageObserver.disconnect(); doc.removeEventListener("click", onClick, true); doc.removeEventListener("click", onFaqClick, true); doc.removeEventListener("toggle", onToggle, true); doc.removeEventListener("submit", onSubmit, true); };
  };
  const frame = document.querySelector<HTMLIFrameElement>("iframe[title^='Instagram Growth']");
  let detachFrame: (() => void) | undefined;
  const onFrame = () => { detachFrame?.(); if (frame?.contentDocument?.URL !== "about:blank" && frame?.contentDocument) detachFrame = attach(frame.contentDocument); };
  if (frame) { frame.addEventListener("load", onFrame); if (frame.contentDocument?.readyState === "complete") onFrame(); cleanups.push(() => { frame.removeEventListener("load", onFrame); detachFrame?.(); }); }
  else cleanups.push(attach(document));
  const raf = requestAnimationFrame(() => { emit("bmb_page_view"); window.bmbMarketingPreviousPath = path; });
  return () => { stopped = true; cancelAnimationFrame(raf); cleanups.forEach(cleanup => cleanup()); };
}
