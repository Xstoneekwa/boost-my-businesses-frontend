import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assessFranceSerpCandidate, type FranceSerpCandidate } from "./france-acquisition.ts";
import { resolveCommercialLocation, deterministicCommercialPrecheck } from "./discovery-reliability.ts";
import { resolveFranceLocation } from "./france-location.ts";
import { buildCommercialDiscoveryQueries } from "./discovery-query-portfolio.ts";
import { COMMERCIAL_DISCOVERY_SUBSEGMENTS } from "./discovery-contract.ts";

const fixture: { candidates: Array<FranceSerpCandidate & { expectedKeep: boolean }>; localProof: { signals: Parameters<typeof resolveFranceLocation>[0] } } = JSON.parse(readFileSync(new URL("./fixtures/france-acquisition-v5.json", import.meta.url), "utf8"));
for (const candidate of fixture.candidates) test(`V5 SERP triage ${candidate.username}: ${candidate.expectedKeep ? "retain" : "reject before lookup"}`, () => {
  assert.equal(assessFranceSerpCandidate(candidate).keep, candidate.expectedKeep);
});
test("V5 replay removes eight unrelated candidates while retaining both beauty hints", () => {
  const kept = fixture.candidates.filter(c => assessFranceSerpCandidate(c).keep);
  assert.deepEqual(kept.map(c => c.username), ["mhaesthetic.clinic", "paris.aesthetic.surgery"]);
  assert.equal(fixture.candidates.length - kept.length, 8);
});
for (const label of ["Salon de coiffure Paris", "Institut de beauté", "Nail studio", "Barber shop", "Technicienne cils", "Maquilleuse de musiciens", "Beauty school salon", "Laser clinic Tech Solutions", "Wellness massage"]) test(`real beauty service survives triage: ${label}`, () => {
  assert.equal(assessFranceSerpCandidate({ username: "salon", profileUrl: "https://instagram.com/salon/", title: label, snippet: "" }).keep, true);
});
test("unknown snippets and personal-looking names are not rejected by absence of keywords", () => {
  for (const title of ["Maison Camille", "Claire Martin", "", "L’Atelier"]) assert.equal(assessFranceSerpCandidate({ username: "camille", profileUrl: "https://instagram.com/camille/", title, snippet: null }).keep, true);
  // Query/handle wording cannot rescue an explicitly unrelated SERP record.
  assert.equal(assessFranceSerpCandidate({ username: "beautyparis", profileUrl: "https://instagram.com/beautyparis/", title: "Student-led school news", snippet: "" }).keep, false);
});
test("technical and spoofed URLs never become France business profiles", () => {
  for (const profileUrl of ["https://instagram.com/policy/", "https://instagram.com/privacy/", "https://instagram.com/accounts/login/", "https://instagram.com/p/photo/", "https://instagram.com/explore/", "https://instagram.com.evil.invalid/salon/", "https://u:p@instagram.com/salon/", "http://instagram.com/salon/", "https://instagram.com/other/"]) {
    assert.equal(assessFranceSerpCandidate({ username: "salon", profileUrl, title: "Salon de beauté Paris", snippet: "" }).keep, false, profileUrl);
  }
  assert.equal(assessFranceSerpCandidate({ username: "policy.skin", profileUrl: "https://instagram.com/policy.skin/", title: "Skin clinic", snippet: "" }).keep, true);
});
for (const city of ["Paris", "Marseille", "Lyon", "Annecy", "Saint-Rémy-de-Provence"]) test(`French portfolio is diverse and bounded in ${city}`, () => {
  const queries = buildCommercialDiscoveryQueries(city, undefined, "FR");
  assert.equal(queries.length, 10); assert.equal(new Set(queries).size, 10);
  assert.ok(queries.every(q => q.includes(`"${city}"`) && q.includes("France") && q.includes("-inurl:/policy/")));
  assert.ok(queries.some(q => q.includes("coiffure"))); assert.ok(queries.some(q => q.includes("onglerie"))); assert.ok(queries.some(q => q.includes("barbier")));
  assert.ok(queries.every(q => !q.includes(" booking")));
  for (const subsegment of COMMERCIAL_DISCOVERY_SUBSEGMENTS) {
    const targeted = buildCommercialDiscoveryQueries(city, subsegment, "FR");
    assert.equal(targeted.length, 6); assert.ok(targeted.every(q => q.includes(`"${city}"`) && q.includes("France")));
  }
});
test("V5 local first-party proof reaches precheck only, never fabricated identity HIGH", () => {
  const l = resolveCommercialLocation({countryCode:"FR", requestedCity:"Paris", signals:fixture.localProof.signals});
  assert.equal(l.country,"FR");assert.equal(l.city,"Paris");assert.equal(l.confidence,"MEDIUM");
  assert.ok(l.evidence.every(e=>e.source==="instagram"));
  assert.ok(l.evidence.some(e=>e.value.includes("Paris 16e")));
  assert.equal(deterministicCommercialPrecheck({countryCode:"FR",requestedCity:"Paris",profileName:fixture.localProof.signals.instagram?.[0],location:l}).decision,"PRECHECK_PASS");
  assert.equal("matchedHandle" in l,false);
});
for (const [city,proof] of [["Paris","Institut de beauté — Paris 16e Sur rendez-vous"],["Lyon","Salon de coiffure Lyon 3e sur rendez-vous"],["Marseille","Institut Marseille 8e, prestations sur rendez-vous"],["Annecy","1 rue du Lac 74000 Annecy"],["Saint-Rémy-de-Provence","5 rue du Lac 13210 Saint-Rémy-de-Provence"]]) test(`first-party local format is usable but capped MEDIUM: ${city}`,()=>{
  const l=resolveCommercialLocation({countryCode:"FR",requestedCity:city,signals:{instagram:[proof],website:[proof]}});
  assert.equal(l.country,"FR");assert.equal(l.city,city);assert.equal(l.confidence,"MEDIUM");
});
test("country/run/query/name/DM activity alone never prove location",()=>{
  for(const signals of [{},{provider:["Clinique esthétique Paris 16e rendez-vous"]},{instagram:["Paris"]},{instagram:["MÉDECINE ESTHÉTIQUE PARIS"]},{instagram:["DM pour RDV"]},{instagram:["Vacances à Paris 16e, salon"]},{instagram:["Salon Paris 21e sur rendez-vous"]},{instagram:["Salon Lyon 16e sur rendez-vous"]},{instagram:["Salon Annecy 16e sur rendez-vous"]}]) {
    assert.equal(resolveCommercialLocation({countryCode:"FR",requestedCity:"Paris",signals}).country,null,JSON.stringify(signals));
  }
  assert.equal(resolveFranceLocation({instagram:["Salon Paris 16e sur rendez-vous"]}).country,null);
});
test("foreign and other-city contradictions remain fail-closed",()=>{
  for(const foreign of ["Paris, Canada","Paris, Texas USA"]) assert.equal(resolveCommercialLocation({countryCode:"FR",requestedCity:"Paris",signals:{instagram:["Salon Paris 16e rendez-vous",foreign]}}).country,null);
  assert.equal(resolveCommercialLocation({countryCode:"FR",requestedCity:"Paris",signals:{instagram:["Salon Paris 16e rendez-vous"],website:["Lyon, France"]}}).country,null);
  assert.equal(resolveCommercialLocation({countryCode:"FR",requestedCity:"Paris",signals:{instagram:["Salon Paris 16e rendez-vous"],website:["1 rue du Port 13003 Marseille"]}}).country,null);
  assert.equal(resolveCommercialLocation({countryCode:"FR",requestedCity:"Paris",signals:{instagram:["Salon Paris 16e rendez-vous"],website:["Cabinet Lyon 3e sur rendez-vous"]}}).country,null);
});
test("ZA, legacy nationwide France and existing explicit HIGH thresholds remain unchanged",()=>{
  assert.equal(buildCommercialDiscoveryQueries("Cape Town","Hair Salon","ZA")[0],'site:instagram.com/ "hair salon" "Cape Town" South Africa');
  assert.ok(buildCommercialDiscoveryQueries("France").every(q=>q.includes('"France"')&&!q.includes("-inurl")));
  const signals={instagram:["Paris, France"],provider:["Paris, France"]};
  assert.equal(resolveCommercialLocation({countryCode:"FR",requestedCity:"Paris",signals}).confidence,"HIGH");
  assert.deepEqual(resolveCommercialLocation({countryCode:"ZA",requestedCity:"Cape Town",signals:{instagram:["Cape Town"]}}),resolveCommercialLocation({requestedCity:"Cape Town",signals:{instagram:["Cape Town"]}}));
});
