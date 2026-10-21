// Test-only composition of the qualified PG17 private-socket lifecycle.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { userInfo } from 'node:os';
const BIN='/opt/homebrew/opt/postgresql@17/bin';
export function rejectConnectionOverrides(env=process.env) {
  for(const key of Object.keys(env)) if(key.startsWith('PG') || ['DATABASE_URL','SUPABASE_DB_URL'].includes(key))
    throw new Error(`private_pg17_connection_override_forbidden:${key}`);
}
export function createPrivatePg17() {
 rejectConnectionOverrides();
 const root=mkdtempSync('/private/tmp/pf-pg17-'),data=path.join(root,'data'),socket=path.join(root,'socket'),log=path.join(root,'postgres.log');
 const env={PATH:`${BIN}:/usr/bin:/bin`,HOME:process.env.HOME,LC_ALL:'C'};
 const user=userInfo().username;let started=false,closed=false;
 mkdirSync(socket,{mode:0o700});
 function command(name,args,input,timeout=60000) {
  const r=spawnSync(`${BIN}/${name}`,args,{input,encoding:'utf8',timeout,env,maxBuffer:16*1024*1024});
  if(r.error || r.status!==0) throw new Error(`${name} failed: ${r.error?.message??''}\n${r.stderr}\n${r.stdout}`);
  return r;
 }
 function args(database='postgres') {return ['-X','-v','ON_ERROR_STOP=1','-h',socket,'-p','5432','-U',user,'-d',database];}
 function run(sql,database='postgres',extra=[]) {
  return spawnSync(`${BIN}/psql`,[...args(database),...extra],{input:sql,encoding:'utf8',timeout:30000,env,maxBuffer:16*1024*1024});
 }
 function execute(sql,database='postgres') {const r=run(sql,database);if(r.error||r.status!==0)throw new Error(`psql failed: ${r.error?.message??''}\n${r.stderr}`);return r.stdout;}
 function close() {
  if(closed)return;
  if(started)command('pg_ctl',['-D',data,'-m','fast','-w','-t','20','stop']);
  const evidence=process.env.PHONEFARM_PG17_EVIDENCE_DIR;
  if(evidence && existsSync(log)){mkdirSync(evidence,{recursive:true});copyFileSync(log,path.join(evidence,path.basename(root)+'.log'));}
  rmSync(root,{recursive:true,force:true});closed=true;
 }
 try {
  command('initdb',['-D',data,'--no-locale','--encoding=UTF8','--auth=trust','-c','shared_memory_type=mmap','-c','dynamic_shared_memory_type=mmap']);
  command('pg_ctl',['-D',data,'-l',log,'-o',`-h '' -k ${socket} -p 5432`,'-w','-t','20','start']);started=true;
  if(run('show listen_addresses;','postgres',['-qAt']).stdout.trim()!=='')throw new Error('private_pg17_tcp_listener_forbidden');
 }catch(error){close();throw error;}
 return {root,socket,log,user,env,run,execute,close,args,command};
}
export function createWarmupFixture() {
 const pg=createPrivatePg17();
 try {
  pg.command('createdb',['-h',pg.socket,'-U',pg.user,'warmup_real_baseline']);
  pg.execute(readFileSync(new URL('./warmup-real-schema-20260906.sql',import.meta.url),'utf8'),'warmup_real_baseline');
  // Qualified archive fixture uses database ownership for non-superuser postgres.
  pg.execute('ALTER DATABASE warmup_real_baseline OWNER TO postgres;');
  const migration=readFileSync(new URL('../../supabase/migrations/20260905232416_stats_growth_warmup_package_inheritance.sql',import.meta.url),'utf8');
  for(const name of ['warmup_real_matrix','stats_growth_complete']) {
   pg.command('createdb',['-h',pg.socket,'-U',pg.user,'-T','warmup_real_baseline','-O','postgres',name]);
   pg.execute(`SET ROLE postgres; ${migration}`,name);
  }
  return pg;
 }catch(error){pg.close();throw error;}
}
