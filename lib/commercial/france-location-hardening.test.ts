import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveFranceLocation, franceNonLocalServiceReason } from "./france-location.ts";
import { resolveCommercialLocation } from "./discovery-reliability.ts";
import { franceDiagnosticFetcher, type FranceQueryDiagnostic } from "./france-query-diagnostics.ts";
const captures: Array<{handle:string;signals:Parameters<typeof resolveFranceLocation>[0]}> = JSON.parse(readFileSync(new URL("./fixtures/france-location-rejected-v1.json", import.meta.url), "utf8"));

test("exact Marseille postal/country regression and provenance", () => {
  const result = resolveFranceLocation({ instagram: ["13003 Marseille France"] });
  assert.equal(result.city, "Marseille"); assert.equal(result.postalCode, "13003"); assert.equal(result.country, "FR");
  assert.equal(result.evidence[0].raw_evidence,"13003 Marseille France");
  assert.equal(result.evidence[0].normalized_country,"FR");
  assert.equal(result.evidence[0].evidence_source,"instagram");
});
test("postal address with suffix, Unicode case, apostrophe and country boundary", () => {
  for(const city of ["Marseille","Saint-Rémy-de-Provence","L’Haÿ-les-Roses"]) {
    const result = resolveFranceLocation({ instagram: ["13003 "+city+" France @profile"] });
    assert.equal(result.city,city); assert.ok(!result.city?.endsWith(" France"));
  }
  assert.equal(resolveFranceLocation({instagram:["PARIS, FRANCE"]}).city,"Paris");
  assert.equal(resolveFranceLocation({instagram:["Tremblay-en-france (93) 🇫🇷"]}).city,"Tremblay-en-France");
});
test("offline replay: exactly two explicit proofs recovered; other nine remain unresolved", () => {
  assert.equal(captures.length,11);
  const resolved = captures.filter(r => resolveFranceLocation(r.signals).country==="FR").map(r=>r.handle);
  assert.deepEqual(resolved,["beautyfulbeauty_","femme_de_beleza"]);
  for(const value of ["Made in France\nViriat la Neuve","Environ Skin Care France","211 rue Jean Jaures à Onnaing 59264","Paris","Marseille📍🇲🇫","Paris, Canada","Institut de beauté français","Lyon #france"]) {
    assert.equal(resolveFranceLocation({instagram:[value]}).country,null,value);
  }
  assert.equal(resolveFranceLocation({instagram:["Paris, France","Lyon, France"]}).country,null);
});
test("training exclusion is France-only, not independent practitioners offering training", () => {
  assert.equal(franceNonLocalServiceReason("CIME - Collège International de Médecine Esthétique","Formations certifiées QUALIOPI"),"fr_training_only_organization");
  assert.equal(franceNonLocalServiceReason("Salon Camille","Prestations clientes et formations QUALIOPI"),null);
  assert.equal(franceNonLocalServiceReason("Guinot","N°1 en Institut de Beauté en France"),null);
});
test("SA location result unchanged, with no France-only keys", () => {
  assert.deepEqual(resolveCommercialLocation({requestedCity:"Cape Town",signals:{instagram:["Cape Town"]}}),{
    country:"ZA",city:"Cape Town",confidence:"MEDIUM",confidenceScore:0.72,evidence:[{source:"instagram",value:"Cape Town",city:"Cape Town"}]
  });
});
test("France diagnostics distinguish zero results, HTTP, malformed and timeout; no key stored/retry", async () => {
  const logs:FranceQueryDiagnostic[]=[];let calls=0;
  const payloads = [new Response('{"organic_results":[]}'), new Response("busy",{status:429}), new Response("not json")];
  const fetcher=franceDiagnosticFetcher(async()=>{ calls++;return payloads.shift()!;},logs);
  for(let i=0;i<3;i++) await fetcher("https://provider.invalid/?q=local&api_key=SECRET");
  const timeout=franceDiagnosticFetcher(async()=>{throw new DOMException("timeout","AbortError");},logs);
  await assert.rejects(()=>timeout("https://provider.invalid/?q=slow"));
  assert.equal(calls,3);assert.deepEqual(logs.map(r=>r.category),["ZERO_RESULTS","RATE_LIMITED","MALFORMED_JSON","TIMEOUT"]);
  assert.ok(!JSON.stringify(logs).includes("SECRET"));
});
