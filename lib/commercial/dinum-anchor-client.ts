import { projectDinumEstablishment, type DinumProjection, type DinumProjectionContext } from "./dinum-establishment-projection";
import { FR_BEAUTY_ACTIVITY_FILTER_V1 } from "./sirene-provider";
import { rootInstagramHandle } from "./structured-instagram-resolver";

export const DINUM_ANCHOR_CANARY = "DINUM_INSTAGRAM_FIRST_MICRO_CANARY_V1";
export const DINUM_ANCHOR_LIMITS = { profiles: 4, calls: 8, perProfile: 2, initial: 1, verification: 1, results: 5, establishments: 10, bytes: 256_000, timeoutMs: 12_000 } as const;
export const DINUM_CANARY_HANDLES = ["lemaitrebarbierparis", "mhaesthetic.clinic", "lashbyiava", "maisons_cils"] as const;
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown) => typeof v === "string" ? v : "";
const pick = (r: Row, keys: string[]) => Object.fromEntries(keys.filter(k => Object.hasOwn(r, k)).map(k => [k, r[k]]));
type NameHint = { value: string; sourceReference: string; fieldPath: string };
export type DinumInstagramAnchorInput = {
  instagramHandle: string; profileUrl: string; sourceItemId: string; nameHint: NameHint;
  targetCity: string;
  observedPostalCode?: { value: string; sourceReference: string; fieldPath: string };
  observedDepartment?: { value: string; sourceReference: string; fieldPath: string };
};
export type DinumReservation = { key: string; handle: string; kind: "initial" | "verification"; query: string; reservedAt: string };
export type DinumSchemaGate = { status: "PASS" | "FAIL"; mismatches: string[]; checkedEstablishments: number };
export type DinumCallResult = {
  reservation: DinumReservation; httpStatus: number | null; contentType: string | null; durationMs: number;
  schema: DinumSchemaGate | null; resultCount: number | null;
  outcome: "SUCCESS" | "STOP"; stopReason: string | null; retryAfter: string | null;
  projection: DinumProjection | null;
  /** O/O public observations only, whitelisted. Never the complete provider payload. */
  observations: Array<Record<string, unknown>>;
};
export interface DinumCallLedger {
  /** Durable reservation BEFORE transport. Replays must return false, never re-execute. */
  reserve(entry: DinumReservation): Promise<boolean>;
  finish(result: DinumCallResult): Promise<void>;
}

/** Positive reuse of the existing authorized rule ONLY where it actually covers the code.
 * An unlisted code is UNKNOWN/HOLD, never "outside the Beauty vertical".
 */
export function existingDinumActivityCompatibility(code: string, observedAt: string): DinumProjectionContext["activityCompatibility"] {
  const policy = FR_BEAUTY_ACTIVITY_FILTER_V1;
  return observedAt.slice(0, 10) < policy.expiresAt && Object.hasOwn(policy.included, code)
    ? { code, nomenclature: "NAFRev2", compatible: true, ruleReference: policy.version } : undefined;
}

export function buildDinumAnchorQuery(input: DinumInstagramAnchorInput, verification?: { siret: string; necessity: string }) {
  if (!DINUM_CANARY_HANDLES.includes(input.instagramHandle as never) || rootInstagramHandle(input.profileUrl) !== input.instagramHandle
    || !/^[0-9a-f-]{36}$/i.test(input.sourceItemId) || !input.nameHint.sourceReference || !input.nameHint.fieldPath
    || !input.nameHint.value.trim() || input.nameHint.value.length > 160 || /[\r\n\u0000]/.test(input.nameHint.value)
    || !input.targetCity.trim() || input.targetCity.length > 120 || /[\r\n\u0000]/.test(input.targetCity)) throw new Error("dinum_instagram_first_context_required");
  const url = new URL("https://recherche-entreprises.api.gouv.fr/search");
  if (verification && (!/^\d{14}$/.test(verification.siret) || !verification.necessity.trim())) throw new Error("dinum_verification_necessity_required");
  const includesCity = input.nameHint.value.toLocaleLowerCase("fr").includes(input.targetCity.toLocaleLowerCase("fr"));
  url.search = new URLSearchParams({ q: verification?.siret ?? `${input.nameHint.value.trim()}${includesCity ? "" : ` ${input.targetCity.trim()}`}`,
    minimal: "true", include: "matching_etablissements", per_page: "5", page: "1", limite_matching_etablissements: "10", page_etablissements: "1", etat_administratif: "A" }).toString();
  for (const [field, hint, pattern] of [["code_postal", input.observedPostalCode, /^\d{5}$/], ["departement", input.observedDepartment, /^(?:\d{2,3}|2[AB])$/]] as const) {
    if (hint) { if (!hint.sourceReference || !hint.fieldPath || !pattern.test(hint.value)) throw new Error("dinum_observed_territory_provenance_required"); url.searchParams.set(field, hint.value); }
  }
  return url;
}

/** Validates structure/types before any minimized business observation is retained.
 * Optional names/source dates are explicitly nullable/absent; statuses may be unknown
 * values, which are handled by the stricter admission O/O + A/A gates, never assumed.
 * Schema reference: https://recherche-entreprises.api.gouv.fr/openapi.json
 */
