// Local static visual fixture only: no auth, DB, fetch, or decision handlers.
// Run from the repository root. Binds loopback only; never deployed as a route.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const loaded = new Map();
const styles = new Map();
function load(filename) {
  if (loaded.has(filename)) return loaded.get(filename);
  const module = { exports: {} };
  const localRequire = (key) => {
    if (key.endsWith('.css')) {
      const file = path.resolve(path.dirname(filename), key);
      const prefix = path.basename(file).split('.')[0];
      styles.set(file, fs.readFileSync(file, 'utf8').replace(/\.([A-Za-z_][\w-]*)/g, `.${prefix}_$1`));
      return new Proxy({}, { get: (_, name) => name === '__esModule' ? false : `${prefix}_${String(name)}` });
    }
    if (key === 'next/link') return (props) => React.createElement('a', { href: props.href }, props.children);
    if (key.startsWith('@/') || key.startsWith('.')) {
      const base = key.startsWith('@/') ? path.join(root, key.slice(2)) : path.resolve(path.dirname(filename), key);
      return load(['.tsx', '.ts'].map((ext) => base + ext).find((file) => fs.existsSync(file)));
    }
    return require(key);
  };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  loaded.set(filename, module.exports); return module.exports;
}
const Quality = load(path.join(root, 'app/instagram-dashboard/commercial/CommercialReviewQuality.tsx')).default;
const Detail = load(path.join(root, 'app/instagram-dashboard/commercial/CommercialLeadDetail.tsx')).default;
const { buildHumanReviewFeedback } = load(path.join(root, 'lib/commercial/human-review-feedback.ts'));
const events = Array.from({ length: 25 }, (_, i) => ({ lead_id: String(i), event_type: 'human_review_canary_enrolled', occurred_at: '2026-08-28T00:00:00Z', metadata_safe: { canary_key: 'human_review_canary_v1', position: i + 1, ai_priority: i < 15 ? 'urgent' : 'high', ai_score: 84, ai_channel: 'instagram', ai_angle: 'A' } }));
const model = buildHumanReviewFeedback(events, [], []);
const lead = { id: '0', businessName: 'Local visual fixture — no real prospect', city: 'Cape Town', subsegment: 'Beauty studio', score: 84, priority: 'urgent', outreachChannel: 'instagram', messageAngle: 'A', personalizationContext: { reason: 'Verified business activity and relevant local audience.' }, audienceContext: { potential: 'Local beauty audience — fixture only' }, version: 1 };
const body = renderToStaticMarkup(React.createElement('main', null, React.createElement('p', null, 'LOCAL VISUAL FIXTURE · NO REAL ACTIONS'), React.createElement(Quality, { model }), React.createElement(Detail, { lead, pending: false, mobileOpen: true, canaryMember: model.members[0], reviewReady: false, returnPath: '#', previousDisabled: true, nextDisabled: false })));
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Commercial review visual fixture</title><style>*{box-sizing:border-box}body{margin:0;background:#0c0d10;color:#eee;font-family:Arial,sans-serif;padding:20px 20px 100px 68px}main{max-width:1250px;margin:auto}${[...styles.values()].join('\n')}</style><body>${body}</body></html>`;
http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); }).listen(3147, '127.0.0.1', () => console.log('Static fixture: http://127.0.0.1:3147 · no DB/network/actions'));
