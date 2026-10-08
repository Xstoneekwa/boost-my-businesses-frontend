import test from "node:test";
import assert from "node:assert/strict";
import { groupAliasOccurrences, normalizeAliasLookup, type BusinessAliasOccurrence } from "./business-aliases-v2";
import { assertSireneAliasTarget, SIRENE_ALIAS_RUN_ID, SIRENE_ALIAS_TARGETS } from "./sirene-alias-diagnostic-contract";

const occurrence = (value: string, field: string): BusinessAliasOccurrence => ({
  value, normalized_lookup_value: normalizeAliasLookup(value), alias_type: "OTHER_PROVIDER_ALIAS",
  provider: "future_provider", source_field: field, source_reference: "fixture:business:42", observed_at: "2026-09-28T00:00:00Z",
});

test("alias equivalence is comparison-only and retains every source occurrence", () => {
  const aliases = [occurrence("  Émy’S Phair  ", "usual_name"), occurrence("EMY'SPHAIR", "sign_name")];
  const before = JSON.stringify(aliases);
  const grouped = groupAliasOccurrences(aliases);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].sources.length, 2);
  assert.equal(grouped[0].value, "  Émy’S Phair  ");
  assert.equal(JSON.stringify(aliases), before);
  assert.deepEqual(grouped[0].sources.map(source => source.source_field), ["usual_name", "sign_name"]);
});

test("distinct occurrences are not concatenated or semantically split", () => {
  const aliases = [occurrence("SALON", "line1"), occurrence("EXAMPLE", "line2"), occurrence("BEAUTY & HAIR", "line3")];
  assert.deepEqual(groupAliasOccurrences(aliases).map(alias => alias.value), ["SALON", "EXAMPLE", "BEAUTY & HAIR"]);
});

test("empty aliases and inconsistent comparison values fail closed", () => {
  assert.deepEqual(groupAliasOccurrences([]), []);
  assert.throws(() => groupAliasOccurrences([occurrence("  ", "name")]), /alias_normalization_invalid/);
  assert.throws(() => groupAliasOccurrences([{ ...occurrence("Salon", "name"), normalized_lookup_value: "other" }]), /alias_normalization_invalid/);
});

test("only exact existing four MEDIUM identities can pass the execution boundary", () => {
  for (const target of SIRENE_ALIAS_TARGETS) {
    const input = { ...target, runId: SIRENE_ALIAS_RUN_ID, confidence: "MEDIUM", eligible: true, leadId: null, selected: false };
    assert.deepEqual(assertSireneAliasTarget(input), target);
    for (const change of [{ siret: "05580205200040" }, { itemId: "other" }, { businessId: "other" }, { runId: "other" }, { confidence: "LOW" }, { confidence: "HIGH" }, { eligible: false }, { selected: true }, { leadId: "new-lead" }]) {
      assert.throws(() => assertSireneAliasTarget({ ...input, ...change }), /candidate_not_authorized/);
    }
  }
});
