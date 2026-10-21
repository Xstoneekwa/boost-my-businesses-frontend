import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { InstagramPublicProfileLookupResult, lookupInstagramPublicProfile } from "@/lib/instagram-public-profile-lookup";

type Db = ReturnType<typeof createSupabaseAdminClient>;
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown) => typeof v === "string" ? v : "";
const safeCode = (v: unknown) => typeof v === "string" && /^[a-z0-9_.:-]{1,96}$/i.test(v)
  && !/(?:sk[-_]|bearer|secret|token|password|authorization|api[-_]?key)/i.test(v) ? v : null;
export type FranceProviderDiagnostic = {
  http_status: number | null; transport_http_2xx: boolean | null;
  provider_error_code: string | null; provider_error_type: string | null; request_id: string | null;
  timeout: boolean; invalid_payload: boolean; provider_error_payload: boolean; observed_at: string;
};
export type FranceOperationOutcome<T> = {
  ledger_status: "succeeded" | "failed"; result_count: number; error_code: string | null;
  diagnostic: FranceProviderDiagnostic; value: T | null;
};
export class FranceProviderOperationError extends Error {
  readonly safeDetail: Row;
  readonly pending: boolean;
  constructor(code: string, safeDetail: Row = {}, pending = false) { super(code); this.safeDetail = safeDetail; this.pending = pending; }
}
export function franceProviderDiagnostic(): FranceProviderDiagnostic {
  return { http_status: null, transport_http_2xx: null, provider_error_code: null, provider_error_type: null,
    request_id: null, timeout: false, invalid_payload: false, provider_error_payload: false, observed_at: new Date().toISOString() };
}
/** Observe only response status/allowlisted codes. Never retain URL, headers, body or message. */
export function observeFranceProfileFetch(fetcher: typeof fetch, diagnostic: FranceProviderDiagnostic): typeof fetch {
  return async (input, init) => {
    try {
      const response = await fetcher(input, init);
      diagnostic.http_status = response.status; diagnostic.transport_http_2xx = response.ok;
      diagnostic.request_id = safeCode(response.headers.get("x-request-id") ?? response.headers.get("request-id"));
      try {
        const body = row(await response.clone().json()); const error = row(body.error);
        diagnostic.provider_error_payload = Boolean(body.error || body.errors);
        diagnostic.provider_error_code = safeCode(error.code ?? body.error_code);
        diagnostic.provider_error_type = safeCode(error.type ?? body.error_type);
        diagnostic.request_id ??= safeCode(row(body.search_metadata).id);
      } catch { diagnostic.invalid_payload = true; }
      return response;
    } catch (error) {
      diagnostic.timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
      throw error;
    } finally { diagnostic.observed_at = new Date().toISOString(); }
  };
}
/** Only the normalized fields consumed by the existing processor; no raw provider object/IDs/avatars. */
function profileProjection(p: InstagramPublicProfileLookupResult): InstagramPublicProfileLookupResult {
  const metadata: InstagramPublicProfileLookupResult["metadata"] = {};
  for (const key of ["profile_name", "biography", "cache_hit", "throttle_hit", "rate_limited", "latency_ms", "provider_mode", "provider_engine", "provider_status"]) {
    const value = p.metadata?.[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) metadata[key] = value;
  }
  return { ok: p.ok, status: p.status, input_username: p.input_username, canonical_username: p.canonical_username,
    instagram_user_id: null, external_profile_id: null, avatar_url: null, is_private: p.is_private ?? null,
    is_verified: p.is_verified ?? null, is_business: p.is_business ?? null, followers_count: p.followers_count ?? null,
    following_count: p.following_count ?? null, posts_count: p.posts_count ?? null, official_category: p.official_category ?? null,
    external_url: p.external_url ?? null, bio_links: p.bio_links ?? [], recent_post_captions: p.recent_post_captions ?? [],
    reason: safeCode(p.reason) ?? p.status, checked_at: p.checked_at, metadata };
}

/** Existing atomic reservation + existing item JSON checkpoint. Capture BEFORE ledger finish.
 * A reserved call without a durable result is unresolved, never permission to resend.
 */
