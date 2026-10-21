// Local HTTP boundary qualification. Fleet and request-creation SQL are real;
// account/health/package/login inputs are explicit fixtures, not Fleet decisions.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const ts = require('/Users/admin/Projects/boost-ai-frontend/node_modules/typescript/lib/typescript.js');
const root = path.resolve(__dirname, '..');
const socket = process.env.FLEET_TEST_PG_ROOT;
assert(socket && fs.realpathSync(socket).startsWith('/private/tmp/fleet-successor-rpc.'));
const sql = (query) => execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql',
  ['-h',socket,'-p','55483','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],
  {input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const quote = value => value == null ? 'NULL' : "'"+String(value).replaceAll("'","''")+"'";
const ids = [701,702,703,704].map(n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0'));
const calls = [];
let currentAccount = ids[0];
let unexpectedRpcFailure = false;
const accountRow = () => ({id:currentAccount,account_id:currentAccount,status:'active',admin_lifecycle_status:'active',username:'fixture-account'});
function rows(table) {
  switch(table) {
    case 'worker_heartbeats': return [{worker_id:'fixture-dispatcher',status:'idle',last_seen_at:new Date().toISOString(),metadata:{launch_enabled:true}}];
    case 'ig_accounts': return [accountRow()];
    case 'ig_account_dm_settings': return [{account_id:currentAccount,welcome_enabled:false,outreach_enabled:false}];
    case 'ig_account_dm_counters': return [];
    case 'ig_targets': return [{id:'fixture-target',account_id:currentAccount,status:'valid',quality_status:'eligible',verification_status:'found'}];
    case 'account_package_summary': return [{account_id:currentAccount,commercial_package_code:'pro',warmup_status:'warmed_up',package_caps:{follow_day:120,unfollow_day:120},effective_caps_preview:{follow_day:120,follow_session:120}}];
    case 'ig_account_follow_settings': return [];
    case 'ig_account_unfollow_settings': return [{account_id:currentAccount,unfollow_enabled:false,runtime_cap_mode:'prod_normal'}];
    case 'ig_interacted_users': case 'account_dashboard_actions': case 'account_credentials': case 'follow_60s_canary_controls': return [];
    case 'client_instagram_accounts': return [{account_id:currentAccount,client_id:'00000000-0000-0000-0000-000000000710'}];
    case 'client_entitlements': return [];
    case 'ig_runs': case 'account_run_requests': return JSON.parse(sql('select coalesce(json_agg(t),\'[]\'::json) from public.'+table+' t;'));
    default: throw Error('UNCONFIGURED_DATA_FIXTURE:'+table);
  }
}
function builder(table) {
  let filters=[], maximum=Infinity, single=false;
  const result=()=>{
    const data=rows(table).filter(r=>filters.every(f=>f(r))).slice(0,maximum);
    return {data:single?(data[0]||null):data,count:data.length,error:null};
  };
  const b={
    select(){return b;},eq(k,v){filters.push(r=>r[k]===v);return b;},
    in(k,v){filters.push(r=>v.includes(r[k]));return b;},
    gte(k,v){filters.push(r=>r[k]>=v);return b;},order(){return b;},
    limit(n){maximum=n;return b;},maybeSingle(){single=true;return b;},
    then(resolve,reject){return Promise.resolve().then(result).then(resolve,reject);},
    insert(value){if(table!=='ig_action_logs')throw Error('UNCONFIGURED_WRITE:'+table);calls.push({audit:value});return Promise.resolve({error:null});}
  };return b;
}
const supabase={from:builder,async rpc(name,p){
  calls.push({rpc:name,args:p});
  if(name==='account_package_runtime_contract_status')return {data:{ok:true,reason:'ready'},error:null};
  if(name==='evaluate_account_schedule_gate')return {data:{ok:true},error:null};
  if(name==='evaluate_login_identity_gate_v1')return {data:{ok:true,login_status:'connected',provisioning_status:'ready'},error:null};
  if(name!=='create_account_run_request')throw Error('UNCONFIGURED_RPC:'+name);
  if(unexpectedRpcFailure)return {data:null,error:{message:'fixture_unexpected_database_failure'}};
  const values=[p.p_account_id,p.p_requested_by,p.p_actor_type,p.p_source_surface,p.p_requested_run_type,p.p_idempotency_key,p.p_priority,JSON.stringify(p.p_metadata_safe)];
  const casts=['uuid','uuid','text','text','text','text','integer','jsonb'];
  try {return {data:JSON.parse(sql("begin;set local role service_role;set local request.jwt.claim.role='service_role';select row_to_json(public.create_account_run_request("+values.map((v,i)=>quote(v)+'::'+casts[i]).join(',')+'));commit;')),error:null};}
  catch(e){return {data:null,error:{message:String(e.stderr||e.message).split('\n').find(l=>l.startsWith('ERROR:'))?.replace(/^ERROR:\s*/,'')||String(e.message)}};}
}};
const cache = new Map();
function load(spec,parent=path.join(root,'entry.ts')) {
  if(spec==='@/lib/supabase')return {createSupabaseClient:()=>supabase};
  if(spec==='@/lib/restaurant-analytics/session')return {getInstagramUserContext:async()=>({userId:null}),canAccessTenantPages:()=>true};
  if(spec==='next/server')return {NextResponse:Response};
  if(spec==='server-only')return {};
  if(spec.startsWith('node:'))return require(spec);
  let file=spec.startsWith('@/')?path.join(root,spec.slice(2)):path.resolve(path.dirname(parent),spec);
  if(!spec.startsWith('@/')&&!spec.startsWith('.'))throw Error('UNCONFIGURED_IMPORT:'+spec);
  if(!fs.existsSync(file))file=['.ts','.tsx','.js'].map(ext=>file+ext).find(f=>fs.existsSync(f));
  if(!file||!file.startsWith(root+path.sep))throw Error('SOURCE_OUTSIDE_CANDIDATE:'+spec);
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInThisContext('(function(require,module,exports,__filename,__dirname){'+source+'\n})',{filename:file})(name=>load(name,file),module,module.exports,file,path.dirname(file));
  return module.exports;
}
process.env.INSTAGRAM_RUN_CONTROL_PLAY_ENABLED='true';
process.env.INSTAGRAM_RUN_CONTROL_DISPATCHER_WORKER_ID='fixture-dispatcher';
process.env.BOTAPP_RELAY_API_KEY='fixture-local-relay-only';
const route=load('@/app/api/instagram-dashboard/runs/start/route.ts');
const server=http.createServer(async(req,res)=>{
  try {
    let body='';for await(const chunk of req)body+=chunk;
    const response=await route.POST(new Request('http://127.0.0.1'+req.url,{method:'POST',headers:req.headers,body}));
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  } catch(error){res.writeHead(500);res.end(JSON.stringify({harness_error:String(error)}));}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/api/instagram-dashboard/runs/start';
  try {
    for(const [index,state] of ['REQUESTED','ACTIVE','RELEASING','NO_POLICY'].entries()) {
      currentAccount=ids[index];
      const before=Number(sql('select count(*) from public.account_run_requests where account_id='+quote(currentAccount)+';'));
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-botapp-relay-key':'fixture-local-relay-only'},body:JSON.stringify({account_id:currentAccount,requested_run_type:'account_session',manual_start:true,source:'botapp_manual_play',idempotency_key:'fixture-'+state})});
      const body=await response.json();
      const after=Number(sql('select count(*) from public.account_run_requests where account_id='+quote(currentAccount)+';'));
      console.log(JSON.stringify({boundary:'REAL_PLAY_HTTP',state,status:response.status,body,requests_delta:after-before}));
      if(state==='NO_POLICY'){assert.equal(response.status,200);assert.equal(after-before,1);}
      else {assert.equal(response.status,409);assert.equal(body.reason,'fleet_hold_'+state.toLowerCase());assert.equal(after,before);}
    }
    currentAccount=ids[0];unexpectedRpcFailure=true;
    const before=Number(sql('select count(*) from public.account_run_requests;'));
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-botapp-relay-key':'fixture-local-relay-only'},body:JSON.stringify({account_id:currentAccount,requested_run_type:'account_session',manual_start:true,source:'botapp_manual_play',idempotency_key:'fixture-unexpected'})});
    assert.equal(response.status,500);
    assert.equal(Number(sql('select count(*) from public.account_run_requests;')),before);
    console.log('MANUAL_PLAY_HTTP_CASES=5/5 PASS');
  } finally {await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
