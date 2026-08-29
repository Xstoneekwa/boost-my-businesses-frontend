import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const url = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')}`;
const contractUrl = url(read('./outreach-contract.ts'));
const qualityUrl = url(read('./outreach-quality.ts').replaceAll('"./outreach-contract"', JSON.stringify(contractUrl)));
const factsUrl = url(read('./outreach-facts.ts').replaceAll('"./outreach-contract"', JSON.stringify(contractUrl)));
const validationUrl = url(read('./outreach-validation.ts').replaceAll('"./outreach-quality"', JSON.stringify(qualityUrl)).replaceAll('"./outreach-contract"', JSON.stringify(contractUrl)));
const recovery = await import(url(read('./outreach-failed-recovery.ts')
  .replaceAll('"./outreach-contract"', JSON.stringify(contractUrl))
  .replaceAll('"./outreach-facts"', JSON.stringify(factsUrl))
  .replaceAll('"./outreach-validation"', JSON.stringify(validationUrl))));
const capture = JSON.parse(readFileSync('/Users/admin/Projects/boost-commercial-message-quality-v3-two-call-capture.json', 'utf8'));
const records = capture.records.filter(record => record?.result?.message);

const context = (record, overrides = {}) => {
  const message = structuredClone(record.result.message);
  const business = { id:`business-${record.diagnosticNumber}`, business_name:record.business, city:record.minimizedFacts.find(f=>f.key==='city')?.value, enrichment_snapshot_safe:{instagram:{metadata:{biography:record.minimizedFacts.find(f=>f.key==='instagram_bio')?.value}}} };
  const lead = { id:`lead-${record.diagnosticNumber}`, business_id:business.id, qualification_status:'approved', outreach_status:'not_started', city_snapshot:business.city, subsegment_snapshot:'Makeup Artist', outreach_channel:message.channel, message_angle:message.angle };
  const item = { id:`item-${record.diagnosticNumber}`, lead_id:lead.id, state:'generation_failed', channel:message.channel, angle:message.angle, template_version:message.template_version, approved_at:null, approved_by:null, body:null, version:5 };
  return { item, lead, business, message, model:record.result.model, sourceKind:'captured_v3_diagnostic', ...overrides };
};

test('Best Hair and Swaazi captured outputs prepare canonical recovery without OpenAI', () => {
  for (const record of records) {
    const base = context(record);
    const originalBody = base.message.body; const originalSubject = base.message.subject;
    const richerBio = record.business.startsWith('Best') ? `Top rated\n${record.minimizedFacts.find(f=>f.key==='instagram_bio').value}\nGET R100 VOUCHER`
      : `${record.minimizedFacts.find(f=>f.key==='instagram_bio').value}\nFOURWAYS, JOHANNESBURG`;
    base.business.enrichment_snapshot_safe.instagram.metadata.biography = richerBio;
    const currentFacts = (awaitFacts => awaitFacts)([...base.message.facts_used.map(f=>({...f,source:'fixture'})).filter(f=>f.key!=='instagram_bio'),{key:'instagram_bio',value:richerBio,source:'verified_instagram_profile'}]);
    base.message = recovery.rebindCommercialOutreachRecoveryFacts(base.message,currentFacts);
    const result = recovery.prepareCommercialOutreachFailedRecovery(base);
    assert.equal(result.ok, true, `${record.business}: ${result.codes}`);
    assert.equal(base.message.body, originalBody); assert.equal(base.message.subject, originalSubject);
    assert.equal(base.message.facts_used.find(f=>f.key==='instagram_bio').value,richerBio);
    assert.equal(result.payload.recovery_source, 'captured_v3_diagnostic');
    assert.equal(result.payload.prompt_version, 'commercial_outreach_message_quality_v3');
    assert.match(result.payload.content_hash, /^[a-f0-9]{64}$/);
  }
});

test('wrong lead/body pairing and invalid recovered bodies fail before any RPC', () => {
  const base = context(records[0]);
  assert.deepEqual(recovery.prepareCommercialOutreachFailedRecovery({ ...base, lead:{...base.lead,id:'wrong-lead'} }).codes, ['recovery_lead_body_pairing_mismatch']);
  const invalid = { ...base.message, body:`${base.message.body} [Your Name]` };
  assert.ok(recovery.prepareCommercialOutreachFailedRecovery({ ...base, message:invalid }).codes.includes('unresolved_placeholder'));
  const wrong = { ...base.message, body:base.message.body.replace('Best Hair Salon Cape Town','Swaazi Make Up Artists') };
  assert.ok(recovery.prepareCommercialOutreachFailedRecovery({ ...base, message:wrong, otherBusinessNames:['Swaazi Make Up Artists'] }).codes.includes('other_business_reference'));
});

test('recovery migration is atomic, audited, service-role-only and updates no lead or approved item', () => {
  const sql = read('../../supabase/migrations/20260829005000_commercial_outreach_failed_preview_recovery_v31.sql');
  assert.match(sql, /if coalesce\(auth\.jwt\(\) ->> 'role', ''\) <> 'service_role'/i);
  assert.match(sql, /v_item\.state <> 'generation_failed'/i);
  assert.match(sql, /v_item\.approved_at is not null or v_item\.approved_by is not null/i);
  assert.match(sql, /insert into public\.commercial_outreach_events/i);
  assert.match(sql, /'item_regenerated'/i);
  assert.match(sql, /on conflict \(item_id,idempotency_key\) do nothing/i);
  assert.match(sql, /'delivery_enabled',\s*false/i);
  assert.doesNotMatch(sql, /insert into public\.commercial_outreach_items/i);
  assert.doesNotMatch(sql, /update public\.commercial_leads/i);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/i);
});
