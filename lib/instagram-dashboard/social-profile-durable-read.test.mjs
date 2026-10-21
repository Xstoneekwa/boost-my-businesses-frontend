import assert from "node:assert/strict";
import test from "node:test";
import { readCanonicalSocialSnapshots, canonicalSocialSnapshotProjection } from "./canonical-social-snapshot-read.ts";

const pair = [10,27].map((followers_count,index)=>({account_id:"a", followers_count,
  following_count:20, posts_count:0, observed_at:`2026-06-0${1+index*3}T00:00:00Z`,
  source_provider:"searchapi", lookup_status:"found", idempotency_key:`snapshot-${index}`}));
function database(retained) {
  const chain = new Proxy({}, { get(_target,key) {
    if (key === "then") return resolve => resolve({data:[],count:0,error:null});
    return () => chain;
  }});
  return {from:()=>chain, rpc:async(name,args)=>{
    assert.equal(name,"read_last_complete_growth_snapshots_v1");
    assert.deepEqual(args.p_account_ids,["a"]);
    return retained;
  }};
}
test("empty recent window retains complete canonical pair from durable history", async()=>{
  const result=await readCanonicalSocialSnapshots(database({data:pair,error:null}),{
    accountIds:["a"],since:"2026-09-01",until:"2026-09-06",includeLastValidGrowth:true});
  assert.equal(result.error,null);
  assert.equal(canonicalSocialSnapshotProjection(result.data,"a",new Date("2026-09-06")).followerDelta3d.value,17);
});
test("durable lookup failures remain errors, not successful empty data", async()=>{
  const error={message:"history unavailable"};
  const result=await readCanonicalSocialSnapshots(database({data:null,error}),{
    accountIds:["a"],since:"2026-09-01",until:"2026-09-06",includeLastValidGrowth:true});
  assert.equal(result.error,error);
});
test("durable history rejects another account or future timestamp",async()=>{
  for (const row of [{...pair[0],account_id:"b"},{...pair[0],observed_at:"2099-01-01"}]) {
    const result=await readCanonicalSocialSnapshots(database({data:[row],error:null}),{
      accountIds:["a"],since:"2026-09-01",until:"2026-09-06",includeLastValidGrowth:true});
    assert.ok(result.error);
  }
});
