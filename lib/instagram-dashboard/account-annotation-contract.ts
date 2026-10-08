export const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function annotationInput(value: unknown) {
 if (!value || typeof value !== "object") throw new Error("invalid_input");
 const x=value as Record<string,unknown>;
 if (typeof x.accountId!=="string" || !ACCOUNT_ID.test(x.accountId)
 || typeof x.clientId!=="string" || !ACCOUNT_ID.test(x.clientId)
 || !Number.isSafeInteger(x.version) || Number(x.version)<0
 || (x.text!==null && typeof x.text!=="string")) throw new Error("invalid_input");
 const text=typeof x.text==="string"?x.text.trim():null;
 if (text && text.length>1000) throw new Error("annotation_too_long");
 return {accountId:x.accountId,clientId:x.clientId,version:Number(x.version),text:text||null};
}
