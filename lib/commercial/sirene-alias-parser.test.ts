import test from "node:test";
import assert from "node:assert/strict";
import { parseSireneAliases, SireneSchemaError } from "./sirene-alias-parser";
import { groupAliasOccurrences } from "./business-aliases-v2";
const at = "2026-09-28T00:00:00Z", siret = "05580205200039";
function fixture() { return { header: { statut: 200 }, etablissement: {
  siret, statutDiffusionEtablissement: "O",
  uniteLegale: { statutDiffusionUniteLegale: "O", etatAdministratifUniteLegale: "A", denominationUniteLegale: "LEGAL SAS", denominationUsuelle1UniteLegale: "Public name", denominationUsuelle2UniteLegale: null, denominationUsuelle3UniteLegale: "Other" },
  adresseEtablissement: { codeCommuneEtablissement: "13055", codePostalEtablissement: "13004", libelleCommuneEtablissement: "MARSEILLE", numeroVoieEtablissement: "37", typeVoieEtablissement: "BOULEVARD", libelleVoieEtablissement: "PHILIPPON" },
  periodesEtablissement: [{ dateFin: null, etatAdministratifEtablissement: "A", activitePrincipaleEtablissement: "96.02A", nomenclatureActivitePrincipaleEtablissement: "NAFRev2", denominationUsuelleEtablissement: " Émy’S Phair ", enseigne1Etablissement: "EMY'SPHAIR", enseigne2Etablissement: "SECOND LINE", enseigne3Etablissement: "THIRD LINE" }],
} }; }

test("official current-period names retain exact values, types and all origins", () => {
  const f = fixture(), before = JSON.stringify(f), result = parseSireneAliases(f, siret, at);
  assert.equal(result.schema, "PASS"); assert.equal(result.eligibility.prospectingEligible, true);
  assert.equal(result.aliases.length, 7);
  assert.equal(result.aliases[0].value, " Émy’S Phair ");
  assert.deepEqual(result.aliases.map(a => a.alias_type), ["ESTABLISHMENT_USUAL_NAME", "SIGN_NAME", "SIGN_NAME", "SIGN_NAME", "LEGAL_NAME", "LEGAL_UNIT_USUAL_NAME", "LEGAL_UNIT_USUAL_NAME"]);
  assert.equal(groupAliasOccurrences(result.aliases)[0].sources.length, 2);
  assert.equal(JSON.stringify(f), before);
  assert.ok(!result.aliases.some(a => a.value.includes("SECOND LINE THIRD LINE")));
  assert.ok(!("etablissement" in result));
});
test("documented nullable or absent optional names are benign", () => {
  const f = fixture();
  const p = f.etablissement.periodesEtablissement[0] as Record<string, unknown>;
  for (const key of ["enseigne1Etablissement", "enseigne2Etablissement", "enseigne3Etablissement", "denominationUsuelleEtablissement"]) p[key] = null;
  delete p.enseigne3Etablissement;
  assert.equal(parseSireneAliases(f, siret, at).aliases.length, 3);
});
test("restricted diffusion and inactive eligibility never yield aliases", () => {
  for (const change of ["establishment", "legal", "inactive", "activity"]) {
    const f = fixture();
    if (change === "establishment") f.etablissement.statutDiffusionEtablissement = "P";
    if (change === "legal") f.etablissement.uniteLegale.statutDiffusionUniteLegale = "P";
    if (change === "inactive") f.etablissement.periodesEtablissement[0].etatAdministratifEtablissement = "F";
    if (change === "activity") f.etablissement.periodesEtablissement[0].activitePrincipaleEtablissement = "01.11Z";
    const result = parseSireneAliases(f, siret, at);
    assert.equal(result.eligibility.prospectingEligible, false); assert.deepEqual(result.aliases, []);
  }
});
test("material schema mismatch fails closed before extraction", () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => { f.etablissement.siret = "10000706100011"; },
    (f: ReturnType<typeof fixture>) => { f.header.statut = 404; },
    (f: ReturnType<typeof fixture>) => { f.etablissement.periodesEtablissement.push({ ...f.etablissement.periodesEtablissement[0] }); },
    (f: ReturnType<typeof fixture>) => { f.etablissement.periodesEtablissement = []; },
    (f: ReturnType<typeof fixture>) => { (f.etablissement.periodesEtablissement[0] as Record<string, unknown>).enseigne2Etablissement = { invented: true }; },
    (f: ReturnType<typeof fixture>) => { (f.etablissement.uniteLegale as Record<string, unknown>).denominationUsuelle1UniteLegale = 7; },
    (f: ReturnType<typeof fixture>) => { delete (f.etablissement.uniteLegale as Record<string, unknown>).statutDiffusionUniteLegale; },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => parseSireneAliases(f, siret, at), SireneSchemaError); }
  assert.throws(() => parseSireneAliases({ etablissements: [fixture().etablissement] }, siret, at), SireneSchemaError);
});
