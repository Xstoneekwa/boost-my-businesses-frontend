import { createHash, randomUUID } from "node:crypto";

export const COMPASS_V2_SCHEMA = "COMPASS_SIGNAL_INTELLIGENCE_V2";

export type ExternalCredibility = "HIGH" | "MEDIUM" | "LOW" | "CONTEXTUAL";
export type InternalEvidenceStrength = "CONFIRMED" | "STRONG" | "WEAK" | "NONE";
export type AccessStatus = "WORKING" | "LIMITED" | "BLOCKED" | "UNKNOWN";
export type TrendState = "ISOLATED" | "EMERGING" | "ACCELERATING" | "STABLE" | "DECLINING" | "RESOLVED";
export type RiskLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
export type CompassAction = "CONTINUE" | "MONITOR" | "REDUCE_ACTIVITY" | "ISOLATE_ACCOUNTS" | "PAUSE_SELECTED" | "PAUSE_SCOPE" | "PREPARE_RECOVERY" | "NO_ACTION" | "NEEDS_MORE_EVIDENCE";

export type ExternalSignal = {
  id: string;
  source: string;
  source_native_id: string | null;
  native_id?: string | null;
  canonical_url?: string;
  origin_group_id?: string;
  device_id?: string | null;
  run_type?: string | null;
  url: string;
  retrieved_at: string;
  published_at: string | null;
  publication_date_confidence: "HIGH" | "MEDIUM" | "LOW";
  first_seen: string;
  last_seen: string;
  platform: "INSTAGRAM";
  signal_type: string;
  action_family: string;
  symptom_family: string;
  geography: string | null;
  platform_version: string | null;
  source_credibility: ExternalCredibility;
  access_status: AccessStatus;
  freshness: "CURRENT" | "STALE";
  volume: number;
  velocity: number;
  official_confirmation: boolean;
  content_hash: string;
  dedupe_key: string;
  cluster_id: string | null;
  exclusion_reason: string[];
  raw_reference: string;
  author_key?: string | null;
  source_family?: string;
  summary?: string;
};

export type FleetIncident = {
  id: string;
  incident_type: string;
  reason_code?: string | null;
  first_causal_reason?: string | null;
  trigger_reason?: string | null;
  restriction_evidence?: string | null;
  account_id?: string | null;
  run_id?: string | null;
  device_id?: string | null;
  instagram_version?: string | null;
  runtime_version?: string | null;
  package_name?: string | null;
  run_type?: string | null;
  occurred_at: string;
  occurrence_count?: number;
  severity?: "info" | "warning" | "error" | "critical";
};

export type SignalCluster = {
  id: string;
  platform: "INSTAGRAM";
  action_family: string;
  symptom_family: string;
  signals: ExternalSignal[];
  unique_signal_count: number;
  unique_source_family_count: number;
  first_seen: string;
  last_seen: string;
  velocity: number;
  freshness: "CURRENT" | "STALE";
  coverage_status: "FULL" | "PARTIAL" | "DEGRADED";
  external_confidence: number;
  state: TrendState;
  internal_only?: boolean;
  internal_incident_ids?: string[];
  evaluated_at?: string;
};

export type Correlation = {
  cluster_id: string;
  matched_incidents: FleetIncident[];
  internal_evidence_strength: InternalEvidenceStrength;
  confirmed_platform_rate_limit: boolean;
  affected_accounts: string[];
  exposed_accounts: string[];
  score: number;
  factors: Record<string, number>;
  compatibility?: Record<string, Record<string, string>>;
};

export type RiskAssessment = {
  raw_score: number;
  final_score: number;
  caps_applied: { reason: string; ceiling: number }[];
  score: number;
  level: RiskLevel;
  risk_factors: Record<string, number>;
  confidence: number;
  coverage_status: SignalCluster["coverage_status"];
};

export type Recommendation = {
  action: CompassAction;
  why: string[];
  affected_scope: { account_ids: string[]; cluster_id: string };
  confidence: number;
  preconditions: string[];
  recheck_at: string;
  recovery_checks: string[];
};

