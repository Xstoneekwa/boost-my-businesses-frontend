import { businessAliases, type BusinessResolution, type MatchEvidence } from "./business-resolution-v2";
import type { StructuredCandidate } from "./structured-discovery-contract";
import type { InstagramMatch } from "./structured-instagram-resolver";
export type CommercialBusinessView={businessId:string;itemId:string;market:string;country:string;businessName:string;location:string;qualificationStatus:string;outreachStatus:string;salesStatus:string;instagramIdentity:string|null;confidence:string;score:number|null;recommendedChannel:string|null;recommendedAngle:string|null;nextAction:string;evidence:MatchEvidence[];officialWebsite:string|null;sourceContext:{provider:string;externalId:string;department:string;activity:string;aliases:string[];source:string;profileScope:string}};
export function commercialBusinessView(item:{id:string;business_id:string;source_snapshot_safe:StructuredCandidate;enrichment_snapshot_safe:{match?:InstagramMatch;resolver_v2?:BusinessResolution}}):CommercialBusinessView{
  const c=item.source_snapshot_safe,r=item.enrichment_snapshot_safe.resolver_v2,m=r?.match??item.enrichment_snapshot_safe.match;
  const confidence=m?.confidence??"LOW";
  return {businessId:item.business_id,itemId:item.id,country:c.country,market:new Intl.DisplayNames(["en"],{type:"region"}).of(c.country)??c.country,businessName:c.businessName,location:c.city,
    qualificationStatus:confidence==="HIGH"?"Needs Review":confidence==="MEDIUM"?"Hold":"Unresolved",outreachStatus:"Not started",salesStatus:"Not started",instagramIdentity:m?.matchedProfileUrl??null,confidence,score:null,recommendedChannel:null,recommendedAngle:null,
    nextAction:confidence==="HIGH"?"Liam reviews identity evidence before any scoring":confidence==="MEDIUM"?"More establishment-specific evidence required":"Instagram identity unresolved",
    evidence:r?.evidence??[],officialWebsite:r?.websites.find(w=>w.classification==="OFFICIAL_SITE")?.url??null,
    sourceContext:{provider:c.provider,externalId:c.externalId,department:c.department,activity:c.activity.label,aliases:businessAliases(c).map(a=>`${a.value} (${a.alias_type})`),source:c.source.url,profileScope:r?.profileScope??"AMBIGUOUS_PROFILE"}};
}
export function filterBusinessViews(items:CommercialBusinessView[],country:string,search:string){return items.filter(i=>(!country||i.country===country)&&`${i.businessName} ${i.location}`.toLowerCase().includes(search.toLowerCase()));}
