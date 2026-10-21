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
function execute(sql) {
  return pg.run(`BEGIN; SET LOCAL statement_timeout='20s';\n${sql}\nROLLBACK;`,'warmup_real_matrix');
}
function sqlTest(name, sql, expectedError) {
  test(name, {skip:!enabled}, () => {
    const r=execute(setup+'\n'+sql);
    if(expectedError) { assert.notEqual(r.status,0); assert.match(r.stderr,expectedError); }
    else assert.equal(r.status,0,r.stderr || String(r.error));
  });
}

for (const [name,initial,cap,manual,next,expected] of [
  ['inherited_growth_to_pro','growth',80,false,'pro',120],
  ['inherited_growth_to_premium','growth',80,false,'premium',120],
  ['correct_pro','pro',120,false,'premium',120],
  ['correct_premium','premium',120,false,'pro',120],
  ['manual80','growth',80,true,'pro',80],
  ['manual100','pro',100,true,'premium',100],
  ['manual120','pro',120,true,'premium',120],
  ['manual55','growth',55,true,'pro',55],
  ['higher_package','growth',80,false,'higher',160],
  ['lower_package','growth',80,false,'lower',60],
]) sqlTest(name, `DO $$ DECLARE a uuid; before_start timestamptz; BEGIN
  a:=pg_temp.seed_account('${name}','${initial}',${cap},${manual});
  SELECT warmup_started_at INTO before_start FROM account_warmup_settings WHERE account_id=a;
  ${name==='lower_package' ? `UPDATE account_commercial_packages SET status='ended',ends_at=date_trunc('day',now())-interval '1 day' WHERE account_id=a AND status='active';
  INSERT INTO account_commercial_packages(account_id,package_code,starts_at) VALUES(a,'${next}',date_trunc('day',now())-interval '1 day');
  PERFORM pg_temp.assert_true(account_package_runtime_contract_status(a)->>'reason'='package_settings_incomplete' AND (account_package_runtime_contract_status(a)->>'ok')::boolean=false,'lower package must fail closed');
  PERFORM pg_temp.assert_true((SELECT max_actions_per_day=80 FROM ig_account_settings WHERE account_id=a),'configured limit preserved');` : `PERFORM pg_temp.change_package(a,'${next}');`}
  PERFORM pg_temp.assert_true((SELECT day_4_plus_follow_cap=${expected} AND warmup_started_at=before_start AND day_1_follow_cap=10 AND day_2_follow_cap=20 AND day_3_follow_cap=40 FROM account_warmup_settings WHERE account_id=a),'cap/provenance/start preservation ${name}');
END $$;`);

for(const cap of [80,100,120]) sqlTest(`explicit Follow override ${cap} remains distinct from inherited warmup`, `DO $$ DECLARE a uuid; BEGIN
  a:=pg_temp.seed_account('override${cap}','growth',80,false,${cap}); PERFORM pg_temp.change_package(a,'pro');
  PERFORM pg_temp.assert_true((SELECT follow_day_cap_override=${cap} FROM ig_account_follow_limit_overrides WHERE account_id=a),'override history preserved');
  PERFORM pg_temp.assert_true((SELECT max_actions_per_day=${cap} FROM ig_account_settings WHERE account_id=a),'configured manual limit preserved');
  PERFORM pg_temp.assert_true((SELECT day_4_plus_follow_cap=120 FROM account_warmup_settings WHERE account_id=a),'warmup inheritance independent of Follow override');
END $$;`);

sqlTest('missing provenance and null final cap stay conservative', `DO $$ DECLARE a uuid; BEGIN
 a:=pg_temp.seed_account('nullcap','growth',NULL,true); PERFORM pg_temp.change_package(a,'pro');
 PERFORM pg_temp.assert_true((SELECT day_4_plus_follow_cap IS NULL FROM account_warmup_settings WHERE account_id=a),'null provenance not invented');
END $$;`);
sqlTest('warmup start is immutable under service role', `SELECT pg_temp.seed_account('immutable','growth',80,false); UPDATE account_warmup_settings SET warmup_started_at=now();`, /warmup_started_at_is_immutable/);

for(const role of ['anon','authenticated']) {
  sqlTest(`${role} sees no RLS-protected warmup rows`, `SELECT pg_temp.seed_account('rls_${role}','growth',80,false); SET LOCAL ROLE ${role}; SELECT pg_temp.assert_true((SELECT count(*)=0 FROM account_warmup_settings),'RLS must filter all rows');`);
  sqlTest(`${role} cannot insert warmup rows`, `SET LOCAL ROLE ${role}; INSERT INTO account_warmup_settings(account_id) VALUES(gen_random_uuid());`, /row-level security|permission denied/);
  sqlTest(`${role} cannot execute privileged reconciliation`, `SET LOCAL ROLE ${role}; SELECT reconcile_inherited_warmup_package_v1(gen_random_uuid());`, /permission denied for function/);
  sqlTest(`${role} cannot read migration receipts`, `SET LOCAL ROLE ${role}; SELECT * FROM account_warmup_package_inheritance_receipts;`, /permission denied/);
}
sqlTest('service role reads receipts but cannot write directly', `INSERT INTO account_warmup_package_inheritance_receipts(account_id,package_id,applied_at,day_4_plus_follow_cap) VALUES(gen_random_uuid(),gen_random_uuid(),now(),80);`, /permission denied/);
sqlTest('cross-tenant subscription binding is rejected', `DO $$ DECLARE a uuid; b uuid; BEGIN
 a:=pg_temp.seed_account('tenant_a','growth',80,false); b:=pg_temp.seed_account('tenant_b','growth',80,false);
 INSERT INTO client_subscription_accounts(subscription_id,client_instagram_account_id,account_id)
 SELECT md5('subscription:tenant_a')::uuid,md5('client-account:tenant_b')::uuid,b;
END $$;`, /must belong to the same client/);
sqlTest('reconciling account A leaves tenant B unchanged', `DO $$ DECLARE a uuid; b uuid; old_b jsonb; BEGIN
 a:=pg_temp.seed_account('isolation_a','growth',80,false); b:=pg_temp.seed_account('isolation_b','growth',80,true);
 SELECT to_jsonb(w) INTO old_b FROM account_warmup_settings w WHERE account_id=b;
 PERFORM pg_temp.change_package(a,'pro');
 PERFORM pg_temp.assert_true((SELECT to_jsonb(w)=old_b FROM account_warmup_settings w WHERE account_id=b),'cross-account write');
END $$;`);

for(const [name,alteration,error] of [
 ['column','ALTER TABLE account_warmup_package_inheritance_receipts ADD COLUMN incompatible_fixture text;',/warmup_receipt_schema_incompatible/],
 ['type','ALTER TABLE account_warmup_package_inheritance_receipts ALTER COLUMN applied_at TYPE text;',/warmup_receipt_schema_incompatible/],
 ['trigger','ALTER TABLE account_commercial_packages DISABLE TRIGGER warmup_package_transition_v1;',/warmup_migration_trigger_incompatible/],
]) sqlTest(`incompatible ${name} fails closed`, `RESET ROLE; SET LOCAL ROLE postgres; ${alteration}\n${migration}`,error);

sqlTest('N migration replays are accepted with real dependencies', `RESET ROLE; SET LOCAL ROLE postgres;\n${migration}\n${migration}\n${migration}`);