export type FleetHandoff = {
  schema: "COMPASS_FLEET_HANDOFF_V1";
  id: string;
  created_at: string;
  expires_at: string;
  idempotency_key: string;
  recommended_action: CompassAction;
  recommended_scope: { account_ids: string[]; cluster_id: string };
  affected_accounts: string[];
  exposed_accounts: string[];
  risk: RiskAssessment;
  confidence: number;
  evidence_summary: { external_signal_ids: string[]; internal_incident_ids: string[] };
  operator_checks: string[];
  actions_executable: false;
  open_in_fleet: true;
  fleet_flow: ["PREVIEW", "CONFIRMATION", "APPLY"];
};

const credScore: Record<ExternalCredibility, number> = { HIGH: 1, MEDIUM: 0.7, LOW: 0.35, CONTEXTUAL: 0.45 };
const momentumScore: Record<TrendState, number> = { ISOLATED: 2, EMERGING: 8, ACCELERATING: 20, STABLE: 10, DECLINING: 4, RESOLVED: 0 };
const evidenceScore: Record<InternalEvidenceStrength, number> = { CONFIRMED: 25, STRONG: 18, WEAK: 7, NONE: 0 };
const severityScore = { info: 1, warning: 4, error: 7, critical: 10 } as const;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function time(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed)) throw new Error("INVALID_TIMESTAMP");
  return parsed;
}

