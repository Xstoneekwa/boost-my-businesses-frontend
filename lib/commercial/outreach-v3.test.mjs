import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const url = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`;
const qualityUrl = url(read('./outreach-quality.ts'));
const quality = await import(qualityUrl);
const contract = await import(url(read('./outreach-contract.ts')));
const withQuality = source => source.replaceAll('"./outreach-quality"', JSON.stringify(qualityUrl));
const planner = await import(url(withQuality(read('./outreach-reevaluation.ts'))));
const validation = await import(url(withQuality(read('./outreach-validation.ts'))));
const mechanism = 'BMB identifies relevant Instagram audiences around similar businesses and uses targeted interactions to bring those people to your profile, helping grow your visibility among potential customers.';
const body = `Hi Glow Studio, I noticed your luxury bridal makeup service. Your next customers are already on Instagram. ${mechanism} ${quality.AUDIENCE_CTA}`;
const item = { state: 'ready_for_review', approved_at: null, body, subject: null, angle: 'A' };

test('V3 copy versions are separate from the four stable V1 routing families', () => {
  for (const channel of ['instagram', 'email']) for (const angle of ['A', 'B']) {
    assert.match(contract.commercialOutreachTemplateKey(channel, angle), /_V1$/);
    assert.match(contract.commercialOutreachCopyTemplateKey(channel, angle), /_V3$/);
  }
  assert.equal(contract.COMMERCIAL_OUTREACH_COPY_KEYS.length, 4);
});
test('BMB_VALUE_PROPOSITION_PRESENT requires linked discovery, interaction, profile and potential benefit', () => {
  assert.equal(quality.hasBmbValueProposition(body, 'A'), true);
  const variants = [
    body.replace(' and uses', '. We use'),
    body.replace('to bring those people', 'to help direct those people'),
    body.replace('relevant Instagram audiences', 'relevant audiences on Instagram'),
  ];
  for (const variant of variants) assert.equal(quality.hasBmbValueProposition(variant, 'A'), true, variant);
  const invalid = [
    'BMB. Instagram. Relevant audiences. Targeted interactions. Your profile. Potential customers.',
    body.replace('your profile', 'your business'),
    body.replace('potential customers', 'engagement'),
    body.replace('BMB identifies', 'BMB never identifies'),
    body.replace('uses targeted interactions', 'does not use targeted interactions'),
    body.replace('to bring those people to your profile', 'without bringing those people to your profile'),
  ];
  for (const variant of invalid) assert.equal(quality.hasBmbValueProposition(variant, 'A'), false, variant);
  assert.equal(quality.hasBmbValueProposition(body.replace(' and uses targeted interactions', ''), 'A'), true, 'a coherent identify/bring mechanism does not require one exact interaction phrase');
});
test('approved, cancelled and failed items are immutable in automatic reevaluation', () => {
  const baseline = structuredClone(item);
  for (const approval of [{ approved_at: '2026-08-28' }, { approved_by: 'owner' }, { state: 'queued_dry_run' }, { state: 'approved_for_send' }]) {
    const result = planner.planCommercialOutreachV3({ ...item, ...approval, body: '[Your Name]' });
    assert.equal(result.action, 'PRESERVE'); assert.equal(result.classification, 'OWNER_APPROVED');
    assert.deepEqual(result.reasons, ['critical_placeholder_review_required']);
  }
  for (const state of ['cancelled', 'generation_failed', 'generating', 'draft', 'unknown']) assert.equal(planner.planCommercialOutreachV3({ ...item, state, body: '[Name]' }).action, 'PRESERVE');
  assert.deepEqual(item, baseline);
});
test('only failing unapproved ready messages regenerate; passing ones and owner edits stay intact', () => {
  assert.equal(planner.planCommercialOutreachV3(item).action, 'PRESERVE');
  assert.equal(planner.planCommercialOutreachV3({ ...item, body: 'We improve engagement.' }).action, 'REGENERATE');
  assert.deepEqual(planner.planCommercialOutreachV3({ ...item, subject: '[Company]' }).reasons, ['unresolved_placeholder']);
  assert.equal(planner.planCommercialOutreachV3({ ...item, owner_edited: true, body: '[Name]' }).action, 'OWNER_REVIEW_REQUIRED');
});
test('literal evidence preserves specific services; invented, misplaced and city-only evidence fails', () => {
  const facts = [{ key: 'business_name', value: 'Glow Studio', source: 'crm' }, { key: 'instagram_bio', value: 'Cape Town luxury bridal makeup service. Book via WhatsApp.', source: 'verified_instagram_profile' }, { key: 'city', value: 'Cape Town', source: 'crm' }];
  const message = { body, subject: null, channel: 'instagram', angle: 'A', facts_used: facts, confidence: 0.9, personalization_evidence: { key: 'instagram_bio', quote: 'luxury bridal makeup' } };
  const check = overrides => validation.validateCommercialOutreachMessage({ message: { ...message, ...overrides }, businessName: 'Glow Studio', city: 'Cape Town', verifiedFacts: facts });
  assert.equal(check({}).ok, true);
  assert.ok(check({ personalization_evidence: { key: 'instagram_bio', quote: 'lash extensions' } }).codes.includes('personalization_evidence_mismatch'));
  assert.ok(check({ personalization_evidence: { key: 'city', quote: 'Cape Town' } }).codes.includes('rich_personalization_missing'));
  assert.ok(check({ body: body.replace('luxury bridal makeup', 'beauty') }).codes.includes('personalization_evidence_mismatch'));
});
test('placeholder variants, fake signatures and assumed purchase intent cannot become ready', () => {
  const check = body => quality.inspectCommercialOutreachQuality({ body, subject: null, channel: 'instagram', angle: 'A', businessName: 'Glow Studio' });
  for (const token of ['<company>', 'T.B.D', 'TO_DO', 'PLACE_HOLDER', '[Your Company]']) assert.equal(quality.hasUnresolvedOutreachPlaceholder(token), true);
  for (const signature of ['Best, Liam', 'Regards, BMB Team', 'Thanks, John']) assert.ok(check(`${body}\n${signature}`).codes.includes('content_after_cta_or_signature'));
  for (const claim of ['qualified leads eager to engage', 'customers ready to buy', 'they will book', 'guaranteed sales']) assert.ok(check(`${body} ${claim}`).codes.includes('assumed_purchase_intent'), claim);
});
test('migration is insert-only metadata and never replaces a state machine or owner RPC', () => {
  const sql = read('../../supabase/migrations/20260828233455_commercial_outreach_copy_versions_v3.sql');
  assert.doesNotMatch(sql, /\bupdate\s+public\.|create or replace|new\.state\s*:=|new\.template_key\s*:=/i);
  assert.match(sql, /before insert on public.commercial_outreach_items/i);
  assert.match(sql, /new\.template_version := copy_key/);
  assert.match(sql, /revoke all[\s\S]*from public, anon, authenticated/i);
});

test('V3.1 real Best Hair paraphrase and drive wording pass without exact emoji citation', () => {
  const source = '🖤Advanced hair color 🖤Precision cuts 🖤Results-driven treatments 🖤Hair Extensions';
  const message = { subject: null, channel: 'instagram', angle: 'B', template_version: 'IG_BEAUTY_ANGLE_B_V3', confidence: .8,
    body: `Hi there, I noticed that your Instagram bio highlights advanced hair color and precision cuts. There's an opportunity to attract potential customers on Instagram. BMB identifies relevant audiences around similar businesses and uses targeted interactions to drive them to your profile. ${quality.AUDIENCE_CTA}`,
    personalization_summary: 'Services', personalization_evidence: { key: 'instagram_bio', quote: '🖤Advanced hair color 🖤Precision cuts' },
    facts_used: [{key:'business_name',value:'Best Hair Salon Cape Town'},{key:'city',value:'Cape Town'},{key:'instagram_bio',value:source}] };
  const verifiedFacts = message.facts_used.map(f=>({...f,source:'fixture'}));
  assert.deepEqual(validation.validateCommercialOutreachMessage({message,businessName:'Best Hair Salon Cape Town',city:'Cape Town',verifiedFacts}), {ok:true,codes:[]});
  const invented = {...message,body:message.body.replace('precision cuts','lash extensions')};
  assert.ok(validation.validateCommercialOutreachMessage({message:invented,businessName:'Best Hair Salon Cape Town',city:'Cape Town',verifiedFacts}).codes.includes('unsupported_service_claim'));
  const placeholder = {...message,body:`${message.body} [Your Name]`};
  assert.ok(validation.validateCommercialOutreachMessage({message:placeholder,businessName:'Best Hair Salon Cape Town',city:'Cape Town',verifiedFacts}).codes.includes('unresolved_placeholder'));
});

