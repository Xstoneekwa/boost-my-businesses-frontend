type Observation = {account_id:string;followers_count:number|null;following_count:number|null;observed_at:string;source_provider:string;lookup_status:string;idempotency_key?:string};
export function latestStatsObservations(rows:Observation[],accountId:string,now:Date) {
 const select=(field:"followers_count"|"following_count")=>{
 const row=rows.filter(r=>r.account_id===accountId && r.lookup_status==="found"
 && Number.isSafeInteger(r[field]) && Number(r[field])>=0 && Number.isFinite(Date.parse(r.observed_at))
 && Date.parse(r.observed_at)<=now.getTime())
 .sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at)||(b.idempotency_key||"").localeCompare(a.idempotency_key||""))[0];
 return row?{value:row[field],observed_at:row.observed_at,source:row.source_provider,
 state:now.getTime()-Date.parse(row.observed_at)>86400000?"STALE_KNOWN_VALUE":row[field]===0?"REAL_ZERO":"KNOWN_VALUE"}:
 {value:null,observed_at:null,source:null,state:"UNKNOWN"};
 };
 return {followers:select("followers_count"),following:select("following_count")};
}
