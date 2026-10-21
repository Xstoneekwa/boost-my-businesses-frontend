import { createSupabaseClient } from "@/lib/supabase";
import { getIncidentsOverview } from "./incidents-data";
import {
  assessRisk,
  includeInternalOnly, realCoverage, evaluationIdentity, assertHandoffFresh,
  buildSignalClusters,
  correlateFleet,
  prepareFleetHandoff,
  recommend,
  validateExternalSignal,
  type ExternalSignal,
  type FleetIncident,
} from "./compass-v2";

type SupabaseLike = ReturnType<typeof createSupabaseClient>;
type Row = Record<string, unknown>;

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function sourceCheckRow(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SOURCE_CHECK");
  const row = value as Row;
  const source = asString(row.source) || asString(row.source_id);
  if (!source || !asString(row.checked_at)) throw new Error("INVALID_SOURCE_CHECK");
  if (!["WORKING", "LIMITED", "BLOCKED", "UNKNOWN"].includes(asString(row.access_status))) throw new Error("INVALID_SOURCE_ACCESS_STATUS");
  if (!["FULL", "PARTIAL", "DEGRADED"].includes(asString(row.coverage_status))) throw new Error("INVALID_SOURCE_COVERAGE");
  if (!["HIGH", "MEDIUM", "LOW", "CONTEXTUAL"].includes(asString(row.source_credibility))) throw new Error("INVALID_SOURCE_CREDIBILITY");
  return {
    id: asString(row.id) || `${source}:${asString(row.checked_at)}`, source, checked_at: row.checked_at,
    access_status: row.access_status, coverage_status: row.coverage_status,
    source_credibility: row.source_credibility, http_status: row.http_status ?? null,
    next_allowed_at: row.next_allowed_at ?? null, failure_reason: row.failure_reason ?? row.reason ?? null,
    etag_hash: row.etag_hash ?? null, observed: row.observed === true, collection_success: row.collection_success === true, last_success_at: row.last_success_at ?? null,
  };
}

export function externalSignalRow(signal: ExternalSignal) {
  return {
    origin_group_id: signal.origin_group_id, canonical_url: signal.canonical_url, native_id: signal.native_id, device_id: signal.device_id ?? null, run_type: signal.run_type ?? null, id: signal.id, source: signal.source, source_native_id: signal.source_native_id, url: signal.url,
    retrieved_at: signal.retrieved_at, published_at: signal.published_at,
    publication_date_confidence: signal.publication_date_confidence, first_seen: signal.first_seen,
    last_seen: signal.last_seen, platform: signal.platform, signal_type: signal.signal_type,
    action_family: signal.action_family, symptom_family: signal.symptom_family, geography: signal.geography,
    platform_version: signal.platform_version, source_credibility: signal.source_credibility,
    access_status: signal.access_status, freshness: signal.freshness, volume: signal.volume,
    velocity: signal.velocity, official_confirmation: signal.official_confirmation,
    content_hash: signal.content_hash, dedupe_key: signal.dedupe_key, cluster_id: signal.cluster_id,
    exclusion_reason: signal.exclusion_reason, raw_reference: signal.raw_reference,
    author_key: signal.author_key ?? null, source_family: signal.source_family ?? signal.source,
    summary: signal.summary ?? "",
  };
}

export async function persistCompassCollection(input: {
  signals: unknown[];
  sourceChecks?: unknown[];
}, client: SupabaseLike = createSupabaseClient()) {
  if (!Array.isArray(input.signals) || !Array.isArray(input.sourceChecks ?? [])) throw new Error("INVALID_COLLECTION_BATCH");
  const signals = input.signals.map(validateExternalSignal);
  const sourceChecks = (input.sourceChecks ?? []).map(sourceCheckRow);
  if (signals.length > 500 || sourceChecks.length > 50) throw new Error("COLLECTION_BATCH_TOO_LARGE");
  if (signals.some((signal) => signal.raw_reference.length > 160 || (signal.summary?.length ?? 0) > 500)) throw new Error("UNBOUNDED_SIGNAL_CONTENT");
  const {error} = await client.rpc("ingest_compass_collection_v1", {p_signals: signals.map(externalSignalRow), p_checks: sourceChecks});
  if(error) throw new Error(error.message);
  return { signalsAccepted: signals.length, sourceChecksAccepted: sourceChecks.length, rawPayloadStored: false };
}

