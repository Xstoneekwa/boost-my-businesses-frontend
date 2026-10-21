/* eslint-disable @typescript-eslint/no-require-imports -- Set isolated env before loading actual application modules through tsx's CJS hook. */
const {createHmac}=require('node:crypto');
const {createServer}=require('node:http');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const socket=process.env.LOCAL_PG_SOCKET;
if(!socket?.startsWith('/private/tmp/auto-restart-v2-pg17.')) throw Error('ISOLATED_SOCKET_REQUIRED');
const database=process.env.LOCAL_PG_DATABASE||'auto_restart_v2';
if(!/^auto_restart_v2(?:_replay)?$/.test(database)) throw Error('ISOLATED_DATABASE_REQUIRED');
const sql=q=>execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql',['-X','-At','-v','ON_ERROR_STOP=1','-h',socket,'-p','55489','-d',database,'-c',q],{encoding:'utf8'}).trim();
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const data=encode({alg:'HS256',typ:'JWT'})+'.'+encode({role:'service_role',exp:Math.floor(Date.now()/1000)+3600});
const jwt=data+'.'+createHmac('sha256','local-only-auto-restart-v2-fixture-secret-00000000').update(data).digest('base64url');
process.env.NEXT_PUBLIC_SUPABASE_URL=process.env.SUPABASE_URL='http://127.0.0.1:55491';
process.env.SUPABASE_SERVICE_ROLE_KEY=jwt;
process.env.ADMIN_DASHBOARD_API_URL='http://127.0.0.1:55491/admin';
process.env.ADMIN_DASHBOARD_INTERNAL_API_TOKEN='local-only-admin-test';
process.env.INSTAGRAM_RUN_CONTROL_DISPATCHER_WORKER_ID='run-dispatcher:local-cert';
global.Deno={env:{get:name=>process.env[name]}};
const nativeFetch=global.fetch;
const calls=[];
global.fetch=async (input,init)=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(url.hostname!=='127.0.0.1'||!['55490','55491'].includes(url.port)) throw Error('NON_LOCAL_NETWORK_FORBIDDEN');
 const r=await nativeFetch(input,init);calls.push({path:url.pathname,status:r.status,body:init?.body?JSON.parse(String(init.body)):null});
 if(!r.ok) console.log('HTTP_FAILURE',url.pathname,await r.clone().text());
 return r;
};
const {handleRequest}=require(path.join(process.env.ADMIN_CONTRACT_ROOT,'supabase/functions/admin-dashboard/index.ts'));
const server=createServer(async(req,res)=>{
 try {
  const chunks=[];for await(const c of req) chunks.push(c);
  const body=chunks.length?Buffer.concat(chunks):undefined;
  const headers=req.headers;delete headers.host;
  const init={method:req.method,headers,...(body?{body,duplex:'half'}:{})};
  const response=req.url.startsWith('/admin')?await handleRequest(new Request('http://127.0.0.1:55491/admin',init)):await fetch('http://127.0.0.1:55490'+req.url.replace(/^\/rest\/v1/,''),init);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){res.writeHead(500);res.end(String(e));}
});

