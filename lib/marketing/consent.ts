export const CONSENT_COOKIE = "bmb_consent_v1";
export const CONSENT_MAX_AGE = 180 * 24 * 60 * 60;
export type ConsentChoice = { v: 1; analytics: boolean; ads: boolean; expires: number };

export function parseConsent(value: string | undefined, now = Date.now()): ConsentChoice | null {
  try {
    const choice = JSON.parse(decodeURIComponent(value || ""));
    return choice?.v === 1 && typeof choice.analytics === "boolean" && typeof choice.ads === "boolean" && Number.isFinite(choice.expires) && choice.expires > now && choice.expires <= now + CONSENT_MAX_AGE * 1000 + 60000 ? choice : null;
  } catch { return null; }
}

declare global {
  interface Window {
    bmbConsentChoice?: ConsentChoice | null;
    bmbSetConsent?: (analytics: boolean, ads: boolean) => void;
  }
}

// Runs before GTM in the same beforeInteractive script. No config command or
// direct GA4 script: this queue controls Consent Mode only (Google's native fallback).
export const CONSENT_BOOTSTRAP = `(function(w,d){
if(w.bmbSetConsent)return;
w.dataLayer=w.dataLayer||[];
function command(){w.dataLayer.push(arguments);}
function states(a,b){return {analytics_storage:a?'granted':'denied',ad_storage:b?'granted':'denied',ad_user_data:b?'granted':'denied',ad_personalization:b?'granted':'denied'};}
command('consent','default',states(false,false));
command('set','ads_data_redaction',true);
command('set','url_passthrough',false);
w.bmbConsentChoice=null;w.bmbAnalyticsConsent=false;
try{var raw=d.cookie.split('; ').find(function(c){return c.indexOf('${CONSENT_COOKIE}=')===0;});var c=JSON.parse(decodeURIComponent(raw?raw.slice('${CONSENT_COOKIE}='.length):''));if(c.v===1&&typeof c.analytics==='boolean'&&typeof c.ads==='boolean'&&Number.isFinite(c.expires)&&c.expires>Date.now()&&c.expires<=Date.now()+${CONSENT_MAX_AGE * 1000}+60000){w.bmbConsentChoice=c;w.bmbAnalyticsConsent=c.analytics;command('consent','update',states(c.analytics,c.ads));}}catch(e){}
w.bmbSetConsent=function(a,b){
if(typeof a!=='boolean'||typeof b!=='boolean')return;
var old=w.bmbConsentChoice;
var c={v:1,analytics:a,ads:b,expires:Date.now()+${CONSENT_MAX_AGE * 1000}};
try{d.cookie='${CONSENT_COOKIE}='+encodeURIComponent(JSON.stringify(c))+'; Path=/; Max-Age=${CONSENT_MAX_AGE}; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');}catch(e){}
w.bmbConsentChoice=c;w.bmbAnalyticsConsent=a;
if(!old||old.analytics!==a||old.ads!==b)command('consent','update',states(a,b));
if(!a||!b){var domains=['',location.hostname];if(location.hostname==='www.boostmybusinesses.com')domains.push('boostmybusinesses.com');d.cookie.split('; ').forEach(function(cookie){var name=cookie.split('=')[0];if((!a&&/^(_ga($|_)|_gid$|_gat($|_))/.test(name))||(!b&&/^(_gcl_|_gac_)/.test(name))){domains.forEach(function(domain){d.cookie=name+'=; Max-Age=0; Path=/'+(domain?'; Domain='+domain:'');});}});}
w.dispatchEvent(new CustomEvent('bmb:consent',{detail:{analytics:a?'granted':'denied',ads:b?'granted':'denied'}}));
};
})(window,document);`;
