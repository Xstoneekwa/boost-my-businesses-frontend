import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function read(relative) { return readFileSync(new URL(relative, import.meta.url), "utf8"); }
function moduleUrl(source) {
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
}
const moduleFromTs = (source) => import(moduleUrl(source));

const contract = await moduleFromTs(read("./outreach-contract.ts"));
const qualityUrl = moduleUrl(read("./outreach-quality.ts"));
const quality = await import(qualityUrl);
const withQuality = (source) => source.replaceAll('"./outreach-quality"', JSON.stringify(qualityUrl));
const validationUrl = moduleUrl(withQuality(read("./outreach-validation.ts")));
const validation = await import(validationUrl);
const ai = await moduleFromTs(withQuality(read("./outreach-ai.ts")).replace(/import \{[\s\S]*?\} from "\.\/outreach-contract";\n/, `const COMMERCIAL_OUTREACH_PROMPT_VERSION = ${JSON.stringify(contract.COMMERCIAL_OUTREACH_PROMPT_VERSION)};\n`));

const facts = [
  { key: "business_name", value: "Glow Studio", source: "crm" },
  { key: "city", value: "Johannesburg", source: "crm" },
  { key: "instagram_handle", value: "glowstudio", source: "instagram" },
];

function validMessage(overrides = {}) {
  return {
    subject: null,
    body: `Hi Glow Studio, I noticed you're based in Johannesburg. Your next customers are already on Instagram. BMB identifies relevant audiences around similar businesses to help bring potential customers to you and grow your visibility. ${quality.AUDIENCE_CTA}`,
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

test("generation uses server greeting, locked offer, previous guard feedback and prompt V2", async () => {
  let requestBody;
  const result = await ai.generateCommercialOutreachMessage({
    channel: "instagram",
    angle: "A",
    templateKey: "IG_BEAUTY_ANGLE_A_V1",
    templateIntent: "Local visibility",
    businessName: "Glow Studio",
    verifiedFacts: facts,
    previousValidationCodes: ["unresolved_placeholder"],
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(validMessage()) }] }] }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.match(requestBody.input[0].content[0].text, /exact greeting supplied by the server/i);
  assert.match(requestBody.input[0].content[0].text, /Your next customers are already on Instagram/);
  const payload = JSON.parse(requestBody.input[1].content[0].text);
  assert.equal(payload.business_name, "Glow Studio");
  assert.equal(payload.prompt_version, "commercial_outreach_message_quality_v2");
  assert.equal(payload.greeting, "Hi Glow Studio,");
  assert.deepEqual(payload.previous_validation_codes, ["unresolved_placeholder"]);
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

const check = (message, extra = {}) => validation.validateCommercialOutreachMessage({ message, businessName: "Glow Studio", city: "Johannesburg", verifiedFacts: facts, ...extra });

test("all requested placeholders, malformed tokens and normalized variants fail closed", () => {
  for (const token of ["[Your Name]", "[Name]", "[Company]", "[Business Name]", "[First Name]", "[Your Company]", "{{firstName}}", "<name>", "<placeholder>", "TBD", "TODO", "[Name", "%FIRST_NAME%", "${name}", "［Your Name］", "&lt;name&gt;", "[Your\u200B Name]"]) {
    assert.equal(quality.hasUnresolvedOutreachPlaceholder(token), true, token);
    assert.ok(check(validMessage({ body: `${validMessage().body} ${token}` })).codes.includes("unresolved_placeholder"), token);
  }
  assert.ok(check(validMessage({ subject: "[Company]" })).codes.includes("unresolved_placeholder"));
  assert.equal(quality.hasUnresolvedOutreachPlaceholder("BMB helps find relevant audiences."), false);
});

test("greeting policy shortens SEO labels, rejects ugly handles and never guesses a first name", () => {
  for (const businessName of ["Makeup Artist Cape Town (@leedraglam)", "@very_long_beauty_123", "Bridal Wedding Makeup Hair Cape Town Lesley-Ann", "Johannesburg Bridal Makeup Artist", "J A N I N E • Pro MUA • Cape Town"]) {
    assert.equal(quality.commercialOutreachGreeting({ businessName }).greeting, "Hi there,", businessName);
  }
  assert.equal(quality.commercialOutreachGreeting({ businessName: "Glow Studio - Cape Town", city: "Cape Town" }).greeting, "Hi Glow Studio,");
  assert.equal(quality.commercialOutreachGreeting({ businessName: "Danielle Jacobs | Bridal Hair & Make-Up Artist" }).greeting, "Hi Danielle Jacobs,");
  assert.equal(quality.commercialOutreachGreeting({ businessName: "Glow Studio", verifiedFacts: [{ key: "verified_contact_first_name", value: "Liam", source: "instagram_bio" }] }).greeting, "Hi Glow Studio,");
  assert.equal(quality.commercialOutreachGreeting({ businessName: "Glow Studio", verifiedFacts: [{ key: "verified_contact_first_name", value: "Liam", source: "owner_verified_contact" }] }).greeting, "Hi Liam,");
  assert.ok(check(validMessage({ body: validMessage().body.replace("Hi Glow Studio,", "Hi Glow Studio team,") })).codes.includes("unnatural_or_unverified_greeting"));
  assert.ok(check(validMessage({ body: validMessage().body.replace("Hi Glow Studio,", "Hi Sarah,") })).codes.includes("unnatural_or_unverified_greeting"));
});

function emailBody(angle) {
  return `Hi Glow Studio,\n\nI noticed that your studio is based in Johannesburg. Your next customers are already on Instagram, and BMB helps bring them to you.\n\nBMB identifies relevant Instagram audiences around competitors or similar businesses to help you reach people who could become qualified potential customers. ${angle === "A" ? "The opportunity is to grow your visibility among people already interested in services like yours." : "The opportunity is customer acquisition: finding relevant people who may be interested in the services you offer."}\n\n${quality.AUDIENCE_CTA}`;
}

for (const channel of ["instagram", "email"]) for (const angle of ["A", "B"]) {
  test(`${channel} angle ${angle}: clear BMB offer, verified observation and audience CTA`, () => {
    const message = validMessage({ channel, angle, template_version: contract.commercialOutreachTemplateKey(channel, angle), subject: channel === "email" ? "Instagram audiences for Glow Studio" : null, body: channel === "email" ? emailBody(angle) : validMessage().body });
    assert.deepEqual(check(message), { ok: true, codes: [] });
    assert.match(quality.outreachCopyInstructions(channel, angle), new RegExp(`Angle ${angle}:`));
    if (channel === "email") {
      const shaped = ai.validateCommercialOutreachAiShape(message, { channel, angle, templateKey: message.template_version });
      assert.match(shaped.body, /\n\n/);
      assert.ok(check({ ...message, body: validMessage().body }).codes.includes("channel_copy_structure_invalid"));
    }
  });
}

test("vague offer and vague CTA are rejected; optional exact comparison is email-only", () => {
  assert.ok(check(validMessage({ body: validMessage().body.replace(quality.AUDIENCE_CTA, "Interested in learning more?") })).codes.includes("concrete_audience_cta_missing"));
  assert.ok(check(validMessage({ body: `Hi Glow Studio, I noticed your Johannesburg studio. We help improve engagement. ${quality.AUDIENCE_CTA}` })).codes.includes("bmb_value_proposition_missing"));
  const email = validMessage({ channel: "email", subject: "Audiences for Glow Studio", body: emailBody("A").replace("The opportunity", "BMB can cost up to 3–4× less than Meta Ads. The opportunity") });
  assert.equal(check(email).ok, true);
  assert.ok(check({ ...email, body: email.body.replace("3–4×", "10×") }).codes.includes("unapproved_performance_comparison"));
  assert.ok(check(validMessage({ body: `${validMessage().body} Up to 3–4× less than Meta Ads.` })).codes.includes("unapproved_performance_comparison"));
});

test("unsupported facts, fake owners, wrong businesses, demo pressure and dangling signoffs remain blocked", () => {
  for (const [suffix, code] of [["Your monthly sales are booming.", "unsupported_commercial_claim"], ["Your owner is Sarah.", "unsupported_commercial_claim"], ["Your ad spend is R5000.", "unsupported_commercial_claim"], ["You have 500 customers.", "unsupported_commercial_claim"], ["We guarantee growth.", "unsupported_commercial_claim"], ["Book a demo now.", "premature_demo_cta"], ["Best,", "incomplete_or_email_style_signature"], ["We offer content creation.", "offer_positioning_mismatch"]]) {
    assert.ok(check(validMessage({ body: `${validMessage().body} ${suffix}` })).codes.includes(code), suffix);
  }
  for (const malformed of [null, [null], [{ key: "business_name", value: 42 }]]) assert.ok(check(validMessage({ facts_used: malformed })).codes.includes("facts_used_shape_invalid"));
  assert.equal(ai.validateCommercialOutreachAiShape(validMessage({ body: `${"x".repeat(910)} [Your Name]` }), { channel: "instagram", angle: "A", templateKey: "IG_BEAUTY_ANGLE_A_V1" }), null);
  assert.ok(check(validMessage({ body: `${validMessage().body} We bring 100 new customers.` })).codes.includes("unsupported_commercial_claim"));
  assert.ok(check(validMessage({ body: `${validMessage().body} You serve the Hair Salon subsegment.` })).codes.includes("internal_or_debug_content"));
});

test("processor never completes an invalid preview as ready; retry feedback is bounded by existing claim RPC", async () => {
  const source = read("./outreach-processor.ts").replace(/^import [^;]+;\n/gm, "");
  const processor = await moduleFromTs(`import { validateCommercialOutreachMessage, commercialOutreachContentHash } from ${JSON.stringify(validationUrl)};\nconst COMMERCIAL_OUTREACH_PROMPT_VERSION = "commercial_outreach_message_quality_v2"; const buildCommercialOutreachFactLedger = () => ${JSON.stringify(facts)};\n${source}`);
  let attempted = 0; const completions = []; const prior = [];
  const fakeDb = {
    rpc: async (name, args) => {
      if (name.startsWith("claim_")) return { data: attempted < 2 ? [{ id: "item", lead_id: "lead", channel: "instagram", angle: "A", template_key: "IG_BEAUTY_ANGLE_A_V1", generation_attempt_count: attempted + 1, validation_codes: [] }] : [] };
      completions.push(args); return { error: null };
    },
    from: (table) => {
      const data = table === "commercial_leads" ? { business_id: "biz", qualification_status: "approved", outreach_status: "not_started", city_snapshot: "Johannesburg" } : table === "commercial_outreach_templates" ? { active: true } : { business_name: "Glow Studio" };
      const chain = { select: () => chain, eq: () => chain, neq: () => chain, order: () => chain, limit: async () => ({ data: table === "commercial_outreach_events" ? [{ metadata_safe: { validation_codes: ["unresolved_placeholder"] } }] : [] }), single: async () => ({ data }) }; return chain;
    },
  };
  const generate = async (input) => { attempted++; prior.push(input.previousValidationCodes); return { ok: true, model: "test", message: validMessage({ body: `${validMessage().body} [Your Name]` }) }; };
  for (let i = 0; i < 3; i++) await processor.processCommercialOutreachBatch({ supabase: fakeDb, generate, workerId: "test" });
  assert.equal(attempted, 2);
  assert.equal(completions.length, 2);
  assert.ok(completions.every((call) => call.p_success === false && call.p_validation_codes.includes("unresolved_placeholder")));
  assert.deepEqual(prior, [[], ["unresolved_placeholder"]]);
  attempted = 0; completions.length = 0;
  const corrected = async () => { attempted++; return { ok: true, model: "test", message: attempted === 1 ? validMessage({ body: `${validMessage().body} [Your Name]` }) : validMessage() }; };
  for (let i = 0; i < 3; i++) await processor.processCommercialOutreachBatch({ supabase: fakeDb, generate: corrected, workerId: "test" });
  assert.deepEqual(completions.map((call) => call.p_success), [false, true]);
  assert.equal(completions[1].p_payload.prompt_version, "commercial_outreach_message_quality_v2");
  assert.deepEqual(completions[1].p_validation_codes, []);
});

test("approval and edit run the real V2 guard before the existing owner-authorized mutation RPC", async () => {
  const source = read("./outreach-service.ts").replace(/^import [^;]+;\n/gm, "");
  let current = validMessage({ body: `${validMessage().body} [Your Name]` }); let calls = 0; let authChecks = 0;
  globalThis.__qualityServiceTest = {
    auth: async () => { authChecks++; return { userId: "owner" }; },
    db: {
      from: (table) => { const data = table === "commercial_outreach_items" ? { ...current, lead_id: "lead" } : table === "commercial_leads" ? { business_id: "biz", city_snapshot: "Johannesburg" } : { business_name: "Glow Studio" }; const chain = { select: () => chain, eq: () => chain, neq: () => chain, single: async () => ({ data }), limit: async () => ({ data: [] }) }; return chain; },
      rpc: async (_name, args) => { calls++; assert.equal(args.p_actor_user_id, "owner"); assert.equal(args.p_expected_version, 1); return { data: {} }; },
    },
  };
  try {
    const service = await moduleFromTs(`import { validateCommercialOutreachMessage, commercialOutreachContentHash } from ${JSON.stringify(validationUrl)}; const requireCommercialCrmAccess = () => globalThis.__qualityServiceTest.auth(); const createSupabaseAdminClient = () => globalThis.__qualityServiceTest.db; const buildCommercialOutreachFactLedger = () => ${JSON.stringify(facts)};\n${source}`);
    const mutation = { action: "approve_message", expectedVersion: 1, idempotencyKey: "test", patch: {} };
    const id = "00000000-0000-4000-8000-000000000001";
    await assert.rejects(service.mutateCommercialOutreachItem(id, mutation), /approval_rejected:.*unresolved_placeholder/);
    assert.equal(calls, 0);
    await assert.rejects(service.mutateCommercialOutreachItem(id, { ...mutation, action: "edit_message", patch: { body: current.body } }), /edit_rejected:.*unresolved_placeholder/);
    assert.equal(calls, 0);
    current = validMessage();
    await service.mutateCommercialOutreachItem(id, mutation);
    assert.equal(calls, 1); assert.equal(authChecks, 3);
  } finally { delete globalThis.__qualityServiceTest; }
});
