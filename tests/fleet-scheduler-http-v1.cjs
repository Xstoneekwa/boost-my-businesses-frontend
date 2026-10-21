const fs=require('node:fs'), Module=require('node:module');
const filename='/Users/admin/Projects/backend-fleet-control-v1/tests/fleet-http-operational-v1.cjs';
let s=fs.readFileSync(filename,'utf8');
s=s.replace("let unexpectedRpcFailure = false;","let unexpectedRpcFailure = false;\nconst fixtureWrites=new Map();");
s=s.replace("case 'worker_heartbeats': return", "case 'auto_restart_settings': return [{id:'global',auto_restart_enabled:true,max_restarts_per_day_per_account:10,max_restarts_per_window_per_account:10}];\n    case 'auto_restart_tick_locks': case 'auto_restart_decisions': return fixtureWrites.get(table)||[];\n    case 'incident_resume_authorizations': return [];\n    case 'worker_heartbeats': return");
s=s.replaceAll("'fixture-dispatcher'","'run-dispatcher:fixture-local'");
s=s.replace("unfollow_enabled:false","unfollow_enabled:true,unfollow_daily_limit:120,unfollow_per_run:120");
s=s.replace("case 'ig_interacted_users': case 'account_dashboard_actions'", "case 'ig_interacted_users': return [{id:'fixture-unfollow-target',account_id:currentAccount,unfollow_status:'pending'}];\n    case 'account_dashboard_actions'");
s=s.replace("insert(value){if(table!=='ig_action_logs')", "update(value){calls.push({fixture_update:table,value});return b;},\n    insert(value){if(['auto_restart_tick_locks','auto_restart_decisions','runtime_events'].includes(table)){const rows=fixtureWrites.get(table)||[];rows.push(value);fixtureWrites.set(table,rows);return Promise.resolve({error:null});}if(table!=='ig_action_logs')");
s=s.replace("if(name==='account_package_runtime_contract_status')", "if(['reconcile_stale_account_session_resume_plans_v1','reconcile_resolved_incident_resume_windows_v2','restore_prebusiness_resume_retry_credits_v1'].includes(name))return {data:{reconciled:[],ambiguous:[]},error:null};\n  if(name==='account_package_runtime_contract_status')");
const injection=[
"function extractFunctions(relative,names){",
" const file=path.join(root,relative), text=fs.readFileSync(file,'utf8');",
" const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);",
" const found=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text));",
" assert.equal(found.length,names.length);",
" const code=found.map(n=>n.getText(ast).replace(/^export /,'')).join('\\n')+'\\nreturn {'+names.join(',')+'};';",
" return new Function(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)();",
"}",
"const realRules=extractFunctions('app/instagram-dashboard/auto-restart-data.ts',['readNumber','readBoolean','defaultAutoRestartRules','rulesFromSettingsRow']);",
"const fixtureFactory=extractFunctions('lib/instagram-dashboard/auto-restart-tick-helpers.test.ts',['recoverableCandidate']);",
"function overviewFixture(){",
" const c=fixtureFactory.recoverableCandidate(0);",
" c.accountId=currentAccount;c.username='fixture-restart';c.deviceId=null;c.appInstanceId=null;",
" c.sourceRunId='00000000-0000-0000-0000-000000000950';c.sourceBusinessSessionId='00000000-0000-0000-0000-000000000951';",
" c.reliability.businessDaySast=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg'}).format(new Date());",
" c.reliability.lastRunId=c.sourceRunId;c.reliability.businessSessionId=c.sourceBusinessSessionId;",
" return {candidates:[c]};",
"}"
].join('\n');
s=s.replace("const cache = new Map();",injection+"\nconst cache = new Map();");
s=s.replace("if(spec==='@/lib/supabase')","if(spec==='@/app/instagram-dashboard/auto-restart-data')return {...realRules,getAutoRestartData:async()=>overviewFixture()};\n  if(spec==='@/lib/supabase')");
s=s.replace("const route=load('@/app/api/instagram-dashboard/runs/start/route.ts');","process.env.INSTAGRAM_AUTO_RESTART_TICK_TOKEN='fixture-tick-only';\nconst route=load('@/app/api/instagram-dashboard/auto-restart/tick/route.ts');");
s=s.slice(0,s.indexOf("(async()=>{"))+[
"(async()=>{",
" await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));",
" try{",
" for(const [i,state] of ['REQUESTED','ACTIVE','RELEASING','NO_POLICY'].entries()){",
" currentAccount=ids[i];fixtureWrites.clear();",
" const before=Number(sql('select count(*) from public.account_run_requests where account_id='+quote(currentAccount)+';'));",
" const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/instagram-dashboard/auto-restart/tick',{",
" method:'POST',headers:{'content-type':'application/json','x-instagram-auto-restart-tick-token':'fixture-tick-only','x-run-control-worker-id':'run-dispatcher:fixture-local'},body:'{}'});",
" const body=await response.json();",
" const after=Number(sql('select count(*) from public.account_run_requests where account_id='+quote(currentAccount)+';'));",
" console.log(JSON.stringify({boundary:'REAL_AUTO_RESTART_HTTP',state,status:response.status,body,requests_delta:after-before}));",
" assert.equal(response.status,200);",
" if(state==='NO_POLICY'){assert.equal(after-before,1);assert.equal(body.data.enqueued_count,1);}",
" else{assert.equal(after-before,0);assert(body.data.blocked.some(x=>x.reason==='fleet_hold_'+state.toLowerCase()));}",
" }",
" console.log('AUTO_RESTART_HTTP=4/4 PASS; OVERVIEW_AND_AUXILIARY_TABLES=EXPLICIT_FIXTURES; DEVICE_LOCK=NOT_COVERED');",
" }finally{await new Promise(resolve=>server.close(resolve));}",
"})().catch(e=>{console.error(e);process.exitCode=1;});"
].join('\n');
s=s.replace("commercial_package_code:'pro'","commercial_package_code:'pro',runtime_profiles:['full_cycle']");
s=s.replace("follow_day:120,unfollow_day:120","follow_day:120,follow_session:120,unfollow_day:120,unfollow_session:120");
s=s.replace("unfollow_daily_limit:120,unfollow_per_run:120","unfollow_per_day_limit:120,unfollow_per_session_limit:120,unfollow_mode:'unfollow'");