function words(value: string) {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function similarity(a: string, b: string) {
  const left = words(a);
  const right = words(b);
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / union.size;
}

// One bounded contract shared by ingestion, replays and assessment.
export const EPISODE_MS = 24 * 3600_000;
export function canonicalUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("INVALID_PUBLIC_URL");
  if (["reddit.com", "old.reddit.com", "m.reddit.com"].includes(url.hostname)) url.hostname = "www.reddit.com";
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ["ref", "share", "context", "sort", "fbclid", "gclid"].includes(key)) url.searchParams.delete(key);
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  url.searchParams.sort();
  return url.toString().replace(/\/$/, "");
}
export function provenanceFamily(url: string) {
  const host = new URL(url).hostname;
  if (host === "reddit.com" || host.endsWith(".reddit.com")) return "reddit";
  if (["metastatus.com", "www.metastatus.com", "help.instagram.com", "about.instagram.com", "developers.facebook.com"].includes(host)) return "meta";
  if (host === "downdetector.com" || host.endsWith(".downdetector.com")) return "downdetector";
  return host.split(".").slice(-2).join(".");
}
const actions: Record<string, string> = {
  FOLLOW: "FOLLOW", FOLLOW_BLOCKED: "FOLLOW", FOLLOW_LIMIT_LOW: "FOLLOW", FOLLOW_REVERT: "FOLLOW_REVERT", FOLLOW_REVERT_PATTERN: "FOLLOW_REVERT",
  PREVENTIVE_FOLLOW_RESTRICTION: "FOLLOW_REVERT", UNFOLLOW: "UNFOLLOW", UNFOLLOW_BLOCKED: "UNFOLLOW", UNFOLLOW_LIMIT_LOW: "UNFOLLOW",
  DM: "DM", DM_RESTRICTED: "DM", LOGIN: "LOGIN", LOGIN_ISSUE: "LOGIN", SESSION: "SESSION", SESSION_EXPIRED: "SESSION",
  RATE_LIMIT: "RATE_LIMIT", GENERIC_RATE_LIMIT: "RATE_LIMIT", INSTAGRAM_ACTION_RATE_LIMIT: "RATE_LIMIT",
  LIKE: "LIKE", LIKE_RESTRICTED: "LIKE", COMMENT: "COMMENT", COMMENT_RESTRICTED: "COMMENT",
  TRY_AGAIN_LATER: "RATE_LIMIT", ACTION_BLOCKED: "RATE_LIMIT",
};
export function canonicalAction(value: string) { return actions[value.toUpperCase()] ?? "UNKNOWN"; }
export function canonicalSymptom(value: string) {
  const key = value.toUpperCase();
  if (key === "ACTION_RESTRICTION") return key;
  if (["TRY_AGAIN_LATER", "FOLLOW_BLOCKED", "UNFOLLOW_BLOCKED", "ACTION_BLOCKED", "GENERIC_RATE_LIMIT", "INSTAGRAM_ACTION_RATE_LIMIT", "DM_RESTRICTED", "LIKE_RESTRICTED", "COMMENT_RESTRICTED", "FOLLOW_LIMIT_LOW", "UNFOLLOW_LIMIT_LOW"].includes(key)) return "ACTION_RESTRICTION";
  if (["PREVENTIVE_FOLLOW_RESTRICTION", "FOLLOW_REVERT", "FOLLOW_REVERT_PATTERN"].includes(key)) return "FOLLOW_REVERT";
  return ["LOGIN_ISSUE", "SESSION_EXPIRED"].includes(key) ? key : "UNKNOWN";
}
export function validateExternalSignal(value: unknown): ExternalSignal {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_EXTERNAL_SIGNAL");
  const row = value as Record<string, unknown>;
  for (const field of ["id", "source", "url", "retrieved_at", "first_seen", "last_seen", "platform", "signal_type", "action_family", "symptom_family", "source_credibility", "access_status", "freshness", "content_hash", "dedupe_key", "raw_reference"]) {
    if (typeof row[field] !== "string" || !row[field] || String(row[field]).length > 4096) throw new Error(`MISSING_EXTERNAL_SIGNAL_FIELD:${field}`);
  }
  if (row.platform !== "INSTAGRAM") throw new Error("UNSUPPORTED_PLATFORM");
  const url = canonicalUrl(String(row.url));
  const family = provenanceFamily(url);
  if (row.source !== family || (row.source_family && row.source_family !== family)) throw new Error("SOURCE_PROVENANCE_MISMATCH");
  if (!["HIGH", "MEDIUM", "LOW", "CONTEXTUAL"].includes(String(row.source_credibility))) throw new Error("INVALID_EXTERNAL_CREDIBILITY");
  if (!["WORKING", "LIMITED", "BLOCKED", "UNKNOWN"].includes(String(row.access_status))) throw new Error("INVALID_ACCESS_STATUS");
  if (typeof row.official_confirmation !== "boolean") throw new Error("INVALID_OFFICIAL_CONFIRMATION");
  if (row.official_confirmation && (family !== "meta" || row.source_credibility !== "HIGH" || row.signal_type !== "OFFICIAL_STATUS")) throw new Error("INVALID_OFFICIAL_CONFIRMATION");
  if (row.source_credibility === "HIGH" && !row.official_confirmation) throw new Error("HIGH_EXTERNAL_CREDIBILITY_REQUIRES_OFFICIAL_META_CONFIRMATION");
  if (family === "reddit" && !["MEDIUM", "LOW"].includes(String(row.source_credibility))) throw new Error("INVALID_REDDIT_CREDIBILITY");
  if (family === "downdetector" && row.source_credibility !== "CONTEXTUAL") throw new Error("INVALID_VOLUME_SIGNAL_CREDIBILITY");
  const retrieved = time(String(row.retrieved_at));
  for (const field of ["first_seen", "last_seen"]) time(String(row[field]));
  if (row.published_at != null && (typeof row.published_at !== "string" || time(row.published_at) > retrieved)) throw new Error("INVALID_EVENT_TIME");
  if (!["HIGH", "MEDIUM", "LOW"].includes(String(row.publication_date_confidence))) throw new Error("INVALID_PUBLICATION_CONFIDENCE");
  if (!Number.isInteger(row.volume) || Number(row.volume) < 0 || !Number.isFinite(row.velocity)) throw new Error("INVALID_SIGNAL_METRIC");
  if (row.access_status === "BLOCKED" && Number(row.volume) > 0) throw new Error("BLOCKED_SOURCE_CANNOT_REPORT_SIGNAL");
  if (!Array.isArray(row.exclusion_reason) || row.exclusion_reason.some(x => typeof x !== "string")) throw new Error("INVALID_EXCLUSION_REASONS");
  for (const field of ["source_native_id", "native_id", "origin_group_id", "platform_version", "device_id", "run_type", "author_key", "summary"]) if (row[field] != null && (typeof row[field] !== "string" || String(row[field]).length > 500)) throw new Error(`INVALID_SIGNAL_FIELD:${field}`);
  return { ...row, url, canonical_url: url, native_id: row.source_native_id ?? row.native_id ?? null,
    source_family: family, origin_group_id: row.origin_group_id || hash(url),
    action_family: canonicalAction(String(row.action_family)), symptom_family: canonicalSymptom(String(row.symptom_family)),
  } as ExternalSignal;
}

