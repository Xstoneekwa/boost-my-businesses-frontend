/* Local HTTP -> actual route/service -> actual PostgreSQL RPC.
 * The authenticated session is explicit test input; no production auth bypass.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const http = require('node:http');
const {spawnSync} = require('node:child_process');
const ts = require('/Users/admin/Projects/boost-ai-frontend/node_modules/typescript');
const root = path.resolve(__dirname, '..');
const socket = process.env.FLEET_TEST_PG_ROOT;
assert.match(socket || '', /^\/private\/tmp\/fleet-atomic-enqueue-[A-Za-z0-9_-]+$/);
const actor = process.env.FLEET_TEST_ACTOR;
let rpcCalls = 0;
function rpc(name, args) {
  assert.equal(name, 'fleet_mutate_policy_v1');
  rpcCalls++;
  const input = JSON.stringify(args.p_input).replaceAll("'", "''");
  const r = spawnSync('/opt/homebrew/opt/postgresql@17/bin/psql',
    ['-X','-qAt','-v','ON_ERROR_STOP=1','-h',socket,'-p','55483','-d','postgres',
     '-c',"BEGIN; SET LOCAL ROLE service_role; SELECT public.fleet_mutate_policy_v1('" + input + "'::jsonb); COMMIT;"],
    {encoding:'utf8'});
  if (r.status !== 0) return Promise.resolve({data:null,error:{message:r.stderr}});
  return Promise.resolve({data:JSON.parse(r.stdout.trim().split('\n').at(-1)),error:null});
}
function moduleFrom(file, imports) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  const localRequire = name => {
    if (Object.hasOwn(imports,name)) return imports[name];
    throw Error('Unconfined import: '+name);
  };
  vm.runInThisContext('(function(require,module,exports){'+output+'\n})',
    {filename:file})(localRequire,module,module.exports);
  return module.exports;
}
const service = moduleFrom('lib/instagram-dashboard/fleet-policy-mutation.ts', {
  'server-only':{},
  '@/lib/supabase':{createSupabaseClient:()=>({rpc})}
});
const utils = {
  jsonOk:data=>Response.json({ok:true,data}),
  jsonError:(error,status)=>Response.json({ok:false,error},{status}),
  readJsonBody:request=>request.json(),
  resolveInstagramDashboardActor:async request =>
    request.headers.get('x-fixture-auth') === actor
      ? {ok:true,actor:{actorId:actor}}
      : {ok:false,response:Response.json({ok:false,error:'unauthorized'},{status:401})}
};
const route = moduleFrom('app/api/instagram-dashboard/fleet/policy/route.ts',{
  '../../_utils':utils,
  '@/lib/instagram-dashboard/fleet-policy-mutation':service
});
async function main() {
  const server=http.createServer(async(req,res)=>{
    try {
      let body='';for await(const chunk of req)body+=chunk;
      const response=await route.POST(new Request('http://127.0.0.1'+req.url,
        {method:'POST',headers:req.headers,body}));
      res.writeHead(response.status,{'content-type':'application/json'});
      res.end(await response.text());
    } catch(error) {res.writeHead(500);res.end(String(error));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base={account_id:process.env.FLEET_TEST_ACCOUNT,tenant_id:process.env.FLEET_TEST_TENANT,
      request_id:crypto.randomUUID(),action:'hold',expected_revision:null};
    async function request(payload,authenticated=true){
      const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/instagram-dashboard/fleet/policy',
        {method:'POST',headers:{'content-type':'application/json',...(authenticated?{'x-fixture-auth':actor}:{})},
         body:JSON.stringify(payload)});
      return {status:response.status,body:await response.json()};
    }
    let r=await request(base,false);assert.equal(r.status,401);assert.equal(rpcCalls,0);
    r=await request({...base,actor_id:actor});assert.equal(r.status,400);assert.equal(rpcCalls,0);
    r=await request(base);assert.equal(r.status,200);
    assert.equal(r.body.data.current_policy.hold_state,'REQUESTED');
    assert.equal(r.body.data.current_policy.revision,1);
    const original=r.body.data.receipt;
    r=await request(base);assert.equal(r.status,200);
    assert.equal(r.body.data.replayed,true);assert.deepEqual(r.body.data.receipt,original);
    r=await request({...base,cap:60});assert.equal(r.status,400);
    r=await request({...base,request_id:crypto.randomUUID(),action:'release',expected_revision:1});
    assert.equal(r.status,200);assert.equal(r.body.data.current_policy.hold_state,'CLEARED');
    assert.equal(r.body.data.current_policy.revision,2);
    console.log(JSON.stringify({HOLD_RELEASE_HTTP_TESTS:'6/6 PASS',REAL_SQL_RPC_CALLS:rpcCalls,
      SOURCE:'REAL_ROUTE_SERVICE_RPC',AUTH_SESSION:'EXPLICIT_TEST_SESSION',PRODUCTION_CHANGED:'NO'}));
  } finally {await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
