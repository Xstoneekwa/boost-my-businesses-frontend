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
    body.replace(' and uses targeted interactions', ''),
    body.replace('your profile', 'your business'),
    body.replace('potential customers', 'engagement'),
    body.replace('similar businesses', 'everyone'),
    body.replace('BMB identifies', 'BMB never identifies'),
    body.replace('uses targeted interactions', 'does not use targeted interactions'),
    body.replace('to bring those people to your profile', 'without bringing those people to your profile'),
    body.replace(' and uses', '. Another service uses'),
    `BMB identifies relevant Instagram audiences around similar businesses. ${quality.AUDIENCE_CTA} We use targeted interactions to bring those people to your profile for qualified growth.`,
  ];
  for (const variant of invalid) assert.equal(quality.hasBmbValueProposition(variant, 'A'), false, variant);
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