function toFleetIncident(row: Row): FleetIncident {
  const evidence = row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence) ? row.evidence as Row : {};
  return {
    id: asString(row.id), incident_type: asString(row.incidentType),
    reason_code: asString(evidence.reason_code) || asString(row.reason),
    first_causal_reason: asString(evidence.first_causal_reason), trigger_reason: asString(evidence.trigger_reason),
    restriction_evidence: asString(evidence.restriction_evidence), account_id: asString(row.accountId) || null,
    run_id: asString(row.runId) || null, device_id: asString(row.deviceId) || null,
    instagram_version: asString(evidence.instagram_version) || null,
    runtime_version: asString(evidence.runtime_version) || asString(row.executionWorkerId) || null,
    package_name: asString(row.packageName) || null, run_type: asString(evidence.run_type) || null,
    occurred_at: asString(row.lastSeenAt) || asString(row.firstSeenAt) || asString(row.createdAt),
    occurrence_count: Number(row.occurrenceCount) || 1,
    severity: (["info", "warning", "error", "critical"].includes(asString(row.severity)) ? asString(row.severity) : "warning") as FleetIncident["severity"],
  };
}

function deriveExposedAccounts(correlation: ReturnType<typeof correlateFleet>, assignments: Row[], appInstances: Row[]) {
  const devices = new Set(correlation.matched_incidents.map((row) => row.device_id).filter(Boolean));
  const packages = new Set(correlation.matched_incidents.map((row) => row.package_name).filter(Boolean));
  const appPackage = new Map(appInstances.map((row) => [asString(row.id), asString(row.package_name)]));
  const cohort = assignments.filter((row) => devices.has(asString(row.device_id)) || packages.has(appPackage.get(asString(row.app_instance_id)) ?? ""));
  const source = cohort.length ? cohort : assignments;
  return [...new Set(source.map((row) => asString(row.account_id)).filter(Boolean))];
}

export async function runCompassIntelligence(input: { now?: string } = {}, client: SupabaseLike = createSupabaseClient(), loadIncidents = getIncidentsOverview) {
  const now = input.now ?? new Date().toISOString();
  const since = new Date(Date.parse(now) - 30 * 86400_000).toISOString();
  const [{ data: signalRows, error: signalError }, { data: checks, error: checkError }, incidentsOverview,
    { data: assignments, error: assignmentError }, { data: appInstances, error: appInstanceError }] = await Promise.all([
    client.from("compass_external_signals").select("*").gte("published_at", since).order("published_at", { ascending: false }).limit(1000),
    client.from("compass_external_source_checks").select("*").order("checked_at", { ascending: false }).limit(100),
    loadIncidents({ status: "open,acknowledged", since, limit: 250 }),
    client.from("account_assignments").select("account_id,device_id,app_instance_id,status").in("status", ["pending", "reserved", "active"]).limit(2000),
    client.from("phone_app_instances").select("id,device_id,package_name,status").limit(1000),
  ]);
  if (signalError) throw new Error(signalError.message);
  if (checkError) throw new Error(checkError.message);
  if (assignmentError) throw new Error(assignmentError.message);
  if (appInstanceError) throw new Error(appInstanceError.message);
  const signals = ((signalRows ?? []) as unknown[]).map(validateExternalSignal);
  const recentChecks = (checks ?? []) as Row[];
  const truncated=signals.length>=1000 || incidentsOverview.incidents.length>=250 || (assignments?.length ?? 0)>=2000 || (appInstances?.length ?? 0)>=1000 || recentChecks.length>=100;
  const {coverageDegraded,coverageTruncated}=realCoverage(recentChecks,now,truncated);
  const incidents = (incidentsOverview.incidents as unknown as Row[]).map(toFleetIncident).filter((row) => row.occurred_at);
  const clusters = includeInternalOnly(buildSignalClusters(signals, { now, coverageDegraded }),incidents,now);
  const results = [];
  for (const cluster of clusters) {
    const preliminary = correlateFleet(cluster, incidents, []);
    const exposedAccounts = deriveExposedAccounts(preliminary, (assignments ?? []) as Row[], (appInstances ?? []) as Row[]);
    const correlation = correlateFleet(cluster, incidents, exposedAccounts);
    const risk = assessRisk(cluster, correlation);
    const recommendation = recommend(cluster, correlation, risk, now);
    const identity=evaluationIdentity(cluster,correlation,risk,recommendation);
    results.push({ cluster, correlation, risk, recommendation, recommendationId: identity+":recommendation", identity });
  }
  // Bounded batch RPC, never one network round trip per cluster.
  const persistedResults=[];
  for(let offset=0;offset<results.length;offset+=50) {
    const batch=results.slice(offset,offset+50).map(result=>({
      cluster:{...result.cluster,signals:undefined,history_id:result.identity+":history",observed_at:now,current_evaluation:result},
      signal_ids:result.cluster.signals.map(s=>s.id),
      correlation:{id:result.identity+":correlation",...result.correlation,matched_incident_ids:result.correlation.matched_incidents.map(i=>i.id)},
      risk:{id:result.identity+":risk",...result.risk},recommendation:{id:result.recommendationId,...result.recommendation},
    }));
    const {data,error}=await client.rpc("persist_compass_assessment_batch_v1",{p_assessments:batch});
    if(error) throw new Error(error.message);
    if(!Array.isArray(data) || data.some(x=>!x?.ok)) throw new Error("COMPASS_ASSESSMENT_PERSISTENCE_FAILED");
    persistedResults.push(...data.map(x=>x.current_evaluation));
  }
  return { generatedAt: now, coverageStatus: coverageDegraded ? "COVERAGE_DEGRADED" : "PARTIAL", coverageTruncated, results: persistedResults as typeof results };
}