export function deduplicateSignals(input: ExternalSignal[]) {
  // Hash union for provenance/exact copies; bounded local fuzzy candidates avoid n².
  const rows = input.map(validateExternalSignal).sort((a,b) => a.id.localeCompare(b.id));
  const parent = rows.map((_,i)=>i);
  const find = (n: number): number => parent[n] === n ? n : (parent[n] = find(parent[n]));
  const exact = new Map<string, number>();
  const buckets = new Map<string, number[]>();
  rows.forEach((row,i) => {
    const keys = [`id:${row.id}`, `url:${row.canonical_url}`, `hash:${row.content_hash}`, `dedupe:${row.dedupe_key}`, `origin:${row.origin_group_id}`];
    if (row.native_id) keys.push(`native:${row.source_family}:${row.native_id}`);
    for (const key of keys) { const prior=exact.get(key); if(prior !== undefined) parent[find(i)]=find(prior); else exact.set(key,i); }
    const event = row.published_at ? time(row.published_at) : time(row.first_seen);
    const day = Math.floor(event / EPISODE_MS);
    for (const d of [day-1,day,day+1]) {
      const key=`${row.platform}:${row.action_family}:${row.symptom_family}:${d}`;
      for (const j of (buckets.get(key) ?? []).slice(-64)) {
        const other=rows[j];
        if (Math.abs(event-time(other.published_at ?? other.first_seen)) <= EPISODE_MS &&
          ((row.author_key && row.author_key === other.author_key) || similarity(row.summary ?? "",other.summary ?? "") >= .86)) parent[find(i)]=find(j);
      }
    }
    const key=`${row.platform}:${row.action_family}:${row.symptom_family}:${day}`;
    buckets.set(key,[...(buckets.get(key) ?? []).slice(-63),i]);
  });
  const groups=new Map<number,ExternalSignal[]>();
  rows.forEach((row,i)=>groups.set(find(i),[...(groups.get(find(i)) ?? []),row]));
  return [...groups.values()].map(group=>group.sort((a,b)=>time(a.published_at ?? a.first_seen)-time(b.published_at ?? b.first_seen) || a.id.localeCompare(b.id))[0]);
}

export function buildSignalClusters(input: ExternalSignal[], options: { now: string; coverageDegraded?: boolean }): SignalCluster[] {
  const now=time(options.now);
  const groups=new Map<string,ExternalSignal[]>();
  for(const row of deduplicateSignals(input)) {
    if(row.exclusion_reason.length || !row.published_at || row.publication_date_confidence === "LOW" || time(row.published_at)>now || row.action_family === "UNKNOWN" || row.symptom_family === "UNKNOWN") continue;
    // Fixed daily episodes are stable across ingestion order and bounded to 24h.
    const episode=Math.floor(time(row.published_at)/EPISODE_MS);
    const key=`${row.platform}:${row.action_family}:${row.symptom_family}:${episode}`;
    groups.set(key,[...(groups.get(key) ?? []),row]);
  }
  return [...groups.entries()].map(([key,signals])=>{
    const first=Math.min(...signals.map(s=>time(s.published_at)));
    const last=Math.max(...signals.map(s=>time(s.published_at)));
    const recent=signals.filter(s=>now-time(s.published_at)<=6*3600_000).length;
    const previous=signals.filter(s=>now-time(s.published_at)>6*3600_000 && now-time(s.published_at)<=12*3600_000).length;
    const families=new Set(signals.map(s=>s.source_family));
    const stale=now-last>EPISODE_MS;
    const state: TrendState=stale ? "RESOLVED" : signals.length===1 ? "ISOLATED" : recent<previous ? "DECLINING" : recent>=3 && families.size>=2 && recent>previous*1.5 ? "ACCELERATING" : recent>=2 && families.size>=2 && previous===0 ? "EMERGING" : "STABLE";
    const credibility=signals.reduce((n,s)=>n+credScore[s.source_credibility],0)/signals.length;
    return {id:hash(key),platform:"INSTAGRAM" as const,action_family:signals[0].action_family,symptom_family:signals[0].symptom_family,signals,
      unique_signal_count:signals.length,unique_source_family_count:families.size,first_seen:new Date(first).toISOString(),last_seen:new Date(last).toISOString(),
      velocity:recent-previous,freshness:stale?"STALE" as const:"CURRENT" as const,coverage_status:options.coverageDegraded?"DEGRADED" as const:"PARTIAL" as const,
      external_confidence:Math.round(Math.min(options.coverageDegraded?55:80,100*credibility*(families.size>=2?1:.75))),state,evaluated_at:options.now};
  });
}