export function validateDinumAnchorSchema(payload: unknown): DinumSchemaGate {
  const mismatches: string[] = []; let checkedEstablishments = 0;
  const fail = (path: string, expected: string) => { if (mismatches.length < 20) mismatches.push(`${path}: expected ${expected}`); };
  const string = (r: Row, key: string, path: string, nullable = false, pattern?: RegExp) => {
    const v = r[key]; if (nullable && v == null) return;
    if (typeof v !== "string" || v.length > 1000 || pattern && !pattern.test(v)) fail(`${path}.${key}`, nullable ? "string|null|absent" : "valid string");
  };
  const root = row(payload);
  for (const key of ["total_results", "total_pages"]) if (!Number.isSafeInteger(root[key]) || Number(root[key]) < 0) fail(`$.${key}`, "nonnegative integer");
  if (root.page !== 1 || root.per_page !== DINUM_ANCHOR_LIMITS.results) fail("$.pagination", "page=1 and per_page=5");
  if (!Array.isArray(root.results) || root.results.length > DINUM_ANCHOR_LIMITS.results) fail("$.results", "bounded array <=5");
  else {
    if (Number(root.total_results) < root.results.length) fail("$.total_results", ">= returned result count");
    root.results.forEach((raw, i) => {
      const r = row(raw), path = `$.results[${i}]`;
      string(r, "siren", path, false, /^\d{9}$/);
      for (const field of ["etat_administratif", "statut_diffusion"]) string(r, field, path);
      string(r, "nom_raison_sociale", path, true);
      for (const field of ["date_mise_a_jour_insee"]) {
        string(r, field, path, true);
        if (r[field] != null && !Number.isFinite(Date.parse(text(r[field])))) fail(`${path}.${field}`, "valid source date|null");
      }
      if (!Number.isSafeInteger(r.nombre_etablissements) || Number(r.nombre_etablissements) < 0) fail(`${path}.nombre_etablissements`, "nonnegative integer");
      if (!Array.isArray(r.matching_etablissements) || r.matching_etablissements.length > DINUM_ANCHOR_LIMITS.establishments) fail(`${path}.matching_etablissements`, "bounded array <=10");
      else r.matching_etablissements.forEach((rawEst, j) => {
        const e = row(rawEst), ep = `${path}.matching_etablissements[${j}]`; checkedEstablishments++;
        string(e, "siret", ep, false, /^\d{14}$/);
        if (text(e.siret).slice(0, 9) !== r.siren) fail(`${ep}.siret`, "same exact SIREN prefix");
        for (const field of ["etat_administratif", "statut_diffusion_etablissement"]) string(e, field, ep);
        for (const field of ["nom_commercial", "adresse", "code_postal", "commune", "libelle_commune", "activite_principale", "departement"]) string(e, field, ep, true);
        if (e.liste_enseignes != null && (!Array.isArray(e.liste_enseignes) || e.liste_enseignes.length > 30 || e.liste_enseignes.some(v => typeof v !== "string" || v.length > 1000))) fail(`${ep}.liste_enseignes`, "bounded string[]|null|absent");
        string(e, "date_mise_a_jour_insee", ep, true);
        if (e.date_mise_a_jour_insee != null && !Number.isFinite(Date.parse(text(e.date_mise_a_jour_insee)))) fail(`${ep}.date_mise_a_jour_insee`, "valid source date|null");
      });
    });
  }
  return { status: mismatches.length ? "FAIL" : "PASS", mismatches, checkedEstablishments };
}

function minimizedPayload(payload: unknown) {
  const root = row(payload);
  const legalFields = ["siren", "nom_raison_sociale", "etat_administratif", "statut_diffusion", "date_mise_a_jour_insee", "nombre_etablissements"];
  const estFields = ["siret", "nom_commercial", "liste_enseignes", "adresse", "code_postal", "commune", "libelle_commune", "departement", "activite_principale", "etat_administratif", "statut_diffusion_etablissement", "date_mise_a_jour_insee"];
  const observations: Array<Record<string, unknown>> = [];
  const results = (root.results as unknown[]).map(raw => {
    const r = row(raw);
    const matching = (r.matching_etablissements as unknown[]).map(rawEst => {
      const e = row(rawEst);
      if (r.statut_diffusion === "O" && e.statut_diffusion_etablissement === "O") {
        const safe = pick(e, estFields);
        observations.push({ siren: r.siren, ...safe, legalUnitState: r.etat_administratif, legalUnitDiffusion: r.statut_diffusion, legalUnitUpdatedAt: r.date_mise_a_jour_insee ?? null });
        return safe;
      }
      // Preserve only gate state; no identifying data from non-open observations.
      return { statut_diffusion_etablissement: e.statut_diffusion_etablissement, etat_administratif: e.etat_administratif };
    });
    return { ...(r.statut_diffusion === "O" ? pick(r, legalFields) : pick(r, ["statut_diffusion", "etat_administratif", "nombre_etablissements"])), matching_etablissements: matching };
  });
  return { payload: { ...pick(root, ["page", "per_page", "total_results", "total_pages"]), results }, observations };
}

