import "server-only";

import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { lookupInstagramPublicProfile } from "@/lib/instagram-public-profile-lookup";
import { requireCommercialCrmAccess } from "./crm-access";
import { analyzeCommercialProspect } from "./discovery-ai";
import { COMMERCIAL_AI_PROMPT_VERSION, type CommercialDiscoveryReadModel, type CommercialDiscoveryRun, type CommercialDiscoveryTrigger } from "./discovery-contract";
import { discoverCommercialCandidates, type CommercialDiscoveryCandidate } from "./discovery-provider";
import { scoreCommercialProspect } from "./discovery-scoring";

type Row = Record<string, unknown>;
function row(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function nullableText(value: unknown) { const parsed = text(value).trim(); return parsed || null; }
function runFromRow(value: unknown): CommercialDiscoveryRun {
  const data = row(value); return { id: text(data.id), city: text(data.city) as CommercialDiscoveryRun["city"], subsegment: nullableText(data.subsegment) as CommercialDiscoveryRun["subsegment"], maxProspects: number(data.max_prospects), status: text(data.status) as CommercialDiscoveryRun["status"],
    discoveredCount: number(data.discovered_count), createdCount: number(data.created_count), duplicateCount: number(data.duplicate_count), enrichedCount: number(data.enriched_count), scoredCount: number(data.scored_count), qualifiedCount: number(data.qualified_count),
    p1Count: number(data.p1_count), p2Count: number(data.p2_count), p3Count: number(data.p3_count), hardRejectedCount: number(data.hard_rejected_count), errorCount: number(data.error_count),
    startedAt: nullableText(data.started_at), completedAt: nullableText(data.completed_at), createdAt: text(data.created_at) };
}

export async function createCommercialDiscoveryRun(trigger: CommercialDiscoveryTrigger) {
  const context = await requireCommercialCrmAccess();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("create_commercial_discovery_run_v1", { p_actor_user_id: context.userId, p_city: trigger.city, p_subsegment: trigger.subsegment ?? null, p_max_prospects: trigger.maxProspects, p_idempotency_key: trigger.idempotencyKey });
  if (error) throw new Error("commercial_discovery_create_failed");
  return row(data);
}

export async function getCommercialDiscoveryReadModel(): Promise<CommercialDiscoveryReadModel> {
  await requireCommercialCrmAccess();
  const { data, error } = await createSupabaseAdminClient().rpc("commercial_discovery_run_read_model_v1", { p_limit: 10 });
  if (error) throw new Error("commercial_discovery_read_failed");
  const root = row(data); const summary = row(root.summary);
  return { latest: (Array.isArray(root.latest) ? root.latest : []).map(runFromRow), summary: { lastRunAt: nullableText(summary.last_run_at), running: number(summary.running), discovered: number(summary.discovered), enriched: number(summary.enriched), scored: number(summary.scored), p1: number(summary.p1), p2: number(summary.p2) } };
}

function businessName(candidate: CommercialDiscoveryCandidate, profile: Awaited<ReturnType<typeof lookupInstagramPublicProfile>>) {
  return text(profile.metadata.profile_name).trim() || candidate.title?.replace(/\s*[|(@-].*$/u, "").trim() || candidate.instagramHandle;
}
function website(profile: Awaited<ReturnType<typeof lookupInstagramPublicProfile>>) { return profile.external_url ?? profile.bio_links?.[0]?.url ?? null; }
function sourceHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function logDiscovery(event: string, fields: Record<string, unknown>) {
  console.info("[commercial_discovery]", JSON.stringify({ event, ...fields }));
}
function observedContact(profile: Awaited<ReturnType<typeof lookupInstagramPublicProfile>>) {
  const biography = text(profile.metadata.biography);
  const email = biography.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]?.toLowerCase() ?? null;
  const phone = biography.match(/(?:\+27|0)[1-8][\d\s().-]{7,14}\d/)?.[0]?.replace(/\s+/g, " ").trim() ?? null;
  return { email, phone };
}

async function recordFailedItem(runId: string, candidate: CommercialDiscoveryCandidate, errorCode: string) {
  const supabase = createSupabaseAdminClient();
  await supabase.from("commercial_discovery_items").upsert({ run_id: runId, provider: candidate.provider, provider_external_id: candidate.providerExternalId, source_url: candidate.profileUrl,
    source_query: candidate.sourceQuery, status: "failed", error_code: errorCode, idempotency_key: `${runId}:${candidate.providerExternalId}`, source_snapshot_safe: { profile_url: candidate.profileUrl, title: candidate.title, snippet: candidate.snippet } }, { onConflict: "run_id,idempotency_key", ignoreDuplicates: true });
}

async function recordPreflightExclusion(runId: string, candidate: CommercialDiscoveryCandidate, result: Row, sourceSnapshot: Row, enrichmentSnapshot: Row) {
  await createSupabaseAdminClient().from("commercial_discovery_items").upsert({ run_id: runId, provider: candidate.provider, provider_external_id: candidate.providerExternalId,
    source_url: candidate.profileUrl, source_query: candidate.sourceQuery, status: text(result.status), duplicate_reason: nullableText(result.reason), business_id: nullableText(result.business_id),
    lead_id: nullableText(result.lead_id), idempotency_key: `${runId}:${candidate.providerExternalId}`, source_snapshot_safe: sourceSnapshot, enrichment_snapshot_safe: enrichmentSnapshot },
  { onConflict: "run_id,idempotency_key", ignoreDuplicates: true });
}

async function recordHardRejectedItem(runId: string, candidate: CommercialDiscoveryCandidate, reason: string, sourceSnapshot: Row, enrichmentSnapshot: Row) {
  await createSupabaseAdminClient().from("commercial_discovery_items").upsert({ run_id: runId, provider: candidate.provider, provider_external_id: candidate.providerExternalId,
    source_url: candidate.profileUrl, source_query: candidate.sourceQuery, status: "hard_rejected", duplicate_reason: reason,
    idempotency_key: `${runId}:${candidate.providerExternalId}`, source_snapshot_safe: sourceSnapshot, enrichment_snapshot_safe: enrichmentSnapshot },
  { onConflict: "run_id,idempotency_key", ignoreDuplicates: true });
}

export async function executeCommercialDiscoveryRun(runId: string) {
  const supabase = createSupabaseAdminClient();
  const { data: claimed, error: claimError } = await supabase.rpc("claim_commercial_discovery_run_v1", { p_run_id: runId });
  if (claimError) return;
  const run = row(claimed); if (run.status !== "running") return;
  const counts = { discovered: 0, created: 0, duplicates: 0, enriched: 0, scored: 0, qualified: 0, p1: 0, p2: 0, p3: 0, hard_rejected: 0, errors: 0 };
  const errors: Record<string, number> = {}; let queries: string[] = [];
  const fail = (code: string) => { counts.errors += 1; errors[code] = (errors[code] ?? 0) + 1; };
  try {
    logDiscovery("run_started", { runId, city: run.city, maxProspects: run.max_prospects, provider: run.provider });
    const discovery = await discoverCommercialCandidates({ city: run.city as CommercialDiscoveryTrigger["city"], subsegment: nullableText(run.subsegment) as CommercialDiscoveryTrigger["subsegment"], maxCandidates: number(run.max_prospects) });
    queries = discovery.queries; counts.discovered = discovery.candidates.length;
    logDiscovery("provider_response_summary", { runId, ...discovery.diagnostic });
    if (discovery.candidates.length === 0) fail(`discovery_${text(discovery.diagnostic.stoppedReason) || "no_candidates"}`);
    const peerAudiences = discovery.candidates.slice(0, 8).map((candidate) => ({
      instagram_handle: candidate.instagramHandle,
      name: candidate.title,
      category: nullableText(run.subsegment) ?? "Beauty/Aesthetics",
      reason: `Real public profile found by the same-city ${nullableText(run.subsegment) ?? "Beauty/Aesthetics"} search.`,
      profile_url: candidate.profileUrl,
      source: "searchapi_google_serp",
      source_query: candidate.sourceQuery,
      confidence: candidate.extractionMode === "strict" ? "high" : "medium",
    }));
    let processed = 0;
    for (const candidate of discovery.candidates) {
      if (processed >= number(run.max_prospects)) break;
      processed += 1;
      const profile = await lookupInstagramPublicProfile(candidate.instagramHandle);
      if (!profile.ok || profile.status !== "found") { fail(`profile_${profile.status}`); await recordFailedItem(runId, candidate, `profile_${profile.status}`); continue; }
      counts.enriched += 1;
      const candidateKey = sourceHash(candidate.instagramHandle).slice(0, 12);
      logDiscovery("enrichment_result", { runId, candidateKey, status: profile.status, profilePublic: profile.is_private === false });
      const evidence = { discovery: { title: candidate.title, snippet: candidate.snippet, sourceQuery: candidate.sourceQuery, profileUrl: candidate.profileUrl }, instagram: {
        username: profile.canonical_username, isPrivate: profile.is_private, isVerified: profile.is_verified, isBusiness: profile.is_business, followers: profile.followers_count, following: profile.following_count,
        posts: profile.posts_count, category: profile.official_category, externalUrl: profile.external_url, bioLinks: profile.bio_links, recentCaptions: profile.recent_post_captions,
        profileName: profile.metadata.profile_name, biography: profile.metadata.biography } };
      if (profile.is_private === true) { counts.hard_rejected += 1; await recordHardRejectedItem(runId, candidate, "instagram_private", evidence.discovery, evidence.instagram); logDiscovery("qualification_decision", { runId, candidateKey, decision: "hard_rejected", reason: "instagram_private" }); continue; }
      const observedBusinessName = businessName(candidate, profile); const observedWebsite = website(profile);
      const { data: preflightData, error: preflightError } = await supabase.rpc("preflight_commercial_discovery_candidate_v1", { p_run_id: runId, p_provider: candidate.provider,
        p_external_id: candidate.providerExternalId, p_instagram_handle: profile.canonical_username, p_website: observedWebsite, p_business_name: observedBusinessName });
      if (preflightError) { fail("preflight_failed"); await recordFailedItem(runId, candidate, "preflight_failed"); continue; }
      const preflight = row(preflightData);
      if (text(preflight.status) !== "clear") { counts.duplicates += 1; await recordPreflightExclusion(runId, candidate, preflight, evidence.discovery, evidence.instagram); logDiscovery("duplicate_decision", { runId, candidateKey, status: preflight.status, reason: preflight.reason }); continue; }
      let ai = await analyzeCommercialProspect({ evidence, city: text(run.city), requestedSubsegment: nullableText(run.subsegment) ?? undefined });
      if (!ai.ok && ["provider_rate_limited", "provider_temporary_failure", "provider_timeout", "provider_unavailable"].includes(ai.errorCode)) ai = await analyzeCommercialProspect({ evidence, city: text(run.city), requestedSubsegment: nullableText(run.subsegment) ?? undefined });
      if (!ai.ok || !ai.analysis) { fail(`ai_${ai.errorCode}`); await recordFailedItem(runId, candidate, `ai_${ai.errorCode}`); continue; }
      counts.scored += 1;
      const score = scoreCommercialProspect({ analysis: ai.analysis, isPrivate: profile.is_private, profileFound: true, businessStatus: ai.analysis.signals.appearsClosed ? "closed" : "unknown" });
      logDiscovery("ai_score", { runId, candidateKey, score: score.score, priority: score.scorePriority, confidence: ai.analysis.confidence, qualified: score.qualificationStatus === "qualified" });
      const snapshotHash = sourceHash(evidence);
      const contact = observedContact(profile);
      const payload = { provider: candidate.provider, provider_external_id: candidate.providerExternalId, source_url: candidate.profileUrl, source_query: candidate.sourceQuery,
        source_snapshot_safe: evidence.discovery, enrichment_snapshot_safe: evidence.instagram, enrichment_provenance_safe: { provider: "searchapi", checked_at: profile.checked_at, source_url: candidate.profileUrl },
        analysis_snapshot_safe: { ...ai.analysis, model: ai.model, prompt_version: COMMERCIAL_AI_PROMPT_VERSION, usage: ai.usage }, score_breakdown_safe: score.breakdown,
        personalization_context_safe: { observed_evidence: ai.analysis.evidence, reasoning: ai.analysis.reasoning }, audience_context_safe: { source: "verified_discovery_peers", suggestions: peerAudiences.filter((peer) => peer.instagram_handle !== candidate.instagramHandle).slice(0, 5) },
        business_name: observedBusinessName, country_code: "ZA", city: run.city, vertical: "Beauty/Aesthetics", subsegment: ai.analysis.subsegment,
        instagram_handle: profile.canonical_username, website: observedWebsite, email: contact.email, phone: contact.phone, business_description: ai.analysis.reasoning, booking_url: profile.bio_links?.find((link) => /book|appoint/i.test(`${link.title} ${link.url}`))?.url ?? null,
        business_status: ai.analysis.signals.appearsClosed ? "closed" : "unknown", qualification_status: score.qualificationStatus, item_status: score.itemStatus, lead_score: score.score, score_percent: score.scorePercent,
        priority: score.crmPriority, score_priority: score.scorePriority, recommended_channel: ai.analysis.recommendedChannel, recommended_angle: ai.analysis.recommendedAngle,
        scoring_model_version: score.scoringModelVersion, ai_confidence: ai.analysis.confidence, ai_model: ai.model, ai_prompt_version: COMMERCIAL_AI_PROMPT_VERSION, needs_manual_review: score.needsManualReview,
        hard_gate_codes: score.hardGateCodes, source_snapshot_hash: snapshotHash };
      const { data: ingested, error } = await supabase.rpc("ingest_commercial_discovery_candidate_v1", { p_run_id: runId, p_payload: payload, p_idempotency_key: `${runId}:${candidate.providerExternalId}` });
      if (error) { fail("ingest_failed"); await recordFailedItem(runId, candidate, "ingest_failed"); continue; }
      const status = text(row(ingested).status);
      if (["duplicate", "possible_duplicate", "excluded_client"].includes(status)) counts.duplicates += 1;
      else { counts.created += 1; if (score.itemStatus === "hard_rejected") counts.hard_rejected += 1; if (score.qualificationStatus === "qualified") counts.qualified += 1; counts[score.scorePriority.toLowerCase() as "p1" | "p2" | "p3"] += 1; }
    }
    const handled = counts.created + counts.duplicates + counts.hard_rejected;
    const status = counts.errors === 0 ? "completed" : handled > 0 ? "partial" : "failed";
    await supabase.rpc("finalize_commercial_discovery_run_v1", { p_run_id: runId, p_status: status, p_counts: counts, p_queries: queries, p_error_summary: { by_code: errors, safe: true } });
    logDiscovery("run_completed", { runId, status, counts });
  } catch { fail("run_unavailable"); await supabase.rpc("finalize_commercial_discovery_run_v1", { p_run_id: runId, p_status: "failed", p_counts: counts, p_queries: queries, p_error_summary: { by_code: errors, safe: true } }); logDiscovery("run_completed", { runId, status: "failed", counts }); }
}
