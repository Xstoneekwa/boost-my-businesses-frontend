import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  confirmedProfileTargetingDraft,
  hydrateProfileTargetingDraft,
  profileAiEmptyValueCopy,
  profileAiFieldLabel,
  profileTargetingLanguageLabel,
} from "./profile-intelligence-ui.ts";

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

function targetingAnalysis(overrides = {}) {
  return {
    biography: "Biographie publique originale.",
    probableAudience: "Entrepreneurs qui veulent automatiser leur acquisition Instagram.",
    niche: "Automatisation Instagram pour petites entreprises",
    businessDescription: "Service enrichi de stratégie et automatisation Instagram pour développer une activité en ligne.",
    themes: ["automatisation Instagram", "stratégie de croissance", "acquisition client"],
    keywords: ["outil automatisation Instagram", "croissance organique Instagram", "prospection Instagram"],
    language: "fr",
    location: "Paris",
    sources: { location: "public_observed" },
    ...overrides,
  };
}

test("confirmed Profile Intelligence fields hydrate distinct targeting criteria", () => {
  const draft = confirmedProfileTargetingDraft(targetingAnalysis());
  assert.equal(draft.idealCustomer, "Entrepreneurs qui veulent automatiser leur acquisition Instagram.");
  assert.equal(draft.niche, "Automatisation Instagram pour petites entreprises");
  assert.equal(draft.businessDescription, "Service enrichi de stratégie et automatisation Instagram pour développer une activité en ligne.");
  assert.deepEqual(draft.themes, ["automatisation Instagram", "stratégie de croissance", "acquisition client"]);
  assert.deepEqual(draft.keywords, ["outil automatisation Instagram", "croissance organique Instagram", "prospection Instagram"]);
  assert.notDeepEqual(draft.keywords, draft.themes);
  assert.equal(draft.language, "fr");
  assert.equal(draft.geography, "");
});

test("targeting description falls back to biography only without enriched description", () => {
  assert.equal(confirmedProfileTargetingDraft(targetingAnalysis({ businessDescription: null })).businessDescription, "Biographie publique originale.");
  assert.equal(confirmedProfileTargetingDraft(targetingAnalysis({ businessDescription: "Description confirmée." })).businessDescription, "Description confirmée.");
});

test("targeting never aliases themes into missing keywords and only accepts user-confirmed geography", () => {
  const emptyKeywords = confirmedProfileTargetingDraft(targetingAnalysis({ keywords: [] }));
  assert.deepEqual(emptyKeywords.keywords, []);
  assert.deepEqual(emptyKeywords.themes, ["automatisation Instagram", "stratégie de croissance", "acquisition client"]);
  assert.equal(emptyKeywords.geography, "");
  assert.equal(confirmedProfileTargetingDraft(targetingAnalysis({ sources: { location: "user_confirmed" } })).geography, "Paris");
});

test("stored targeting draft wins wholesale to preserve prior manual edits", () => {
  const stored = {
    idealCustomer: "Audience modifiée manuellement",
    geography: "Global",
    niche: "Niche modifiée",
    businessDescription: "Description modifiée",
    language: "en",
    themes: ["thème manuel"],
    keywords: ["keyword manuel"],
  };
  assert.equal(hydrateProfileTargetingDraft(targetingAnalysis(), stored), stored);
});

test("targeting language keeps canonical values and localizes labels", () => {
  assert.equal(profileTargetingLanguageLabel("fr", "fr"), "Français");
  assert.equal(profileTargetingLanguageLabel("en", "fr"), "French");
  assert.equal(profileTargetingLanguageLabel("fr", "en"), "Anglais");
  assert.equal(profileTargetingLanguageLabel("en", "en"), "English");
  assert.equal(profileTargetingLanguageLabel("fr", "de"), "");
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
  assert.equal((wizard.match(/className="cio-targeting-multiline"/g) ?? []).length, 5);
  assert.match(wizard, /\.cio-targeting-multiline\{[^}]*overflow-x:hidden[^}]*overflow-wrap:anywhere/);
  assert.match(wizard, /\.cio-targeting-multiline\{[^}]*field-sizing:content[^}]*min-height:72px/);
  assert.match(wizard, /<select value=\{criteria\.language\}/);
  assert.match(wizard, /profileTargetingLanguageLabel\(lang, "fr"\)/);
  assert.doesNotMatch(wizard, /keywords:\s*analysis\?\.themes/);
  assert.doesNotMatch(wizard, /useEffect\([\s\S]{0,300}save_targeting/);
});
