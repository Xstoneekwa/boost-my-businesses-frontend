import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require(process.env.TYPESCRIPT_PATH || 'typescript');
const root = fileURLToPath(new URL('../', import.meta.url));
const base = '3cbbaecf28cde0848664825ed901c0b2e1748575';
const entry = 'app/instagram-dashboard/manage-data.ts';
const now = '2026-09-09T17:00:00.000Z';
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const c = '33333333-3333-4333-8333-333333333333';
const plain = value => JSON.parse(JSON.stringify(value));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sourceCache = new Map();
function source(revision, rel) {
  const key = `${revision}:${rel}`;
  if (!sourceCache.has(key)) {
    let text=revision==='candidate'?readFileSync(path.join(root,rel),'utf8'):execFileSync('git',['-C',root,'show',key],{encoding:'utf8'});
    if(revision===base && rel===entry) {
      // The separate certified assignment-id delta is not a scheduling regression.
      const certified=execFileSync('git',['-C',root,'show',`665fb3456a3157d2f8b4051ab377991b9a88b392:${rel}`],{encoding:'utf8'});
      for(const [before,after] of [
        ['.select("account_id,status,device_id,app_instance_id,starts_at,ends_at,released_at,schedule_mode,slot_kind")','.select("id,account_id,status,device_id,app_instance_id,starts_at,ends_at,released_at,schedule_mode,slot_kind")'],
        ['        assignmentStatus: readString(assignment,','        assignmentId: readString(assignment, ["id"], "") || null,\n        assignmentStatus: readString(assignment,'],
      ]) {assert.equal(text.split(before).length-1,1);assert.ok(certified.includes(after));text=text.replace(before,after);}
    }
    sourceCache.set(key,text);
  }
  return sourceCache.get(key);
}

