import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("./PartnersPage.tsx", import.meta.url), "utf8");
test("partners uses canonical destinations, without introducing checkout", () => {
  for (const href of ["/instagram-growth", "/instagram-growth#pricing", "https://calendly.com/boostmybusinesses/discovertheassistant"]) assert.ok(source.includes(href));
  assert.doesNotMatch(source, /fetch\(|stripe\.com|\/api\/checkout|price_[A-Za-z0-9]+/);
});
test("partners retains bilingual copy, one H1 and native accessible FAQ", () => {
  assert.equal((source.match(/<h1\b/g) || []).length, 1);
  assert.match(source, /en: \{/);
  assert.match(source, /fr: \{/);
  assert.match(source, /<details/);
  assert.match(source, /<summary/);
  assert.match(source, /aria-pressed/);
});
test("shared marketing language keeps Instagram key and legacy fallback", () => {
  const lang = readFileSync(new URL("../components/useMarketingLanguage.ts", import.meta.url), "utf8");
  assert.match(lang, /getItem\("bmb_lang"\)/);
  assert.match(lang, /setItem\("bmb_lang", next\)/);
  assert.match(lang, /boost_ai_landing_lang_v1/);
});
test("both required marketing entry points expose partners", () => {
  for (const file of ["../components/MarketingPages.tsx", "../../public/instagram-growth/index.html"]) {
    assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /href="\/partners"/);
  }
});
test("commercial scope is explicit in both languages", () => {
  assert.match(source, /Not in this V1/);
  assert.match(source, /Pas dans cette V1/);
  assert.match(source, /existing volume programme/);
  assert.match(source, /programme volume existant/);
});
