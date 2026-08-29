import {
  COMMERCIAL_OUTREACH_PROMPT_VERSION,
  commercialOutreachCopyTemplateKey,
  type CommercialOutreachGeneratedMessage,
  type CommercialOutreachFact,
} from "./outreach-contract";
import { buildCommercialOutreachFactLedger } from "./outreach-facts";
import { commercialOutreachContentHash, validateCommercialOutreachMessage } from "./outreach-validation";

type Row = Record<string, unknown>;
export type CommercialFailedRecoverySource = "captured_v3_diagnostic" | "openai_single_call";

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

// Captured copy can predate a richer CRM snapshot. Keep the authored subject,
// body and evidence quote byte-for-byte, but bind facts_used to the current
// canonical values so provenance is truthful at recovery time.
export function rebindCommercialOutreachRecoveryFacts(
  message: CommercialOutreachGeneratedMessage,
  verifiedFacts: CommercialOutreachFact[],
): CommercialOutreachGeneratedMessage {
  const current = new Map(verifiedFacts.map((fact) => [fact.key, fact.value]));
  return { ...message, facts_used: message.facts_used.map((fact) => ({ key: fact.key, value: current.get(fact.key) ?? fact.value })) };
}

export function prepareCommercialOutreachFailedRecovery(input: {
  item: Row;
  lead: Row;
  business: Row;
  message: CommercialOutreachGeneratedMessage;
  model: string;
  sourceKind: CommercialFailedRecoverySource;
  otherBusinessNames?: string[];
}) {
  const { item, lead, business, message } = input;
  const identityCodes: string[] = [];
  if (item.state !== "generation_failed" || item.approved_at || item.approved_by || item.body) identityCodes.push("recovery_item_not_failed_closed");
  if (text(item.lead_id) !== text(lead.id) || text(lead.business_id) !== text(business.id)) identityCodes.push("recovery_lead_body_pairing_mismatch");
  if (lead.qualification_status !== "approved" || !["not_started", "queued"].includes(text(lead.outreach_status))) identityCodes.push("recovery_lead_not_eligible");
  if (text(item.channel) !== message.channel || text(lead.outreach_channel) !== message.channel) identityCodes.push("recovery_channel_mismatch");
  if (text(item.angle) !== message.angle || text(lead.message_angle) !== message.angle) identityCodes.push("recovery_angle_mismatch");
  const copyKey = commercialOutreachCopyTemplateKey(message.channel, message.angle);
  if (text(item.template_version) !== copyKey || message.template_version !== copyKey) identityCodes.push("recovery_template_version_mismatch");
  const businessName = text(business.business_name);
  if (!businessName) identityCodes.push("recovery_business_missing");
  if (identityCodes.length) return { ok: false as const, codes: [...new Set(identityCodes)].sort(), payload: null, verifiedFacts: [] };

  const verifiedFacts = buildCommercialOutreachFactLedger({ lead, business });
  const validation = validateCommercialOutreachMessage({
    message,
    businessName,
    city: text(lead.city_snapshot || business.city) || null,
    verifiedFacts,
    otherBusinessNames: input.otherBusinessNames ?? [],
  });
  if (!validation.ok) return { ok: false as const, codes: validation.codes, payload: null, verifiedFacts };

  return {
    ok: true as const,
    codes: [] as string[],
    verifiedFacts,
    payload: {
      ...message,
      model: text(input.model),
      prompt_version: COMMERCIAL_OUTREACH_PROMPT_VERSION,
      content_hash: commercialOutreachContentHash(message.subject, message.body),
      recovery_source: input.sourceKind,
    },
  };
}