const account='00000000-0000-0000-0000-000000009002';
const source='00000000-0000-0000-0000-000000009010';
const reset=()=>{execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql',['-X','-v','ON_ERROR_STOP=1','-h',socket,'-p','55489','-d',database,'-f',path.join(__dirname,'reset.sql')]);calls.length=0;};
const state=()=>JSON.parse(sql(`select json_build_object('consumed',(select count(*) from incident_resume_authorizations where account_id='${account}' and status='consumed'),'requests',(select count(*) from account_run_requests where account_id='${account}' and id<>'${source}'))`));
server.listen(55491,'127.0.0.1',async()=>{
 try{
  const {createSupabaseClient}=require(root+'/lib/supabase.ts');
  const {runAutoRestartTick}=require(root+'/lib/instagram-dashboard/auto-restart-tick.ts');
  const {getAutoRestartData}=require(root+'/app/instagram-dashboard/auto-restart-data.ts');
  const db=createSupabaseClient();
  for(const op of [
   db.from('worker_heartbeats').upsert({worker_id:'run-dispatcher:local-cert',host_machine:'local-cert',status:'idle',last_seen_at:new Date().toISOString(),git_sha:'2e0ae3ceaba2890876c5d5dfde9a486d4ac64bd0'}),
   db.from('auto_restart_settings').upsert({id:'global',auto_restart_enabled:true,mode:'production'})
  ]){const r=await op;if(r.error)throw r.error;}
  const tick=async()=>{const r=await runAutoRestartTick(db,{workerId:'run-dispatcher:local-cert',internal:true});assert.equal(r.status,200);return r.result;};
  reset();
  const projected=(await getAutoRestartData()).candidates.find(c=>c.accountId===account);
  assert.equal(projected.sourceBusinessSessionId,source);
  assert.equal(projected.canonicalAttemptId,1);
  assert.equal(projected.nextRetryIndex,1);
  const success=await tick();
  assert.equal(success.enqueued_count,1);
  assert.deepEqual(state(),{consumed:1,requests:1});
  const rpc=calls.find(c=>c.path==='/rpc/consume_resume_authorization_and_create_request_v4');
  assert.ok(rpc);assert.equal(rpc.status,200);
  const args=rpc.body;
  assert.equal(args.p_metadata_safe.business_session_id,source);
  assert.equal(args.p_metadata_safe.attempt_id,2);
  assert.equal(args.p_metadata_safe.retry_index,1);
  const persisted=JSON.parse(sql(`select row_to_json(q) from (select root_business_session_id,execution_attempt_no,retry_index,idempotency_key from account_run_requests where account_id='${account}' and id<>'${source}')q`));
  assert.equal(persisted.root_business_session_id,source);
  assert.equal(persisted.execution_attempt_no,2);
  assert.equal(persisted.retry_index,1);
  assert.match(persisted.idempotency_key,/^resume-auth:.*:g0$/);
  const receipt={success:'PASS',lineage:{source:[source,1,0],projected:[projected.sourceBusinessSessionId,projected.canonicalAttemptId,projected.nextRetryIndex-1],rpc:[args.p_metadata_safe.business_session_id,args.p_metadata_safe.attempt_id,args.p_metadata_safe.retry_index],persisted}};
  sql("delete from auto_restart_tick_locks where worker_id='run-dispatcher:local-cert'; delete from auto_restart_decisions where account_id='00000000-0000-0000-0000-000000009002'");
  await tick();assert.deepEqual(state(),{consumed:1,requests:1});receipt.consumed='PASS';
  reset();
  const concurrent=await Promise.all([tick(),tick()]);
  assert.deepEqual(state(),{consumed:1,requests:1});
  assert.equal(concurrent.reduce((n,r)=>n+r.enqueued_count,0),1);
  receipt.concurrent={status:'PASS',results:concurrent.map(r=>({skipped:r.skipped,reason:r.reason,enqueued:r.enqueued_count}))};
  reset();
  sql(`update incident_resume_authorizations set expires_at=now()-interval '1 minute' where account_id='${account}'`);
  const expired=await tick();assert.deepEqual(state(),{consumed:0,requests:0});
  assert.ok(expired.blocked.some(b=>b.reason==='resume_authorization_expired'));
  receipt.expired={status:'PASS',result:expired};
  for(const [name,key,value] of [['root','business_session_id','00000000-0000-0000-0000-000000009999'],['attempt','execution_attempt_no',3]]){
   reset();
   const bad=structuredClone(args);bad.p_metadata_safe.resume_plan[key]=value;
   const result=await db.rpc('consume_resume_authorization_and_create_request_v4',bad);
   assert.match(result.error?.message??'',/resume_plan_lineage_mismatch/);
   assert.deepEqual(state(),{consumed:0,requests:0});receipt[name]='PASS_REAL_V4_REJECT';
  }
  reset();
  const retry=structuredClone(args);retry.p_metadata_safe.retry_index=99;retry.p_metadata_safe.resume_plan.retry_index=99;
  const rr=await db.rpc('consume_resume_authorization_and_create_request_v4',retry);
  assert.equal(rr.error,null);
  assert.equal(sql(`select retry_index from account_run_requests where account_id='${account}' and id<>'${source}'`),'1');
  receipt.retry='CANONICALIZED_BY_UNCHANGED_V4_NOT_REJECTED';
  reset();
  for(const [column,value] of [['root_business_session_id',"'00000000-0000-0000-0000-000000009999'"],['execution_attempt_no','2'],['retry_index','1']]){
   const r=await db.from('account_run_requests').update({[column]:value.startsWith("'")?value.slice(1,-1):Number(value)}).eq('id',source);
   assert.match(r.error?.message??'',/account_run_request_lineage_immutable/);
  }
  receipt.persisted_lineage_mutation='FAIL_CLOSED_AT_IMMUTABILITY_TRIGGER';
  for(const [name,metadata] of [['root',{business_session_id:'00000000-0000-0000-0000-000000009999',attempt_id:1,retry_index:0}],['attempt',{business_session_id:source,attempt_id:2,retry_index:1}],['retry',{business_session_id:source,attempt_id:1,retry_index:2}]]){
   reset();
   const write=await db.from('account_run_requests').update({metadata_safe:metadata}).eq('id',source);assert.equal(write.error,null);
   const result=await tick();assert.equal(result.enqueued_count,0);assert.deepEqual(state(),{consumed:0,requests:0});
   receipt['persisted_'+name]={status:'FAIL_CLOSED',blocked:result.blocked};
   const clear=await db.from('account_run_requests').update({metadata_safe:{}}).eq('id',source);assert.equal(clear.error,null);
  }
  receipt.legacy_without_canonical_columns='UNREPRESENTABLE_WITH_CURRENT_NOT_NULL_AND_INSERT_GUARD';
  console.log('CERTIFICATION_RECEIPT='+JSON.stringify(receipt));
 }catch(e){console.error(e);process.exitCode=1;}finally{server.close();}
});
