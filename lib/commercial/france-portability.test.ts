import assert from "node:assert/strict";
import test from "node:test";
import { COMMERCIAL_MARKETS } from "./market-config.ts";
import { parseCommercialDiscoveryTrigger } from "./discovery-contract.ts";
import { buildCommercialDiscoveryQueries } from "./discovery-query-portfolio.ts";
import { resolveCommercialLocation, deterministicCommercialPrecheck, enrichCommercialWebsite } from "./discovery-reliability.ts";

test("France configuration is national, French and Europe/Paris; SA unchanged", () => {
  assert.equal(COMMERCIAL_MARKETS.FR.timezone, "Europe/Paris");
  assert.equal(COMMERCIAL_MARKETS.FR.language, "fr");
  assert.equal(COMMERCIAL_MARKETS.ZA.timezone, "Africa/Johannesburg");
  assert.equal(parseCommercialDiscoveryTrigger({city:"France",maxProspects:30,idempotencyKey:"test"}).city,"France");
  assert.equal(parseCommercialDiscoveryTrigger({city:"France",subsegment:null,maxProspects:30,idempotencyKey:"disabled-form-field",forceRescore:false}).subsegment,undefined);
  assert.throws(()=>parseCommercialDiscoveryTrigger({city:"France",subsegment:"Hair Salon",maxProspects:30,idempotencyKey:"test"}));
  for (const maxProspects of [1,31,100]) assert.throws(()=>parseCommercialDiscoveryTrigger({city:"France",maxProspects,idempotencyKey:"test"}));
  assert.throws(()=>parseCommercialDiscoveryTrigger({city:"France",maxProspects:30,forceRescore:true,idempotencyKey:"test"}));
  assert.ok(buildCommercialDiscoveryQueries("France").every(q=>q.includes('"France"')&&!q.includes("Paris")));
  assert.equal(buildCommercialDiscoveryQueries("Cape Town","Hair Salon")[0],'site:instagram.com/ "hair salon" "Cape Town" South Africa');
});

test("France canary accepts owner-supplied cities without a city-specific engine branch", () => {
  for (const city of ["Paris", "Marseille", "Lyon", "Lille"]) {
    const parsed = parseCommercialDiscoveryTrigger({ countryCode: "FR", city, maxProspects: 30, idempotencyKey: "commercial-france-canary-v1" });
    assert.equal(parsed.countryCode, "FR");
    assert.equal(parsed.city, city);
    assert.ok(buildCommercialDiscoveryQueries(city, "Hair Salon", "FR").every((query) => query.includes(`"${city}"`) && query.includes("France")));
  }
});

test("language, French names and French domains never prove France location", () => {
  for (const value of ["Institut de beauté Sophie", "Paris", "salon.fr", "Paris, Canada", "Bruxelles, Belgique", "Montréal, Québec", "Made in France"]) {
    assert.equal(resolveCommercialLocation({requestedCity:"France",signals:{instagram:[value]}}).country,null,value);
  }
});

test("explicit actual cities and structured postal evidence survive without a city allowlist", () => {
  for (const city of ["Paris","Saint-Rémy-de-Provence","Annecy","Aix-en-Provence"]) {
    const l=resolveCommercialLocation({requestedCity:"France",signals:{instagram:[`${city}, France`],provider:[`${city}, France`]}});
    assert.equal(l.country,"FR");assert.equal(l.city,city);assert.equal(l.confidence,"HIGH");
    assert.equal(deterministicCommercialPrecheck({requestedCity:"France",profileName:"Institut esthétique",location:l}).decision,"PRECHECK_PASS");
  }
  const l=resolveCommercialLocation({requestedCity:"France",signals:{structured_metadata:["10 rue de la Paix 75002 Paris, France"]}});
  assert.equal(l.city,"Paris");assert.equal(l.confidence,"HIGH");
});

test("conflicting French cities fail closed and SA evidence remains unchanged",()=>{
  assert.equal(resolveCommercialLocation({requestedCity:"France",signals:{instagram:["Paris, France"],website:["Lyon, France"]}}).country,null);
  assert.equal(resolveCommercialLocation({requestedCity:"Cape Town",signals:{instagram:["Sea Point"],provider:["Cape Town"]}}).country,"ZA");
});

test("existing bounded enrichment extracts FR structured address without inventing city",async()=>{
  const html='<script type="application/ld+json">{"@type":"BeautySalon","address":{"addressCountry":"FR","addressLocality":"Annecy","postalCode":"74000","streetAddress":"1 rue du Lac"}}</script>';
  const website=await enrichCommercialWebsite({market:"FR",websiteUrl:"https://example.com",fetchImpl:async()=>new Response(html,{headers:{"content-type":"text/html"}})});
  assert.equal(website.address,"1 rue du Lac 74000 Annecy, France");assert.equal(website.pagesFetched,1);
});
