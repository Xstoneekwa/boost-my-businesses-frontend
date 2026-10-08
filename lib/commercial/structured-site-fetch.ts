import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import type { SiteEvidence } from "./structured-instagram-resolver";
import { robotsAllows } from "./robots-policy";
export { robotsAllows } from "./robots-policy";

export function isPublicIPv4(ip: string) {
  if (isIP(ip) !== 4) return false;
  const [a,b] = ip.split(".").map(Number);
  return a > 0 && a < 224 && ![10,127].includes(a) && !(a===169&&b===254) && !(a===172&&b>=16&&b<=31) && !(a===192&&(b===168||b===0||b===2)) && !(a===198&&(b===18||b===19||b===51)) && !(a===203&&b===0) && !(a===100&&b>=64&&b<=127);
}
/** DNS is checked once and pinned to the connection, preventing DNS rebinding. No redirects. */
export async function safeSiteGet(value: string): Promise<{status:number; text:string}> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || isIP(url.hostname) || !url.hostname.includes(".") || /\.(localhost|local|internal)$/i.test(url.hostname)) throw new Error("site_url_blocked");
  const addresses = await lookup(url.hostname,{all:true,family:4});
  if (!addresses.length || addresses.some(a => !isPublicIPv4(a.address))) throw new Error("site_dns_blocked");
  return new Promise((resolve,reject) => {
    const req = request(url,{method:"GET",family:4,lookup:(_host,_opts,cb)=>cb(null,addresses[0].address,4),headers:{"User-Agent":"BMBDiscoveryBot/1.0","Accept":"text/html,text/plain"}},res=>{
      const chunks:Buffer[]=[];let bytes=0;
      res.on("data",(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>250_000)req.destroy(new Error("site_payload_limit"));else chunks.push(chunk);});
      res.on("end",()=>resolve({status:res.statusCode??0,text:Buffer.concat(chunks).toString("utf8")}));
      res.on("error",reject);
    });
    const deadline = setTimeout(()=>req.destroy(new Error("site_timeout")),5000);
    req.on("close",()=>clearTimeout(deadline));req.on("error",reject);req.end();
  });
}
export async function fetchOfficialSite(url: string, get: (url:string)=>Promise<{status:number;text:string}>): Promise<SiteEvidence|null> {
  try {
    const parsed=new URL(url); parsed.hash="";
    const robots=await get(new URL("/robots.txt",parsed).toString());
    if (robots.status!==404 && (robots.status!==200 || !robotsAllows(robots.text,parsed.pathname+parsed.search))) return null;
    const page=await get(parsed.toString()); if(page.status!==200) return null;
    const links=[...page.text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].slice(0,500).flatMap(m=>{try{return [new URL(m[1].replaceAll("&amp;","&"),parsed).toString()];}catch{return [];}});
    return {url:parsed.toString(),links,text:page.text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<[^>]*>/g," ").replace(/\s+/g," ").slice(0,80_000)};
  } catch { return null; }
}
