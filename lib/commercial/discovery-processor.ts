import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { lookupInstagramPublicProfile } from "@/lib/instagram-public-profile-lookup";
import { analyzeCommercialProspect, analyzeCommercialProspectWithRetry } from "./discovery-ai";
import { FR_PROFILE_FIRST_KEY, type PersistPage } from "./france-profile-first";
import { anchorsFromStructuredBusinesses, classifyProfileFirstWebsiteUrl, resolveProfileFirstIdentity, type EstablishmentAnchor } from "./profile-first-anchor";
import { COMMERCIAL_AI_PROMPT_VERSION, COMMERCIAL_SCORING_MODEL_VERSION, type CommercialDiscoveryCity, type CommercialDiscoveryCountry, type CommercialDiscoverySubsegment } from "./discovery-contract";
import { discoverCommercialCandidates, type CommercialDiscoveryCandidate } from "./discovery-provider";
import {
  commercialSnapshotHash,
  deterministicCommercialPrecheck,
  enrichCommercialWebsite,
  extractBookingEvidence,
  extractObservedUrls,
  extractFranceCaptionDomainHints,
  filterCommercialAudiences,
  isSharedCommercialPlatformUrl,
  resolveCommercialLocation,
  type AudienceSuggestion,
} from "./discovery-reliability";
import { scoreCommercialProspect } from "./discovery-scoring";
import { boundedCommercialBatchSize, boundedCommercialConcurrency, mapWithBoundedConcurrency, nextCommercialAttemptAt, retryCommercialWrite } from "./discovery-execution";

type Row = Record<string, unknown>;
type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;
type ProcessorDependencies = {
  supabase?: SupabaseAdmin;
  discover?: typeof discoverCommercialCandidates;
  lookupProfile?: typeof lookupInstagramPublicProfile;
  analyze?: typeof analyzeCommercialProspectWithRetry;
  enrichWebsite?: typeof enrichCommercialWebsite;
  loadAnchors?: (input: { city: string; businessName: string; instagramHandle: string }) => Promise<EstablishmentAnchor[]>;
  now?: () => Date;
};

const terminalItemStatuses = new Set(["completed", "rejected", "duplicate", "possible_duplicate", "excluded_client", "failed", "cancelled", "not_selected"]);
const transientItemErrors = new Set(["profile_rate_limited", "profile_provider_error", "profile_unavailable", "website_timeout", "provider_temporary_failure"]);

