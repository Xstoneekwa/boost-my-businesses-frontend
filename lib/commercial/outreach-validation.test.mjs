import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function read(relative) { return readFileSync(new URL(relative, import.meta.url), "utf8"); }
async function moduleFromTs(source) {
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
}

const contract = await moduleFromTs(read("./outreach-contract.ts"));
const validation = await moduleFromTs(read("./outreach-validation.ts").replace(/import type \{[\s\S]*?\} from "\.\/outreach-contract";\n/, ""));
const ai = await moduleFromTs(read("./outreach-ai.ts").replace(/import \{[\s\S]*?\} from "\.\/outreach-contract";\n/, 'const COMMERCIAL_OUTREACH_PROMPT_VERSION = "commercial_outreach_prompt_v2_exact_target_salutation";\n'));

const facts = [
  { key: "business_name", value: "Glow Studio", source: "crm" },
  { key: "city", value: "Johannesburg", source: "crm" },
  { key: "instagram_handle", value: "glowstudio", source: "instagram" },
];

function validMessage(overrides = {}) {
  return {
    subject: null,
    body: "Hi Glow Studio — I noticed your Johannesburg presence on Instagram. Would it be useful to make your local visibility more consistent without adding manual work?",
    channel: "instagram",
    angle: "A",
    template_version: "IG_BEAUTY_ANGLE_A_V1",
    personalization_summary: "Used the verified business name and city.",
    facts_used: [{ key: "business_name", value: "Glow Studio" }, { key: "city", value: "Johannesburg" }],
    confidence: 0.92,
    ...overrides,
  };
}

test("the four channel-angle combinations map to the four exact template families", () => {
  assert.equal(contract.commercialOutreachTemplateKey("instagram", "A"), "IG_BEAUTY_ANGLE_A_V1");
  assert.equal(contract.commercialOutreachTemplateKey("instagram", "B"), "IG_BEAUTY_ANGLE_B_V1");
  assert.equal(contract.commercialOutreachTemplateKey("email", "A"), "EMAIL_BEAUTY_ANGLE_A_V1");
  assert.equal(contract.commercialOutreachTemplateKey("email", "B"), "EMAIL_BEAUTY_ANGLE_B_V1");
});

test("AI schema fixes channel, angle, template, subject shape, and structured facts", () => {
  const ig = ai.commercialOutreachMessageSchema({ channel: "instagram", angle: "A", templateKey: "IG_BEAUTY_ANGLE_A_V1" });
  const email = ai.commercialOutreachMessageSchema({ channel: "email", angle: "B", templateKey: "EMAIL_BEAUTY_ANGLE_B_V1" });
  assert.deepEqual(ig.properties.subject, { type: "null" });
  assert.deepEqual(email.properties.channel.enum, ["email"]);
  assert.deepEqual(email.properties.angle.enum, ["B"]);
  assert.deepEqual(email.properties.template_version.enum, ["EMAIL_BEAUTY_ANGLE_B_V1"]);
  assert.equal(email.properties.facts_used.maxItems, 5);
});

test("generation prompt requires the exact target salutation and records prompt V2", async () => {
  let requestBody;
  const result = await ai.generateCommercialOutreachMessage({
    channel: "instagram",
    angle: "A",
    templateKey: "IG_BEAUTY_ANGLE_A_V1",
    templateIntent: "Local visibility",
    businessName: "Glow Studio",
    verifiedFacts: facts,
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(validMessage()) }] }] }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.match(requestBody.input[0].content[0].text, /body must begin with 'Hi ' followed by the exact business_name/i);
  const payload = JSON.parse(requestBody.input[1].content[0].text);
  assert.equal(payload.business_name, "Glow Studio");
  assert.equal(payload.prompt_version, "commercial_outreach_prompt_v2_exact_target_salutation");
});

test("valid structured output is accepted only when it matches the selected path", () => {
  const raw = validMessage();
  assert.ok(ai.validateCommercialOutreachAiShape(raw, { channel: "instagram", angle: "A", templateKey: "IG_BEAUTY_ANGLE_A_V1" }));
  assert.equal(ai.validateCommercialOutreachAiShape(raw, { channel: "instagram", angle: "B", templateKey: "IG_BEAUTY_ANGLE_B_V1" }), null);
});

test("deterministic guards accept a verified, bounded Instagram preview", () => {
  assert.deepEqual(validation.validateCommercialOutreachMessage({ message: validMessage(), businessName: "Glow Studio", city: "Johannesburg", verifiedFacts: facts, otherBusinessNames: ["Other Clinic"] }), { ok: true, codes: [] });
});

test("deterministic guards reject placeholders, wrong city, other business, unsupported claims, and unverified facts", () => {
  const result = validation.validateCommercialOutreachMessage({
    message: validMessage({ body: "Hi {{business}} at Glow Studio in Cape Town. Other Clinic knows you have 500 customers. Debug output follows.", facts_used: [{ key: "city", value: "Cape Town" }] }),
    businessName: "Glow Studio", city: "Johannesburg", verifiedFacts: facts, otherBusinessNames: ["Other Clinic"],
  });
  assert.equal(result.ok, false);
  for (const code of ["unresolved_placeholder", "wrong_city_reference", "other_business_reference", "unsupported_commercial_claim", "internal_or_debug_content", "unverified_fact_used"]) assert.ok(result.codes.includes(code), code);
});

test("channel-specific formatting and size fail closed", () => {
  const result = validation.validateCommercialOutreachMessage({ message: validMessage({ subject: "Subject must not exist", body: `Subject: hello\n${"x".repeat(920)}` }), businessName: "Glow Studio", city: "Johannesburg", verifiedFacts: facts });
  assert.equal(result.ok, false);
  assert.ok(result.codes.includes("instagram_subject_forbidden"));
  assert.ok(result.codes.includes("instagram_email_format_detected"));
  assert.ok(result.codes.includes("instagram_body_length_invalid"));
});
