import type { SearchHit } from "./structured-instagram-resolver";
export type SearchOutcome = "SUCCESS" | "EMPTY_RESULTS" | "TIMEOUT" | "HTTP_ERROR" | "INVALID_PAYLOAD" | "PROVIDER_ERROR" | "PARSER_ERROR";
export type SearchResult = { outcome:SearchOutcome; hits:SearchHit[]; httpStatus?:number; reason:string };
export async function targetedSearch(query:string,key:string,fetcher:typeof fetch=fetch):Promise<SearchResult> {
  if(!key.trim())return {outcome:"PROVIDER_ERROR",hits:[],reason:"configuration_missing"};
  const url=new URL("https://www.searchapi.io/api/v1/search");url.search=new URLSearchParams({engine:"google",q:query,api_key:key}).toString();
  let response:Response;
  try {response=await fetcher(url,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10000)});}
  catch(e){return {outcome:e instanceof Error&&["TimeoutError","AbortError"].includes(e.name)?"TIMEOUT":"PROVIDER_ERROR",hits:[],reason:e instanceof Error&&["TimeoutError","AbortError"].includes(e.name)?"request_deadline":"network_failure"};}
  if(!response.ok)return {outcome:"HTTP_ERROR",hits:[],httpStatus:response.status,reason:`http_${response.status}`};
  let payload:unknown;try{payload=await response.json();}catch{return {outcome:"PARSER_ERROR",hits:[],httpStatus:response.status,reason:"invalid_json"};}
  if(!payload||typeof payload!=="object")return {outcome:"INVALID_PAYLOAD",hits:[],reason:"expected_object"};
  const p=payload as Record<string,unknown>;
  if(p.error||p.errors)return {outcome:"PROVIDER_ERROR",hits:[],reason:"provider_reported_error"};
  if(!Array.isArray(p.organic_results))return {outcome:"INVALID_PAYLOAD",hits:[],reason:"organic_results_missing"};
  const hits:SearchHit[]=[];
  for(const item of p.organic_results.slice(0,10)){
    if(!item||typeof item!=="object"||typeof item.link!=="string"||typeof item.title!=="string")return {outcome:"INVALID_PAYLOAD",hits:[],reason:"organic_result_shape"};
    hits.push({url:item.link,title:item.title.slice(0,500),snippet:typeof item.snippet==="string"?item.snippet.slice(0,1500):""});
  }
  return {outcome:hits.length?"SUCCESS":"EMPTY_RESULTS",hits,httpStatus:response.status,reason:hits.length?"organic_results":"zero_organic_results"};
}