function row(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function nullableText(value: unknown) { const valueText = text(value).trim(); return valueText || null; }
function num(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function array(value: unknown) { return Array.isArray(value) ? value : []; }
function safeDatabaseError(error: unknown, attempts: number) {
  const value = row(error); const code = text(value.code).slice(0, 64);
  const category = /^23/.test(code) ? "constraint_violation" : /^08/.test(code) ? "connection_error" : /^PGRST/i.test(code) ? "postgrest_error" : "database_error";
  return { provider: "supabase", code: code || "unknown", category, attempts };
}
async function loadFranceControl(supabase: SupabaseAdmin, runId: string) {
  const result = await supabase.from("commercial_france_run_controls").select("run_id,state").eq("run_id", runId).maybeSingle();
  if (result.error) throw new Error("france_control_read_failed");
  return result.data ? row(result.data) : null;
}
/** Existing, normalized structured records only. No provider, lookup or anchor
 * inferred from the profile/website. Bounded ambiguity fails closed. */
async function loadExistingFranceAnchors(supabase: SupabaseAdmin, input: { city: string; businessName: string; instagramHandle: string }) {
  let query = supabase.from("commercial_businesses").select("identity_mode,country_code,instagram_handle_normalized,metadata_safe")
    .eq("identity_mode", "structured").eq("country_code", "FR");
  if (input.city !== "France") query = query.eq("city", input.city);
  const result = await query.limit(51);
  if (result.error) throw new Error("profile_first_anchor_read_failed");
  const records = (result.data ?? []).map(row);
  return records.length > 50 ? [] : anchorsFromStructuredBusinesses(records, input);
}
class CommercialFranceProfileBudgetExhaustedError extends Error {
  constructor(readonly used: number, readonly limit: number) { super("france_profile_budget_exhausted"); }
}
async function reserveFranceCall(supabase: SupabaseAdmin, runId: string, provider: "searchapi" | "sirene" | "openai", kind: "discovery" | "resolver" | "site_page" | "profile" | "sirene" | "scoring", key: string) {
  const result = await supabase.rpc("reserve_commercial_france_provider_call_v1", { p_run_id: runId, p_provider: provider, p_call_kind: kind, p_call_key: key });
  if (result.error) throw new Error("france_provider_reservation_failed");
  const value = row(result.data);
  if (value.reserved !== true && kind === "profile" && value.reason === "budget_exceeded") {
    throw new CommercialFranceProfileBudgetExhaustedError(num(value.used), num(value.limit));
  }
  if (value.reserved !== true) throw new Error(`france_provider_${text(value.reason) || "budget_blocked"}`);
  return text(value.call_id) || null;
}
async function finishFranceCall(supabase: SupabaseAdmin, callId: string | null, status: "succeeded" | "failed" | "skipped", durationMs: number, resultCount = 0, errorCode?: string) {
  if (!callId) return;
  const result = await supabase.rpc("finish_commercial_france_provider_call_v1", { p_call_id: callId, p_status: status, p_duration_ms: Math.max(0, durationMs), p_result_count: Math.max(0, resultCount), p_error_code: errorCode ?? null });
  if (result.error) throw new Error("france_provider_ledger_write_failed");
}
async function finalizeFranceControl(supabase: SupabaseAdmin, runId: string) {
  const control = await loadFranceControl(supabase, runId);
  // No France row means ZA. HOLD/cancellation stay untouched. A touched STOP
  // may need to finish cancelling unstarted items after an in-flight batch.
  if (!control || !["armed", "running", "stopped"].includes(text(control.state))) return;
  if (text(control.state) === "stopped") {
    const gate = await supabase.rpc("evaluate_commercial_france_run_gate_v1", { p_run_id: runId });
    if (gate.error) throw new Error("france_finalizer_gate_failed");
    return;
  }
  const runResult = await supabase.from("commercial_discovery_runs").select("status").eq("id", runId).single();
  if (runResult.error) throw new Error("france_finalizer_run_read_failed");
  const status = text(row(runResult.data).status);
  if (!["failed", "cancelled"].includes(status)) {
    const gate = await supabase.rpc("evaluate_commercial_france_run_gate_v1", { p_run_id: runId });
    if (gate.error) throw new Error("france_finalizer_gate_failed");
  }
  const state = ["completed", "completed_with_errors", "partial"].includes(status) ? "completed"
    : status === "failed" ? "stopped" : status === "cancelled" ? "cancelled" : null;
  if (!state) return;
  // The conditional update preserves any HOLD/STOP established by the gate
  // (or a concurrent worker) before this terminal synchronization.
  const result = await supabase.from("commercial_france_run_controls").update({ state })
    .eq("run_id", runId).in("state", ["armed", "running"]);
  if (result.error) throw new Error("france_finalizer_control_write_failed");
}
class CommercialDiscoveryItemUpdateError extends Error {
  constructor(readonly safeDetail: Row) { super("commercial_discovery_item_update_failed"); }
}
function candidateFromItem(item: Row): CommercialDiscoveryCandidate {
  const source = row(item.source_snapshot_safe);
  return {
    provider: "searchapi",
    providerExternalId: text(item.provider_external_id),
    instagramHandle: text(source.instagram_handle) || text(item.provider_external_id),
    profileUrl: text(source.profile_url) || text(item.source_url),
    title: nullableText(source.title), snippet: nullableText(source.snippet), sourceQuery: text(source.source_query) || text(item.source_query),
    position: num(source.position), extractionMode: source.extraction_mode === "loose" ? "loose" : "strict",
  };
}

async function discoverAndPersistRun(supabase: SupabaseAdmin, run: Row, discover: typeof discoverCommercialCandidates) {
  const experiment = text(run.idempotency_key) === FR_PROFILE_FIRST_KEY;
  const persist: PersistPage = async (record, phase) => {
    const value = { run_id: text(run.id), query_id: record.query_id, page: record.page, payload: record };
    const result = phase === "start" || phase === "skip"
      ? await supabase.from("commercial_france_serp_pages_v2").insert(value)
      : await supabase.from("commercial_france_serp_pages_v2").update({ payload: record }).eq("run_id", value.run_id).eq("query_id", value.query_id).eq("page", value.page).select("query_id").single();
    if (result.error) throw new Error("fr_capture_audit_failure");
  };
  const franceControl = text(run.country_code) === "FR" ? await loadFranceControl(supabase, text(run.id)) : null;
  const providerStarted = Date.now();
  const discoveryCallId = franceControl ? await reserveFranceCall(supabase, text(run.id), "searchapi", "discovery", `run:${text(run.id)}:discovery`) : null;
  let discovery;
  try {
    discovery = await discover({ city: text(run.city) as CommercialDiscoveryCity, countryCode: text(run.country_code) === "FR" ? "FR" : "ZA", subsegment: nullableText(run.subsegment) as CommercialDiscoverySubsegment | undefined, maxCandidates: num(run.max_prospects),
      ...(experiment ? { experiment: { runId: text(run.id), persist } } : {}) });
    await finishFranceCall(supabase, discoveryCallId, "succeeded", Date.now() - providerStarted, discovery.candidates.length);
  } catch (error) {
    await finishFranceCall(supabase, discoveryCallId, "failed", Date.now() - providerStarted, 0, error instanceof Error ? error.message : "discovery_failed");
    throw error;
  }
  const records = discovery.candidates.map((candidate, index) => ({
    run_id: text(run.id), provider: candidate.provider, provider_external_id: candidate.providerExternalId,
    source_url: candidate.profileUrl, source_query: candidate.sourceQuery,
    status: index < num(run.max_prospects) ? "pending" : "not_selected", stage: "DISCOVERED",
    selected_for_processing: index < num(run.max_prospects), candidate_rank: index + 1,
    idempotency_key: `${text(run.id)}:${candidate.providerExternalId}`,
    source_snapshot_safe: { instagram_handle: candidate.instagramHandle, profile_url: candidate.profileUrl, title: candidate.title, snippet: candidate.snippet,
      source_query: candidate.sourceQuery, position: candidate.position, extraction_mode: candidate.extractionMode,
      ...(experiment ? { experiment: FR_PROFILE_FIRST_KEY, attribution: candidate.experimentAttribution } : {}) },
  }));
  if (records.length) {
    const { error } = await supabase.from("commercial_discovery_items").upsert(records, { onConflict: "run_id,idempotency_key", ignoreDuplicates: true });
    if (error) throw new Error("commercial_discovery_candidate_persist_failed");
  }
  const { error } = await supabase.from("commercial_discovery_runs").update({ discovery_status: records.length ? "completed" : "failed", discovered_at: new Date().toISOString(), discovered_count: records.length,
    queries_safe: discovery.queries, provider_diagnostic_safe: discovery.diagnostic, worker_locked_at: null, worker_locked_by: null }).eq("id", text(run.id));
  if (error) throw new Error("commercial_discovery_stage_finalize_failed");
  return records.length;
}

async function updateItem(supabase: SupabaseAdmin, itemId: string, values: Row) {
  const releaseLock = terminalItemStatuses.has(text(values.status)) || values.status === "retry_scheduled";
  const outcome = await retryCommercialWrite(() => supabase.from("commercial_discovery_items").update({ ...values, ...(releaseLock ? { locked_at: null, locked_by: null } : {}) }).eq("id", itemId).neq("status", "cancelled"));
  if (outcome.result.error) throw new CommercialDiscoveryItemUpdateError(safeDatabaseError(outcome.result.error, outcome.attempts));
}

async function recordPrecheckDecision(supabase: SupabaseAdmin, item: Row, decision: ReturnType<typeof deterministicCommercialPrecheck>, location: ReturnType<typeof resolveCommercialLocation>, extra: Row = {}) {
  const terminal = decision.decision === "PRECHECK_REJECT";
  await updateItem(supabase, text(item.id), { status: terminal ? "rejected" : "processing", stage: "PRECHECKED", precheck_decision: decision.decision, precheck_reason: decision.reason,
    precheck_evidence_safe: decision.evidence, location_country: location.country, location_city: location.city, location_confidence: location.confidence,
    location_confidence_score: location.confidenceScore, location_evidence_safe: location.evidence, ...(terminal ? { completed_at: new Date().toISOString() } : {}), ...extra });
  await supabase.from("commercial_discovery_audit_events").insert({ run_id: text(item.run_id), item_id: text(item.id), event_type: terminal ? "precheck_rejected" : "precheck_completed",
    reason_code: decision.reason, metadata_safe: { decision: decision.decision, location_confidence: location.confidence } });
}

async function loadAudienceSuggestions(supabase: SupabaseAdmin, item: Row, city: CommercialDiscoveryCity, ownHandle: string, targetContext: string, detectedCity: string = city, countryCode?: CommercialDiscoveryCountry) {
  const { data } = await supabase.from("commercial_discovery_items").select("provider_external_id,source_url,source_query,source_snapshot_safe")
    .eq("run_id", text(item.run_id)).eq("selected_for_processing", true).eq("status", "completed")
    .eq("precheck_decision", "PRECHECK_PASS").not("lead_id", "is", null).limit(90);
  const candidates = (data ?? []).flatMap((raw) => {
    const peer = row(raw); const source = row(peer.source_snapshot_safe); const handle = text(source.instagram_handle) || text(peer.provider_external_id);
    if (!handle || handle === ownHandle) return [];
    const title = text(source.title) || handle; const snippet = text(source.snippet); const sourceQuery = text(source.source_query) || text(peer.source_query);
    const location = resolveCommercialLocation({ requestedCity: city, countryCode, signals: { provider: [title, snippet] } });
    const category = snippet || title;
    const suggestion: Omit<AudienceSuggestion, "audience_relevance_score"> = { name: title.slice(0, 160), instagram_handle: handle, category: category.slice(0, 160),
      location: location.city, reason: `Beauty/Aesthetics profile found by source query: ${sourceQuery}`.slice(0, 320), profile_url: `https://www.instagram.com/${handle}/`,
      source: "searchapi_google_serp", source_query: sourceQuery, confidence: location.confidence.toLowerCase() as "high" | "medium" | "low" };
    return [suggestion];
  });
  return filterCommercialAudiences(candidates, detectedCity, targetContext);
}

async function processCommercialItem(supabase: SupabaseAdmin, item: Row, dependencies: ProcessorDependencies) {
  const started = Date.now(); const candidate = candidateFromItem(item); const city = text(item.city) as CommercialDiscoveryCity;
  const lookupProfile = dependencies.lookupProfile ?? lookupInstagramPublicProfile; const analyze = dependencies.analyze ?? analyzeCommercialProspectWithRetry; const enrichWebsite = dependencies.enrichWebsite ?? enrichCommercialWebsite;
  try {
    // Item claims do not include country_code; use the persisted run context,
    // never a city-name heuristic, for every geography/precheck branch.
    const runContext = await supabase.from("commercial_discovery_runs").select("country_code").eq("id", text(item.run_id)).single();
    if (runContext.error) throw new Error("commercial_discovery_country_read_failed");
    const market = text(row(runContext.data).country_code);
    if (market !== "FR" && market !== "ZA") throw new Error("commercial_discovery_country_invalid");
    const franceControl = market === "FR" ? await loadFranceControl(supabase, text(item.run_id)) : null;
    if (franceControl && !["armed", "running"].includes(text(franceControl.state))) {
      await supabase.from("commercial_discovery_items").update({ status: "pending", locked_at: null, locked_by: null, next_attempt_at: null }).eq("id", text(item.id));
      return;
    }
    const profileStarted = Date.now();
    const profileCallId = franceControl ? await reserveFranceCall(supabase, text(item.run_id), "searchapi", "profile", `item:${text(item.id)}:profile`) : null;
    let profile;
    try {
      profile = await lookupProfile(candidate.instagramHandle);
      await finishFranceCall(supabase, profileCallId, "succeeded", Date.now() - profileStarted, profile.ok && profile.status === "found" ? 1 : 0);
    } catch (error) {
      await finishFranceCall(supabase, profileCallId, "failed", Date.now() - profileStarted, 0, error instanceof Error ? error.message : "profile_failed");
      throw error;
    }
    if (!profile.ok || profile.status !== "found") {
      const code = `profile_${profile.status}`; const canRetry = transientItemErrors.has(code) && num(item.attempt_count) < num(item.max_attempts);
      if (profile.status === "not_found") {
        const location = resolveCommercialLocation({ requestedCity: city, countryCode: market, signals: { provider: [candidate.title, candidate.snippet] } });
        const precheck = deterministicCommercialPrecheck({ requestedCity: city, countryCode: market, title: candidate.title, snippet: candidate.snippet, profileFound: false, location });
        await recordPrecheckDecision(supabase, item, precheck, location, { duration_ms: Date.now() - started });
        return;
      }
      await updateItem(supabase, text(item.id), { status: canRetry ? "retry_scheduled" : "failed", stage: "FAILED", error_code: code,
        next_attempt_at: canRetry ? nextCommercialAttemptAt((dependencies.now ?? (() => new Date()))(), num(item.attempt_count)) : null,
        completed_at: canRetry ? null : new Date().toISOString(), duration_ms: Date.now() - started });
      return;
    }
    const recentCaptions = profile.recent_post_captions ?? [];
    const profileTexts = [profile.metadata.profile_name, profile.metadata.biography, profile.official_category, ...recentCaptions];
    const providerTexts = [candidate.title, candidate.snippet];
    let location = resolveCommercialLocation({ requestedCity: city, countryCode: market, signals: { provider: providerTexts, instagram: profileTexts } });
    let precheck = deterministicCommercialPrecheck({ requestedCity: city, countryCode: market, title: candidate.title, snippet: candidate.snippet, profileName: profile.metadata.profile_name,
      biography: profile.metadata.biography, category: profile.official_category, recentCaptions, isPrivate: profile.is_private, profileFound: true, location });
    if (precheck.decision === "PRECHECK_REJECT") { await recordPrecheckDecision(supabase, item, precheck, location, { duration_ms: Date.now() - started }); return; }
    if (precheck.decision === "PRECHECK_AMBIGUOUS") await recordPrecheckDecision(supabase, item, precheck, location);

    const bioLinks = profile.bio_links?.map((link) => ({ url: link.url, title: link.title })) ?? [];
    const observedUrls = extractObservedUrls([...profileTexts, ...bioLinks.map((link) => link.url)]);
    const domainHints = market === "FR" ? extractFranceCaptionDomainHints(recentCaptions) : [];
    const observedWebsite = profile.external_url ?? bioLinks.map((link) => link.url).find((url) => url && !/instagram\.com/i.test(url)) ?? observedUrls[0] ?? domainHints[0]?.url ?? null;
    const siteStarted = Date.now();
    const siteCallId = franceControl ? await reserveFranceCall(supabase, text(item.run_id), "searchapi", "site_page", `item:${text(item.id)}:site`) : null;
    let website;
    try {
      website = await enrichWebsite({ websiteUrl: observedWebsite, ...(market === "FR" ? { market } : {}) });
      await finishFranceCall(supabase, siteCallId, "succeeded", Date.now() - siteStarted, num(website.pagesFetched));
    } catch (error) {
      await finishFranceCall(supabase, siteCallId, "failed", Date.now() - siteStarted, 0, error instanceof Error ? error.message : "site_failed");
      throw error;
    }
    const directBooking = extractBookingEvidence(bioLinks, profileTexts);
    const booking = directBooking.bookingUrl ? directBooking : { bookingUrl: website.bookingUrl, bookingProvider: website.bookingProvider, evidence: website.bookingEvidence };
    const websiteClassification = market === "FR" && website.websiteUrl ? classifyProfileFirstWebsiteUrl(website.websiteUrl) : null;
    let businessWebsite = website.websiteUrl && !isSharedCommercialPlatformUrl(website.websiteUrl) ? website.websiteUrl : null;
    location = resolveCommercialLocation({ requestedCity: city, countryCode: market, signals: { provider: providerTexts, instagram: profileTexts, website: [website.address, website.description], booking: [booking.evidence], structured_metadata: [website.address] } });
    precheck = deterministicCommercialPrecheck({ requestedCity: city, countryCode: market, title: candidate.title, snippet: candidate.snippet, profileName: profile.metadata.profile_name,
      ...(market === "FR" ? { websiteDescription: website.description } : {}),
      biography: profile.metadata.biography, category: profile.official_category, recentCaptions, isPrivate: profile.is_private, profileFound: true, location });
    const businessName = text(profile.metadata.profile_name).trim() || candidate.title?.replace(/\s*[|(@-].*$/u, "").trim() || candidate.instagramHandle;
    let profileFirst: ReturnType<typeof resolveProfileFirstIdentity> | undefined;
    if (market === "FR" && precheck.decision !== "PRECHECK_REJECT") {
      const input = { city, businessName, instagramHandle: profile.canonical_username ?? candidate.instagramHandle };
      const anchors = await (dependencies.loadAnchors ? dependencies.loadAnchors(input) : loadExistingFranceAnchors(supabase, input));
      profileFirst = resolveProfileFirstIdentity({ anchors,
        context: { country: "FR", requestedCity: city, profileUrl: candidate.profileUrl, candidateWebsiteUrls: [observedWebsite, website.websiteUrl, ...(website.evidence ?? [])].filter((url): url is string => Boolean(url)) },
        sites: website.identityPages ?? [],
        profile: { url: candidate.profileUrl, alias: nullableText(profile.metadata.profile_name) ?? undefined, city: location.confidence !== "LOW" ? location.city ?? undefined : undefined,
          website: profile.external_url ?? undefined, observed_at: profile.checked_at },
        hits: [{ url: candidate.profileUrl, title: candidate.title ?? "", snippet: candidate.snippet ?? "" }], observedAt: profile.checked_at });
      // UNKNOWN is never promoted because enrichment found a plausible URL.
      businessWebsite = profileFirst.identity?.websites.find(site => site.classification === "OFFICIAL_SITE")?.url ?? null;
      if (!profileFirst.scoringAllowed || profile.is_private !== false) {
        const contradiction = profileFirst.admission.outcome === "REJECT" || profileFirst.identity?.match.reason === "IDENTITY_CONTRADICTION";
        const identityLow = profileFirst.identity?.match.confidence === "LOW";
        const reason = profileFirst.admission.outcome === "ADMITTED" ? profileFirst.scoringAllowed ? "enrichment_not_verified_public_profile" : profileFirst.identity!.match.reason : profileFirst.admission.reason;
        // Reuse the existing terminal review-hold status. The explicit HOLD
        // outcome is evidence metadata, not a new DB state or identity LOW.
        await recordPrecheckDecision(supabase, item, precheck, location, {
          status: contradiction || identityLow ? "rejected" : "possible_duplicate", stage: "ENRICHED", error_code: reason,
          website_url: businessWebsite, booking_url: booking.bookingUrl, booking_provider: booking.bookingProvider, booking_evidence: booking.evidence,
          enrichment_snapshot_safe: { instagram: profile, website, websiteClassification, domainHints, profile_first: profileFirst },
          next_attempt_at: null, completed_at: new Date().toISOString(), duration_ms: Date.now() - started,
        });
        return;
      }
      // Independent establishment geography can now inform LOCATION, separately
      // from the canonical V2 identity result. Candidate-site data is not an anchor.
      if (profileFirst.admission.outcome === "ADMITTED") {
        const anchor = profileFirst.admission.candidate;
        location = resolveCommercialLocation({ requestedCity: city, countryCode: market, signals: { provider: providerTexts, instagram: profileTexts,
          structured_metadata: [`${anchor.address} ${anchor.postalCode} ${anchor.city}, France`] } });
        precheck = deterministicCommercialPrecheck({ requestedCity: city, countryCode: market, title: candidate.title, snippet: candidate.snippet,
          profileName: profile.metadata.profile_name, websiteDescription: website.description, biography: profile.metadata.biography,
          category: profile.official_category, recentCaptions, isPrivate: profile.is_private, profileFound: true, location });
      }
    } else if (market === "FR") {
      // Third-party URLs and unknown domains remain observations even on a fit reject.
      businessWebsite = null;
    }
    if (precheck.decision !== "PRECHECK_PASS") {
      const terminal = { ...precheck, decision: "PRECHECK_REJECT" as const, reason: precheck.reason === "location_requires_enrichment" ? "location_unresolved_after_enrichment" : precheck.reason };
      await recordPrecheckDecision(supabase, item, terminal, location, { website_url: businessWebsite, booking_url: booking.bookingUrl, booking_provider: booking.bookingProvider,
        booking_evidence: booking.evidence, enrichment_snapshot_safe: { instagram: profile, website, ...(market === "FR" ? { websiteClassification, domainHints, profile_first: profileFirst } : {}) }, duration_ms: Date.now() - started }); return;
    }
    await recordPrecheckDecision(supabase, item, precheck, location, { stage: "ENRICHED", website_url: businessWebsite, booking_url: booking.bookingUrl,
      booking_provider: booking.bookingProvider, booking_evidence: booking.evidence, enrichment_snapshot_safe: { instagram: profile, website, ...(profileFirst ? { websiteClassification, domainHints, profile_first: profileFirst } : {}) }, enriched_at: new Date().toISOString() });

    const { data: preflightData, error: preflightError } = await supabase.rpc("preflight_commercial_discovery_candidate_v1", { p_run_id: text(item.run_id), p_provider: candidate.provider,
      p_external_id: candidate.providerExternalId, p_instagram_handle: profile.canonical_username, p_website: businessWebsite, p_business_name: businessName });
    if (preflightError) throw new Error("preflight_failed");
    const dbPreflight = row(preflightData);
    if (text(dbPreflight.status) !== "clear" && !(item.force_rescore === true && text(dbPreflight.status) === "duplicate")) {
      await updateItem(supabase, text(item.id), { status: text(dbPreflight.status), stage: "REJECTED", duplicate_reason: text(dbPreflight.reason), business_id: nullableText(dbPreflight.business_id),
        lead_id: nullableText(dbPreflight.lead_id), completed_at: new Date().toISOString(), duration_ms: Date.now() - started }); return;
    }

    const detectedCity = market === "FR" ? location.city! : city;
    const compactEvidence = { businessName, requestedCity: detectedCity, requestedSubsegment: nullableText(item.subsegment), instagram: { username: profile.canonical_username,
      followers: profile.followers_count, posts: profile.posts_count, category: profile.official_category, biography: profile.metadata.biography,
      recentCaptions: recentCaptions.slice(0, 4) }, website: { url: businessWebsite, description: website.description, bookingProvider: booking.bookingProvider },
      deterministic: { location, precheck, publicProfile: profile.is_private === false, ...(profileFirst ? { profile_first: profileFirst } : {}) } };
    const enrichmentHash = commercialSnapshotHash(compactEvidence);
    const knownBusinessId = nullableText(dbPreflight.business_id);
    let cached: Row | null = null;
    if (knownBusinessId && item.force_rescore !== true) {
      const { data } = await supabase.from("commercial_scoring_cache").select("analysis_snapshot_safe,score_snapshot_safe,ai_model").eq("business_id", knownBusinessId)
        .eq("enrichment_snapshot_hash", enrichmentHash).eq("scoring_model_version", COMMERCIAL_SCORING_MODEL_VERSION).eq("prompt_version", COMMERCIAL_AI_PROMPT_VERSION).maybeSingle();
      cached = data ? row(data) : null;
    }
    const experiment = text(row(item.source_snapshot_safe).experiment) === FR_PROFILE_FIRST_KEY;
    if (experiment && !cached) {
      const { data: reserved, error } = await supabase.rpc("reserve_commercial_france_score_v2", { p_item_id: text(item.id) });
      if (error || reserved !== true) throw new Error("fr_scoring_budget_or_replay_blocked");
    }
    const request = { evidence: compactEvidence, city: detectedCity, ...(market === "FR" ? { market: "FR" as const } : {}), requestedSubsegment: nullableText(item.subsegment) ?? undefined };
    const scoringStarted = Date.now();
    const scoringCallId = franceControl && !cached ? await reserveFranceCall(supabase, text(item.run_id), "openai", "scoring", `item:${text(item.id)}:scoring`) : null;
    let ai;
    try {
      ai = cached ? { ok: true as const, analysis: row(cached.analysis_snapshot_safe) as never, model: text(cached.ai_model), attempts: 0, usage: undefined }
        : experiment ? { ...await analyzeCommercialProspect(request), attempts: 1 } : await analyze(request);
    } catch {
      await finishFranceCall(supabase, scoringCallId, "failed", Date.now() - scoringStarted, 0, "provider_unavailable");
      throw new Error("scoring_failed");
    }
    // A resolved promise/HTTP 200 does not imply a valid scoring result.
    // Finish once, after checking ai.ok, using the existing ledger outcomes.
    const aiSucceeded = ai.ok && Boolean(ai.analysis);
    await finishFranceCall(supabase, scoringCallId, aiSucceeded ? "succeeded" : "failed", Date.now() - scoringStarted,
      aiSucceeded ? 1 : 0, aiSucceeded ? undefined : ai.errorCode ?? "schema_invalid");
    const providerDiagnostic = "providerDiagnostic" in ai ? ai.providerDiagnostic : undefined;
    const providerAttemptsSafe = "providerAttemptsSafe" in ai ? ai.providerAttemptsSafe : providerDiagnostic ? [providerDiagnostic] : [];
    if (!ai.ok || !ai.analysis) {
      await updateItem(supabase, text(item.id), { status: "failed", stage: "FAILED", error_code: "AI_ANALYSIS_FAILED", error_detail_safe: { provider_code: ai.errorCode, attempts: ai.attempts, provider_diagnostic: providerDiagnostic, provider_attempts_safe: providerAttemptsSafe },
        completed_at: new Date().toISOString(), duration_ms: Date.now() - started }); return;
    }
    const score = scoreCommercialProspect({ analysis: ai.analysis, isPrivate: profile.is_private, profileFound: true,
      businessStatus: ai.analysis.signals.appearsClosed ? "closed" : "unknown", deterministicLocationConfidence: location.confidence });
    if (score.itemStatus === "hard_rejected") {
      await updateItem(supabase, text(item.id), { status: "rejected", stage: "REJECTED", duplicate_reason: score.hardGateCodes.join(",") || "ai_hard_reject",
        analysis_snapshot_safe: { ...ai.analysis, model: ai.model, prompt_version: COMMERCIAL_AI_PROMPT_VERSION, attempts: ai.attempts, usage: ai.usage, provider_diagnostic: providerDiagnostic, provider_attempts_safe: providerAttemptsSafe },
        completed_at: new Date().toISOString(), duration_ms: Date.now() - started });
      return;
    }
    const audienceTargetContext = [businessName, profile.official_category, candidate.title].filter(Boolean).join(" ");
    const audiences = await loadAudienceSuggestions(supabase, item, city, profile.canonical_username ?? candidate.instagramHandle, audienceTargetContext, detectedCity, market);
    const payload = { provider: candidate.provider, provider_external_id: candidate.providerExternalId, source_url: candidate.profileUrl, source_query: candidate.sourceQuery,
      source_snapshot_safe: row(item.source_snapshot_safe), enrichment_snapshot_safe: { instagram: profile, website, location, booking, ...(profileFirst ? { websiteClassification, domainHints, profile_first: profileFirst } : {}) }, enrichment_provenance_safe: { instagram_checked_at: profile.checked_at, website_pages: website.evidence },
      analysis_snapshot_safe: { ...ai.analysis, model: ai.model, prompt_version: COMMERCIAL_AI_PROMPT_VERSION, attempts: ai.attempts, usage: ai.usage, provider_diagnostic: providerDiagnostic, provider_attempts_safe: providerAttemptsSafe }, score_breakdown_safe: score.breakdown,
      personalization_context_safe: { observed_evidence: ai.analysis.evidence, reasoning: ai.analysis.reasoning }, audience_context_safe: { source: "deterministically_filtered_discovery_peers", suggestions: audiences },
      business_name: businessName, country_code: market, city: detectedCity, vertical: "Beauty/Aesthetics", subsegment: ai.analysis.subsegment, instagram_handle: profile.canonical_username,
      website: businessWebsite, email: website.email, phone: website.phone, address_safe: website.address, business_description: website.description ?? ai.analysis.reasoning,
      booking_url: booking.bookingUrl, booking_provider: booking.bookingProvider, booking_evidence: booking.evidence, business_status: ai.analysis.signals.appearsClosed ? "closed" : "unknown",
      qualification_status: score.qualificationStatus, item_status: score.itemStatus, lead_score: score.score, score_percent: score.scorePercent, priority: score.crmPriority,
      score_priority: score.scorePriority, recommended_channel: ai.analysis.recommendedChannel, recommended_angle: ai.analysis.recommendedAngle, scoring_model_version: score.scoringModelVersion,
      ai_confidence: ai.analysis.confidence, ai_model: ai.model, ai_prompt_version: COMMERCIAL_AI_PROMPT_VERSION, needs_manual_review: score.needsManualReview, hard_gate_codes: score.hardGateCodes,
      source_snapshot_hash: enrichmentHash, location_confidence: location.confidence, location_evidence: location.evidence, duration_ms: Date.now() - started };
    const { data: ingested, error: ingestError } = await supabase.rpc("ingest_commercial_discovery_candidate_v2", { p_item_id: text(item.id), p_payload: payload });
    if (ingestError) throw new Error("ingest_failed");
    void ingested;
  } catch (error) {
    if (error instanceof CommercialFranceProfileBudgetExhaustedError) {
      const held = await supabase.from("commercial_france_run_controls").update({ state: "hold", stop_code: "profile_budget_exhausted", stop_reason: "public_profiles_budget_exhausted" })
        .eq("run_id", text(item.run_id)).in("state", ["armed", "running"]);
      if (held.error) throw new Error("france_profile_budget_hold_failed");
      await updateItem(supabase, text(item.id), { status: "cancelled", stage: "REJECTED", error_code: "skipped_by_budget",
        error_detail_safe: { reason: "budget_exhausted", budget: "public_profiles", used: error.used, limit: error.limit },
        next_attempt_at: null, locked_at: null, locked_by: null, completed_at: new Date().toISOString(), duration_ms: Date.now() - started });
      return;
    }
    const code = error instanceof Error ? error.message : "processor_error"; const canRetry = transientItemErrors.has(code) && num(item.attempt_count) < num(item.max_attempts);
    await updateItem(supabase, text(item.id), { status: canRetry ? "retry_scheduled" : "failed", stage: "FAILED", error_code: code,
      error_detail_safe: error instanceof CommercialDiscoveryItemUpdateError ? error.safeDetail : {},
      next_attempt_at: canRetry ? nextCommercialAttemptAt((dependencies.now ?? (() => new Date()))(), num(item.attempt_count)) : null,
      completed_at: canRetry ? null : new Date().toISOString(), duration_ms: Date.now() - started });
  }
}

export async function processCommercialDiscoveryBatch(dependencies: ProcessorDependencies = {}) {
  const supabase = dependencies.supabase ?? createSupabaseAdminClient(); const discover = dependencies.discover ?? discoverCommercialCandidates;
  const workerId = `commercial:${process.env.VERCEL_REGION ?? "local"}:${crypto.randomUUID().slice(0, 8)}`;
  const { data: runClaims, error: runClaimError } = await supabase.rpc("claim_commercial_discovery_runs_v2", { batch_limit: 1, worker_id: workerId });
  if (runClaimError) throw new Error("commercial_discovery_run_claim_failed");
  const claimedRuns = array(runClaims).map(row);
  for (const claimed of claimedRuns) {
    try { await discoverAndPersistRun(supabase, claimed, discover); }
    catch {
      const exhausted = text(claimed.idempotency_key) === FR_PROFILE_FIRST_KEY || num(claimed.discovery_attempt_count) >= num(claimed.discovery_max_attempts);
      await supabase.from("commercial_discovery_runs").update({ discovery_status: exhausted ? "failed" : "pending", status: exhausted ? "failed" : "running",
        worker_locked_at: null, worker_locked_by: null, error_summary_safe: { discovery_provider_failure: 1 } }).eq("id", text(claimed.id));
    }
  }

  const batchLimit = boundedCommercialBatchSize(process.env.COMMERCIAL_DISCOVERY_BATCH_SIZE, 5);
  const concurrency = Math.min(boundedCommercialConcurrency(process.env.COMMERCIAL_DISCOVERY_ENRICHMENT_CONCURRENCY, 3), boundedCommercialConcurrency(process.env.COMMERCIAL_DISCOVERY_AI_CONCURRENCY, 2));
  const { data: itemClaims, error: claimError } = await supabase.rpc("claim_commercial_discovery_items_v2", { batch_limit: batchLimit, worker_id: workerId });
  if (claimError) throw new Error("commercial_discovery_item_claim_failed");
  const items = array(itemClaims).map(row).filter((item) => !terminalItemStatuses.has(text(item.status)));
  await mapWithBoundedConcurrency(items, concurrency, (item) => processCommercialItem(supabase, item, dependencies));
  const touchedRuns = [...new Set([...claimedRuns.map((run) => text(run.id)), ...items.map((item) => text(item.run_id))].filter(Boolean))];
  for (const runId of touchedRuns) {
    // A previously stopped in-flight batch must settle cancellation BEFORE
    // refresh can mistake cancelled/preserved items for successful completion.
    const control = await loadFranceControl(supabase, runId);
    if (text(control?.state) === "stopped") {
      await finalizeFranceControl(supabase, runId);
      await supabase.rpc("refresh_commercial_discovery_run_v2", { p_run_id: runId });
      continue;
    }
    await supabase.rpc("refresh_commercial_discovery_run_v2", { p_run_id: runId });
    await finalizeFranceControl(supabase, runId);
  }
  return { workerId, discoveredRuns: claimedRuns.length, claimedItems: items.length, concurrency, batchLimit };
}

export async function cancelCommercialDiscoveryRun(runId: string, actorUserId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("cancel_commercial_discovery_run_v2", { p_run_id: runId, p_actor_user_id: actorUserId });
  if (error) throw new Error("commercial_discovery_cancel_failed");
  if (text(row(data).status) === "cancelled") await finalizeFranceControl(supabase, runId);
  return row(data);
}
