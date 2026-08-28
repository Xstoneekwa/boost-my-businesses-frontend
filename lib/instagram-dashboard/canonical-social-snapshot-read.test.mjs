import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSocialSnapshotProjection, readCanonicalSocialSnapshots, CANONICAL_SOCIAL_SNAPSHOT_TABLE } from './canonical-social-snapshot-read.ts';
import { canonicalProfilesMembership } from '../../app/api/instagram-dashboard/profiles/live/profile-visibility.ts';
const now=new Date('2026-08-28T12:00:00.000Z');
function row(account_id,followers_count,observed_at) {
 return {account_id,followers_count,following_count:50,posts_count:7,observed_at,snapshot_local_date:observed_at.slice(0,10),account_timezone:'Africa/Johannesburg',lookup_status:'found',source_provider:'searchapi',idempotency_key:`${account_id}:${observed_at}`};
}
export function mockDatabase(tables={}, {error=null, cap=500, noCount=false, countDrift=false}={}) {
 const calls=[];
 return {calls,from(table) {
  calls.push(table); let data=tables[table]||[], count; let lo=0,hi=Infinity;
  const q={select(){return q},eq(k,v){data=data.filter(r=>r[k]===v);return q},in(k,vs){data=data.filter(r=>vs.includes(r[k]));return q},gte(k,v){data=data.filter(r=>r[k]>=v);return q},lte(k,v){data=data.filter(r=>r[k]<=v);return q},order(){return q},limit(n){hi=n-1;return q},range(a,b){lo=a;hi=b;count=data.length;return q},maybeSingle(){return Promise.resolve({data:data[0]||null,error})},then(resolve,reject){return Promise.resolve({data:data.slice(lo,Math.min(hi+1,lo+cap)),error,count:noCount?null:(countDrift&&lo?count+1:count)}).then(resolve,reject)}};
  return q;
 }};
}
test('shared projection isolates accounts; preserves canonical values, timestamps and local days', () => {
 const rows=[row('a',10,'2026-08-25T12:00:00.000Z'),row('a',16,now.toISOString()),row('b',999,now.toISOString()),row('a',999,'2026-08-29T12:00:00.000Z')];
 const p=canonicalSocialSnapshotProjection(rows,'a',now);
 assert.equal(p.followerDelta3d.value,6);
 assert.equal(p.followerDelta3d.currentFollowers,16);
 assert.equal(p.stats.points.at(-1).row.followers_count,16);
 assert.equal(p.stats.points.at(-1).row.observed_at,p.followerDelta3d.currentCapturedAt);
 assert.equal(p.stats.timezone,'Africa/Johannesburg');
 assert.equal(canonicalSocialSnapshotProjection(rows,'missing',now).followerDelta3d.currentFollowers,null);
});
test('shared read completes server-capped pages, excludes other accounts and future snapshots',async()=>{
 const rows=Array.from({length:8},(_,i)=>row('a',i,`2026-08-${String(20+i).padStart(2,'0')}T12:00:00.000Z`));
 const db=mockDatabase({[CANONICAL_SOCIAL_SNAPSHOT_TABLE]:[...rows,row('b',999,now.toISOString())]}, {cap:2});
 const result=await readCanonicalSocialSnapshots(db,{accountIds:['a'],since:'2026-08-01',until:now.toISOString()});
 assert.equal(result.error,null); assert.equal(result.data.length,8);assert.equal(db.calls.length,4);
});
test('error, changing count or missing completeness never produces a partial canonical projection',async()=>{
 for(const options of [{error:{message:'offline'}},{noCount:true},{cap:1,countDrift:true}]) {
  const db=mockDatabase({[CANONICAL_SOCIAL_SNAPSHOT_TABLE]:[row('a',1,'2026-08-25T12:00:00.000Z'),row('a',2,now.toISOString())]},options);
  const result=await readCanonicalSocialSnapshots(db,{accountIds:['a'],since:'2026-08-01',until:now.toISOString()});
  assert.ok(result.error);assert.deepEqual(result.data,[]);
 }
});
test('authoritative removal requires a coherent complete inventory, never partial or malformed Live',()=>{
 const a={accountId:'a',adminStatus:'active'},deleted={accountId:'deleted',adminStatus:'cancelled'};
 const payload={profiles:[a,deleted],activeAccounts:[a],errors:[],projection_revision:now.toISOString()};
 assert.deepEqual(canonicalProfilesMembership(payload,['a','deleted','removed']),{schema:'profiles_membership_v1',revision:now.toISOString(),removedAccountIds:['deleted','removed']});
 for(const patch of [{profiles:null},{activeAccounts:[]},{errors:['partial']},{profiles:[a,a]},{projection_revision:'invalid'},{profiles:[null]}]) assert.equal(canonicalProfilesMembership({...payload,...patch},['a']),undefined);
 assert.deepEqual(canonicalProfilesMembership({...payload,profiles:[],activeAccounts:[]},['a']).removedAccountIds,['a']);
});