export function incidentFamilies(row: FleetIncident) {
  const values=[row.reason_code,row.first_causal_reason,row.trigger_reason,row.incident_type].filter((x):x is string=>Boolean(x));
  const action=row.incident_type === "preventive_follow_restriction" ? "FOLLOW_REVERT" : values.map(canonicalAction).find(x=>x!=="UNKNOWN" && x!=="RATE_LIMIT") ?? values.map(canonicalAction).find(x=>x!=="UNKNOWN") ?? "UNKNOWN";
  const symptom=row.incident_type==="preventive_follow_restriction" ? "FOLLOW_REVERT" : values.map(canonicalSymptom).find(x=>x!=="UNKNOWN") ?? "UNKNOWN";
  return {action,symptom};
}
function dimension(actual: string | null | undefined, expected: (string | null | undefined)[]) {
  const known=expected.filter((x):x is string=>Boolean(x));
  return !actual || !known.length ? "UNKNOWN" : known.includes(actual)?"MATCH":"CONFLICT";
}
function evidenceStrength(rows: FleetIncident[]): InternalEvidenceStrength {
  if(rows.some(r=>r.incident_type==="instagram_action_rate_limit" && r.restriction_evidence==="confirmed_ui")) return "CONFIRMED";
  if(rows.filter(r=>r.incident_type==="preventive_follow_restriction").reduce((n,r)=>n+Math.max(1,r.occurrence_count??1),0)>=2) return "STRONG";
  return rows.length?"WEAK":"NONE";
}
export function correlateFleet(cluster:SignalCluster,incidents:FleetIncident[],exposedAccounts:string[]=[]):Correlation {
  const compatibility:Record<string,Record<string,string>>={};
  const matched=incidents.filter(row=>{
    const f=incidentFamilies(row);
    const dimensions={version:dimension(row.instagram_version,cluster.signals.map(s=>s.platform_version)),device:dimension(row.device_id,cluster.signals.map(s=>s.device_id)),run_type:dimension(row.run_type,cluster.signals.map(s=>s.run_type))};
    compatibility[row.id]=dimensions;
    if(cluster.internal_only) return (cluster.internal_incident_ids ?? []).includes(row.id);
    return f.action===cluster.action_family && f.symptom===cluster.symptom_family && f.action!=="UNKNOWN" && !Object.values(dimensions).includes("CONFLICT") &&
      time(row.occurred_at)>=time(cluster.first_seen)-2*3600_000 && time(row.occurred_at)<=time(cluster.last_seen)+2*3600_000;
  });
  const strength=evidenceStrength(matched);
  const temporal=matched.length?10:0;
  const cohort=matched.some(r=>Object.values(compatibility[r.id]).includes("MATCH"))?5:0;
  return {cluster_id:cluster.id,matched_incidents:matched,internal_evidence_strength:strength,confirmed_platform_rate_limit:strength==="CONFIRMED",
    affected_accounts:[...new Set(matched.map(r=>r.account_id).filter((x):x is string=>Boolean(x)))].sort(),exposed_accounts:[...new Set(exposedAccounts)].sort(),
    score:Math.min(100,evidenceScore[strength]*3+temporal+cohort),factors:{internal_evidence:evidenceScore[strength]*3,temporal_match:temporal,cohort_match:cohort},compatibility};
}
export function includeInternalOnly(clusters:SignalCluster[],incidents:FleetIncident[],now:string):SignalCluster[] {
  const matched=new Set(clusters.flatMap(c=>correlateFleet(c,incidents).matched_incidents.map(i=>i.id)));
  const groups=new Map<string,FleetIncident[]>();
  for(const row of incidents.filter(i=>!matched.has(i.id))) {
    const f=incidentFamilies(row); const key=`internal:${f.action}:${f.symptom}:${Math.floor(time(row.occurred_at)/EPISODE_MS)}`;
    groups.set(key,[...(groups.get(key)??[]),row]);
  }
  return [...clusters,...[...groups.entries()].map(([key,rows])=>{
    const f=incidentFamilies(rows[0]);const first=Math.min(...rows.map(r=>time(r.occurred_at)));const last=Math.max(...rows.map(r=>time(r.occurred_at)));
    return {id:hash(key),platform:"INSTAGRAM" as const,action_family:f.action,symptom_family:f.symptom,signals:[],unique_signal_count:0,unique_source_family_count:0,
      first_seen:new Date(first).toISOString(),last_seen:new Date(last).toISOString(),velocity:0,freshness:time(now)-last>EPISODE_MS?"STALE" as const:"CURRENT" as const,
      coverage_status:"DEGRADED" as const,external_confidence:0,state:"ISOLATED" as const,internal_only:true,internal_incident_ids:rows.map(r=>r.id).sort(),evaluated_at:now};
  })];
}
export function realCoverage(checks:Record<string,unknown>[],now:string,truncated=false) {
  const latest=new Map<string,Record<string,unknown>>();
  for(const row of checks) if(!latest.has(String(row.source)) || time(String(row.checked_at))>time(String(latest.get(String(row.source))!.checked_at))) latest.set(String(row.source),row);
  const observed=[...latest.values()].some(r=>r.observed===true && r.collection_success===true && ["PARTIAL","FULL"].includes(String(r.coverage_status)) &&
    r.last_success_at && time(String(r.last_success_at))<=time(now) && time(String(r.last_success_at))>=time(now)-3*3600_000);
  return {coverageDegraded:truncated||!observed,coverageTruncated:truncated};
}

