/** RFC 9309 matching; errors retrieving robots remain fail-closed in the fetcher. */
export function robotsAllows(text: string, path = "/", userAgent = "BMBDiscoveryBot") {
  const groups: Array<{agents:string[]; rules:Array<{allow:boolean; path:string}>}> = [];
  let group: typeof groups[number] | undefined;
  let rulesStarted = false;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n|\r/)) {
    const line = raw.split("#")[0].trim(), colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0,colon).trim().toLowerCase(), value = line.slice(colon+1).trim();
    if (key === "user-agent") {
      if (!group || rulesStarted) { group={agents:[],rules:[]}; groups.push(group); rulesStarted=false; }
      group.agents.push(value.toLowerCase());
    } else if (group && ["allow","disallow"].includes(key)) {
      rulesStarted=true;
      if (value.startsWith("/")) group.rules.push({allow:key==="allow",path:value});
    }
  }
  const specific = groups.filter(g=>g.agents.includes(userAgent.toLowerCase()));
  const selected = specific.length ? specific : groups.filter(g=>g.agents.includes("*"));
  const normalize = (s:string) => s.replace(/[^\x00-\x7F]/gu,c=>encodeURIComponent(c)).replace(/%[a-f0-9]{2}/gi,p=>{
    const c=String.fromCharCode(parseInt(p.slice(1),16));return /[a-z0-9._~-]/i.test(c)?c:p.toUpperCase();
  });
  const target = normalize(path);
  let length=-1, allowed=true;
  for (const rule of selected.flatMap(g=>g.rules)) {
    const pattern=normalize(rule.path), end=pattern.endsWith("$");
    const body=end?pattern.slice(0,-1):pattern;
    const expression="^"+body.split("*").map(p=>p.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join(".*")+(end?"$":"");
    const specificity=body.replaceAll("*","").length;
    if (new RegExp(expression).test(target) && (specificity>length || specificity===length&&rule.allow)) {length=specificity;allowed=rule.allow;}
  }
  return allowed;
}
