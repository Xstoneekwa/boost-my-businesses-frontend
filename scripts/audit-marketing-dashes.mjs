// Source-literal inventory. Excludes syntax, comments, keys and CSS; never rewrites copy.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const roots = ["app/components", "app/partners", "app/about", "app/contact", "app/privacy-policy", "app/refund-policy", "app/terms-and-conditions", "app/agent", "app/restaurant-call-test", "app/instagram-growth", "app/instagram-growth-south-africa", "app/ai-automation"];
const files = ["app/page.tsx", "app/layout.tsx", "lib/marketing/seo.ts", "public/instagram-growth/index.html", "public/instagram-growth/app.js"];
function walk(dir) { for (const d of fs.readdirSync(dir, {withFileTypes:true})) { const p=path.join(dir,d.name); if(d.isDirectory()) walk(p); else if(/\.(tsx?|jsx?)$/.test(p)) files.push(p); } }
roots.forEach(walk);
const rows=[];
const refIndex = process.argv.indexOf("--ref");
const ref = refIndex < 0 ? null : process.argv[refIndex + 1];
// A historical audit must use that revision's inventory, not newly added files.
const refFiles = ref ? new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", ref], {encoding:"utf8"}).trim().split("\n")) : null;
export const auditedFiles = [...new Set(files)].filter(file => !refFiles || refFiles.has(file)).sort();
const technicalTokens = /^(?:-?apple-system|sans-serif|system-ui|inline-flex|auto-fit|space-between|pre-wrap|not-allowed|en-US|fr-FR|bad-on|good-on|is-active|reduced-motion|web-chat|web-user|checkout-email(?:-error)?|checkout-offer|email-error|period-note|product-journey|restaurant-call|ugc-ads(?:-engine-page)?|south-africa|beauty-aesthetics|ads-engine|call-test|engine-page)$/;
function add(file, source, start, text, technical=false) {
  for(const m of text.matchAll(/[—–−‐‒-]/g)) {
    const left=text.slice(0,m.index), right=text.slice(m.index+1);
    const token=(left.match(/[\p{L}\p{N}-]+$/u)?.[0]||"")+m[0]+(right.match(/^[\p{L}\p{N}-]+/u)?.[0]||"");
    let category=technical ? "TECHNICAL_KEEP" : /\d$/.test(left)&&/^\d/.test(right) ? "VALID_RANGE_KEEP" : m[0]==="-"&&/[\p{L}\p{N}]$/u.test(left)&&/^[\p{L}]/u.test(right) ? "VALID_COMPOUND_WORD_KEEP" : m[0]==="-"&&/^\d/.test(right) ? "VALID_RANGE_KEEP" : "PUNCTUATION_STYLE_REMOVE";
    // The owner confirmed these exact product names; their separators are meaningful.
    if (!technical && /^Boost AI — (Growth|Pro|Premium)$/.test(text)) category="VALID_PRODUCT_NAME_KEEP";
    rows.push({file,line:source.slice(0,start).split("\n").length,char:m[0],token,category,text});
  }
}
for(const file of auditedFiles) {
  const source=ref ? execFileSync("git", ["show", `${ref}:${file}`], {encoding:"utf8"}) : fs.readFileSync(file,"utf8");
  if(file.endsWith(".html")) {
    // Only text nodes and public text attributes. Script/style/comment bodies are not copy.
    const clean=source.replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1>/gi,m=>m.replace(/[^\n]/g," "));
    for(const m of clean.matchAll(/>([^<>]+)</g)) if(m[1].trim()) add(file,source,m.index,m[1].trim());
    for(const m of clean.matchAll(/\b(data-en|data-fr|title|alt|aria-label|placeholder|content)=("[^"]*"|'[^']*')/g)) {
      const value=m[2].slice(1,-1); add(file,source,m.index,value,/^(https?:|width=|text\/)/.test(value));
    }
    continue;
  }
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith("tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  function visit(n) {
    if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateHead(n)||ts.isTemplateMiddle(n)||ts.isTemplateTail(n)||ts.isJsxText(n)) {
      const p=n.parent;
      const key=(ts.isPropertyAssignment(p)&&p.name===n)||(ts.isPropertySignature(p)&&p.name===n);
      const attr=ts.isJsxAttribute(p)?p.name.getText(ast):null;
      if(!key && (!attr || /^(alt|title|aria-label|data-en|data-fr|placeholder)$/.test(attr)) && !ts.isImportDeclaration(p) && !ts.isExportDeclaration(p)) {
        const text=n.text.trim();
        const prop=ts.isPropertyAssignment(p)?p.name.getText(ast):"";
        let style=false;
        for(let a=p;a;a=a.parent) if(ts.isJsxAttribute(a)&&a.name.getText(ast)==="style") style=true;
        if(/^(fontFamily|gridTemplateColumns)$/.test(prop)||/^(?:repeat\(|\[|\(prefers-reduced-motion:)/.test(text)) style=true;
        const technical=style||technicalTokens.test(text)||/^:\s*-$/.test(text)||/^(https?:|\/|@\/|\.|#|--|calc\(|linear-gradient|radial-gradient|rgba?\(|[a-z]+\/)/.test(text)||/^(src|href|image|img|className|id|event|key|name)$/.test(prop)&&!text.includes(" ")||/^(data-|aria-|bmb-|gtm\.|text-|bg-|items-|justify-|font-|rounded-|border-|grid-|flex-|max-|min-|overflow-|object-)/.test(text)||/^(\d+px|.*\b(?:px|rem|vh|vw)\b|.*[{};].*:)/.test(text)||/^(use-|react-|next-)/.test(text);
        add(file,source,n.getStart(ast),text,technical);
      }
    }
    ts.forEachChild(n,visit);
  }
  visit(ast);
}
const counts=Object.fromEntries(["PUNCTUATION_STYLE_REMOVE","VALID_PRODUCT_NAME_KEEP","VALID_COMPOUND_WORD_KEEP","VALID_RANGE_KEEP","TECHNICAL_KEEP","UNCERTAIN_MANUAL_REVIEW"].map(c=>[c,rows.filter(r=>r.category===c).length]));
const result={files:auditedFiles,total:rows.length,counts,terms:[...new Set(rows.filter(r=>r.category==="VALID_COMPOUND_WORD_KEEP").map(r=>r.token))].sort(),rows};
if(process.argv.includes("--guard")) {
  const violations=rows.filter(r=>r.category==="PUNCTUATION_STYLE_REMOVE");
  if(violations.length) { console.error(JSON.stringify(violations,null,2)); process.exitCode=1; } else console.log("COPY_DASH_GUARD=PASS");
} else console.log(JSON.stringify(result,null,2));