export function assessRisk(cluster: SignalCluster, correlation: Correlation): RiskAssessment {
  const recent = correlation.matched_incidents.filter(row => !cluster.evaluated_at || (time(cluster.evaluated_at)-time(row.occurred_at)>=0 && time(cluster.evaluated_at)-time(row.occurred_at)<=6*3600_000));
  const recentStrength=evidenceStrength(recent);
  const recentAccounts=new Set(recent.map(row=>row.account_id).filter(Boolean)).size;
  const externalCredibility = cluster.freshness === "STALE" ? 0 : Math.round(15 * cluster.external_confidence / 100);
  const affected = Math.min(10, recentAccounts * 3);
  const exposed = correlation.exposed_accounts.length ? Math.min(10, Math.round(10 * recentAccounts / correlation.exposed_accounts.length)) : 0;
  const severity = Math.max(0, ...recent.map((row) => severityScore[row.severity ?? "warning"]));
  const recurrence = Math.min(5, recent.reduce((sum, row) => sum + Math.max(1, row.occurrence_count ?? 1), 0));
  const freshness = cluster.freshness === "CURRENT" ? 5 : 0;
  const factors = { external_momentum: momentumScore[cluster.state], external_credibility: externalCredibility,
    internal_evidence: evidenceScore[recentStrength], internal_affected_count: affected,
    exposed_count: exposed, severity, recurrence, freshness };
  let score = Object.values(factors).reduce((sum, value) => sum + value, 0);
  const rawScore=score;
  const caps: {reason:string;ceiling:number}[]=[];
  if (score>49 && correlation.internal_evidence_strength === "NONE") caps.push({reason:"NO_INTERNAL_EVIDENCE",ceiling:49});
  if (correlation.internal_evidence_strength === "NONE") score = Math.min(score, 49);
  if (score>74 && cluster.coverage_status === "DEGRADED") caps.push({reason:"COVERAGE_DEGRADED",ceiling:74});
  if (cluster.coverage_status === "DEGRADED") score = Math.min(score, 74);
  const level: RiskLevel = score >= 75 ? "CRITICAL" : score >= 50 ? "HIGH" : score >= 25 ? "MODERATE" : "LOW";
  const confidence = Math.min(cluster.external_confidence, cluster.coverage_status === "DEGRADED" ? 55 : 80,
    correlation.internal_evidence_strength === "NONE" ? 45 : correlation.internal_evidence_strength === "WEAK" ? 60 : 90);
  return { raw_score:rawScore,final_score:score,caps_applied:caps, score, level, risk_factors: factors, confidence, coverage_status: cluster.coverage_status };
}