function harness(revision, scenario = {}) {
  const calls = [], events = [], cache = new Map();
  const ids = scenario.empty ? [] : [a,b,c];
  const overviewItems = ids.map(account_id => ({account_id, username: `fixture-${account_id[0]}`, admin_status:'active',
    credentials_configured:true, credentials_status:'active', login_status:'connected', provisioning_status:'ready',
    onboarding_status:'completed', package_label:'Pro', created_at:now, entitlement_summary:'follow'}));
  const tables = {
    client_instagram_accounts: ids.map(account_id => ({account_id, client_id:a, active:true, onboarding_rollback_at:null,
      login_status:'connected', provisioning_status:'ready', onboarding_status:'completed', created_at:now,
      login_identity_proof_status: scenario.badIdentity ? 'mismatch' : 'verified', login_identity_profile_opened:true,
      login_identity_username_match:!scenario.badIdentity, login_identity_verified_at:now, login_state_version:5})),
    ig_accounts: ids.map(id => ({id, username:`fixture-${id[0]}`, status:id===c?'rolled_back_test_onboarding':'active',
      admin_lifecycle_status:id===b?'archived':'active', username_verification_status:'verified', avatar_url:null, created_at:now})),
    account_credentials: ids.map(account_id=>({account_id, status:'active', secret_ref:scenario.missingSecret?null:'fixture-secret-ref',
      metadata_safe:{email:'fixture@example.invalid'}, reauth_required:false, created_at:now})),
    account_assignments: scenario.unassigned ? [] : ids.map(account_id=>({id:`assignment-${account_id}`,account_id,status:'active',device_id:'device',app_instance_id:`app-${account_id}`,schedule_mode:'manual'})),
    phone_app_instances: ids.map(current_account_id=>({id:`app-${current_account_id}`,device_id:'device',current_account_id: scenario.mismatch ? a : current_account_id,
      visible_label:'Instagram',package_name:'com.instagram.android',status:'active',is_launchable:true,usable_for_auto_login:true,instance_index:1})),
    phone_devices:[{id:'device',name:'Phone fixture',status:'active',timezone:'Africa/Johannesburg'}],
    ig_account_settings:ids.map(account_id=>({account_id,email:'fixture@example.invalid'})),
    account_dashboard_actions:[], account_incidents:[],ig_account_dm_settings:[],ig_account_unfollow_settings:[],ig_runs:[],ig_targets:[],
  };
  function query(table) {
    let fields = '*', filters = [], take = null, offset = 0;
    const q = {
      select(v){fields=v;return q}, in(k,v){filters.push(['in',k,[...v]]);return q}, eq(k,v){filters.push(['eq',k,v]);return q},
      is(k,v){filters.push(['eq',k,v]);return q}, order(){return q}, limit(n){take=n;return q}, range(start,end){offset=start;take=end-start+1;return q},
      then(resolve,reject) {
        const key = `${table}:${fields}`;
        calls.push({table,fields,filters:plain(filters),take,offset});
        events.push({kind:'start',key,at:performance.now()});
        const wait = scenario.wait?.(table,fields) ?? 0;
        return delay(wait).then(()=>{
          events.push({kind:'end',key,at:performance.now()});
          if (scenario.fail?.(table,fields)) return {data:null,error:{code:'fixture_failure'}};
          if (scenario.throw?.(table,fields)) throw new Error('fixture transport failure');
          let rows = (tables[table] || []).filter(row=>filters.every(([op,k,v])=>op==='in'?v.includes(row[k]):(row[k]??null)===v));
          rows = rows.slice(offset,take==null?undefined:offset+take);
          if(fields!=='*')rows=rows.map(row=>Object.fromEntries(fields.split(',').filter(k=>k in row).map(k=>[k,row[k]])));
          return {data:plain(rows),error:null};
        }).then(resolve,reject);
      },
    };return q;
  }
  async function fetchOverview() {
    events.push({kind:'start',key:'overview',at:performance.now()});
    await delay(scenario.overviewMs ?? 0);
    events.push({kind:'end',key:'overview',at:performance.now()});
    if(scenario.apiError)return Response.json({ok:false},{status:503});
    return Response.json({ok:true,action:'manage_overview',items:scenario.missingCanonical?overviewItems.slice(0,1):overviewItems});
  }
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[now]))}static now(){return Date.parse(now)}}
  const env=scenario.noConfig?{}:{ADMIN_DASHBOARD_API_URL:'https://fixture.invalid',ADMIN_DASHBOARD_INTERNAL_API_TOKEN:'fixture-token'};
  const context = vm.createContext({Date:FixedDate,performance,Response,Request,URL,Headers,AbortController,TextEncoder,Buffer,
    setTimeout,clearTimeout,process:{env},console:{info(){},warn(){},error(){}}});
  function load(rel) {
    if (rel === "lib/supabase.ts") return {createSupabaseClient:()=>({from:query})};
    if(cache.has(rel))return cache.get(rel).exports;
    const loadedModule={exports:{}};cache.set(rel,loadedModule);
    const localRequire=specifier=>{
      if(specifier==='@/lib/supabase')return {createSupabaseClient:()=>({from:query})};
      if(specifier==='@/lib/instagram-dashboard/profiles-live-causal-context')return {
        causalFetch:fetchOverview,traceStep:async(_name,fn)=>await fn(),traceMetric(){},traceFallback(){},
      };
      if(specifier==='./package-summary-data')return {getAccountPackageSummaries:async accounts=>{
        events.push({kind:'start',key:'packages',at:performance.now()});await delay(scenario.packagesMs??0);
        if(scenario.packageError)throw new Error('fixture package failure');
        return new Map(accounts.map(id=>[id,{commercialPackageLabel:'Pro',commercialAddonsLabel:'None',outreachSourceLabel:'fixture',runtimeProfilesLabel:'Standard',entitlementSummary:'follow'}]));
      }};
      if(specifier==='@/lib/instagram-dashboard/orphan-login-recovery')return {resolveOrphanLoginRecoveryProjection:async()=>({state:'none',botappActionAvailable:false})};
      // Remote eligibility/blocker reads are fixtures; use their real pure projection functions.
      if(specifier.startsWith('node:'))return require(specifier);
      let resolved=specifier.startsWith('@/')?specifier.slice(2):path.posix.normalize(path.posix.join(path.posix.dirname(rel),specifier));
      if(!resolved.endsWith('.ts'))resolved+='.ts';
      const exports=load(resolved);
      if(specifier==='@/lib/instagram-dashboard/account-target-eligibility')return {...exports,loadTargetEligibilityCountsByAccount:async()=>new Map()};
      if(specifier==='@/lib/instagram-dashboard/operational-blocker')return {...exports,loadCanonicalOperationalBlockers:async()=>new Map()};
      return exports;
    };
    const js=ts.transpileModule(source(revision,rel),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:rel}).outputText;
    vm.runInContext(`(function(require,module,exports){${js}\n})`,context,{filename:rel})(localRequire,loadedModule,loadedModule.exports);
    return loadedModule.exports;
  }
  const mod=load(entry);
  return {calls,events,async run(){try{return {ok:true,value:plain(await mod.getManageData({requireCanonicalComplete:!scenario.allowFallback}))}}
    catch(error){return {ok:false,name:error.name,message:error.message}}}};
}

