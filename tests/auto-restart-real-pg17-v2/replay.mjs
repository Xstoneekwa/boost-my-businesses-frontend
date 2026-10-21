// Replay only into the explicitly named isolated Unix-socket database.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const socket=process.env.LOCAL_PG_SOCKET;
const dependency=process.env.ADMIN_CONTRACT_ROOT;
if(!socket?.startsWith('/private/tmp/auto-restart-v2-pg17.')||!dependency) throw Error('ISOLATED_SOCKET_AND_DEPENDENCY_REQUIRED');
const database=process.env.LOCAL_PG_DATABASE||'auto_restart_v2';
if(!/^auto_restart_v2(?:_replay)?$/.test(database)) throw Error('ISOLATED_DATABASE_REQUIRED');
const args=['-X','-q','-v','ON_ERROR_STOP=1','-h',socket,'-p','55489','-d',database];
const psql=(extra,input)=>execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql',[...args,...extra],{input,encoding:'utf8',maxBuffer:8*1024*1024});
if(psql(['-Atc',"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'"]).trim()!=='0') throw Error('EMPTY_DATABASE_REQUIRED');
for(const file of ['0000_local_platform_compatibility.sql','20260728001632_public_schema.sql']) psql(['-f',path.join(root,'supabase/baseline',file)]);
psql([],"INSERT INTO auth.users(id,email) VALUES ('580d7856-d60f-4838-a5f9-3b405d6ae79b','synthetic-owner@example.invalid'); INSERT INTO public.tenant_users(user_id,role) VALUES ('580d7856-d60f-4838-a5f9-3b405d6ae79b','superadmin');");
const dependencyFiles=['20260826021814_control_plane_reliability_v1.sql','20260826134332_fast_recovery_active_state_v1.sql','20260826222059_resume_plan_contract_v1.sql'];
const files=readdirSync(path.join(root,'supabase/migrations')).filter(x=>/^\d+.*\.sql$/.test(x)&&x>'20260728001632'&&!/rollback/i.test(x)).map(x=>path.join(root,'supabase/migrations',x));
files.push(...dependencyFiles.map(x=>path.join(dependency,'supabase/migrations',x)));
for(const file of files.sort((a,b)=>path.basename(a).localeCompare(path.basename(b)))){
 if(path.basename(file)==='20260815024500_pre_run_incident_resume_not_null_v1.sql'){
  // Earlier historical migration already includes this repair. Assert its postcondition.
  const definition=psql(['-Atc',"select pg_get_functiondef(oid) from pg_proc where proname='reconcile_resolved_pre_run_incident_authorizations_v1'"]);
  if(!/restart_block_reason\s*=\s*''/.test(definition)) throw Error('HISTORICAL_PREAPPLIED_FIX_NOT_PROVEN');
  console.log('PREAPPLIED_POSTCONDITION_VERIFIED='+path.basename(file));
  continue;
 }
 psql(['-f',file]);console.log('REPLAYED='+path.basename(file));
}
for(const file of ['seed.sql','ready.sql','settings.sql','package.sql','resolve.sql']) console.log(psql(['-f',path.join(root,'tests/auto-restart-real-pg17-v2',file)]));
