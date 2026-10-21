import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once, EventEmitter } from "node:events";
import { channel } from "node:diagnostics_channel";
import { createTransportTrace, observeTransport, transportBodyConsumed, transportEvents, safeTransportHeaders, TRANSPORT_MAX_BYTES, TRANSPORT_MAX_CALLS } from "./profiles-live-transport.ts";
const actualDateNow = Date.now;
test.before(() => { Date.now = () => Date.parse('2026-09-10T12:00:00Z'); });
test.after(() => { Date.now = actualDateNow; });
const wait = ms => new Promise(r => setTimeout(r,ms));
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://transport-fixture.invalid";
function result(trace) {
  return transportEvents(trace,{request_id:"fixture",correlation_id:"fixture",started_at:"2026-09-09T20:00:00Z"});
}
function fakeAttempt(request,socket, responseStatus=200) {
  channel("undici:request:create").publish({request});
  channel("undici:client:sendHeaders").publish({request,socket,headers:"Authorization: forbidden-secret"});
  channel("undici:request:bodySent").publish({request});
  channel("undici:request:headers").publish({request,response:{statusCode:responseStatus}});
  channel("undici:request:trailers").publish({request,trailers:["cookie","forbidden-secret"]});
}
test("strict header allowlist never records secrets, descriptions or arbitrary request IDs",()=>{
 const headers=new Headers({Authorization:"forbidden-secret","set-cookie":"forbidden-secret",
   "sb-request-id":"11111111-1111-4111-8111-111111111111","x-request-id":"forbidden-secret",
   "cf-ray":"aabbccddeeff0011-IAD","server-timing":'db;dur=5.2;desc="forbidden-secret", forbidden-secret;dur=3, cfOrigin;dur=7',
   "x-envoy-upstream-service-time":"9","x-kong-proxy-latency":"forbidden-secret"});
 const out=safeTransportHeaders(k=>headers.get(k));
 assert.equal(out["server_timing.db"],5.2);assert.equal(out["x-envoy-upstream-service-time"],9);
 assert.equal(out["cf-ray"],"aabbccddeeff0011-IAD");assert.doesNotMatch(JSON.stringify(out),/forbidden-secret|Authorization|set-cookie/);
});
test("unavailable hooks remain unknown; exact response and original errors survive",async()=>{
 const trace=createTransportTrace(performance.now()), response=new Response("body-secret"); let calls=0;
 const out=await observeTransport(trace,1,0,"https://transport-fixture.invalid/rest/v1/table?token=forbidden-secret",undefined,async()=>{calls++;return response;});
 assert.equal(out,response);assert.equal(calls,1);assert.equal(trace.calls[0].attempt_count,0);
 assert.equal(result(trace)[0].complete,false);assert.ok(result(trace)[0].unavailable.includes("ttfb_ms"));
 const error=new TypeError("forbidden-secret");
 await assert.rejects(observeTransport(trace,2,0,"https://transport-fixture.invalid/rest/v1/table",undefined,async()=>{throw error;}),e=>e===error);
 assert.doesNotMatch(JSON.stringify(result(trace)),/body-secret|forbidden-secret/);
});
test("parallel request contexts bind exact objects, not current completion context",async()=>{
 const traces=[createTransportTrace(performance.now()),createTransportTrace(performance.now())];
 const socket={remoteAddress:"127.0.0.1",remotePort:443,encrypted:true};
 const reqs=[{},{}].map(()=>({origin:"https://transport-fixture.invalid",path:"/rest/v1/table"}));
 let finish=[];
 const operations=traces.map((tr,i)=>observeTransport(tr,i+1,0,"https://transport-fixture.invalid/rest/v1/table",undefined,()=>new Promise(resolve=>{
  channel("undici:request:create").publish({request:reqs[i]});
  finish[i]=()=>{channel("undici:client:sendHeaders").publish({request:reqs[i],socket});
   channel("undici:request:headers").publish({request:reqs[i],response:{statusCode:200}});
   channel("undici:request:trailers").publish({request:reqs[i]});resolve(new Response("same"));};
 })));
 finish[1]();finish[0]();await Promise.all(operations);
 assert.equal(traces[0].calls[0].span,1);assert.equal(traces[1].calls[0].span,2);
 assert.equal(traces[1].calls[0].attempts[0].reuse,"UNKNOWN");
 assert.equal(traces[0].calls[0].attempts[0].reuse,"REUSED_CONNECTION");
 assert.ok(traces.every(tr=>result(tr)[0].complete));assert.equal(traces[1].calls[0].attempts[0].preheaders_at_create,1);
});
test("simultaneous connections sharing connector never fabricate setup attribution",async()=>{
 const trace=createTransportTrace(performance.now()), connector=()=>{}, params={protocol:"https:",host:"transport-fixture.invalid"};
 await observeTransport(trace,1,0,"https://transport-fixture.invalid/rest/v1/table",undefined,async()=>{
  channel("undici:client:beforeConnect").publish({connector,connectParams:params});
  channel("undici:client:beforeConnect").publish({connector,connectParams:{...params}});
  for(let i=0;i<2;i++){
   const socket={};channel("undici:client:connected").publish({connector,connectParams:{...params},socket});
   fakeAttempt({origin:"https://transport-fixture.invalid"},socket);
  }
  return new Response("same");
 });
 assert.equal(trace.calls[0].attempt_count,2);
 assert.ok(trace.calls[0].attempts.every(a=>a.setup_ms===null && a.connection_start===null));
});
test("single connection setup and reuse bind by actual socket; retries and redirects remain visible",async()=>{
 const trace=createTransportTrace(performance.now()),connector=()=>{}, params={protocol:"https:",host:"transport-fixture.invalid"},socket={};
 await observeTransport(trace,1,0,"https://transport-fixture.invalid/rest/v1/table",{headers:{"X-Retry-Count":"2",Authorization:"forbidden-secret"}},async()=>{
  channel("undici:client:beforeConnect").publish({connector,connectParams:params});await wait(3);
  channel("undici:client:connected").publish({connector,connectParams:{...params},socket});
  fakeAttempt({origin:"https://transport-fixture.invalid"},socket,307);
  fakeAttempt({origin:"https://transport-fixture.invalid"},socket,200);
  return new Response("same");
 });
 const call=trace.calls[0];assert.equal(call.sdk_retry,2);assert.equal(call.attempt_count,2);
 assert.equal(call.attempts[0].reuse,"NEW_CONNECTION");assert.ok(call.attempts[0].setup_ms>=2);
 assert.equal(call.attempts[1].reuse,"REUSED_CONNECTION");assert.equal(call.attempts[0].socket,call.attempts[1].socket);
 assert.deepEqual(call.attempts.map(a=>a.status),[307,200]);assert.doesNotMatch(JSON.stringify(result(trace)),/forbidden-secret/);
});
test("diagnostic getter/sink failures cannot cause an additional fetch or change errors",async()=>{
 const trace=createTransportTrace(performance.now());let count=0;
 const response=new Response("same");
 Object.defineProperty(response,"headers",{get(){throw new Error("malicious-header-getter");}});
 const actual=await observeTransport(trace,1,0,"https://transport-fixture.invalid/rest/v1/table",undefined,async()=>{
  count++;
  channel("undici:request:create").publish({request:{get origin(){throw new Error("malicious-origin-getter");}}});
  return response;
 });
 assert.equal(actual,response);assert.equal(count,1);
});
test("typical 56-read traffic fits bounded chunks; pathological call/attempt overflow explicit",async()=>{
 const trace=createTransportTrace(performance.now()),socket={}, connector=()=>{}, params={protocol:"https:",host:"transport-fixture.invalid"};
 for(let i=0;i<56;i++){
  await observeTransport(trace,i+1,0,"https://transport-fixture.invalid/rest/v1/table",undefined,async()=>{
   if(i===0){channel("undici:client:beforeConnect").publish({connector,connectParams:params});channel("undici:client:connected").publish({connector,connectParams:params,socket});}
   fakeAttempt({origin:"https://transport-fixture.invalid"},socket);
   return new Response("[]",{headers:{"sb-request-id":"11111111-1111-4111-8111-111111111111","cf-ray":"aabbccddeeff0011-IAD"}});
  });
  transportBodyConsumed(trace,i+1);
 }
 const events=result(trace);
 assert.equal(events[0].complete,true);
 assert.ok(events.reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e)),0)<=TRANSPORT_MAX_BYTES);
 assert.ok(events.every(e=>Buffer.byteLength(JSON.stringify(e))<=6400));
 for(let i=56;i<TRANSPORT_MAX_CALLS+5;i++) await observeTransport(trace,i+1,0,"https://transport-fixture.invalid/rest/v1/table",undefined,async()=>new Response("same"));
 assert.equal(trace.calls.length,TRANSPORT_MAX_CALLS);assert.equal(trace.dropped,5);assert.equal(result(trace)[0].complete,false);
});
test("real native fetch observes header stall, body completion and keep-alive without tuning client",async()=>{
 const prior=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const server=createServer((req,res)=>{
  setTimeout(()=>{res.writeHead(200,{"content-type":"application/json","sb-request-id":"22222222-2222-4222-8222-222222222222"});
    res.write("[");setTimeout(()=>res.end("]"),15);},req.url.includes("slow")?90:2);
 });
 server.listen(0,"127.0.0.1");await once(server,"listening");
 const base="http://127.0.0.1:"+server.address().port;
 process.env.NEXT_PUBLIC_SUPABASE_URL=base;
 try {
  const trace=createTransportTrace(performance.now());
  for(const [i,name] of ["fast","fast","slow","fast"].entries()){
   const res=await observeTransport(trace,i+1,0,base+"/rest/v1/"+name,undefined,()=>fetch(base+"/rest/v1/"+name));
   assert.equal(await res.text(),"[]");transportBodyConsumed(trace,i+1);await wait(5);
  }
  const a=trace.calls[2].attempts[0];
  assert.ok(a.headers-a.send>=70,JSON.stringify(a));
  assert.ok(a.ended>=a.headers);assert.equal(result(trace)[0].complete,true);
  assert.ok(trace.calls.some(c=>c.attempts[0].reuse==="REUSED_CONNECTION"));
  assert.ok(trace.calls.every(c=>c.attempt_count===1));
  assert.ok(trace.calls.every(c=>c.response["sb-request-id"]==="22222222-2222-4222-8222-222222222222"));
 } finally {server.closeAllConnections();await new Promise(r=>server.close(r));process.env.NEXT_PUBLIC_SUPABASE_URL=prior;}
});
test.after(()=>{if(originalUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=originalUrl;});

test("real PostgREST SDK retries are observed without changing the SDK retry policy",async()=>{
 const {createRequire}=await import("node:module"); const require=createRequire(import.meta.url);
 const {createClient}=require(process.env.SUPABASE_JS_PATH || "@supabase/supabase-js");
 const trace=createTransportTrace(performance.now());let count=0;
 const client=createClient("https://transport-fixture.invalid","fixture-key-not-logged",{
  auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:(input,init)=>observeTransport(trace,++count,1,input,init,async()=>count===1
   ? new Response("gateway failure",{status:520,headers:{"Retry-After":"0"}})
   : new Response('[{"id":1}]',{status:200,headers:{"content-type":"application/json"}}))}
 });
 const response=await client.from("fixture_table").select("id");
 assert.equal(response.error,null);assert.deepEqual(response.data,[{id:1}]);assert.equal(count,2);
 assert.deepEqual(trace.calls.map(c=>c.sdk_retry),[0,1]);
 assert.deepEqual(trace.calls.map(c=>c.response.status),[520,200]);
 assert.doesNotMatch(JSON.stringify(result(trace)),/fixture-key|gateway failure/);
});
test("bounded observer bookkeeping and serialization overhead, 56 reads paired control",async()=>{
 const enabled=[],disabled=[];const prior=process.env.PROFILES_LIVE_CAUSAL_DISABLED;
 try {
  for(let repeat=0;repeat<7;repeat++){
   for(const mode of repeat%2?["on","off"]:["off","on"]){
    if(mode==="off")process.env.PROFILES_LIVE_CAUSAL_DISABLED="1";else delete process.env.PROFILES_LIVE_CAUSAL_DISABLED;
    const trace=createTransportTrace(performance.now()),socket={};
    const started=performance.now();
    for(let i=0;i<56;i++) await observeTransport(trace,i+1,1,"https://transport-fixture.invalid/rest/v1/table",undefined,async()=>{
     fakeAttempt({origin:"https://transport-fixture.invalid"},socket);return new Response("[]");
    });
    if(mode==="on")JSON.stringify(result(trace));
    const elapsed=performance.now()-started;
    (mode==="on"?enabled:disabled).push(elapsed);
   }
  }
 } finally {if(prior===undefined)delete process.env.PROFILES_LIVE_CAUSAL_DISABLED;else process.env.PROFILES_LIVE_CAUSAL_DISABLED=prior;}
 const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
 const overhead=median(enabled)-median(disabled);
 console.log(JSON.stringify({transport_observer_56_reads:{enabled_median_ms:median(enabled),disabled_median_ms:median(disabled),delta_ms:overhead,production_sla_claim:false}}));
 assert.ok(overhead<25,"passive observer should add <25ms median per synthetic 56-read request");
});


test('expired transport observation preserves dispatch without recording', async () => {
 const saved=Date.now; Date.now=()=>Date.parse('2026-09-12T00:00:00Z');
 try {const trace=createTransportTrace(performance.now()),response=new Response('same');let calls=0;
 assert.equal(await observeTransport(trace,1,0,'https://transport-fixture.invalid/rest/v1/table',undefined,async()=>{calls++;return response;}),response);
 assert.equal(calls,1);assert.equal(trace.calls.length,0);assert.equal(result(trace)[0].call_count,0);
 }finally{Date.now=saved;}
});
