import { createHash } from "node:crypto";
import type { CommercialDiscoveryCity } from "./discovery-contract.ts";

type EvidenceSource = "provider" | "instagram" | "website" | "booking" | "structured_metadata";

export type LocationResolution = {
  country: "ZA" | null;
  city: CommercialDiscoveryCity | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidenceScore: number;
  evidence: Array<{ source: EvidenceSource; value: string; city: CommercialDiscoveryCity }>;
};

export type CommercialPrecheckResult = {
  decision: "PRECHECK_PASS" | "PRECHECK_REJECT" | "PRECHECK_AMBIGUOUS";
  reason: string;
  evidence: string[];
};

export type AudienceSuggestion = {
  name: string;
  instagram_handle: string;
  category: string;
  location: string | null;
  reason: string;
  profile_url: string;
  source: string;
  source_query: string;
  confidence: "high" | "medium" | "low";
  audience_relevance_score: number;
};

const beautyPattern = /\b(aesthetic|aesthetics|beauty|hair|salon|skin|spa|clinic|laser|lash|brow|nail|makeup|wellness|cosmetic|derma|facial|injectable|stylist|barber)\b/i;
const disallowedAudiencePattern = /\b(digital|marketing|agency|software|saas|app|platform|directory|marketplace|media|magazine|supplier|wholesale|academy|course|training)\b/i;
const closedPattern = /\b(permanently closed|business closed|no longer trading|ceased trading)\b/i;
const cityPatterns: Record<CommercialDiscoveryCity, RegExp> = {
  Johannesburg: /\b(johannesburg|joburg|jozi|sandton|rosebank|midrand|randburg|fourways|soweto|centurion|gauteng)\b/i,
  "Cape Town": /\b(cape town|capetown|cpt|stellenbosch|somerset west|claremont|constantia|sea point|western cape)\b/i,
};

