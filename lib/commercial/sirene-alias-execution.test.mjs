import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../restaurant-worker/node_modules/esbuild/lib/main.js';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require=createRequire(import.meta.url);
async function load(entry,globals={},stubs={}) {
 const result=await build({entryPoints:[`lib/commercial/${entry}.ts`],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'isolated-test',setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'stub'}));
  b.onResolve({filter:/crm-access$|supabase\/admin$|sirene-exact-provider$/},a=>Object.keys(stubs).some(k=>a.path.endsWith(k))?{path:Object.keys(stubs).find(k=>a.path.endsWith(k)),namespace:'stub'}:undefined);
  b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]??'',loader:'ts',resolveDir:process.cwd()}));
 }}]});
 const module={exports:{}};runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require,process:{env:{SIRENE_API_KEY:'fixture-not-secret'}},URL,Response,AbortSignal,...globals});return module.exports;
}
test('exact provider rejects outside cohort before fetch and never retries HTTP failure',async()=>{
 const {SireneExactProvider}=await load('sirene-exact-provider');
 const p=new SireneExactProvider();let calls=0;
 const input={runId:'7243d1fe-1554-4cf5-ba07-2c6ad07d731d',itemId:'b5327fe9-a147-4f27-b49d-22ee422d881e',businessId:'53d9149a-a54e-4cf2-a0de-21dd3b136f91',siret:'05580205200039',confidence:'MEDIUM',eligible:true,leadId:null,selected:false};
 const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://api.insee.fr/api-sirene/3.11/siret/05580205200039');assert.equal(options.redirect,'error');assert.equal(options.headers['X-INSEE-Api-Key-Integration'],'fixture');return new Response('{}',{status:503});};
 await assert.rejects(p.getEstablishmentBySiret({...input,siret:'other'},'fixture','2026-09-28',fetcher),/not_authorized/);assert.equal(calls,0);
 await assert.rejects(p.getEstablishmentBySiret(input,'fixture','2026-09-28',fetcher),/sirene_http_503/);assert.equal(calls,1);
});
test('first live schema mismatch records no aliases and stops all later calls',async()=>{
 const contract=await load('sirene-alias-diagnostic-contract');
 const inputs=contract.SIRENE_ALIAS_TARGETS.map(t=>({...t,runId:contract.SIRENE_ALIAS_RUN_ID,confidence:'MEDIUM',eligible:true,leadId:null,selected:false}));
 let fetches=0;const actions=[];
 const rpc=async(_name,p)=>{actions.push(p);return {data:p.p_action==='start'?{replay:false,status:'running',inputs}:{status:p.p_action==='record'?'failed':'running'},error:null};};
 const {runSireneAliasDiagnostic}=await load('sirene-alias-diagnostic-service',{rpc,failFetch:()=>{fetches++;}}, {
  'crm-access':'export async function requireCommercialCrmAccess(){return {userId:"owner"}}',
  'supabase/admin':'export function createSupabaseAdminClient(){return {rpc:globalThis.rpc}}',
  'sirene-exact-provider':'import {SireneSchemaError} from "'+process.cwd()+'/lib/commercial/sirene-alias-parser"; export class SireneExactProvider {async getEstablishmentBySiret(){globalThis.failFetch();throw new SireneSchemaError(["currentPeriod"]);}}',
 });
 assert.equal((await runSireneAliasDiagnostic()).status,'failed');assert.equal(fetches,1);
 assert.deepEqual(actions.map(a=>a.p_action),['start','reserve','record']);
 assert.equal(actions[2].p_payload.outcome,'SCHEMA_FAIL');assert.equal(actions[2].p_payload.aliases.length,0);
});
test('V3A has canonical owner guard, fixed body, and no forbidden provider/transport dependency',()=>{
 const service=readFileSync('lib/commercial/sirene-alias-diagnostic-service.ts','utf8');
 const route=readFileSync('app/api/instagram-dashboard/commercial/discovery/aliases/route.ts','utf8');
 assert.match(service,/await requireCommercialCrmAccess\(\)/);assert.match(route,/Object.keys\(body\).length !== 1/);assert.match(route,/same_origin_required/);
 assert.doesNotMatch(service,/searchapi|lookupInstagram|analyzeCommercial|sendEmail|executeStructuredPoc|executeResolverReprocess/);
 assert.ok(service.indexOf('"reserve", input.itemId')<service.indexOf('provider.getEstablishmentBySiret'));
});
