export const SIRENE_ALIAS_DIAGNOSTIC_KEY = "commercial-france-sirene-alias-diagnostic-v3a";
export const SIRENE_ALIAS_RUN_ID = "7243d1fe-1554-4cf5-ba07-2c6ad07d731d";
export const SIRENE_ALIAS_CALL_LIMIT = 4;
export const SIRENE_ALIAS_TARGETS = [
  { itemId: "b5327fe9-a147-4f27-b49d-22ee422d881e", businessId: "53d9149a-a54e-4cf2-a0de-21dd3b136f91", siret: "05580205200039" },
  { itemId: "92670a4d-8aea-4dd5-920f-87439bded8ac", businessId: "c9b1fd45-2430-438e-9758-5b0dd4949c5f", siret: "10000706100011" },
  { itemId: "6756be90-8ef0-431a-aadc-672e87421e89", businessId: "412d04cc-9a32-4fe8-9253-69a6784b4414", siret: "10001008100014" },
  { itemId: "4c798eab-e64f-4955-8e97-b61b54fa941b", businessId: "2f1e59f6-9515-4665-b335-b2fea1035a8a", siret: "10001013100025" },
] as const;

/** Inputs must originate from the owner-checked DB reservation, not request body data. */
export function assertSireneAliasTarget(input: {
  runId: string; itemId: string; businessId: string; siret: string;
  confidence: string; eligible: boolean; leadId: string | null; selected: boolean;
}) {
  const target = SIRENE_ALIAS_TARGETS.find(target => target.itemId === input.itemId);
  if (input.runId !== SIRENE_ALIAS_RUN_ID || !target || target.businessId !== input.businessId
    || target.siret !== input.siret || input.confidence !== "MEDIUM" || !input.eligible
    || input.leadId !== null || input.selected) throw new Error("sirene_alias_candidate_not_authorized");
  return target;
}
