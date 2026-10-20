import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DinumAnchorClient, DINUM_ANCHOR_LIMITS, DINUM_ANCHOR_CANARY, buildDinumAnchorQuery, validateDinumAnchorSchema, existingDinumActivityCompatibility, type DinumInstagramAnchorInput, type DinumCallResult, type DinumReservation } from "./dinum-anchor-client";
import { projectDinumEstablishment } from "./dinum-establishment-projection";

const at = "2026-10-19T12:00:00Z";
const input: DinumInstagramAnchorInput = { instagramHandle: "lemaitrebarbierparis", profileUrl: "https://www.instagram.com/lemaitrebarbierparis/", sourceItemId: "8a093a0c-e7d0-4e3c-990b-9b8ad453a38f", nameHint: { value: "Atelier Fixture", sourceReference: "commercial_discovery_items:fixture", fieldPath: "instagram.metadata.profile_name" }, targetCity: "Paris" };
const payload = () => ({ page: 1, per_page: 5, total_results: 1, total_pages: 1, results: [{ siren: "001234567", nom_raison_sociale: "SOCIETE FIXTURE", statut_diffusion: "O", etat_administratif: "A", nombre_etablissements: 1, date_mise_a_jour_insee: null, dirigeants: [{ secret: "DO_NOT_PERSIST" }], finances: { secret: "DO_NOT_PERSIST" }, matching_etablissements: [{ siret: "00123456700001", nom_commercial: "Atelier Fixture", liste_enseignes: null, adresse: "12 RUE EXEMPLE 75018 PARIS 18", code_postal: "75018", commune: "75118", libelle_commune: "PARIS 18", activite_principale: "96.02A", statut_diffusion_etablissement: "O", etat_administratif: "A" }] }] });
function harness(fetcher: typeof fetch = async () => Response.json(payload()), prior: DinumReservation[] = [], reserveResult = true) {
  const reservations: DinumReservation[] = [], finished: DinumCallResult[] = [];
  const client = new DinumAnchorClient({ reserve: async entry => { reservations.push(entry); return reserveResult; }, finish: async r => { finished.push(structuredClone(r)); } }, fetcher, prior);
  return { client, reservations, finished };
}
test("Instagram-first known profile and provenance required before any transport", async () => {
  let calls = 0; const h = harness(async () => { calls++; return Response.json(payload()); });
  for (const change of [{ instagramHandle: "other" }, { profileUrl: "https://instagram.com/different/" }, { sourceItemId: "" }, { nameHint: { ...input.nameHint, fieldPath: "" } }]) await assert.rejects(h.client.search({ ...input, ...change }), /instagram_first/);
  assert.equal(calls, 0); assert.equal(h.reservations.length, 0);
});
test("exact GET /search, minimized include, first page only and observed territorial filters", () => {
  const url = buildDinumAnchorQuery({ ...input, observedPostalCode: { value: "75018", sourceReference: "historical_observation", fieldPath: "website.address" } });
  assert.equal(url.origin, "https://recherche-entreprises.api.gouv.fr"); assert.equal(url.pathname, "/search"); assert.equal(url.searchParams.get("q"), "Atelier Fixture Paris");
  assert.equal(url.searchParams.get("include"), "matching_etablissements"); assert.equal(url.searchParams.get("minimal"), "true");
  assert.equal(url.searchParams.get("page"), "1"); assert.equal(url.searchParams.get("page_etablissements"), "1"); assert.equal(url.searchParams.get("per_page"), "5");
  assert.equal(url.searchParams.get("code_postal"), "75018"); assert.equal(url.searchParams.has("departement"), false); assert.equal(url.searchParams.has("activite_principale"), false);
  assert.throws(() => buildDinumAnchorQuery({ ...input, observedDepartment: { value: "75", sourceReference: "", fieldPath: "" } }), /provenance/);
});
test("valid documented payload without departement/source date at establishment admits via observed COG", async () => {
  const h = harness(); const r = await h.client.search(input);
  assert.equal(r.schema?.status, "PASS"); assert.equal(r.outcome, "SUCCESS"); assert.equal(r.projection?.matchState, "UNIQUE_MATCH");
  assert.equal(r.projection?.candidate?.department, "75"); assert.equal(r.projection?.candidate?.source.lineage?.fieldPaths.departmentDerivedFrom, "results[0].matching_etablissements[0].commune");
  assert.equal(r.projection?.candidate?.source.lineage?.providerUpdatedAt, null); assert.equal(r.projection?.candidate?.source.lineage?.rawAdminCity, "PARIS 18");
  assert.equal(h.reservations.length, 1); assert.equal(h.finished.length, 1);
  assert.doesNotMatch(JSON.stringify(r), /DO_NOT_PERSIST|dirigeants|finances|dateFin|periodesEtablissement/);
});
test("conflicting explicit department is still rejected, never overwritten by derived COG", () => {
  const p = payload(); Object.assign(p.results[0].matching_etablissements[0], { departement: "13" });
  const r = projectDinumEstablishment(p, { country: "FR", requestedCity: "Paris", businessName: "Atelier Fixture", observedAt: at, activityCompatibilityForCode: c => existingDinumActivityCompatibility(c, at) });
  assert.equal(r.matchState, "CONTRADICTION"); assert.equal(r.candidate, null);
});
test("existing activity rule only supplies positive coverage; medical/other code stays UNKNOWN/HOLD", async () => {
  assert.equal(existingDinumActivityCompatibility("96.02A", at)?.ruleReference, "FR_BEAUTY_ACTIVITY_FILTER_V1");
  assert.equal(existingDinumActivityCompatibility("96.02B", at)?.compatible, true);
  assert.equal(existingDinumActivityCompatibility("86.90F", at), undefined); assert.equal(existingDinumActivityCompatibility("96.02A", "2027-01-01"), undefined);
  const p = payload(); p.results[0].matching_etablissements[0].activite_principale = "86.90F";
  const r = await harness(async () => Response.json(p)).client.search(input);
  assert.equal(r.projection?.reason, "authorized_activity_compatibility_missing"); assert.equal(r.projection?.disposition, "HOLD");
});
test("successful response never implies Instagram HIGH/scoring and no inactive/self-call hook exists", async () => {
  const r = await harness().client.search(input); assert.ok(r.projection?.anchor); assert.equal("identity" in r, false);
  const source = readFileSync(new URL("./dinum-anchor-client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env|api_key|Authorization:|analyzeCommercial|scoreCommercial|\.rpc\(|sendEmail/);
});
test("no mutation of raw input and no false raw departement/date field manufactured", () => {
  const p = payload(), before = JSON.stringify(p); const r = projectDinumEstablishment(p, { country: "FR", requestedCity: "Paris", businessName: "Atelier Fixture", observedAt: at, activityCompatibilityForCode: c => existingDinumActivityCompatibility(c, at) });
  assert.equal(JSON.stringify(p), before); assert.equal("departement" in p.results[0].matching_etablissements[0], false);
  assert.equal(r.candidate?.source.lineage?.fieldPaths.departement, undefined);
});
test("HTTP 429 captures Retry-After and stops all subsequent calls, without retry", async () => {
  let calls = 0; const h = harness(async () => { calls++; return new Response("do not store", { status: 429, headers: { "retry-after": "60" } }); });
  const r = await h.client.search(input); assert.equal(r.httpStatus, 429); assert.equal(r.retryAfter, "60"); assert.equal(r.outcome, "STOP");
  assert.equal(r.observations.length, 0); await assert.rejects(h.client.search({ ...input, instagramHandle: "lashbyiava", profileUrl: "https://instagram.com/lashbyiava/" }), /gate_stopped/); assert.equal(calls, 1);
});
for (const status of [400, 401, 403, 500, 503]) test(`provider HTTP ${status} is terminal, no error body persisted`, async () => {
  const h = harness(async () => new Response("private arbitrary provider body", { status })); const r = await h.client.search(input);
  assert.equal(r.stopReason, `dinum_http_${status}`); assert.doesNotMatch(JSON.stringify(r), /private arbitrary/); assert.equal(h.finished[0].outcome, "STOP");
});
test("timeout is one failed attempt, no retry", async () => {
  let calls = 0; const h = harness(async () => { calls++; throw new DOMException("operation timed out", "TimeoutError"); });
  assert.equal((await h.client.search(input)).stopReason, "dinum_timeout"); assert.equal(calls, 1);
});
for (const [body, contentType, reason] of [["<html>not JSON</html>", "text/html", "dinum_non_json_or_redirect"], ["{malformed", "application/json", "dinum_json_parsing"]]) test(`response guard ${reason}`, async () => {
  const r = await harness(async () => new Response(body, { headers: { "content-type": contentType } })).client.search(input); assert.equal(r.stopReason, reason); assert.equal(r.projection, null);
});
test("payload byte limit fail-closed without persisting response", async () => {
  const r = await harness(async () => new Response("x".repeat(DINUM_ANCHOR_LIMITS.bytes + 1), { headers: { "content-type": "application/json" } })).client.search(input);
  assert.equal(r.stopReason, "dinum_payload_limit"); assert.equal(r.observations.length, 0);
});
test("first live schema mismatch stops before any business observation/anchor persistence", async () => {
  const p = payload(); Object.assign(p.results[0], { matching_etablissements: {} });
  const h = harness(async () => Response.json(p)); const r = await h.client.search(input);
  assert.equal(r.stopReason, "dinum_live_schema_mismatch"); assert.equal(r.schema?.status, "FAIL"); assert.equal(r.observations.length, 0); assert.equal(r.projection, null);
  assert.doesNotMatch(JSON.stringify(r), /00123456700001|SOCIETE FIXTURE/);
  await assert.rejects(h.client.search(input), /gate_stopped/);
});
test("non-open statuses preserve HOLD without retaining identifiers, names or address", async () => {
  const p = payload(); p.results[0].statut_diffusion = "P"; const r = await harness(async () => Response.json(p)).client.search(input);
  assert.equal(r.schema?.status, "PASS"); assert.equal(r.projection?.disposition, "HOLD"); assert.equal(r.observations.length, 0);
  assert.doesNotMatch(JSON.stringify(r), /00123456700001|SOCIETE FIXTURE|RUE EXEMPLE/);
});
test("pagination or unexamined establishments HOLD; client never auto-paginates", async () => {
  let calls = 0; const p = payload(); p.total_results = 20; p.total_pages = 4;
  const r = await harness(async () => { calls++; return Response.json(p); }).client.search(input);
  assert.equal(r.projection?.matchState, "AMBIGUOUS"); assert.equal(calls, 1);
  const p2 = payload(); p2.results[0].nombre_etablissements = 3; assert.equal((await harness(async () => Response.json(p2)).client.search(input)).projection?.reason, "unexamined_legal_unit_establishments");
});
test("no-result first page is valid schema but never produces an anchor", async () => {
  const r = await harness(async () => Response.json({ page: 1, per_page: 5, total_results: 0, total_pages: 0, results: [] })).client.search(input);
  assert.equal(r.schema?.status, "PASS"); assert.equal(r.projection?.matchState, "NO_MATCH"); assert.equal(r.projection?.anchor, null);
});
test("durable ledger replay denial happens before transport", async () => {
  let calls = 0; const h = harness(async () => { calls++; return Response.json(payload()); }, [], false);
  await assert.rejects(h.client.search(input), /reservation_denied/); assert.equal(calls, 0);
});
test("same initial operation cannot run twice; max total remains eight", async () => {
  const h = harness(); await h.client.search(input); await assert.rejects(h.client.search(input), /budget_or_replay/);
  const prior = Array.from({ length: 8 }, (_, i): DinumReservation => ({ key: `${i}`, handle: "lemaitrebarbierparis", kind: "initial", query: "fixture", reservedAt: at }));
  let calls = 0; const full = harness(async () => { calls++; return Response.json(payload()); }, prior);
  await assert.rejects(full.client.search(input), /budget_or_replay/); assert.equal(calls, 0);
});
test("only one explicitly necessary observed-SIRET verification, never automatic or arbitrary", async () => {
  let calls = 0; const h = harness(async () => { calls++; return Response.json(payload()); });
  await assert.rejects(h.client.search(input, { siret: "00123456700001", necessity: "test" }), /not_observed/);
  await h.client.search(input); assert.equal(calls, 1);
  await assert.rejects(h.client.search(input, { siret: "99999999900001", necessity: "test" }), /not_observed/);
  const r = await h.client.search(input, { siret: "00123456700001", necessity: "Explicit fixture-only verification" }); assert.equal(r.reservation.kind, "verification"); assert.equal(calls, 2);
  await assert.rejects(h.client.search(input, { siret: "00123456700001", necessity: "third" }), /budget_or_replay/);
});
test("transport errors are finished failed, ledger-finish failure prevents future calls", async () => {
  const ledger = { reserve: async () => true, finish: async () => { throw new Error("storage unavailable"); } };
  const client = new DinumAnchorClient(ledger, async () => Response.json(payload()));
  await assert.rejects(client.search(input), /ledger_finish_failed/); await assert.rejects(client.search(input), /gate_stopped/);
});
test("schema rejects malformed SIRET/date/array/counters, accepts documented optional nulls", () => {
  assert.equal(validateDinumAnchorSchema(payload()).status, "PASS");
  for (const change of [{ siret: 12345678900000 }, { liste_enseignes: {} }, { code_postal: {} }, { date_mise_a_jour_insee: "bad" }]) { const p = payload(); Object.assign(p.results[0].matching_etablissements[0], change); assert.equal(validateDinumAnchorSchema(p).status, "FAIL"); }
  const p = payload(); p.results = Array.from({ length: 6 }, () => payload().results[0]); assert.equal(validateDinumAnchorSchema(p).status, "FAIL");
});
test("ledger keys are source-authorization scoped, no reuse of historical Sirene POC run", async () => {
  const r = await harness().client.search(input); assert.ok(r.reservation.key.startsWith(DINUM_ANCHOR_CANARY));
  assert.doesNotMatch(r.reservation.key, /commercial-france-wide-sirene-poc15/);
});