s=s.replaceAll('/api/instagram-dashboard/auto-restart/tick','/api/instagram-dashboard/schedule-session/cron');
s=s.replaceAll('@/app/api/instagram-dashboard/auto-restart/tick/route.ts','@/app/api/instagram-dashboard/schedule-session/cron/route.ts');
s=s.replaceAll("'x-instagram-auto-restart-tick-token'","'x-instagram-schedule-session-cron-token'");
s=s.replace("process.env.INSTAGRAM_AUTO_RESTART_TICK_TOKEN='fixture-tick-only';","process.env.INSTAGRAM_SCHEDULE_SESSION_CRON_TOKEN='fixture-tick-only';process.env.INSTAGRAM_SCHEDULE_SESSION_CRON_ENABLED='true';process.env.INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN='false';");
s=s.replace("case 'auto_restart_settings':","case 'account_assignments': return [{id:'00000000-0000-0000-0000-000000000960',account_id:currentAccount,device_id:'00000000-0000-0000-0000-000000000961',app_instance_id:'00000000-0000-0000-0000-000000000962',status:'active',schedule_mode:'scheduled',assignment_type:'full_cycle',starts_at:new Date(Date.now()-3600000).toISOString(),ends_at:new Date(Date.now()+3600000).toISOString()}];\n case 'phone_devices': return [{id:'00000000-0000-0000-0000-000000000961',device_kind:'physical_phone',status:'online',timezone:'Africa/Johannesburg'}];\n case 'device_heartbeats': return [{device_id:'00000000-0000-0000-0000-000000000961',status:'online',last_seen_at:new Date().toISOString()}];\n case 'auto_restart_settings':");
s=s.replace("case 'worker_heartbeats': return [","case 'worker_heartbeats': return [{worker_id:'botapp-scheduler-runtime:fixture-local',status:'idle',last_seen_at:new Date().toISOString(),metadata:{scheduler_available:true}},");
s=s.replace("select(){return b;}","select(){return b;},lte(k,v){filters.push(r=>r[k]<=v);return b;},gt(k,v){filters.push(r=>r[k]>v);return b;},like(k,v){filters.push(r=>String(r[k]||'').startsWith(v.replace(/%$/,'')));return b;}");
s=s.replace("if(name==='account_package_runtime_contract_status')","if(name==='canonical_active_operational_blockers_v1')return {data:[],error:null};\nif(name==='resolve_welcome_template_missing_incidents_v1')return {data:0,error:null};\nif(name==='account_package_runtime_contract_status')");
s=s.replace("['auto_restart_tick_locks','auto_restart_decisions','runtime_events']","['auto_restart_tick_locks','auto_restart_decisions','runtime_events','schedule_session_cron_runs']");
s=s.replaceAll("REAL_AUTO_RESTART_HTTP","REAL_SCHEDULER_HTTP");
s=s.replace("assert.equal(response.status,200);","assert([200,500].includes(response.status));");
s=s.replace("assert.equal(body.data.enqueued_count,1)","assert.equal(response.status,200);assert.equal(body.data.summary.queued_count,1)");
s=s.replace("assert(body.data.blocked.some(x=>x.reason==='fleet_hold_'+state.toLowerCase()))","assert.equal(body.error,'fleet_hold_'+state.toLowerCase());assert.equal(response.status,500);console.log('PRODUCT_BOUNDARY=EXPECTED_FLEET_REFUSAL_ABORTS_CRON_AS_HTTP_500')");
s=s.replace("AUTO_RESTART_HTTP=4/4 PASS; OVERVIEW_AND_AUXILIARY_TABLES=EXPLICIT_FIXTURES; DEVICE_LOCK=NOT_COVERED","SCHEDULER_REFUSAL_CLASSIFICATION=PRODUCT_DEFECT; NO_POLICY_BASELINE=PASS; FLEET_SQL_GATE_PRESERVED=YES");