export async function persistPreparedHandoff(result: Awaited<ReturnType<typeof runCompassIntelligence>>["results"][number], now: string, client: SupabaseLike = createSupabaseClient()) {
  const handoff = prepareFleetHandoff(result.cluster, result.correlation, result.risk, result.recommendation, now);
  const { error } = await client.from("compass_fleet_handoffs").insert({
    id: handoff.id, idempotency_key: handoff.idempotency_key, recommendation_id: result.recommendationId,
    created_at: handoff.created_at, expires_at: handoff.expires_at, payload: handoff,
    status: "PREPARED", actions_executable: false,
  });
  if (error?.code === "23505") {
    const { data: existing, error: existingError } = await client.from("compass_fleet_handoffs")
      .select("payload").eq("idempotency_key", handoff.idempotency_key).single();
    if (existingError || !existing?.payload) throw new Error(existingError?.message ?? "HANDOFF_IDEMPOTENCY_READ_FAILED");
    return assertHandoffFresh(existing.payload as unknown as typeof handoff, now);
  }
  if (error) throw new Error(error.message);
  return handoff;
}

export async function getCompassIntelligenceOverview(client: SupabaseLike = createSupabaseClient()) {
  const [{ data: clusters, error: clusterError }, { data: risks, error: riskError }, { data: recommendations, error: recommendationError }, { data: sourceChecks, error: sourceCheckError }] = await Promise.all([
    client.from("compass_signal_clusters").select("*").order("last_seen", { ascending: false }).limit(100),
    client.from("compass_risk_assessments").select("*").order("assessed_at", { ascending: false }).limit(100),
    client.from("compass_recommendations").select("*").order("created_at", { ascending: false }).limit(100),
    client.from("compass_external_source_checks").select("source,checked_at,access_status,coverage_status,source_credibility,http_status,next_allowed_at,failure_reason,last_success_at,observed,collection_success").order("checked_at", { ascending: false }).limit(100),
  ]);
  for (const error of [clusterError, riskError, recommendationError, sourceCheckError]) if (error) throw new Error(error.message);
  return { generatedAt: new Date().toISOString(), clusters: clusters ?? [], risks: risks ?? [], recommendations: recommendations ?? [], sourceChecks: sourceChecks ?? [], actionsExecutable: false };
}

export async function loadCurrentHandoffContext(clusterId:string,now:string,client:SupabaseLike=createSupabaseClient()) {
  const {data,error}=await client.from("compass_signal_clusters").select("current_evaluation,updated_at").eq("id",clusterId).single();
  if(error) throw new Error(error.message);
  if(!data?.current_evaluation || Date.parse(now)-Date.parse(data.updated_at)>3600_000 || Date.parse(data.updated_at)>Date.parse(now)) throw new Error("ASSESSMENT_STALE_RECHECK_REQUIRED");
  return data.current_evaluation as Awaited<ReturnType<typeof runCompassIntelligence>>["results"][number];
}
