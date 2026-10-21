"""Real local HTTP/service/SQL release; persisted manual scheduling is unchanged."""
import json
import os
from pathlib import Path
import runpy
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = runpy.run_path(str(ROOT / 'tests/fleet-prospective-hold-participation-v1.py'))
NODE = '/Users/admin/.nvm/versions/node/v22.22.2/bin/node'

HTTP = r'''
const fs=require('node:fs'),vm=require('node:vm'),http=require('node:http');
const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const ts=require('typescript'),root=process.cwd();
const [socket,actor,account,tenant]=process.argv.slice(1);
assert.match(socket,/^\/private\/tmp\/fleet-atomic-enqueue-[A-Za-z0-9_-]+$/);
let calls=0;
function sql(text){return execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql',
 ['-X','-qAt','-v','ON_ERROR_STOP=1','-h',socket,'-p','55483','-d','postgres'],
 {input:text,encoding:'utf8'}).trim();}
function load(file,imports){
 const out={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(root+'/'+file,'utf8'),{compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(js,{exports:out.exports,module:out,require:n=>{
  if(Object.hasOwn(imports,n))return imports[n];throw Error('unexpected dependency '+n);
 },Request,Response,Headers,URL,console},{filename:file});return out.exports;
}
const service=load('lib/instagram-dashboard/fleet-policy-mutation.ts',{
 'server-only':{},'@/lib/supabase':{createSupabaseClient:()=>({rpc:async(name,args)=>{
  assert.equal(name,'fleet_mutate_policy_v1');calls++;
  const input=JSON.stringify(args.p_input).replaceAll("'","''");
  return {data:JSON.parse(sql(`BEGIN; SET LOCAL ROLE service_role;
    SELECT public.fleet_mutate_policy_v1('${input}'::jsonb); COMMIT;`)),error:null};
 }})}
});
const utils={resolveInstagramDashboardActor:async req=>req.headers.get('x-fixture-actor')===actor
 ?{ok:true,actor:{actorId:actor}}:{ok:false,response:Response.json({error:'unauthorized'},{status:401})},
 readJsonBody:req=>req.json(),jsonOk:data=>Response.json(data),
 jsonError:(error,status)=>Response.json({error},{status})};
const route=load('app/api/instagram-dashboard/fleet/policy/route.ts',{
 '../../_utils':utils,'@/lib/instagram-dashboard/fleet-policy-mutation':service});
const eligibility=load('lib/instagram-dashboard/auto-restart-scheduled-eligibility.ts',{});
const snapshot=()=>JSON.parse(sql(`SELECT jsonb_build_object(
 'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM account_assignments a WHERE account_id='${account}'),
 'auto_restart_settings',(SELECT jsonb_agg(to_jsonb(s)) FROM auto_restart_settings s));`));
const before=snapshot();assert.equal(before.assignments.length,1);
assert.equal(before.assignments[0].schedule_mode,'manual_only');
assert.equal(eligibility.manualOnlyAutoRestartBlockReason(before.assignments[0].schedule_mode),
 'manual_only_requires_manual_trigger');
const server=http.createServer(async(req,res)=>{try{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 const response=await route.POST(new Request('http://127.0.0.1/fleet/policy',{
  method:'POST',headers:req.headers,body:Buffer.concat(chunks)}));
 res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
}catch(error){res.writeHead(500);res.end(String(error));}});
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{
 async function mutate(action,revision){
  const response=await fetch(`http://127.0.0.1:${server.address().port}`,{method:'POST',
   headers:{'content-type':'application/json','x-fixture-actor':actor},
   body:JSON.stringify({action,account_id:account,tenant_id:tenant,
    request_id:require('node:crypto').randomUUID(),expected_revision:revision})});
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;
 }
 const hold=await mutate('hold',null);assert.equal(hold.current_policy.hold_state,'REQUESTED');
 const release=await mutate('release',1);assert.equal(release.current_policy.hold_state,'CLEARED');
 assert.equal(release.current_policy.revision,2);
 const after=snapshot();assert.deepEqual(after,before);
 assert.equal(eligibility.manualOnlyAutoRestartBlockReason(after.assignments[0].schedule_mode),
  'manual_only_requires_manual_trigger');
 assert.equal(sql(`SELECT count(*) FROM account_run_requests WHERE account_id='${account}'`),'0');
 assert.equal(calls,2);
 console.log(JSON.stringify({RELEASE_MANUAL_ONLY_INTEGRATION:'PASS',
  FLEET_RELEASE_MUTATES_MANUAL_ONLY:'NO',REAL_HTTP_SERVICE_SQL_CALLS:calls,
  PERSISTED_ASSIGNMENT_UNCHANGED:true,AUTO_RESTART_SETTINGS_UNCHANGED:true,
  HISTORICAL_MANUAL_ONLY_ELIGIBILITY:'BLOCKED',RUN_REQUESTS_CREATED:0,
  AUTH_BOUNDARY:'explicit local upstream-session fixture; actual service and SQL role guard'}));
}finally{await new Promise(resolve=>server.close(resolve));}})().catch(e=>{console.error(e);process.exitCode=1;});
'''


class ManualOnlyReleaseHTTP(unittest.TestCase):
    def test_manual_only_survives_real_release(self):
        fixture = FIXTURE['ProspectiveHold']
        self.addCleanup(fixture.doClassCleanups)
        fixture.setUpClass()
        row = fixture('test_fresh_idle_release_current_state_and_no_synthetic_ack')
        row.setUp()
        # The canonical assignment model uses schedule_mode, not a Fleet boolean.
        fixture.db.sql("ALTER TABLE account_assignments ADD COLUMN IF NOT EXISTS "
                       "schedule_mode text CHECK (schedule_mode IN ('scheduled','manual_only'));")
        fixture.db.sql("UPDATE account_assignments SET schedule_mode='manual_only' "
                       "WHERE account_id='%s';" % row.account)
        result = subprocess.run([NODE, '-e', HTTP, str(fixture.db.directory),
                                 str(row.actor), str(row.account), str(row.tenant)],
                                cwd=str(ROOT), env=os.environ.copy(), text=True,
                                capture_output=True, timeout=40)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(result.stdout.strip())
        self.assertEqual(report['RELEASE_MANUAL_ONLY_INTEGRATION'], 'PASS')
        print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    unittest.main(verbosity=2)
