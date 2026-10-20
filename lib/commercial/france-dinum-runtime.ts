import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { DinumAnchorClient, type DinumCallResult } from "./dinum-anchor-client";
import { assessFranceSerpCandidate } from "./france-acquisition";
import { administrativeName } from "./france-administrative-territory";
import { classifyProfileFirstWebsiteUrl, type EstablishmentAnchor } from "./profile-first-anchor";
import { rootInstagramHandle } from "./structured-instagram-resolver";

export const FRANCE_DINUM_RUNTIME = "FRANCE_INSTAGRAM_FIRST_DINUM_RUNTIME_V1";
export const OFFICIAL_ESTABLISHMENT_LOOKUPS_PER_RUN = 2;
type Db = ReturnType<typeof createSupabaseAdminClient>;
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown) => typeof v === "string" ? v : "";
const generic = new Set("salon institut beaute beauty aesthetics aesthetic clinic skin med spa hair stylist nail studio lash brow laser makeup artist wellness coiffure coiff coiffeur barbier barber ongles cils sourcils maquillage esthetique paris france le la les de du des et the officiel official instagram".split(" "));
/** Observed name only: no handle expansion, query terms, fuzzy match or AI. */
export function usableDinumName(value: string, city: string) {
  const normalized = administrativeName(value);
  const local = new Set(administrativeName(city).split(" "));
  return value.trim().length <= 160 && !/[\r\n\u0000]/.test(value)
    && normalized.split(" ").some(word => word.length >= 3 && !generic.has(word) && !local.has(word) && /\p{L}/u.test(word));
}

/** Freeze allocation on the whole run's immutable discovery evidence, not claim order.
 * A later fresh profile may veto its slot; unused slots are NOT opportunistically
 * reallocated. Unknown/locality-free hints cannot consume the two scarce lookups.
 */
