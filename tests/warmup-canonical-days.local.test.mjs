import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWarmupFixture, createPrivatePg17, rejectConnectionOverrides } from './fixtures/private-pg17-fixture.mjs';

const enabled = process.env.WARMUP_REPRESENTATIVE_TEST === '1';
const setup = readFileSync(new URL('./fixtures/warmup-real-cases.sql', import.meta.url), 'utf8');
let pg;
test.before(() => { if(enabled) pg=createWarmupFixture(); });
test.after(() => { if(pg) pg.close(); });
const migration = readFileSync(new URL('../supabase/migrations/20260905232416_stats_growth_warmup_package_inheritance.sql', import.meta.url), 'utf8');
function run(sql, database = 'warmup_real_matrix') {
  assert.ok(['warmup_real_matrix', 'warmup_real_baseline'].includes(database));
  return pg.run(sql,database,['-q','-t','-A']);
}
function pass(sql, database) {
  const result = run(`BEGIN; SET LOCAL statement_timeout='20s';\n${setup}\n${sql}\nROLLBACK;`, database);
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout;
}

for (const stage of [1, 2, 3, 4, 5]) {
  for (const nextPackage of ['pro', 'premium']) {
    test(`canonical Day${stage} activity and Growth -> ${nextPackage}`, { skip: !enabled }, () => {
      const before = [10, 20, 40, 80, 80][stage - 1];
      const after = [10, 20, 40, 120, 120][stage - 1];
      pass(`DO $$ DECLARE a uuid; original_start timestamptz; BEGIN
        a:=pg_temp.seed_account('day${stage}_${nextPackage}','growth',80,false);
        PERFORM pg_temp.seed_verified_follow_days(a,${stage - 1});
        SELECT warmup_started_at INTO original_start FROM account_warmup_settings WHERE account_id=a;
        PERFORM pg_temp.assert_true((SELECT (effective_caps_preview->>'follow_day')::int=${before} FROM account_package_summary WHERE account_id=a),'canonical stage before transition');
        PERFORM pg_temp.change_package(a,'${nextPackage}');
        PERFORM pg_temp.assert_true((SELECT (effective_caps_preview->>'follow_day')::int=${after} AND warmup_day=${Math.min(stage, 4)} AND warmup_status='${stage >= 4 ? 'warmed_up' : 'warming_up'}' FROM account_package_summary WHERE account_id=a),'canonical stage after transition');
        PERFORM pg_temp.assert_true((SELECT warmup_started_at=original_start FROM account_warmup_settings WHERE account_id=a),'immutable start after transition');
      END $$;`);
    });
  }
}

for (const cap of [80, 100, 120]) {
  test(`Day4+ explicit account override ${cap} survives inherited warmup reconciliation`, { skip: !enabled }, () => {
    pass(`DO $$ DECLARE a uuid; BEGIN
      a:=pg_temp.seed_account('day4_override${cap}','growth',80,false,${cap});
      PERFORM pg_temp.seed_verified_follow_days(a,3);
      PERFORM pg_temp.change_package(a,'pro');
      PERFORM pg_temp.assert_true((SELECT day_4_plus_follow_cap=120 FROM account_warmup_settings WHERE account_id=a),'inherited warmup cap');
      PERFORM pg_temp.assert_true((SELECT (effective_caps_preview->>'follow_day')::int=${cap} FROM account_package_summary WHERE account_id=a),'manual effective account cap');
    END $$;`);
  });
}

test('Day4+ explicit warmup 80 remains 80 after Pro transition', { skip: !enabled }, () => {
  pass(`DO $$ DECLARE a uuid; BEGIN
    a:=pg_temp.seed_account('day4_manual','growth',80,true);
    PERFORM pg_temp.seed_verified_follow_days(a,3); PERFORM pg_temp.change_package(a,'pro');
    PERFORM pg_temp.assert_true((SELECT day_4_plus_follow_cap=80 FROM account_warmup_settings WHERE account_id=a),'manual warmup preserved');
    PERFORM pg_temp.assert_true((SELECT (effective_caps_preview->>'follow_day')::int=80 FROM account_package_summary WHERE account_id=a),'manual effective warmup');
  END $$;`);
});

test('canonical never-follow-twice guard remains active', { skip: !enabled }, () => {
  const result = run(`BEGIN; ${setup}
    SELECT pg_temp.seed_account('day_guard','growth',80,false);
    SELECT pg_temp.seed_verified_follow_days(md5('account:day_guard')::uuid,1);
    INSERT INTO ig_interaction_events(account_id,username,event_type,event_status,interaction_type,interaction_status,event_at)
    VALUES(md5('account:day_guard')::uuid,'synthetic_target_1','follow_verified_persisted_v1','success','follow','success',now()); ROLLBACK;`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /follow_persistence_canonical_once_already_exists/);
});

const snapshot = `CREATE TEMP TABLE existing_schema AS
  SELECT 'class'::text kind,c.oid,to_jsonb(c) value FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'function',p.oid,to_jsonb(p) FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace,'private'::regnamespace)
  UNION ALL SELECT 'constraint',c.oid,to_jsonb(c) FROM pg_constraint c WHERE c.connamespace='public'::regnamespace
  UNION ALL SELECT 'trigger',t.oid,to_jsonb(t) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'policy',p.oid,to_jsonb(p) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='public'::regnamespace;
  CREATE TEMP TABLE existing_history(table_name text PRIMARY KEY,value jsonb);
  DO $$ DECLARE r record; v jsonb; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), ''[]''::jsonb) FROM public.%I t',r.tablename) INTO v;
    INSERT INTO existing_history VALUES(r.tablename,v);
  END LOOP; END $$;`;
