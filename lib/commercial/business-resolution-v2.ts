import type { BusinessAlias, StructuredCandidate } from "./structured-discovery-contract";
import { normalizeIdentityText as norm, rootInstagramHandle, type InstagramMatch, type SearchHit, type SiteEvidence } from "./structured-instagram-resolver";

export type MatchEvidence = { type: string; source: string; reference: string; strength: "STRONG" | "SECONDARY" | "NEGATIVE"; observed_at: string };
export type WebsiteClassification = "OFFICIAL_SITE" | "SHARED_PLATFORM" | "DIRECTORY" | "SOCIAL_NETWORK" | "UNKNOWN";
export type WebsiteResolution = { url: string; classification: WebsiteClassification; confidence: "HIGH" | "MEDIUM" | "LOW"; signals: MatchEvidence[]; source: string };
export type PublicProfileEvidence = { url:string; alias?:string; city?:string; address?:string; postalCode?:string; phone?:string; website?:string; services?:string; bookingIdentityVerified?:boolean; sharedBrand?:boolean; observed_at:string };
export type BusinessResolution = { match: InstagramMatch; aliases: BusinessAlias[]; evidence: MatchEvidence[]; websites: WebsiteResolution[]; profileScope: "DEDICATED_ESTABLISHMENT_PROFILE" | "SHARED_BRAND_PROFILE" | "AMBIGUOUS_PROFILE"; observed_at:string };

