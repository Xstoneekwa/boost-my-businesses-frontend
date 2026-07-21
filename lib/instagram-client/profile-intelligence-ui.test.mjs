import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { profileAiEmptyValueCopy, profileAiFieldLabel } from "./profile-intelligence-ui.ts";

test("AI field labels reserve To analyze for the pre-call state", () => {
  assert.equal(profileAiFieldLabel({ lang: "fr", status: "not_started", field: "niche", source: "unknown", edited: false }), "À analyser");
  assert.equal(profileAiFieldLabel({ lang: "en", status: "running", field: "niche", source: "unknown", edited: false }), "Analysis in progress");
  assert.equal(profileAiFieldLabel({ lang: "fr", status: "failed_retryable", field: "niche", source: "unknown", edited: false }), "À relancer ou compléter manuellement");
});

test("completed empty V4 suggestions keep completed AI provenance", () => {
  assert.equal(profileAiFieldLabel({ lang: "fr", status: "completed", field: "niche", source: "unknown", edited: false }), "Suggéré par l'analyse");
  assert.equal(profileAiFieldLabel({ lang: "en", status: "completed", field: "niche", source: "ai_suggested", edited: false }), "Suggested by the analysis");
});

test("editing or confirming a suggestion changes its UI provenance", () => {
  assert.equal(profileAiFieldLabel({ lang: "fr", status: "completed", field: "suggestedCategory", qualityStatus: "insufficient", source: "ai_suggested", edited: true }), "Confirmé par vous");
  assert.equal(profileAiFieldLabel({ lang: "en", status: "completed", field: "niche", source: "user_confirmed", edited: false }), "Confirmed by you");
});

test("partially accepted optional fields and empty exclusions expose final field-level states", () => {
  assert.equal(profileAiFieldLabel({ lang: "fr", status: "completed", field: "suggestedCategory", qualityStatus: "insufficient", source: "ai_suggested", edited: false }), "Aucune suggestion fiable");
  assert.equal(profileAiFieldLabel({ lang: "en", status: "completed", field: "businessDescription", qualityStatus: "empty_valid", source: "ai_suggested", edited: false }), "No reliable suggestion");
  assert.equal(profileAiFieldLabel({ lang: "fr", status: "completed", field: "exclusions", qualityStatus: "empty_valid", source: "ai_suggested", edited: false }), "Aucune exclusion suggérée");
});

test("completed empty exclusions and nullable values have final-state copy in FR and EN", () => {
  assert.equal(profileAiEmptyValueCopy({ lang: "fr", status: "completed", field: "exclusions" }), "Aucune exclusion suggérée");
  assert.equal(profileAiEmptyValueCopy({ lang: "en", status: "completed", field: "exclusions" }), "No exclusions suggested");
  assert.equal(profileAiEmptyValueCopy({ lang: "fr", status: "completed", field: "businessDescription" }), "Aucune suggestion fiable");
  assert.equal(profileAiEmptyValueCopy({ lang: "en", status: "completed", field: "businessDescription" }), "No reliable suggestion");
});

test("wizard renders long lists as wrapped multiline controls without automatic AI calls", () => {
  const wizard = readFileSync(new URL("../../app/instagram-client/ClientInstagramOnboardingWizard.tsx", import.meta.url), "utf8");
  assert.equal((wizard.match(/className="cio-ai-list"/g) ?? []).length, 4);
  assert.match(wizard, /className="cio-ai-long-text"/);
  assert.match(wizard, /\.cio-ai-list,\.cio-ai-long-text\{[^}]*overflow-x:hidden[^}]*overflow-wrap:anywhere/);
  assert.match(wizard, /analysis\.exclusions\.length === 0/);
  assert.match(wizard, /cio-ai-empty-state/);
  assert.match(wizard, /Catégorie générale suggérée/);
  assert.match(wizard, /fieldQuality/);
  assert.doesNotMatch(wizard, /useEffect\([\s\S]{0,300}analyzeProfileWithAi/);
  assert.match(wizard, /onClick=\{\(\) => void analyzeProfileWithAi\(\)\}/);
});