export function selectDinumRunCandidates(items: Row[], city: string) {
  return items.flatMap(item => {
    const source = row(item.source_snapshot_safe), handle = text(source.instagram_handle);
    const profileUrl = text(source.profile_url), title = text(source.title), snippet = text(source.snippet);
    const name = title.split(/\s*[|(@]\s*/u)[0].trim();
    if (item.selected_for_processing !== true || !text(item.id) || rootInstagramHandle(profileUrl) !== handle
      || !assessFranceSerpCandidate({ username: handle, profileUrl, title, snippet }).keep || !usableDinumName(name, city)) return [];
    const observed = administrativeName(`${title} ${snippet}`), locality = administrativeName(city);
    const local = city === "France" ? /\bfrance\b/.test(observed) : (` ${observed} `).includes(` ${locality} `);
    if (!local) return [];
    const legalId = /\b(?:siren|siret)\s*[: ]\s*\d{9}(?:\d{5})?\b/i.test(`${title} ${snippet}`);
    const postal = /\b\d{5}\b/.test(snippet);
    const domain = (snippet.match(/https:\/\/[^\s<>"']+/g) ?? []).some(url => {
      try { return !/(^|\.)(instagram|facebook|tiktok)\.com$/.test(new URL(url).hostname) && classifyProfileFirstWebsiteUrl(url) === "UNKNOWN"; } catch { return false; }
    });
    // Lexicographic evidence order, NOT an identity/marketing score.
    return [{ itemId: text(item.id), handle, priority: [Number(legalId), Number(postal), Number(domain)] }];
  }).sort((a, b) => b.priority[0] - a.priority[0] || b.priority[1] - a.priority[1] || b.priority[2] - a.priority[2]
    || (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))
    .filter((entry, index, all) => all.findIndex(other => other.handle === entry.handle) === index)
    .slice(0, OFFICIAL_ESTABLISHMENT_LOOKUPS_PER_RUN);
}

export type DinumRuntimeInput = {
  runId: string; itemId: string; country: string; city: string; instagramHandle: string; profileUrl: string;
  observedName: string; publicProfile: boolean; precheckDecision: string; precheckReason: string;
  plausibleFranceLocation: boolean; anchorAdmitted: boolean;
};
export type DinumRuntimeEvidence = {
  contract: typeof FRANCE_DINUM_RUNTIME; delivery_source: "dinum"; disposition: "HOLD" | "ANCHOR_CANDIDATE" | "NOT_NEEDED";
  reason: string; call_key?: string; http_status?: number | null; retry_after?: string | null;
  match_state?: string; schema?: string; duration_ms?: number;
};
export type DinumRuntimeResult = { anchor: EstablishmentAnchor | null; evidence: DinumRuntimeEvidence };

// Serialize a run's two transports within a worker; SQL remains authoritative
// across workers/restarts. A persisted provider failure stops subsequent DINUM,
// including after Retry-After (no automatic retry in this contract).
const runTails = new Map<string, Promise<void>>();
async function serial<T>(runId: string, operation: () => Promise<T>) {
  const previous = runTails.get(runId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  runTails.set(runId, current);
  await previous;
  try { return await operation(); }
  finally { release(); if (runTails.get(runId) === current) runTails.delete(runId); }
}

export async function resolveFranceDinumAnchor(db: Db, input: DinumRuntimeInput, fetcher?: typeof fetch): Promise<DinumRuntimeResult> {
  const evidence: DinumRuntimeEvidence = { contract: FRANCE_DINUM_RUNTIME, delivery_source: "dinum", disposition: "HOLD", reason: "INSUFFICIENT_ANCHOR" };
  const hold = (reason: string): DinumRuntimeResult => ({ anchor: null, evidence: { ...evidence, reason } });
  if (input.anchorAdmitted) return { anchor: null, evidence: { ...evidence, disposition: "NOT_NEEDED", reason: "ANCHOR_ALREADY_ADMITTED" } };
  if (input.country !== "FR" || !input.publicProfile || rootInstagramHandle(input.profileUrl) !== input.instagramHandle
    || !assessFranceSerpCandidate({ username: input.instagramHandle, profileUrl: input.profileUrl, title: input.observedName, snippet: null }).keep
    || !(input.precheckDecision === "PRECHECK_PASS" || input.precheckDecision === "PRECHECK_AMBIGUOUS" && input.precheckReason === "location_requires_enrichment")
    || !input.plausibleFranceLocation) return hold("DINUM_TRIGGER_NOT_ELIGIBLE");
  if (!usableDinumName(input.observedName, input.city)) return hold("NAME_HINT_NOT_USABLE");
  const peers = await db.from("commercial_discovery_items").select("id,selected_for_processing,source_snapshot_safe")
    .eq("run_id", input.runId).eq("selected_for_processing", true).limit(51);
  if (peers.error || !peers.data || peers.data.length > 50) return hold("DINUM_ALLOCATION_READ_FAILED");
  const allocated = selectDinumRunCandidates(peers.data.map(row), input.city);
  if (!allocated.some(c => c.itemId === input.itemId && c.handle === input.instagramHandle)) return hold("OFFICIAL_LOOKUP_BUDGET_NOT_ALLOCATED");

  return serial(input.runId, async () => {
    const control = await db.from("commercial_france_run_controls").select("state,budget_limits_safe").eq("run_id", input.runId).maybeSingle();
    if (control.error || !["armed", "running"].includes(text(row(control.data).state))) return hold("DINUM_CONTROL_NOT_RUNNING");
    const limit = Number(row(row(control.data).budget_limits_safe).sirene);
    // Fail closed if the shared configuration ever drifts above the authorized 2.
    if (!Number.isInteger(limit) || limit < 1 || limit > OFFICIAL_ESTABLISHMENT_LOOKUPS_PER_RUN) return hold("OFFICIAL_LOOKUP_BUDGET_CONTRACT_MISMATCH");
    const calls = await db.from("commercial_france_provider_calls").select("status,provider,error_code,created_at")
      .eq("run_id", input.runId).eq("call_kind", "sirene").neq("status", "cancelled").limit(3);
    if (calls.error) return hold("DINUM_LEDGER_READ_FAILED");
    const prior = (calls.data ?? []).map(row);
    if (prior.some(c => c.provider === "dinum" && c.status === "failed")) return hold("DINUM_PRIOR_PROVIDER_FAILURE_NO_RETRY");
    if (prior.length >= limit) return hold("OFFICIAL_LOOKUP_BUDGET_EXHAUSTED");
    if (prior.some(c => c.status === "reserved")) return hold("OFFICIAL_LOOKUP_IN_FLIGHT_NO_RETRY");
    const lastDinum = Math.max(0, ...prior.filter(c => c.provider === "dinum").map(c => Date.parse(text(c.created_at)) || 0));
    const delay = Math.max(0, lastDinum + 1000 - Date.now());
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    let callId: string | null = null, denial = "DINUM_RESERVATION_DENIED";
    const client = new DinumAnchorClient({
      reserve: async entry => {
        evidence.call_key = entry.key;
        const result = await db.rpc("reserve_commercial_france_provider_call_v1", {
          p_run_id: input.runId, p_provider: "dinum", p_call_kind: "sirene", p_call_key: entry.key,
        });
        const value = row(result.data);
        denial = result.error ? "DINUM_RESERVATION_RPC_FAILED" : `DINUM_${text(value.reason) || "RESERVATION_DENIED"}`.toUpperCase();
        callId = value.reserved === true && !result.error ? text(value.call_id) || null : null;
        return callId !== null;
      },
      finish: async result => {
        const finished = await db.rpc("finish_commercial_france_provider_call_v1", {
          p_call_id: callId, p_status: result.outcome === "SUCCESS" ? "succeeded" : "failed",
          p_duration_ms: result.durationMs, p_result_count: result.resultCount ?? 0,
          p_error_code: result.stopReason, // bounded codes only; no body/query/profile/credentials
        });
        if (finished.error) throw new Error("dinum_finish_failed");
      },
    }, fetcher, [], { runId: input.runId, candidates: [{ sourceItemId: input.itemId, instagramHandle: input.instagramHandle }] });
    let result: DinumCallResult;
    try {
      result = await client.search({ instagramHandle: input.instagramHandle, profileUrl: input.profileUrl, sourceItemId: input.itemId,
        nameHint: { value: input.observedName, sourceReference: `commercial_discovery_items:${input.itemId}`, fieldPath: "instagram.metadata.profile_name" }, targetCity: input.city });
    } catch (error) {
      return hold(error instanceof Error && error.message === "dinum_durable_reservation_denied" ? denial : "DINUM_LEDGER_OR_CONTEXT_FAILURE");
    }
    Object.assign(evidence, { http_status: result.httpStatus, retry_after: result.retryAfter, duration_ms: result.durationMs,
      schema: result.schema?.status, match_state: result.projection?.matchState });
    // No raw payload, complete observation array or unrelated registry data persisted.
    if (result.outcome !== "SUCCESS") return hold(result.stopReason ?? "DINUM_PROVIDER_FAILURE");
    if (!result.projection?.anchor) return hold(result.projection?.reason ?? "DINUM_PARTIAL_RESULT");
    return { anchor: result.projection.anchor, evidence: { ...evidence, disposition: "ANCHOR_CANDIDATE", reason: result.projection.reason } };
  });
}
