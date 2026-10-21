import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createWarmupFixture, createPrivatePg17, rejectConnectionOverrides } from './fixtures/private-pg17-fixture.mjs';

// Opt-in only: never connect to production or use ambient PG connection settings.
const enabled = process.env.WARMUP_LOCAL_COMPATIBILITY_TEST === '1';
let pg;
test.before(() => { if(enabled) pg=createWarmupFixture(); });
test.after(() => { if(pg) pg.close(); });
const migration = readFileSync(new URL('../supabase/migrations/20260905232416_stats_growth_warmup_package_inheritance.sql', import.meta.url), 'utf8');
function run(sql) {
  return pg.run(`BEGIN;\nSET LOCAL statement_timeout = '15s';\n${sql}\nROLLBACK;\n`,'stats_growth_complete');
}

const catalog = `SELECT jsonb_build_object(
  'relations', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace),
  'columns', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid, a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.relnamespace = 'public'::regnamespace),
  'constraints', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace),
  'indexes', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid WHERE c.relnamespace = 'public'::regnamespace),
  'triggers', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'public'::regnamespace),
  'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relnamespace = 'public'::regnamespace),
  'functions', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace),
  'receipts', (SELECT jsonb_agg(to_jsonb(r) ORDER BY account_id) FROM public.account_warmup_package_inheritance_receipts r),
  'warmup', (SELECT jsonb_agg(to_jsonb(w) ORDER BY account_id) FROM public.account_warmup_settings w)
) AS value`;

test('compatible migration replay twice preserves schema, OIDs, privileges, triggers and history', { skip: !enabled }, () => {
  const result = run(`CREATE TEMP TABLE compatibility_before AS ${catalog};\n${migration}\n${migration}\nCREATE TEMP TABLE compatibility_after AS ${catalog};\nDO $$ BEGIN IF (SELECT value FROM compatibility_before) IS DISTINCT FROM (SELECT value FROM compatibility_after) THEN RAISE EXCEPTION 'replay_changed_existing_contract_or_history'; END IF; END $$;`);
  assert.equal(result.status, 0, result.stderr || String(result.error));
});

for (const [name, alteration] of [
  ['unexpected column', 'ALTER TABLE public.account_warmup_package_inheritance_receipts ADD COLUMN incompatible_fixture text;'],
  ['nullable required column', 'ALTER TABLE public.account_warmup_package_inheritance_receipts ALTER COLUMN applied_at DROP NOT NULL;'],
  ['disabled RLS', 'ALTER TABLE public.account_warmup_package_inheritance_receipts DISABLE ROW LEVEL SECURITY;'],
  ['missing service grant', 'REVOKE SELECT ON public.account_warmup_package_inheritance_receipts FROM service_role;'],
  ['unexpected anonymous grant', 'GRANT SELECT ON public.account_warmup_package_inheritance_receipts TO anon;'],
]) {
  test(`incompatible receipt contract fails closed: ${name}`, { skip: !enabled }, () => {
    const result = run(`${alteration}\n${migration}`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /warmup_receipt_schema_incompatible:/);
    // Connection exit rolls the entire fixture transaction back, including DDL.
  });
}

test('compatible schema remains replayable after rejected transactions', { skip: !enabled }, () => {
  const result = run(migration);
  assert.equal(result.status, 0, result.stderr || String(result.error));
});

 test('private PG17 fixture refuses ambient or remote connection override',()=>{
  for(const env of [{PGHOST:'remote.invalid'},{PGSERVICE:'prod'},{DATABASE_URL:'postgres://remote.invalid/db'}]) assert.throws(()=>rejectConnectionOverrides(env),/connection_override_forbidden/);
 });
 test('private PG17 fixture rolls back and cleans up after SQL failure',()=>{
  const isolated=createPrivatePg17(),root=isolated.root;
  try {assert.notEqual(isolated.run("BEGIN; CREATE TABLE rollback_probe(id int); SELECT 1/0; COMMIT;").status,0);
   assert.equal(isolated.execute("SELECT to_regclass('rollback_probe') IS NULL;").trim().split('\n')[2]?.trim(),'t');
  }finally{isolated.close();}
  assert.equal(existsSync(root),false);
 });