function clean(value: unknown, limit = 600) {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

export function resolveCommercialLocation(input: {
  requestedCity: CommercialDiscoveryCity;
  signals: Partial<Record<EvidenceSource, unknown[]>>;
}): LocationResolution {
  const evidence: LocationResolution["evidence"] = [];
  for (const [source, values] of Object.entries(input.signals) as Array<[EvidenceSource, unknown[] | undefined]>) {
    for (const raw of values ?? []) {
      const value = clean(raw);
      if (!value) continue;
      for (const city of Object.keys(cityPatterns) as CommercialDiscoveryCity[]) {
        if (cityPatterns[city].test(value)) evidence.push({ source, value: value.slice(0, 240), city });
      }
    }
  }
  const matching = evidence.filter((item) => item.city === input.requestedCity);
  const distinctSources = new Set(matching.map((item) => item.source));
  const structured = matching.some((item) => item.source === "structured_metadata" || item.source === "booking");
  const conflicting = evidence.some((item) => item.city !== input.requestedCity);
  const confidence = structured || distinctSources.size >= 2 ? "HIGH" : matching.length > 0 ? "MEDIUM" : "LOW";
  const confidenceScore = confidence === "HIGH" ? (conflicting ? 0.82 : 0.94) : confidence === "MEDIUM" ? (conflicting ? 0.58 : 0.72) : 0.25;
  return { country: matching.length ? "ZA" : null, city: matching.length ? input.requestedCity : null, confidence, confidenceScore, evidence };
}

export function deterministicCommercialPrecheck(input: {
  requestedCity: CommercialDiscoveryCity;
  title?: unknown;
  snippet?: unknown;
  profileName?: unknown;
  biography?: unknown;
  category?: unknown;
  recentCaptions?: unknown[];
  isPrivate?: boolean | null;
  profileFound?: boolean;
  location: LocationResolution;
}): CommercialPrecheckResult {
  const fields = [input.title, input.snippet, input.profileName, input.biography, input.category, ...(input.recentCaptions ?? [])].map((value) => clean(value)).filter(Boolean);
  const combined = fields.join(" ");
  const identityCombined = [input.title, input.profileName, input.category].map((value) => clean(value)).filter(Boolean).join(" ");
  if (input.profileFound === false) return { decision: "PRECHECK_REJECT", reason: "instagram_profile_not_found", evidence: [] };
  if (input.isPrivate === true) return { decision: "PRECHECK_REJECT", reason: "instagram_private", evidence: [] };
  if (closedPattern.test(combined)) return { decision: "PRECHECK_REJECT", reason: "business_closed", evidence: fields.filter((value) => closedPattern.test(value)).slice(0, 3) };
  if (disallowedAudiencePattern.test(identityCombined) || (disallowedAudiencePattern.test(combined) && !beautyPattern.test(combined))) {
    return { decision: "PRECHECK_REJECT", reason: "clearly_unrelated_business", evidence: fields.filter((value) => disallowedAudiencePattern.test(value)).slice(0, 3) };
  }
  if (!beautyPattern.test(combined)) return { decision: "PRECHECK_AMBIGUOUS", reason: "beauty_vertical_unproven", evidence: fields.slice(0, 3) };
  const wrongCityEvidence = input.location.evidence.filter((item) => item.city !== input.requestedCity);
  if (input.location.confidence === "LOW" && wrongCityEvidence.length) {
    return { decision: "PRECHECK_REJECT", reason: "outside_strict_market", evidence: wrongCityEvidence.map((item) => item.value).slice(0, 3) };
  }
  if (input.location.confidence === "LOW") return { decision: "PRECHECK_AMBIGUOUS", reason: "location_requires_enrichment", evidence: fields.filter((value) => beautyPattern.test(value)).slice(0, 3) };
  return { decision: "PRECHECK_PASS", reason: "plausible_local_beauty_business", evidence: input.location.evidence.filter((item) => item.city === input.requestedCity).map((item) => `${item.source}:${item.value}`).slice(0, 5) };
}

function normalizedUrl(raw: string, base?: string) {
  const candidate = raw.startsWith("www.") ? `https://${raw}` : raw;
  try {
    const url = base ? new URL(candidate, base) : new URL(candidate);
    if (!/^https?:$/.test(url.protocol) || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i.test(url.hostname)) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

export function extractObservedUrls(values: unknown[]) {
  const urls = new Set<string>();
  for (const raw of values) {
    const value = clean(raw, 5000);
    for (const match of value.matchAll(/(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi)) {
      const url = normalizedUrl(match[0].replace(/[.,;:!?]+$/, ""));
      if (url) urls.add(url);
    }
  }
  return [...urls].slice(0, 20);
}

function bookingProvider(url: string) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (/fresha\./i.test(host)) return "fresha";
  if (/treatwell\./i.test(host)) return "treatwell";
  if (/calendly\./i.test(host)) return "calendly";
  if (/wa\.me|whatsapp\./i.test(host)) return "whatsapp";
  if (/booksy\./i.test(host)) return "booksy";
  return "website_booking";
}

const bookingPattern = /\b(book(?:ing|ings)?|appointment|schedule|reserve|fresha|treatwell|calendly|booksy|whatsapp)\b/i;

export function extractBookingEvidence(links: Array<{ url?: unknown; title?: unknown }>, fallbackTexts: unknown[] = []) {
  const candidates = links.map((link) => ({ url: normalizedUrl(clean(link.url, 2000)), label: clean(link.title) })).filter((link): link is { url: string; label: string } => Boolean(link.url));
  for (const candidate of candidates) {
    if (bookingPattern.test(`${candidate.label} ${candidate.url}`)) return { bookingUrl: candidate.url, bookingProvider: bookingProvider(candidate.url), evidence: `${candidate.label || "public link"}: ${candidate.url}`.slice(0, 500) };
  }
  const observed = extractObservedUrls(fallbackTexts);
  const match = observed.find((url) => bookingPattern.test(url));
  return match ? { bookingUrl: match, bookingProvider: bookingProvider(match), evidence: `Observed booking URL: ${match}` } : { bookingUrl: null, bookingProvider: null, evidence: null };
}

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function extractPage(html: string, pageUrl: string) {
  const links: Array<{ url: string; title: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = normalizedUrl(decodeHtml(match[1]), pageUrl);
    if (url) links.push({ url, title: decodeHtml(match[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 160) });
  }
  const plain = decodeHtml(html.replace(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  const email = plain.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]?.toLowerCase() ?? null;
  const phone = plain.match(/(?:\+27|0)[1-8][\d\s().-]{7,14}\d/)?.[0]?.replace(/\s+/g, " ").trim() ?? null;
  const address = plain.match(/.{0,80}\b(?:Johannesburg|Joburg|Sandton|Rosebank|Midrand|Cape Town|Stellenbosch|Western Cape)\b.{0,120}/i)?.[0]?.trim() ?? null;
  const description = html.match(/<meta\b[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? null;
  const booking = extractBookingEvidence(links, [plain]);
  return { links, email, phone, address, description: description ? decodeHtml(description).slice(0, 500) : null, ...booking };
}

async function fetchWithRedirectLimit(url: string, fetchImpl: typeof fetch, timeoutMs: number, maxBytes: number) {
  let current = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(current, { signal: controller.signal, redirect: "manual", headers: { "User-Agent": "BMB-Commercial-Enrichment/1.0", Accept: "text/html,application/xhtml+xml" }, cache: "no-store" });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = normalizedUrl(response.headers.get("location") ?? "", current);
        if (!next || redirects === 3) return null;
        current = next; continue;
      }
      if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) return null;
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > maxBytes) return null;
      const body = (await response.text()).slice(0, maxBytes);
      return { url: current, html: body };
    } finally { clearTimeout(timer); }
  }
  return null;
}

export async function enrichCommercialWebsite(input: { websiteUrl: string | null; fetchImpl?: typeof fetch; maxPages?: number; timeoutMs?: number; maxBytes?: number }) {
  const start = input.websiteUrl ? normalizedUrl(input.websiteUrl) : null;
  if (!start) return { websiteUrl: null, pagesFetched: 0, email: null, phone: null, address: null, description: null, bookingUrl: null, bookingProvider: null, bookingEvidence: null, evidence: [] as string[] };
  const fetchImpl = input.fetchImpl ?? fetch; const maxPages = Math.min(Math.max(input.maxPages ?? 3, 1), 3); const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 5_000, 500), 8_000); const maxBytes = Math.min(Math.max(input.maxBytes ?? 512_000, 16_000), 512_000);
  const queue = [start]; const visited = new Set<string>(); const pages: ReturnType<typeof extractPage>[] = []; const evidence: string[] = [];
  while (queue.length && visited.size < maxPages) {
    const url = queue.shift()!; if (visited.has(url)) continue; visited.add(url);
    try {
      const result = await fetchWithRedirectLimit(url, fetchImpl, timeoutMs, maxBytes); if (!result) continue;
      const page = extractPage(result.html, result.url); pages.push(page); evidence.push(result.url);
      for (const link of page.links) if (new URL(link.url).hostname === new URL(start).hostname && /contact|book|appointment|about/i.test(`${link.title} ${link.url}`) && !visited.has(link.url)) queue.push(link.url);
    } catch { /* Bounded website enrichment is best-effort; Instagram evidence remains usable. */ }
  }
  const first = <K extends keyof ReturnType<typeof extractPage>>(key: K) => pages.map((page) => page[key]).find(Boolean) ?? null;
  return { websiteUrl: start, pagesFetched: pages.length, email: first("email") as string | null, phone: first("phone") as string | null, address: first("address") as string | null,
    description: first("description") as string | null, bookingUrl: first("bookingUrl") as string | null, bookingProvider: first("bookingProvider") as string | null,
    bookingEvidence: first("evidence") as string | null, evidence };
}

export function filterCommercialAudiences(input: Array<Omit<AudienceSuggestion, "audience_relevance_score">>, requestedCity: CommercialDiscoveryCity) {
  return input.flatMap((candidate) => {
    const combined = `${candidate.name} ${candidate.instagram_handle} ${candidate.category} ${candidate.reason} ${candidate.source_query}`;
    if (disallowedAudiencePattern.test(combined) || !beautyPattern.test(combined)) return [];
    const sameCity = cityPatterns[requestedCity].test(`${candidate.location ?? ""} ${candidate.source_query} ${candidate.reason}`);
    if (!sameCity) return [];
    const score = Math.min(1, Number((0.45 + 0.25 + (candidate.confidence === "high" ? 0.2 : candidate.confidence === "medium" ? 0.12 : 0.04) + (/competitor|similar|same/i.test(candidate.reason) ? 0.1 : 0)).toFixed(2)));
    if (score < 0.72 || clean(candidate.reason).length < 24) return [];
    return [{ ...candidate, audience_relevance_score: score }];
  }).sort((a, b) => b.audience_relevance_score - a.audience_relevance_score).slice(0, 5);
}

export function commercialSnapshotHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
