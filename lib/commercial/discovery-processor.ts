import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { lookupInstagramPublicProfile } from "@/lib/instagram-public-profile-lookup";
import { analyzeCommercialProspectWithRetry } from "./discovery-ai";
import { COMMERCIAL_AI_PROMPT_VERSION, COMMERCIAL_SCORING_MODEL_VERSION, type CommercialDiscoveryCity, type CommercialDiscoverySubsegment } from "./discovery-contract";
import { discoverCommercialCandidates, type CommercialDiscoveryCandidate } from "./discovery-provider";
import {
  commercialSnapshotHash,
  deterministicCommercialPrecheck,
  enrichCommercialWebsite,
  extractBookingEvidence,
  extractObservedUrls,
  filterCommercialAudiences,
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
  now?: () => Date;
};

const terminalItemStatuses = new Set(["completed", "rejected", "duplicate", "possible_duplicate", "excluded_client", "failed", "cancelled", "not_selected"]);
const transientItemErrors = new Set(["profile_rate_limited", "profile_provider_error", "profile_unavailable", "website_timeout", "provider_temporary_failure"]);

function row(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function nullableText(value: unknown) { const valueText = text(value).trim(); return valueText || null; }
function num(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function array(value: unknown) { return Array.isArray(value) ? value : []; }
function sleep(milliseconds: number) { return new Promise<void>((resolve) => setTimeout(resolve, milliseconds)); }
function safeDatabaseError(error: unknown, attempts: number) {
  const value = row(error); const code = text(value.code).slice(0, 64);
  const category = /^23/.test(code) ? "constraint_violation" : /^08/.test(code) ? "connection_error" : /^PGRST/i.test(code) ? "postgrest_error" : "database_error";
  return { provider: "supabase", code: code || "unknown", category, attempts };
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
  const discovery = await discover({ city: text(run.city) as CommercialDiscoveryCity, subsegment: nullableText(run.subsegment) as CommercialDiscoverySubsegment | undefined, maxCandidates: num(run.max_prospects) });
  const records = discovery.candidates.map((candidate, index) => ({
    run_id: text(run.id), provider: candidate.provider, provider_external_id: candidate.providerExternalId,
    source_url: candidate.profileUrl, source_query: candidate.sourceQuery,
    status: index < num(run.max_prospects) ? "pending" : "not_selected", stage: "DISCOVERED",
    selected_for_processing: index < num(run.max_prospects), candidate_rank: index + 1,
    idempotency_key: `${text(run.id)}:${candidate.providerExternalId}`,
    source_snapshot_safe: { instagram_handle: candidate.instagramHandle, profile_url: candidate.profileUrl, title: candidate.title, snippet: candidate.snippet,
      source_query: candidate.sourceQuery, position: candidate.position, extraction_mode: candidate.extractionMode },
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

async function loadAudienceSuggestions(supabase: SupabaseAdmin, item: Row, city: CommercialDiscoveryCity, ownHandle: string) {
  const { data } = await supabase.from("commercial_discovery_items").select("provider_external_id,source_url,source_query,source_snapshot_safe").eq("run_id", text(item.run_id)).limit(90);
  const candidates = (data ?? []).flatMap((raw) => {
    const peer = row(raw); const source = row(peer.source_snapshot_safe); const handle = text(source.instagram_handle) || text(peer.provider_external_id);
    if (!handle || handle === ownHandle) return [];
    const title = text(source.title) || handle; const snippet = text(source.snippet); const sourceQuery = text(source.source_query) || text(peer.source_query);
    const location = resolveCommercialLocation({ requestedCity: city, signals: { provider: [title, snippet, sourceQuery] } });
    const category = snippet || title;
    const suggestion: Omit<AudienceSuggestion, "audience_relevance_score"> = { name: title.slice(0, 160), instagram_handle: handle, category: category.slice(0, 160),
      location: location.city, reason: `Same-city Beauty/Aesthetics profile found by verified query: ${sourceQuery}`.slice(0, 320), profile_url: text(source.profile_url) || text(peer.source_url),
      source: "searchapi_google_serp", source_query: sourceQuery, confidence: source.extraction_mode === "loose" ? "medium" : "high" };
    return [suggestion];
  });
  return filterCommercialAudiences(candidates, city);
}

async function processCommercialItem(supabase: SupabaseAdmin, item: Row, dependencies: ProcessorDependencies) {
  const started = Date.now(); const candidate = candidateFromItem(item); const city = text(item.city) as CommercialDiscoveryCity;
  const lookupProfile = dependencies.lookupProfile ?? lookupInstagramPublicProfile; const analyze = dependencies.analyze ?? analyzeCommercialProspectWithRetry; const enrichWebsite = dependencies.enrichWebsite ?? enrichCommercialWebsite;
  try {
    const profile = await lookupProfile(candidate.instagramHandle);
    if (!profile.ok || profile.status !== "found") {
      const code = `profile_${profile.status}`; const canRetry = transientItemErrors.has(code) && num(item.attempt_count) < num(item.max_attempts);
      await updateItem(supabase, text(item.id), { status: canRetry ? "retry_scheduled" : "failed", stage: "FAILED", error_code: code,
        next_attempt_at: canRetry ? nextCommercialAttemptAt((dependencies.now ?? (() => new Date()))(), num(item.attempt_count)) : null,
        completed_at: canRetry ? null : new Date().toISOString(), duration_ms: Date.now() - started });
      return;
    }
    const recentCaptions = profile.recent_post_captions ?? [];
    const profileTexts = [profile.metadata.profile_name, profile.metadata.biography, profile.official_category, ...recentCaptions];
    const providerTexts = [candidate.title, candidate.snippet, candidate.sourceQuery];
    let location = resolveCommercialLocation({ requestedCity: city, signals: { provider: providerTexts, instagram: profileTexts } });
    let precheck = deterministicCommercialPrecheck({ requestedCity: city, title: candidate.title, snippet: candidate.snippet, profileName: profile.metadata.profile_name,
      biography: profile.metadata.biography, category: profile.official_category, recentCaptions, isPrivate: profile.is_private, profileFound: true, location });
    if (precheck.decision === "PRECHECK_REJECT") { await recordPrecheckDecision(supabase, item, precheck, location, { duration_ms: Date.now() - started }); return; }
    if (precheck.decision === "PRECHECK_AMBIGUOUS") await recordPrecheckDecision(supabase, item, precheck, location);

    const bioLinks = profile.bio_links?.map((link) => ({ url: link.url, title: link.title })) ?? [];
    const observedUrls = extractObservedUrls([...profileTexts, ...bioLinks.map((link) => link.url)]);
    const observedWebsite = profile.external_url ?? bioLinks.map((link) => link.url).find((url) => url && !/instagram\.com/i.test(url)) ?? observedUrls[0] ?? null;
    const website = await enrichWebsite({ websiteUrl: observedWebsite });
    const directBooking = extractBookingEvidence(bioLinks, profileTexts);
    const booking = directBooking.bookingUrl ? directBooking : { bookingUrl: website.bookingUrl, bookingProvider: website.bookingProvider, evidence: website.bookingEvidence };
    location = resolveCommercialLocation({ requestedCity: city, signals: { provider: providerTexts, instagram: profileTexts, website: [website.address, website.description], booking: [booking.evidence], structured_metadata: [website.address] } });
    precheck = deterministicCommercialPrecheck({ requestedCity: city, title: candidate.title, snippet: candidate.snippet, profileName: profile.metadata.profile_name,
      biography: profile.metadata.biography, category: profile.official_category, recentCaptions, isPrivate: profile.is_private, profileFound: true, location });
    if (precheck.decision !== "PRECHECK_PASS") {
      const terminal = { ...precheck, decision: "PRECHECK_REJECT" as const, reason: precheck.reason === "location_requires_enrichment" ? "location_unresolved_after_enrichment" : precheck.reason };
      await recordPrecheckDecision(supabase, item, terminal, location, { website_url: website.websiteUrl, booking_url: booking.bookingUrl, booking_provider: booking.bookingProvider,
        booking_evidence: booking.evidence, enrichment_snapshot_safe: { instagram: profile, website }, duration_ms: Date.now() - started }); return;
    }
    await recordPrecheckDecision(supabase, item, precheck, location, { stage: "ENRICHED", website_url: website.websiteUrl, booking_url: booking.bookingUrl,
      booking_provider: booking.bookingProvider, booking_evidence: booking.evidence, enrichment_snapshot_safe: { instagram: profile, website }, enriched_at: new Date().toISOString() });

    const businessName = text(profile.metadata.profile_name).trim() || candidate.title?.replace(/\s*[|(@-].*$/u, "").trim() || candidate.instagramHandle;
    const { data: preflightData, error: preflightError } = await supabase.rpc("preflight_commercial_discovery_candidate_v1", { p_run_id: text(item.run_id), p_provider: candidate.provider,
      p_external_id: candidate.providerExternalId, p_instagram_handle: profile.canonical_username, p_website: website.websiteUrl, p_business_name: businessName });
    if (preflightError) throw new Error("preflight_failed");
    const dbPreflight = row(preflightData);
    if (text(dbPreflight.status) !== "clear" && !(item.force_rescore === true && text(dbPreflight.status) === "duplicate")) {
      await updateItem(supabase, text(item.id), { status: text(dbPreflight.status), stage: "REJECTED", duplicate_reason: text(dbPreflight.reason), business_id: nullableText(dbPreflight.business_id),
        lead_id: nullableText(dbPreflight.lead_id), completed_at: new Date().toISOString(), duration_ms: Date.now() - started }); return;
    }

    const compactEvidence = { businessName, requestedCity: city, requestedSubsegment: nullableText(item.subsegment), instagram: { username: profile.canonical_username,
      followers: profile.followers_count, posts: profile.posts_count, category: profile.official_category, biography: profile.metadata.biography,
      recentCaptions: recentCaptions.slice(0, 4) }, website: { url: website.websiteUrl, description: website.description, bookingProvider: booking.bookingProvider },
      deterministic: { location, precheck, publicProfile: profile.is_private === false } };
    const enrichmentHash = commercialSnapshotHash(compactEvidence);
    const knownBusinessId = nullableText(dbPreflight.business_id);
    let cached: Row | null = null;
    if (knownBusinessId && item.force_rescore !== true) {
      const { data } = await supabase.from("commercial_scoring_cache").select("analysis_snapshot_safe,score_snapshot_safe,ai_model").eq("business_id", knownBusinessId)
        .eq("enrichment_snapshot_hash", enrichmentHash).eq("scoring_model_version", COMMERCIAL_SCORING_MODEL_VERSION).eq("prompt_version", COMMERCIAL_AI_PROMPT_VERSION).maybeSingle();
      cached = data ? row(data) : null;
    }
    const ai = cached ? { ok: true as const, analysis: row(cached.analysis_snapshot_safe) as never, model: text(cached.ai_model), attempts: 0, usage: undefined } : await analyze({ evidence: compactEvidence, city, requestedSubsegment: nullableText(item.subsegment) ?? undefined });
    if (!ai.ok || !ai.analysis) {
      await updateItem(supabase, text(item.id), { status: "failed", stage: "FAILED", error_code: "AI_ANALYSIS_FAILED", error_detail_safe: { provider_code: ai.errorCode, attempts: ai.attempts },
        completed_at: new Date().toISOString(), duration_ms: Date.now() - started }); return;
    }
    const score = scoreCommercialProspect({ analysis: ai.analysis, isPrivate: profile.is_private, profileFound: true,
      businessStatus: ai.analysis.signals.appearsClosed ? "closed" : "unknown", deterministicLocationConfidence: location.confidence });
    if (score.itemStatus === "hard_rejected") {
      await updateItem(supabase, text(item.id), { status: "rejected", stage: "REJECTED", duplicate_reason: score.hardGateCodes.join(",") || "ai_hard_reject",
        analysis_snapshot_safe: { ...ai.analysis, model: ai.model, prompt_version: COMMERCIAL_AI_PROMPT_VERSION, attempts: ai.attempts, usage: ai.usage },
        completed_at: new Date().toISOString(), duration_ms: Date.now() - started });
      return;
    }
    const audiences = await loadAudienceSuggestions(supabase, item, city, profile.canonical_username ?? candidate.instagramHandle);
    const payload = { provider: candidate.provider, provider_external_id: candidate.providerExternalId, source_url: candidate.profileUrl, source_query: candidate.sourceQuery,
      source_snapshot_safe: row(item.source_snapshot_safe), enrichment_snapshot_safe: { instagram: profile, website, location, booking }, enrichment_provenance_safe: { instagram_checked_at: profile.checked_at, website_pages: website.evidence },
      analysis_snapshot_safe: { ...ai.analysis, model: ai.model, prompt_version: COMMERCIAL_AI_PROMPT_VERSION, attempts: ai.attempts, usage: ai.usage }, score_breakdown_safe: score.breakdown,
      personalization_context_safe: { observed_evidence: ai.analysis.evidence, reasoning: ai.analysis.reasoning }, audience_context_safe: { source: "deterministically_filtered_discovery_peers", suggestions: audiences },
      business_name: businessName, country_code: "ZA", city, vertical: "Beauty/Aesthetics", subsegment: ai.analysis.subsegment, instagram_handle: profile.canonical_username,
      website: website.websiteUrl, email: website.email, phone: website.phone, address_safe: website.address, business_description: website.description ?? ai.analysis.reasoning,
      booking_url: booking.bookingUrl, booking_provider: booking.bookingProvider, booking_evidence: booking.evidence, business_status: ai.analysis.signals.appearsClosed ? "closed" : "unknown",
      qualification_status: score.qualificationStatus, item_status: score.itemStatus, lead_score: score.score, score_percent: score.scorePercent, priority: score.crmPriority,
      score_priority: score.scorePriority, recommended_channel: ai.analysis.recommendedChannel, recommended_angle: ai.analysis.recommendedAngle, scoring_model_version: score.scoringModelVersion,
      ai_confidence: ai.analysis.confidence, ai_model: ai.model, ai_prompt_version: COMMERCIAL_AI_PROMPT_VERSION, needs_manual_review: score.needsManualReview, hard_gate_codes: score.hardGateCodes,
      source_snapshot_hash: enrichmentHash, location_confidence: location.confidence, location_evidence: location.evidence, duration_ms: Date.now() - started };
    const { data: ingested, error: ingestError } = await supabase.rpc("ingest_commercial_discovery_candidate_v2", { p_item_id: text(item.id), p_payload: payload });
    if (ingestError) throw new Error("ingest_failed");
    void ingested;
  } catch (error) {
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
      const exhausted = num(claimed.discovery_attempt_count) >= num(claimed.discovery_max_attempts);
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
  for (const runId of touchedRuns) await supabase.rpc("refresh_commercial_discovery_run_v2", { p_run_id: runId });
  return { workerId, discoveredRuns: claimedRuns.length, claimedItems: items.length, concurrency, batchLimit };
}

export async function cancelCommercialDiscoveryRun(runId: string, actorUserId: string) {
  const { data, error } = await createSupabaseAdminClient().rpc("cancel_commercial_discovery_run_v2", { p_run_id: runId, p_actor_user_id: actorUserId });
  if (error) throw new Error("commercial_discovery_cancel_failed"); return row(data);
}
