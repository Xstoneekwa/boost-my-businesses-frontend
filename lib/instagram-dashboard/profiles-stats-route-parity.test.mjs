import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {mockDatabase} from './canonical-social-snapshot-read.test.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const instant='2026-08-28T12:00:00.000Z';
class FixedDate extends Date { constructor(...args){super(...(args.length?args:[instant]))} static now(){return Date.parse(instant)} }
// Execute actual route bodies and actual pure projectors. Only auth, clock,
// getManageData and the database transport are replaced with in-memory fixtures.
async function loadRoute(relative, mocks) {
 const filename=path.join(root,relative), source=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const dependencies=new Map();
 for(const [,specifier] of source.matchAll(/require\("([^"]+)"\)/g)) {
  if(specifier in mocks){dependencies.set(specifier,mocks[specifier]);continue;}
  let absolute=specifier.startsWith('@/')?path.join(root,specifier.slice(2)):path.resolve(path.dirname(filename),specifier);
  if(!absolute.endsWith('.ts'))absolute+='.ts';
  dependencies.set(specifier,await import(pathToFileURL(absolute)));
 }
 const exports={};
 vm.runInNewContext(source,{exports,require:s=>dependencies.get(s),Date:FixedDate,URL,Response,console,process:{env:{}}},{filename});
 return exports;
}
test('actual full Profiles → Live → Stats routes use the same account-scoped canonical snapshots',async()=>{
 const accounts=[{accountId:'a',username:'account_a',adminStatus:'active'},{accountId:'b',username:'account_b',adminStatus:'active'}];
 const deleted={accountId:'deleted',username:'removed_account',adminStatus:'cancelled'};
 const snapshots=[['a',10,'2026-08-25T12:00:00.000Z'],['a',16,instant],['b',900,instant]].map(([account_id,followers_count,observed_at])=>({account_id,followers_count,following_count:50,posts_count:7,observed_at,snapshot_local_date:observed_at.slice(0,10),account_timezone:'Africa/Johannesburg',lookup_status:'found',source_provider:'searchapi',idempotency_key:`${account_id}:${observed_at}`}));
 const db=mockDatabase({ig_account_social_profile_snapshots:snapshots,ig_accounts:[{id:'a',followers_count:99999}],ig_account_settings:[{account_id:'a'}]});
 const utils={jsonOk:data=>Response.json({ok:true,data}),jsonError:(error,status=500)=>Response.json({ok:false,error},{status}),requireInstagramAdmin:async()=>null,readNumber:(row,key,fallback=0)=>Number.isFinite(Number(row?.[key]))?Number(row[key]):fallback,readString:(v,f='')=>typeof v==='string'?v:f};
 const auth={verifyCompassRelayKey:()=>({ok:true,mode:'relay_key'})};
 const common={'@/lib/supabase':{createSupabaseClient:()=>db},'@/app/instagram-dashboard/manage-data':{getManageData:async()=>({allAccounts:[...accounts,deleted],activeAccounts:accounts,archivedAccounts:[],trashedAccounts:[],summary:{},errors:[]})},'../_utils':utils,'../compass/relay-auth':auth};
 const full=await loadRoute('app/api/instagram-dashboard/profiles/route.ts',common);
 const live=await loadRoute('app/api/instagram-dashboard/profiles/live/route.ts',{'@/app/api/instagram-dashboard/_utils':utils,'@/lib/supabase':common['@/lib/supabase'],'../route':full});
 const stats=await loadRoute('app/api/instagram-dashboard/profiles/[accountId]/stats-history/route.ts',{'../../../_utils':utils,'../../../compass/relay-auth':auth,'@/lib/supabase':common['@/lib/supabase']});
 const request=new Request('http://fixture/profiles?account_ids=a,b,deleted,merely_missing');
 const fullResult=await (await full.GET(request)).json(), liveResult=await (await live.GET(request)).json();
 const statsResult=await (await stats.GET(request,{params:Promise.resolve({accountId:'a'})})).json();
 assert.equal(fullResult.ok,true); assert.equal(liveResult.ok,true); assert.equal(statsResult.ok,true,JSON.stringify(statsResult));
 const a=fullResult.data.profiles.find(p=>p.accountId==='a');
 assert.equal(a.followerDelta3d.value,6);assert.equal(a.followerDelta3d.currentFollowers,16);
 assert.deepEqual(liveResult.data.profiles.find(p=>p.accountId==='a').followerDelta3d,a.followerDelta3d);
 assert.deepEqual(liveResult.data.membership.removedAccountIds,['deleted']);
 const serialized=JSON.stringify(statsResult.data);
 assert.ok(serialized.includes('"followers_count":16'),serialized);
 assert.ok(!serialized.includes('99999'));assert.ok(!serialized.includes('"followers_count":900'));
 assert.ok(db.calls.includes('ig_account_social_profile_snapshots'));
});