export function recommend(cluster: SignalCluster, correlation: Correlation, risk: RiskAssessment, now: string): Recommendation {
  let action: CompassAction;
  const recentInternal=correlation.matched_incidents.some(r=>time(now)-time(r.occurred_at)<=6*3600_000);
  if (cluster.internal_only) action="MONITOR";
  else if (!recentInternal && ["DECLINING","RESOLVED"].includes(cluster.state)) action="MONITOR";
  else if (cluster.coverage_status === "DEGRADED" && correlation.internal_evidence_strength === "NONE") action = "NEEDS_MORE_EVIDENCE";
  else if (correlation.internal_evidence_strength === "NONE") action = "MONITOR";
  else if (risk.level === "CRITICAL") action = correlation.affected_accounts.length ? "PAUSE_SELECTED" : "NEEDS_MORE_EVIDENCE";
  else if (risk.level === "HIGH") action = "REDUCE_ACTIVITY";
  else if (cluster.state === "DECLINING" || cluster.state === "RESOLVED") action = "MONITOR";
  else if (risk.level === "LOW") action = "CONTINUE";
  else action = "MONITOR";
  if (correlation.internal_evidence_strength === "WEAK" && !correlation.confirmed_platform_rate_limit && action === "REDUCE_ACTIVITY") action = "MONITOR";
  return {
    action,
    why: [`trend:${cluster.state}`, `internal_evidence:${correlation.internal_evidence_strength}`, `risk:${risk.level}`, `coverage:${cluster.coverage_status}`],
    affected_scope: { account_ids: correlation.affected_accounts, cluster_id: cluster.id }, confidence: risk.confidence,
    preconditions: ["Fleet preview resolves the current scope", "Operator confirms current incident evidence"],
    recheck_at: new Date(time(now) + (cluster.state === "ACCELERATING" ? 30 : 60) * 60_000).toISOString(),
    recovery_checks: ["No new confirmed internal incidents", "External momentum is declining or resolved"],
  };
}

export function prepareFleetHandoff(cluster: SignalCluster, correlation: Correlation, risk: RiskAssessment, recommendation: Recommendation, now: string): FleetHandoff {
  const created = new Date(time(now));
  const evidence = { external_signal_ids: cluster.signals.map((row) => row.id), internal_incident_ids: correlation.matched_incidents.map((row) => row.id) };
  const idempotency = hash(JSON.stringify({ cluster: cluster.id, action: recommendation.action, scope: [...recommendation.affected_scope.account_ids].sort(), evidence }));
  return {
    schema: "COMPASS_FLEET_HANDOFF_V1", id: randomUUID(), created_at: created.toISOString(),
    expires_at: new Date(created.getTime() + 2 * 3600_000).toISOString(), idempotency_key: idempotency,
    recommended_action: recommendation.action, recommended_scope: recommendation.affected_scope,
    affected_accounts: correlation.affected_accounts, exposed_accounts: correlation.exposed_accounts, risk, confidence: recommendation.confidence,
    evidence_summary: evidence, operator_checks: recommendation.preconditions,
    actions_executable: false, open_in_fleet: true, fleet_flow: ["PREVIEW", "CONFIRMATION", "APPLY"],
  };
}

function canonicalizeLogicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeLogicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeLogicalValue(entry)]),
    );
  }
  return value;
}

export function evaluationIdentity(cluster:SignalCluster,correlation:Correlation,risk:RiskAssessment,recommendation:Recommendation) {
  const {evaluated_at: _at, ...c}=cluster;
  void _at;
  const logicalState = {
    cluster: {
      ...c,
      internal_incident_ids: [...(c.internal_incident_ids ?? [])].sort(),
      signals: c.signals
        .map(signal => ({ id: signal.id, hash: signal.content_hash, event: signal.published_at }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    },
    correlation: {
      ...correlation,
      matched_incidents: [...correlation.matched_incidents].sort((left, right) => left.id.localeCompare(right.id)),
      affected_accounts: [...correlation.affected_accounts].sort(),
      exposed_accounts: [...correlation.exposed_accounts].sort(),
    },
    risk,
    action: recommendation.action,
    scope: {
      ...recommendation.affected_scope,
      account_ids: [...recommendation.affected_scope.account_ids].sort(),
    },
  };
  return hash(JSON.stringify(canonicalizeLogicalValue(logicalState)));
}
export function assertHandoffFresh(payload:FleetHandoff,now:string) {
  if(time(payload.expires_at)<=time(now)) throw new Error("HANDOFF_EXPIRED");
  return payload;
}