export function businessAliases(c: StructuredCandidate): BusinessAlias[] {
  const aliases=(c.business_aliases??[]).filter(a=>a.value.trim()&&a.provider&&a.evidence);
  if (!aliases.some(a=>norm(a.value)===norm(c.businessName))) aliases.push({value:c.businessName,alias_type:"provider_selected_name",provider:c.provider,evidence:c.source.url,observed_at:c.source.observedAt});
  const priority={trade_name:0,establishment_name:1,provider_selected_name:2,legal_name:3};
  return aliases.sort((a,b)=>priority[a.alias_type]-priority[b.alias_type]).filter((a,index,sorted)=>sorted.findIndex(b=>norm(a.value)===norm(b.value))===index);
}
export function targetedAliasQuery(c: StructuredCandidate) {
  const clean=(s:string)=>s.replace(/["\\\r\n]/g," ").slice(0,160);
  return `"${clean(businessAliases(c)[0]?.value??c.businessName)}" "${clean(c.city)}" Instagram`;
}
export function classifyWebsiteUrl(value:string): WebsiteClassification {
  try {
    const url=new URL(value), h=url.hostname.toLowerCase();
    if(url.protocol!=="https:"||url.username||url.password) return "UNKNOWN";
    if(/(^|\.)(planity|treatwell|fresha|booksy|linktr|linktree|calendly|resalib)\./.test(h))return "SHARED_PLATFORM";
    if(/(^|\.)(instagram|facebook|tiktok|linkedin|youtube|pinterest|threads|twitter|x)\./.test(h))return "SOCIAL_NETWORK";
    if(/(^|\.)(infobel|unboncoiffeur|alentoor|pagesjaunes|yelp|societe|pappers|verif|annuaire-entreprises|utagawavtt|mapquest|tripadvisor|google|mappy|118000|hoodspot|cylex|horaires)\./.test(h)||/annuaire|directory|business-index/.test(h))return "DIRECTORY";
  } catch { /* Not usable as an official URL. */ }
  return "UNKNOWN";
}
const has=(text:string,value:string)=>norm(value).length>=3&&norm(text).includes(norm(value));
const phone=(s:string)=>s.replace(/\D/g,"");
const host=(s:string)=>{try{return new URL(s).hostname.toLowerCase().replace(/^www\./,"");}catch{return "";}};
const evidence=(type:string,source:string,reference:string,strength:MatchEvidence["strength"],at:string):MatchEvidence=>({type,source,reference,strength,observed_at:at});

export class CommercialOfficialWebsiteResolver {
  evaluate(c:StructuredCandidate,site:SiteEvidence,at:string):WebsiteResolution {
    let classification=classifyWebsiteUrl(site.url);
    const signals:MatchEvidence[]=[];
    if(classification!=="UNKNOWN")return {url:site.url,classification,confidence:"LOW",signals,source:site.url};
    if(/annuaire|business directory|entreprises similaires|entreprises à proximité|listing of businesses/i.test(site.text)) classification="DIRECTORY";
    const alias=businessAliases(c).find(a=>has(site.text,a.value));
    const city=has(site.text,c.city), postal=Boolean(c.postalCode)&&site.text.includes(c.postalCode);
    const address=c.address.length>=8&&has(site.text,c.address);
    const matchingPhone=Boolean(c.verifiedPhone&&phone(c.verifiedPhone).length>=8&&phone(site.text).includes(phone(c.verifiedPhone)));
    if(alias)signals.push(evidence("BUSINESS_ALIAS_MATCH",site.url,alias.value,"SECONDARY",at));
    if(city)signals.push(evidence("CITY_MATCH",site.url,c.city,"SECONDARY",at));
    if(postal)signals.push(evidence("POSTAL_CODE_MATCH",site.url,c.postalCode,"SECONDARY",at));
    if(address)signals.push(evidence("ADDRESS_MATCH",site.url,c.address,"STRONG",at));
    if(matchingPhone)signals.push(evidence("PHONE_MATCH",site.url,c.verifiedPhone!,"STRONG",at));
    // Name+city never establishes a business-owned domain. Require establishment identity.
    if(classification==="UNKNOWN"&&alias&&city&&postal&&(address||matchingPhone)) classification="OFFICIAL_SITE";
    return {url:site.url,classification,confidence:classification==="OFFICIAL_SITE"?"HIGH":"LOW",signals,source:site.url};
  }
}

export function evaluateBusinessResolution(c:StructuredCandidate,hits:SearchHit[],sites:SiteEvidence[],profiles:PublicProfileEvidence[]=[],at=new Date().toISOString(),previous?:InstagramMatch):BusinessResolution {
  const aliases=businessAliases(c), websiteResolver=new CommercialOfficialWebsiteResolver();
  const websites=sites.map(s=>websiteResolver.evaluate(c,s,at));
  const allEvidence=websites.flatMap(w=>w.signals), strong=new Map<string,string[]>(), hints=new Set<string>();
  let contradiction=false,shared=false;
  const make=(handle:string|null,confidence:InstagramMatch["confidence"],reason:string):BusinessResolution=>({aliases,websites,evidence:allEvidence,observed_at:at,profileScope:shared?"SHARED_BRAND_PROFILE":confidence==="HIGH"?"DEDICATED_ESTABLISHMENT_PROFILE":"AMBIGUOUS_PROFILE",match:{matchedHandle:handle,matchedProfileUrl:handle?`https://www.instagram.com/${handle}/`:null,confidence,reason,signals:[...new Set(allEvidence.map(e=>e.type))],sources:[...new Set(allEvidence.map(e=>e.source))],establishmentSpecific:confidence==="HIGH",resolverVersion:"COMMERCIAL_INSTAGRAM_RESOLVER_V2"}});
  if(!c.eligibility.prospectingEligible)return make(null,"LOW","ineligible");
  for(const site of sites){
    // A same-origin contact page can verify the homepage's establishment identity.
    // Never cross origins, and aggregate chain warnings across both observed pages.
    if(!websites.some(w=>new URL(w.url).origin===new URL(site.url).origin&&w.classification==="OFFICIAL_SITE"))continue;
    const handles=[...new Set(site.links.map(rootInstagramHandle).filter((h):h is string=>Boolean(h)))];
    if(sites.some(s=>new URL(s.url).origin===new URL(site.url).origin&&/nos salons|our salons|our locations|store locator|réseau de salons|franchise network/i.test(s.text))){
      shared=true;allEvidence.push(evidence("SHARED_BRAND_PROFILE",site.url,"Multi-location brand context; direct link alone is insufficient","NEGATIVE",at));
    }
    if(handles.length>1){shared=true;allEvidence.push(evidence("SHARED_BRAND_PROFILE",site.url,"multiple Instagram identities on verified site","NEGATIVE",at));}
    if(handles.length===1){strong.set(handles[0],[site.url]);allEvidence.push(evidence("OFFICIAL_SITE_INSTAGRAM_LINK",site.url,`https://www.instagram.com/${handles[0]}/`,"STRONG",at));}
  }
  for(const hit of hits){
    const handle=rootInstagramHandle(hit.url);
    if(handle&&aliases.some(a=>has(hit.title+" "+hit.snippet,a.value))&&has(hit.title+" "+hit.snippet,c.city)){
      hints.add(handle);allEvidence.push(evidence("BUSINESS_ALIAS_MATCH",hit.url,hit.title.slice(0,180),"SECONDARY",at),evidence("CITY_MATCH",hit.url,c.city,"SECONDARY",at));
    }
  }
  if(previous?.confidence==="MEDIUM"&&previous.matchedProfileUrl&&rootInstagramHandle(previous.matchedProfileUrl)){
    hints.add(rootInstagramHandle(previous.matchedProfileUrl)!);
    allEvidence.push(evidence("PREVIOUS_MATCH_HINT",previous.matchedProfileUrl,"Historical name/city match; not a new verification","SECONDARY",c.source.observedAt));
  }
  for(const p of profiles){
    const handle=rootInstagramHandle(p.url);if(!handle)continue;
    const relevant=strong.has(handle)||hints.has(handle)||Boolean(p.alias&&aliases.some(a=>norm(a.value)===norm(p.alias!)));
    if(!relevant)continue;
    if(p.sharedBrand){shared=true;allEvidence.push(evidence("SHARED_BRAND_PROFILE",p.url,"Observed brand-wide profile","NEGATIVE",p.observed_at));}
    if(p.city&&norm(p.city)!==norm(c.city)||p.address&&norm(p.address)!==norm(c.address)||p.postalCode&&p.postalCode!==c.postalCode){contradiction=true;allEvidence.push(evidence("IDENTITY_CONTRADICTION",p.url,"Explicit profile location differs from establishment","NEGATIVE",p.observed_at));continue;}
    const alias=Boolean(p.alias&&aliases.some(a=>norm(a.value)===norm(p.alias!))), city=Boolean(p.city&&norm(p.city)===norm(c.city));
    const address=Boolean(p.address&&norm(p.address)===norm(c.address));
    const matchingPhone=Boolean(p.phone&&c.verifiedPhone&&phone(p.phone)===phone(c.verifiedPhone));
    const backlink=Boolean(p.website&&websites.some(w=>w.classification==="OFFICIAL_SITE"&&host(w.url)===host(p.website!)));
    if(alias)allEvidence.push(evidence("BUSINESS_ALIAS_MATCH",p.url,p.alias!,"SECONDARY",p.observed_at));
    if(city)allEvidence.push(evidence("CITY_MATCH",p.url,p.city!,"SECONDARY",p.observed_at));
    if(address)allEvidence.push(evidence("ADDRESS_MATCH",p.url,p.address!,"STRONG",p.observed_at));
    if(matchingPhone)allEvidence.push(evidence("PHONE_MATCH",p.url,p.phone!,"STRONG",p.observed_at));
    if(backlink)allEvidence.push(evidence("INSTAGRAM_BACKLINK_TO_OFFICIAL_SITE",p.url,p.website!,"STRONG",p.observed_at));
    if(p.bookingIdentityVerified)allEvidence.push(evidence("BOOKING_IDENTITY_MATCH",p.url,"Verified establishment booking identity","SECONDARY",p.observed_at));
    // Two independent sources: verified establishment site and observed profile, not two snippets.
    if(alias&&city&&backlink&&(address||matchingPhone))strong.set(handle,[p.url,p.website!]);
    if(alias&&city)hints.add(handle);
  }
  if(contradiction)return make(null,"LOW","IDENTITY_CONTRADICTION");
  if(shared)return make(hints.size===1?[...hints][0]:null,"MEDIUM","SHARED_BRAND_PROFILE");
  if(strong.size===1)return make([...strong.keys()][0],"HIGH","verified_establishment_identity");
  if(strong.size>1)return make(null,"MEDIUM","conflicting_verified_accounts");
  if(hints.size)return make([...hints][0],"MEDIUM",hints.size>1?"ambiguous_profile_requires_review":"name_city_only_requires_review");
  return make(null,"LOW","no_establishment_specific_match");
}

export async function resolveBusinessPresence(c:StructuredCandidate,deps:{search:(q:string)=>Promise<SearchHit[]>;site:(url:string)=>Promise<SiteEvidence|null>;profiles?:PublicProfileEvidence[];previous?:InstagramMatch}) {
  const sites:SiteEvidence[]=[];
  if(!c.eligibility.prospectingEligible)return evaluateBusinessResolution(c,[],[]);
  // Exactly one targeted lookup; no query portfolio, no second page.
  const hits=await deps.search(targetedAliasQuery(c));
  const hint=c.officialWebsite ? {url:c.officialWebsite,title:c.businessName,snippet:c.city} : hits.find(h=>classifyWebsiteUrl(h.url)==="UNKNOWN"&&businessAliases(c).some(a=>has(h.title+" "+h.snippet,a.value))&&has(h.title+" "+h.snippet,c.city));
  if(hint&&classifyWebsiteUrl(hint.url)==="UNKNOWN"){
    const homepage=new URL("/",hint.url).href;
    const site=await deps.site(homepage);if(site)sites.push(site);
    // Only one same-origin contact/location page. Never crawl arbitrary external links.
    if(site){const follow=site.links.find(link=>{try{return new URL(link).origin===new URL(site.url).origin&&link!==site.url&&/\/(contact|about|a-propos|nous-contacter|location)([/.?#-]|$)/i.test(new URL(link).pathname);}catch{return false;}});
      if(follow){const detail=await deps.site(follow);if(detail)sites.push(detail);}
    }
  }
  return evaluateBusinessResolution(c,hits,sites,deps.profiles,undefined,deps.previous);
}
