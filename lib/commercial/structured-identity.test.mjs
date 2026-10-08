import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const read = path => readFileSync(new URL(path,import.meta.url),'utf8');
const sql=read('../../supabase/migrations/20260926203812_commercial_structured_discovery_identity_safety_v1.sql');
const service=read('./structured-identity-service.ts');
test('structured service is owner gated, server-only and has no collection or transport',()=>{
 assert.match(service,/import "server-only"/);
 assert.equal((service.match(/await requireCommercialCrmAccess\(\)/g)||[]).length,3);
 assert.doesNotMatch(service,/fetch\(|process\.env|SIRENE_API_KEY|actorOverride|sendEmail/);
 assert.doesNotMatch(service,/commercial_leads|approve|outreach_items/);
});
test('migration preserves legacy uniqueness and isolates all six fallback readers',()=>{
 assert.equal((sql.match(/where identity_mode = 'legacy' and (instagram_handle|website_domain)_normalized/g)||[]).length,6);
 assert.match(sql,/default 'legacy'/);
 assert.match(sql,/where identity_mode='legacy' and website_domain_normalized is not null/);
 assert.match(sql,/where identity_mode='legacy' and instagram_handle_normalized is not null/);
 assert.doesNotMatch(sql,/update public\.commercial_business_identifiers set external_id/i);
 assert.match(sql,/pg_advisory_xact_lock/);
});
test('structured normalization preserves opaque case and fails unregistered providers',()=>{
 const normalizer=sql.split('create function public.normalize_structured_external_id_v1')[1].split('end $$;')[0];
 assert.doesNotMatch(normalizer,/lower\(/i);
 assert.match(normalizer,/structured_provider_unregistered/);
 assert.match(normalizer,/siret_format_invalid/);
});
test('response attribution rejects shared structured handles before contact fallback',()=>{
 const followup=read('./followup-service.ts');
 const guard=followup.indexOf('businesses.some(b => b.identity_mode === "structured")');
 assert.ok(guard>0);
 assert.ok(guard<followup.indexOf('if (channel === "phone")',guard));
 assert.match(followup.slice(guard,guard+250),/return null/);
});
test('outreach and dashboard resolve canonical business IDs, not domains',()=>{
 for(const path of ['./outreach-service.ts','./outreach-processor.ts','./dashboard-read-model.ts']){
   const source=read(path);
   assert.match(source,/\.eq\("id", text\(lead(?:Data)?\.business_id\)\)/);
   assert.doesNotMatch(source,/\.eq\("website_domain_normalized"/);
 }
});

test('actual response matcher holds shared structured handle, preserves legacy attribution',async()=>{
 const source=read('./followup-service.ts');
 const fn=source.slice(source.indexOf('async function matchContact('),source.indexOf('export async function ingestFollowup'));
 const js=ts.transpileModule('const checked = r => { if(r.error) throw Error("db_failed"); return r.data; }; export '+fn,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const {matchContact}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 const db=rows=>({from:table=>{const query={select:()=>query,eq:()=>query,not:()=>query,limit:()=>Promise.resolve({data:rows[table]??[],error:null})};return query;}});
 const shared=db({commercial_businesses:[{id:'a',identity_mode:'legacy'},{id:'b',identity_mode:'structured'}],commercial_contacts:[{id:'c',business_id:'a'}],commercial_leads:[{id:'l',business_id:'a'}]});
 assert.equal(await matchContact(shared,'instagram','network'),null);
 await assert.rejects(()=>matchContact(shared,'instagram','network',undefined,true),/booking_identity_ambiguous/);
 const legacy=db({commercial_businesses:[{id:'a',identity_mode:'legacy'}],commercial_contacts:[{id:'c',business_id:'a'}],commercial_leads:[{id:'l',business_id:'a'}]});
 assert.deepEqual(await matchContact(legacy,'instagram','network'),{leadId:'l',contactId:'c'});
});