s=s.replace('const fixtureWrites=new Map();','const fixtureWrites=new Map();let fixtureAccounts=[];let fixtureRpcError=null;');
s=s.replace(/case 'account_assignments': return \[[\s\S]*?\];/, "case 'account_assignments': return fixtureAccounts.map((a,i)=>({id:'00000000-0000-0000-0000-'+String(960+i).padStart(12,'0'),account_id:a,device_id:'fixture-device-'+i,app_instance_id:'fixture-instance-'+i,status:'active',schedule_mode:'scheduled',assignment_type:'full_cycle',starts_at:new Date(Date.now()-3600000).toISOString(),ends_at:new Date(Date.now()+3600000).toISOString()}));");
s=s.replace(/case 'phone_devices': return \[[\s\S]*?\];/, "case 'phone_devices': return fixtureAccounts.map((a,i)=>({id:'fixture-device-'+i,device_kind:'physical_phone',status:'online',timezone:'Africa/Johannesburg'}));");
s=s.replace(/case 'device_heartbeats': return \[[\s\S]*?\];/, "case 'device_heartbeats': return fixtureAccounts.map((a,i)=>({device_id:'fixture-device-'+i,status:'online',last_seen_at:new Date().toISOString()}));");
s=s.replace("eq(k,v){filters.push", "eq(k,v){if(table==='ig_accounts'&&k==='id')currentAccount=v;filters.push");
s=s.replace("if(unexpectedRpcFailure)", "if(fixtureRpcError)return {data:null,error:{message:fixtureRpcError}};\nif(unexpectedRpcFailure)");

s=s.slice(0,s.indexOf('(async()=>{'))+"\n(async()=>{\n await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));\n const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');\n const cases=[\n ['REQUESTED',[701],null],['ACTIVE',[702],null],['RELEASING',[703],null],\n ['NO_POLICY',[704],null],['CONTINUE_AFTER_BLOCK',[702,704],null],\n ['MIXED',[702,704,701,705],null],\n ['UNKNOWN_ERROR',[704],'fixture_unknown_reason'],\n ['DB_FAILURE',[704],'fixture_database_unavailable']\n ];\n try{\n for(const [name,accounts,error] of cases){\n fixtureAccounts=accounts.map(id);currentAccount=fixtureAccounts[0];fixtureRpcError=error;fixtureWrites.clear();\n sql(\"delete from public.account_run_requests where account_id in ('\"+[704,705].map(id).join(\"','\")+\"');\");\n const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/instagram-dashboard/schedule-session/cron',{\n method:'POST',headers:{'content-type':'application/json','x-instagram-schedule-session-cron-token':'fixture-tick-only'},body:'{}'});\n const body=await response.json();\n const created=JSON.parse(sql(\"select coalesce(json_agg(account_id),'[]'::json) from public.account_run_requests where status='queued';\"));\n if(error){assert.equal(response.status,500);assert.equal(body.error,error);assert.deepEqual(created,[]);}\n else{\n assert.equal(response.status,200);\n const outcomes=body.data.evaluated_accounts;\n assert.equal(outcomes.length,accounts.length);\n for(const [index,n] of accounts.entries()){\n const expected=({701:'fleet_hold_requested',702:'fleet_hold_active',703:'fleet_hold_releasing'})[n];\n const row=outcomes[index];\n assert.equal(row.account_id,id(n));assert.equal(row.eligible,!expected);assert.equal(row.queued,!expected);\n assert.equal(row.stable_reason,expected||null);\n assert.equal(created.includes(id(n)),!expected);\n }\n assert.equal(body.data.summary.queued_count,accounts.filter(n=>n>=704).length);\n assert.equal(body.data.summary.eligible_count,accounts.filter(n=>n>=704).length);\n assert.equal(body.data.summary.skipped_eligibility_count,accounts.filter(n=>n<704).length);\n }\n console.log(JSON.stringify({test:name,status:response.status,body,created}));\n }\n console.log('SCHEDULER_HTTP_TESTS=8/8 PASS; UNEXPECTED_ERRORS_STILL_SURFACED=YES; SQL_ADMISSION=REAL; PHONE_ACTIONS=NONE');\n }finally{await new Promise(resolve=>server.close(resolve));}\n})().catch(e=>{console.error(e);process.exitCode=1;});\n";
const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(require('node:path').dirname(filename));m._compile(s,filename);