/** Explicit bounded canary entry point only; not called by cron, UI, a France worker,
 * or Sirene discovery. Ledger must be durably bound to this authorization across restarts.
 */
export class DinumAnchorClient {
  private stopped = false;
  private busy = false;
  private calls: DinumReservation[];
  private lastCallStarted = 0;
  private observedSirets = new Map<string, Set<string>>();
  constructor(private ledger: DinumCallLedger, private fetcher: typeof fetch = fetch, priorCalls: DinumReservation[] = []) {
    this.calls = [...priorCalls];
    if (priorCalls.length > DINUM_ANCHOR_LIMITS.calls || priorCalls.some(c => !DINUM_CANARY_HANDLES.includes(c.handle as never))) throw new Error("dinum_prior_ledger_invalid");
  }
  async search(input: DinumInstagramAnchorInput, verification?: { siret: string; necessity: string }): Promise<DinumCallResult> {
    if (this.stopped || this.busy) throw new Error("dinum_gate_stopped_or_busy");
    const url = buildDinumAnchorQuery(input, verification), kind = verification ? "verification" : "initial";
    const previous = this.calls.filter(c => c.handle === input.instagramHandle);
    if (this.calls.length >= DINUM_ANCHOR_LIMITS.calls || previous.length >= DINUM_ANCHOR_LIMITS.perProfile || previous.some(c => c.kind === kind)) throw new Error("dinum_budget_or_replay_blocked");
    if (verification && (!previous.some(c => c.kind === "initial") || !this.observedSirets.get(input.instagramHandle)?.has(verification.siret))) throw new Error("dinum_verification_not_observed");
    const at = new Date().toISOString();
    const reservation: DinumReservation = { key: `${DINUM_ANCHOR_CANARY}:${input.instagramHandle}:${kind}`, handle: input.instagramHandle, kind, query: url.toString(), reservedAt: at };
    this.busy = true;
    try { if (!await this.ledger.reserve(reservation)) throw new Error("dinum_durable_reservation_denied"); }
    catch (e) { this.busy = false; this.stopped = true; throw e; }
    this.calls.push(reservation);
    const started = Date.now();
    const result: DinumCallResult = { reservation, httpStatus: null, contentType: null, durationMs: 0, schema: null, resultCount: null, outcome: "STOP", stopReason: null, retryAfter: null, projection: null, observations: [] };
    try {
      // Serial, at most one request/second; no retry after Retry-After or any STOP.
      const delay = Math.max(0, 1000 - (Date.now() - this.lastCallStarted));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      this.lastCallStarted = Date.now();
      const response = await this.fetcher(url, { method: "GET", headers: { Accept: "application/json", "User-Agent": "BMBInstagramAnchorCanary/1.0 (bounded owner-authorized identity verification)" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(DINUM_ANCHOR_LIMITS.timeoutMs) });
      result.httpStatus = response.status; result.contentType = response.headers.get("content-type");
      result.retryAfter = response.headers.get("retry-after")?.slice(0, 100) ?? null;
      if (!response.ok) { result.stopReason = `dinum_http_${response.status}`; return result; }
      if (response.redirected || !result.contentType?.includes("application/json")) { result.stopReason = "dinum_non_json_or_redirect"; return result; }
      const reader = response.body?.getReader(); if (!reader) { result.stopReason = "dinum_empty_body"; return result; }
      const chunks: Uint8Array[] = []; let bytes = 0;
      while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > DINUM_ANCHOR_LIMITS.bytes) { await reader.cancel(); result.stopReason = "dinum_payload_limit"; return result; } chunks.push(chunk.value); }
      let raw: unknown;
      try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { result.stopReason = "dinum_json_parsing"; return result; }
      result.schema = validateDinumAnchorSchema(raw);
      if (result.schema.status !== "PASS") { result.stopReason = "dinum_live_schema_mismatch"; return result; }
      const minimal = minimizedPayload(raw); // raw is never returned, logged or persisted.
      result.resultCount = Number(row(raw).total_results); result.observations = minimal.observations;
      this.observedSirets.set(input.instagramHandle, new Set(minimal.observations.map(e => text(e.siret))));
      result.projection = projectDinumEstablishment(minimal.payload, { country: "FR", requestedCity: input.targetCity, businessName: input.nameHint.value, observedAt: at,
        activityCompatibilityForCode: code => existingDinumActivityCompatibility(code, at) });
      result.outcome = "SUCCESS"; return result;
    } catch (error) {
      result.stopReason = error instanceof Error && /timeout|abort/i.test(error.name + error.message) ? "dinum_timeout" : "dinum_transport_failure";
      return result;
    } finally {
      result.durationMs = Date.now() - started;
      if (result.outcome === "STOP") this.stopped = true;
      try { await this.ledger.finish(result); } catch { this.stopped = true; this.busy = false; throw new Error("dinum_ledger_finish_failed_stop"); }
      this.busy = false;
    }
  }
}