test('V3.1 real Swaazi whole-message benefit passes while hard fails remain strict', () => {
  const source='No DM bookings accepted. Click :BOOK NOW 💄 PRO MAKEUP ARTIST & EDUCATOR';
  const body=`Hi Swaazi Make Up Artists,\n\nI noticed you are a PRO MAKEUP ARTIST & EDUCATOR and direct bookings through a clear booking flow rather than Instagram DMs. That gives interested people a defined path once they reach you. There is an opportunity to draw potential customers to your profile.\n\nBMB identifies relevant Instagram audiences around similar businesses and uses targeted interactions to bring those people to your profile, helping attract engaged followers interested in makeup services.\n\n${quality.AUDIENCE_CTA}`;
  const message={subject:'Instagram audiences for Swaazi',body,channel:'email',angle:'B',template_version:'EMAIL_BEAUTY_ANGLE_B_V3',personalization_summary:'Makeup',personalization_evidence:{key:'instagram_bio',quote:'PRO MAKEUP ARTIST & EDUCATOR'},facts_used:[{key:'business_name',value:'Swaazi Make Up Artists'},{key:'city',value:'Johannesburg'},{key:'instagram_bio',value:source}],confidence:.9};
  const verifiedFacts=message.facts_used.map(f=>({...f,source:'fixture'}));
  const check=m=>validation.validateCommercialOutreachMessage({message:m,businessName:'Swaazi Make Up Artists',city:'Johannesburg',verifiedFacts,otherBusinessNames:['Competitor X']});
  assert.deepEqual(check(message),{ok:true,codes:[]});
  for(const [suffix,code] of [[' BMB guarantees you 500 paying customers every month.','unsupported_commercial_claim'],[' You currently spend R20,000/month on Meta Ads.','unsupported_commercial_claim'],[' Your salon is located in Cape Town.','wrong_city_reference'],[' We use your Competitor X.','other_business_reference'],[' [Company]','unresolved_placeholder'],[' Tool output: success','internal_or_debug_content'],[' We operate in the United States.','wrong_country_reference']]) assert.ok(check({...message,body:`${body}${suffix}`}).codes.includes(code),code);
  assert.ok(check({...message,body:`Hi Swaazi Make Up Artists,\n\nGrow your Instagram.\n\n${quality.AUDIENCE_CTA}`}).codes.includes('bmb_value_proposition_missing'));
});
