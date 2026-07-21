export type DeterministicProfileLanguage = "fr" | "en";

export type ProfileLanguageDetection = {
  language: DeterministicProfileLanguage | null;
  confidence: number | null;
  sourceFields: string[];
  scores: Record<DeterministicProfileLanguage, number>;
  reason: "detected" | "insufficient_text" | "ambiguous";
};

const minimumAlphabeticCharacters = 24;
const minimumTokens = 5;
const minimumWinningScore = 3;
const minimumScoreMargin = 2;

const markers: Record<DeterministicProfileLanguage, Set<string>> = {
  fr: new Set([
    "aide", "aidons", "avec", "automatisation", "automatise", "compte", "conseil", "conseils",
    "developpe", "developpez", "entreprise", "entreprises", "france", "francais", "marketing",
    "nous", "pour", "strategie", "strategies", "ton", "votre", "vos", "vous",
  ]),
  en: new Set([
    "and", "business", "businesses", "content", "english", "for", "grow", "growth", "help", "helping",
    "marketing", "online", "our", "small", "strategy", "their", "the", "we", "with", "your",
  ]),
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/[’']/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
function foldToken(value: string) {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

function collectInput(input: {
  biography?: unknown;
  displayName?: unknown;
  captions?: unknown;
}) {
  const chunks: Array<{ field: string; text: string }> = [];
  const biography = normalizeText(input.biography);
  if (biography) chunks.push({ field: "biography", text: biography });
  const displayName = normalizeText(input.displayName);
  if (displayName) chunks.push({ field: "display_name", text: displayName });
  if (Array.isArray(input.captions)) {
    const captions = input.captions
      .slice(0, 5)
      .map(normalizeText)
      .filter(Boolean);
    if (captions.length) chunks.push({ field: "recent_post_captions", text: captions.join(" ") });
  }
  return chunks;
}

export function detectProfileLanguage(input: {
  biography?: unknown;
  displayName?: unknown;
  captions?: unknown;
}): ProfileLanguageDetection {
  const chunks = collectInput(input);
  const text = chunks.map((chunk) => chunk.text).join(" ");
  const alphabeticCharacters = (text.match(/\p{L}/gu) ?? []).length;
  const tokens = (text.match(/\p{L}+/gu) ?? []).map(foldToken);
  const scores: Record<DeterministicProfileLanguage, number> = { fr: 0, en: 0 };

  if (alphabeticCharacters < minimumAlphabeticCharacters || tokens.length < minimumTokens) {
    return { language: null, confidence: null, sourceFields: [], scores, reason: "insufficient_text" };
  }

  for (const token of tokens) {
    if (markers.fr.has(token)) scores.fr += 1;
    if (markers.en.has(token)) scores.en += 1;
  }
  if (/[àâçéèêëîïôùûüÿœ]/iu.test(text)) scores.fr += 2;

  const winner: DeterministicProfileLanguage = scores.fr >= scores.en ? "fr" : "en";
  const runnerUp: DeterministicProfileLanguage = winner === "fr" ? "en" : "fr";
  const margin = scores[winner] - scores[runnerUp];
  if (scores[winner] < minimumWinningScore || margin < minimumScoreMargin) {
    return { language: null, confidence: null, sourceFields: [], scores, reason: "ambiguous" };
  }

  const confidence = Math.min(0.98, Number((0.55 + scores[winner] / 30 + margin / 20).toFixed(2)));
  return {
    language: winner,
    confidence,
    sourceFields: chunks.map((chunk) => chunk.field),
    scores,
    reason: "detected",
  };
}