export async function runFranceItemOperation<T>(db: Db, item: Row, kind: "profile" | "site_page",
  operate: () => Promise<FranceOperationOutcome<T>>): Promise<FranceOperationOutcome<T>> {
  const current = await db.from("commercial_discovery_items").select("enrichment_snapshot_safe,status,attempt_count")
    .eq("id", text(item.id)).eq("run_id", text(item.run_id)).single();
  if (current.error || !current.data) throw new FranceProviderOperationError("provider_outcome_read_failed");
  item.enrichment_snapshot_safe = row(current.data.enrichment_snapshot_safe);
  const reserved = await db.rpc("reserve_commercial_france_provider_call_v1", {
    p_run_id: text(item.run_id), p_provider: "searchapi", p_call_kind: kind,
    p_call_key: `item:${text(item.id)}:${kind === "site_page" ? "site" : "profile"}`,
  });
  if (reserved.error) throw new FranceProviderOperationError("france_provider_reservation_failed");
  const reservation = row(reserved.data);
  if (reservation.reserved !== true && reservation.reason !== "idempotent_replay") {
    throw new FranceProviderOperationError(`france_provider_${safeCode(reservation.reason) ?? "budget_blocked"}`, {
      reason: reservation.reason, used: reservation.used, limit: reservation.limit, kind,
    });
  }
  const callId = text(reservation.call_id);
  let outcome: FranceOperationOutcome<T>;
  if (reservation.reserved === true) {
    const started = Date.now();
    outcome = await operate();
    const snapshot = row(item.enrichment_snapshot_safe);
    const checkpoint = { contract: "FRANCE_PROVIDER_OUTCOME_V1", call_id: callId, ...outcome, duration_ms: Date.now() - started };
    const next = { ...snapshot, provider_operations: { ...row(snapshot.provider_operations), [kind]: checkpoint } };
    const persisted = await db.from("commercial_discovery_items").update({ enrichment_snapshot_safe: next })
      .eq("id", text(item.id)).eq("run_id", text(item.run_id)).eq("attempt_count", Number(item.attempt_count))
      .eq("status", "processing").select("id").single();
    if (persisted.error || !persisted.data) throw new FranceProviderOperationError("provider_outcome_checkpoint_failed");
    item.enrichment_snapshot_safe = next;
  } else {
    const refreshed = await db.from("commercial_discovery_items").select("enrichment_snapshot_safe")
      .eq("id", text(item.id)).eq("run_id", text(item.run_id)).single();
    if (refreshed.error || !refreshed.data) throw new FranceProviderOperationError("provider_outcome_read_failed");
    item.enrichment_snapshot_safe = row(refreshed.data.enrichment_snapshot_safe);
    const saved = row(row(row(item.enrichment_snapshot_safe).provider_operations)[kind]);
    if (saved.contract !== "FRANCE_PROVIDER_OUTCOME_V1" || saved.call_id !== callId) {
      const prior = await db.from("commercial_france_provider_calls").select("status,error_code").eq("id", callId).single();
      if (prior.error) throw new FranceProviderOperationError("provider_outcome_read_failed");
      const legacy = row(row(item.enrichment_snapshot_safe)[kind === "profile" ? "instagram" : "website"]);
      if (row(prior.data).status === "succeeded" && (kind === "profile"
        ? legacy.ok === true && legacy.status === "found" && Boolean(legacy.canonical_username)
        : typeof legacy.pagesFetched === "number")) {
        return { ledger_status: "succeeded", result_count: kind === "profile" ? 1 : Number(legacy.pagesFetched), error_code: null,
          diagnostic: franceProviderDiagnostic(), value: (kind === "profile" ? profileProjection(legacy as InstagramPublicProfileLookupResult) : legacy) as T };
      }
      const pending = row(prior.data).status === "reserved";
      throw new FranceProviderOperationError(pending ? "provider_operation_in_flight" : "provider_outcome_unavailable", {
        prior_ledger_status: row(prior.data).status, original_error_code: row(prior.data).error_code ?? null,
        original_outcome: "NOT_RECORDED", no_second_transport: true,
      }, pending);
    }
    outcome = { ledger_status: saved.ledger_status as "succeeded" | "failed", result_count: Number(saved.result_count),
      error_code: saved.error_code as string | null, diagnostic: saved.diagnostic as FranceProviderDiagnostic, value: saved.value as T | null };
  }
  const saved = row(row(row(item.enrichment_snapshot_safe).provider_operations)[kind]);
  // The first worker may have crashed after capture but before finish. Reconcile only
  // that finish; it never transports again and the RPC updates reserved rows only.
  if (reservation.reserved !== true) {
    const prior = await db.from("commercial_france_provider_calls").select("status").eq("id", callId).single();
    if (prior.error) throw new FranceProviderOperationError("provider_outcome_read_failed");
    if (row(prior.data).status === outcome.ledger_status) return outcome;
    if (row(prior.data).status !== "reserved") throw new FranceProviderOperationError("provider_outcome_ledger_conflict");
  }
  const finished = await db.rpc("finish_commercial_france_provider_call_v1", { p_call_id: callId, p_status: outcome.ledger_status,
    p_duration_ms: Number(saved.duration_ms), p_result_count: outcome.result_count, p_error_code: outcome.error_code });
  if (finished.error) {
    const prior = await db.from("commercial_france_provider_calls").select("status").eq("id", callId).single();
    if (prior.error || row(prior.data).status !== outcome.ledger_status) throw new FranceProviderOperationError("france_provider_ledger_write_failed");
  }
  return outcome;
}

export async function lookupFranceProfile(db: Db, item: Row, handle: string, lookup: typeof lookupInstagramPublicProfile, fetcher: typeof fetch = globalThis.fetch) {
  return runFranceItemOperation(db, item, "profile", async () => {
    const diagnostic = franceProviderDiagnostic();
    let profile: InstagramPublicProfileLookupResult;
    try { profile = profileProjection(await lookup(handle, { strictProviderOutcome: true, fetcher: observeFranceProfileFetch(fetcher, diagnostic) })); }
    catch (error) {
      diagnostic.timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
      return { ledger_status: "failed", result_count: 0, error_code: diagnostic.timeout ? "profile_timeout" : "profile_provider_error", diagnostic, value: null };
    }
    const usable = profile.ok && profile.status === "found" && Boolean(profile.canonical_username)
      && !diagnostic.provider_error_payload && !diagnostic.invalid_payload;
    diagnostic.timeout ||= profile.reason === "provider_timeout";
    diagnostic.invalid_payload ||= profile.reason === "provider_invalid_response" || profile.ok && profile.status === "found" && !profile.canonical_username;
    const code = usable ? null : diagnostic.timeout ? "profile_timeout" : diagnostic.provider_error_payload ? "profile_provider_error"
      : diagnostic.invalid_payload ? "profile_invalid_payload" : `profile_${profile.status}`;
    // A cache hit still carries its normalized failure. No guessed HTTP status.
    if (!usable) profile = { ...profile, ok: false };
    return { ledger_status: usable ? "succeeded" : "failed", result_count: usable ? 1 : 0, error_code: code, diagnostic, value: profile };
  });
}