async function parity(scenario={}) {
  const old=harness(base,scenario), candidate=harness('candidate',scenario);
  const expected=await old.run(),actual=await candidate.run();
  assert.deepEqual(actual,expected);
  return {expected,actual,old,candidate};
}
for (const [name,scenario] of Object.entries({nominal:{},empty:{empty:true},missingCanonical:{missingCanonical:true},
  missingSecret:{missingSecret:true},badIdentity:{badIdentity:true},unassigned:{unassigned:true},mismatch:{mismatch:true},
  apiError:{apiError:true},legacyFallback:{apiError:true,allowFallback:true},notConfigured:{noConfig:true},
  packageError:{packageError:true},combinedFailures:{packageError:true,fail:t=>t==='account_credentials'||t==='ig_account_dm_settings'}})) {
  test(`projection/fallback parity: ${name}`,async()=>{
    const {actual}=await parity(scenario);
    if(name==='nominal') {
      assert.equal(actual.ok,true);assert.equal(actual.value.allAccounts.length,2);
      assert.ok(!JSON.stringify(actual).includes('fixture-secret-ref'));
      assert.ok(actual.value.allAccounts.every(p=>p.orphanRecoveryState==='none'));
    }
  });
}
for(const table of ['client_instagram_accounts','ig_accounts','account_credentials','account_assignments','phone_app_instances','phone_devices','ig_account_settings','account_dashboard_actions','account_incidents','ig_account_dm_settings']) {
  test(`failure precedence preserved: ${table}`,()=>parity({fail:t=>t===table}));
  test(`transport failure preserved: ${table}`,()=>parity({throw:t=>t===table}));
}
test('read arguments, membership and bounds are preserved despite scheduling order',async()=>{
  const {old,candidate}=await parity();
  const canonical=calls=>calls.map(c=>JSON.stringify(c)).sort();
  assert.deepEqual(canonical(candidate.calls),canonical(old.calls));
});
test('controlled slow dependencies overlap without changing projection (no production SLA claim)',async()=>{
  const scenario={overviewMs:180,packagesMs:100,wait:(t,f)=>t==='account_assignments'?180:t==='client_instagram_accounts'&&f.includes('client_id')?160:t==='account_dashboard_actions'?160:1};
  const old=harness(base,scenario),candidate=harness('candidate',scenario);
  let started=performance.now();const expected=await old.run();const beforeMs=performance.now()-started;
  started=performance.now();const actual=await candidate.run();const afterMs=performance.now()-started;
  assert.deepEqual(actual,expected);
  assert.ok(actual.value.allAccounts.every(p=>p.assignmentId===`assignment-${p.accountId}`));
  assert.ok(afterMs<beforeMs*0.8,JSON.stringify({beforeMs,afterMs}));
  const reconcileStart=candidate.events.find(e=>e.kind==='start'&&e.key.startsWith('client_instagram_accounts:account_id,client_id'));
  const overviewEnd=candidate.events.find(e=>e.kind==='end'&&e.key==='overview');
  assert.ok(reconcileStart.at<overviewEnd.at);
  const readinessStart=candidate.events.find(e=>e.kind==='start'&&e.key.startsWith('account_dashboard_actions:'));
  const assignmentEnd=candidate.events.find(e=>e.kind==='end'&&e.key.startsWith('account_assignments:'));
  assert.ok(readinessStart.at<assignmentEnd.at);
  console.log(JSON.stringify({controlled_performance:{beforeMs:Math.round(beforeMs),afterMs:Math.round(afterMs)}}));
});

test('controlled 6000ms budget: remove additive waits, retain the complete response',async()=>{
  const scenario={overviewMs:3200,packagesMs:500,wait:(t,f)=>t==='client_instagram_accounts'&&f.includes('client_id')?2400:t==='account_assignments'?450:t==='account_dashboard_actions'?450:1};
  const old=harness(base,scenario),candidate=harness('candidate',scenario);
  let started=performance.now();const expected=await old.run();const beforeMs=performance.now()-started;
  started=performance.now();const actual=await candidate.run();const afterMs=performance.now()-started;
  assert.deepEqual(actual,expected);
  assert.ok(beforeMs>6000,`baseline must exercise the additive timeout pattern: ${beforeMs}`);
  assert.ok(afterMs<5500,`candidate must retain margin under 6000ms: ${afterMs}`);
  console.log(JSON.stringify({controlled_6000ms_budget:{beforeMs:Math.round(beforeMs),afterMs:Math.round(afterMs),production_certification:false}}));
});
