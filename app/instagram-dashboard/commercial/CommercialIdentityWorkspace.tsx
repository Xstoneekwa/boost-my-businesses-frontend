"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import CommercialQueueShell from "./CommercialQueueShell";
import CommercialContextSection from "./CommercialContextSection";
import styles from "./CommercialLeadReviewWorkspace.module.css";
import { filterBusinessViews, type CommercialBusinessView } from "@/lib/commercial/business-review-model";
import { safeCommercialReviewUrl } from "@/lib/commercial/lead-review-ui";
import { groupAliasOccurrences, type BusinessAliasOccurrence } from "@/lib/commercial/business-aliases-v2";

export default function CommercialIdentityWorkspace({items,runStatus,market="",aliasObservations,aliasDiagnosticStatus}:{items:CommercialBusinessView[];runStatus:string;market?:string;aliasObservations?:Record<string,BusinessAliasOccurrence[]>;aliasDiagnosticStatus?:string}){
  const router=useRouter(),[selectedId,setSelectedId]=useState<string|null>(null),[query,setQuery]=useState(""),[mobileOpen,setMobileOpen]=useState(false),[pending,setPending]=useState(false),[feedback,setFeedback]=useState("");
  const visible=filterBusinessViews(items,market,query), selected=visible.find(i=>i.businessId===selectedId)??visible[0];
  const website=selected? safeCommercialReviewUrl(selected.officialWebsite):null;
  const instagram=selected?safeCommercialReviewUrl(selected.instagramIdentity):null;
  const aliases=selected?groupAliasOccurrences(aliasObservations?.[selected.itemId]??[]):[];
  const [aliasSubmitted,setAliasSubmitted]=useState(false);
  async function diagnoseAliases(){
    if(pending||aliasSubmitted||aliasDiagnosticStatus)return;
    setAliasSubmitted(true);setPending(true);setFeedback("Checking the four authorized business names. No Instagram lookup, scoring or outreach.");
    try{
      const response=await fetch("/api/instagram-dashboard/commercial/discovery/aliases",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({authorizationKey:"commercial-france-sirene-alias-diagnostic-v3a"})});
      if(!response.ok)throw new Error();
      setFeedback("Diagnostic returned. Refresh results to inspect the recorded outcome; no automatic retry.");
    }catch{setFeedback("The diagnostic outcome could not be confirmed. Refresh to inspect its state; do not retry blindly.");}
    finally{setPending(false);router.refresh();}
  }
  async function reprocess(){
    if(pending||runStatus!=="not_started")return;
    setPending(true);setFeedback("Starting the bounded identity check…");
    try{const response=await fetch("/api/instagram-dashboard/commercial/discovery/resolver",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({authorizationKey:"commercial-existing-15-instagram-resolver-v2"})});if(!response.ok)throw new Error();setFeedback("Check reserved. Refresh to read its result; no scoring or outreach.");router.refresh();}
    catch{setFeedback("The check could not be confirmed. Refresh to inspect its state; do not retry blindly.");}
    finally{setPending(false);}
  }
  return <section id="identity-review" className={styles.workspace} aria-label="Business identity review">
    <div className={styles.heading}><div className={styles.headingCopy}><small className={styles.eyebrow}>DISCOVERY · IDENTITY REVIEW</small><h2>Verify the right business</h2><p>Existing businesses · {market?new Intl.DisplayNames(["en"],{type:"region"}).of(market):"All markets"} · Human review before scoring. No approval or sending here.</p></div><div className={styles.metrics}><span><b>{visible.length}</b>Businesses</span><span><b>{visible.filter(i=>i.confidence==="HIGH").length}</b>Needs Review</span><span><b>{visible.filter(i=>i.confidence==="MEDIUM").length}</b>Hold</span></div></div>
    <div className={styles.toolbar}><label className={styles.searchField}><span>⌕</span><input aria-label="Search identity queue" placeholder="Business or city" value={query} onChange={e=>{setQuery(e.target.value);setMobileOpen(false);}}/></label>
      {runStatus==="not_started"&&items.length===15?<button className={styles.secondaryButton} disabled={pending} onClick={reprocess}>Verify existing 15 identities</button>:<span className={styles.priorityBadge}>{runStatus==="completed"?"Frozen · Human review":runStatus.replaceAll("_"," ")}</span>}
      <button className={styles.quietButton} onClick={()=>router.refresh()}>Refresh results</button>
      {market==="FR"&&items.length===15&&runStatus==="completed"&&!aliasDiagnosticStatus?<button className={styles.secondaryButton} disabled={pending||aliasSubmitted} onClick={diagnoseAliases}>Diagnose aliases · 4 existing businesses</button>:null}
    </div>
    {feedback&&<p className={styles.feedback} role="status">{feedback}</p>}
    <CommercialQueueShell mobileDetailOpen={mobileOpen} busy={pending} queue={<aside className={styles.queue} aria-label="Business identity queue"><header className={styles.panelHeader}><div><small className={styles.panelEyebrow}>QUEUE</small><h3>{visible.length} businesses</h3></div></header>
      <div className={styles.queueList} role="listbox" aria-label="Business identities">{visible.map(i=><button type="button" role="option" aria-selected={i.businessId===selected?.businessId} key={i.businessId} className={`${styles.queueItem} ${i.businessId===selected?.businessId?styles.queueItemSelected:""}`} onClick={()=>{setSelectedId(i.businessId);setMobileOpen(true);}}><span className={styles.queueItemTop}><strong>{i.businessName}</strong><span className={styles.priorityBadge}>{i.confidence}</span></span><span className={styles.queueMeta}>{i.location} · {i.market}</span><span className={styles.queueHandle}>{i.instagramIdentity?`@${new URL(i.instagramIdentity).pathname.split("/").filter(Boolean)[0]}`:"Instagram unresolved"}</span><span className={styles.queueMeta}>{i.qualificationStatus} · Not scored</span></button>)}</div>
      {!visible.length&&<div className={styles.empty}><strong>Queue clear</strong><p>No businesses awaiting identity review in this market.</p></div>}
    </aside>}>
      <article className={`${styles.detail} ${mobileOpen?"":styles.detailHiddenMobile}`} aria-label="Business identity detail">
        {selected?<><header className={styles.detailHeader}><button className={`${styles.quietButton} ${styles.mobileBack}`} onClick={()=>setMobileOpen(false)}>← Queue</button><div className={styles.detailHeading}><div><h3>{selected.businessName}</h3><p>{selected.location} · {selected.market}</p></div></div><span className={styles.priorityBadge}>{selected.qualificationStatus}</span></header>
          <div className={styles.detailBody}><div className={styles.linkRow}>{instagram?<a href={instagram} target="_blank" rel="noreferrer">Instagram ↗</a>:<span>Instagram unresolved</span>}{website?<a href={website} target="_blank" rel="noreferrer">Verified website ↗</a>:<span>Official website not verified</span>}</div>
            <CommercialContextSection title="Next action" entries={[{label:"Review",value:selected.nextAction},{label:"Confidence",value:selected.confidence},{label:"Score",value:"Not scored"},{label:"Channel / angle",value:"Not assigned"}]} empty=""/>
            <CommercialContextSection title="Identity evidence" entries={selected.evidence.map(e=>({label:e.type.replaceAll("_"," "),value:`${e.reference} · ${e.strength} · ${e.source} · ${e.observed_at}`}))} empty="Historical name/city hint only. No establishment-specific proof recorded."/>
            {aliases.length>0?<details className={styles.contextSection}><summary>Business aliases · {aliases.length}</summary><CommercialContextSection title="Business aliases" entries={[{label:"Current lookup",value:selected.businessName},...aliases.map(a=>({label:a.value,value:a.sources.map(s=>`${s.alias_type.replaceAll("_"," ")} · ${s.provider} · ${s.source_field} · ${s.observed_at}`).join("; ")}))]} empty=""/><p className={styles.contextEmpty}>Source occurrences only. Sign lines are not combined. Instagram confidence unchanged.</p></details>:null}
            <details className={styles.contextSection}><summary>Source context · {selected.sourceContext.provider}</summary><CommercialContextSection title="Provider details" entries={[{label:"Identifier",value:selected.sourceContext.externalId},{label:"Department / region",value:selected.sourceContext.department},{label:"Activity",value:selected.sourceContext.activity},{label:"Names / aliases",value:selected.sourceContext.aliases.join(" · ")},{label:"Profile scope",value:selected.sourceContext.profileScope.replaceAll("_"," ")},{label:"Source",value:selected.sourceContext.source}]} empty=""/></details>
            <p className={styles.contextEmpty}>Results are frozen for Liam’s review. AI scoring OFF · Auto-approval OFF · All delivery OFF.</p>
          </div></>:<div className={styles.empty}>Select a business to inspect its evidence.</div>}
      </article>
    </CommercialQueueShell>
  </section>;
}