const unchanged = `DO $$ DECLARE r record; v jsonb; BEGIN
  FOR r IN SELECT * FROM existing_schema LOOP
    CASE r.kind
      WHEN 'class' THEN SELECT to_jsonb(c) INTO v FROM pg_class c WHERE c.oid=r.oid;
      WHEN 'function' THEN SELECT to_jsonb(p) INTO v FROM pg_proc p WHERE p.oid=r.oid;
      WHEN 'constraint' THEN SELECT to_jsonb(c) INTO v FROM pg_constraint c WHERE c.oid=r.oid;
      WHEN 'trigger' THEN SELECT to_jsonb(t) INTO v FROM pg_trigger t WHERE t.oid=r.oid;
      WHEN 'policy' THEN SELECT to_jsonb(p) INTO v FROM pg_policy p WHERE p.oid=r.oid;
    END CASE;
    PERFORM pg_temp.assert_true(v IS NOT DISTINCT FROM r.value,'existing schema changed: '||r.kind||':'||r.oid);
  END LOOP;
  FOR r IN SELECT * FROM existing_history LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), ''[]''::jsonb) FROM public.%I t',r.table_name) INTO v;
    PERFORM pg_temp.assert_true(v IS NOT DISTINCT FROM r.value,'existing history changed: '||r.table_name);
  END LOOP;
END $$;`;

for (const database of ['warmup_real_baseline', 'warmup_real_matrix']) {
  test(`${database}: installation/replay preserves canonical interaction history and existing schema`, { skip: !enabled }, () => {
    pass(`SELECT pg_temp.seed_account('history','growth',80,false);
      SELECT pg_temp.seed_verified_follow_days(md5('account:history')::uuid,3);
      RESET ROLE; ${snapshot}
      SET LOCAL ROLE postgres; ${migration}\n${migration}
      RESET ROLE; ${unchanged}`, database);
  });
}

test('mid-migration failure rolls back new receipt table and synthetic canonical history', { skip: !enabled }, () => {
  const before = run("SELECT to_regclass('public.account_warmup_package_inheritance_receipts') IS NULL AND NOT EXISTS(SELECT 1 FROM public.ig_accounts WHERE username='fixture_fault');", 'warmup_real_baseline');
  assert.equal(before.status, 0, before.stderr);
  assert.equal(before.stdout.trim(), 't');
  assert.ok(migration.includes('$receipt_guard$;'));
  const injected = migration.replace('$receipt_guard$;', () => "$receipt_guard$; DO $$ BEGIN RAISE EXCEPTION 'qualification_mid_migration_fault'; END $$;");
  const result = run(`BEGIN; ${setup}
    SELECT pg_temp.seed_account('fault','growth',80,false);
    SELECT pg_temp.seed_verified_follow_days(md5('account:fault')::uuid,3);
    RESET ROLE; SET LOCAL ROLE postgres; ${injected}\nCOMMIT;`, 'warmup_real_baseline');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /qualification_mid_migration_fault/);
  const after = run("SELECT to_regclass('public.account_warmup_package_inheritance_receipts') IS NULL AND NOT EXISTS(SELECT 1 FROM public.ig_accounts WHERE username='fixture_fault') AND NOT EXISTS(SELECT 1 FROM public.ig_interaction_events WHERE account_id=md5('account:fault')::uuid);", 'warmup_real_baseline');
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout.trim(), 't');
});

test('Pro -> Growth runtime defect is identical A/B; candidate only reconciles inherited warmup', { skip: !enabled }, () => {
  const evidence = [];
  for (const database of ['warmup_real_baseline', 'warmup_real_matrix']) {
    const output = pass(`DO $$ DECLARE a uuid; BEGIN
      a:=pg_temp.seed_account('downgrade_scope','pro',120,false);
      PERFORM pg_temp.seed_verified_follow_days(a,3);
      UPDATE account_commercial_packages SET status='ended',ends_at=date_trunc('day',now())-interval '1 day' WHERE account_id=a AND status='active';
      INSERT INTO account_commercial_packages(account_id,package_code,starts_at) VALUES(a,'growth',date_trunc('day',now())-interval '1 day');
    END $$;
    SELECT jsonb_build_object('runtime',c-'assignment','warmup',(SELECT day_4_plus_follow_cap FROM account_warmup_settings WHERE account_id=md5('account:downgrade_scope')::uuid))
    FROM (SELECT account_package_runtime_contract_status(md5('account:downgrade_scope')::uuid) c) s;`, database);
    evidence.push(JSON.parse(output.trim()));
  }
  assert.deepEqual(evidence[0].runtime, evidence[1].runtime);
  assert.equal(evidence[0].runtime.ok, false);
  assert.equal(evidence[0].runtime.reason, 'package_settings_incomplete');
  assert.equal(evidence[0].warmup, 120);
  assert.equal(evidence[1].warmup, 80);
});
