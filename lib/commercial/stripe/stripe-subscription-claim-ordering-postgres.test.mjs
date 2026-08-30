import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const INITDB = "/opt/homebrew/bin/initdb";
const PG_CTL = "/opt/homebrew/bin/pg_ctl";
const PSQL = "/opt/homebrew/bin/psql";

const CLIENT = "10000000-0000-4000-8000-000000000001";
const ACCOUNT = "20000000-0000-4000-8000-000000000002";
const OTHER_ACCOUNT = "20000000-0000-4000-8000-000000000099";
const SOURCE = "30000000-0000-4000-8000-000000000003";
const REPLACEMENT = "30000000-0000-4000-8000-000000000004";
const AUTHORIZATION = "40000000-0000-4000-8000-000000000005";
const ATTEMPT = "50000000-0000-4000-8000-000000000006";
const CHECKOUT = "60000000-0000-4000-8000-000000000007";
const SUBSCRIPTION = "sub_claim_ordering_test";
const CUSTOMER = "cus_claim_ordering_test";
const PRICE = "price_premium_test";
const EVENT = "evt_checkout_completed_test";

function psqlArgs(port, sql) {
  return ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-c", sql];
}

async function query(port, sql) {
  const { stdout } = await execFileAsync(PSQL, psqlArgs(port, sql));
  return stdout.trim();
}

function call(overrides = {}) {
  const value = {
    attempt: ATTEMPT,
    client: CLIENT,
    account: ACCOUNT,
    source: SOURCE,
    replacement: REPLACEMENT,
    authorization: AUTHORIZATION,
    subscription: SUBSCRIPTION,
    customer: CUSTOMER,
    price: PRICE,
    checkout: "cs_claim_ordering_test",
    event: EVENT,
    livemode: false,
    metadataClient: CLIENT,
    metadataAccount: ACCOUNT,
    metadataSource: SOURCE,
    metadataKind: "simulated_to_stripe_test",
    metadataMode: "stripe_test",
    metadataAuthorization: AUTHORIZATION,
    ...overrides,
  };
  return `set local role service_role; select public.reconcile_simulated_to_stripe_test_v2(
    '${value.attempt}', '${value.client}', '${value.account}', '${value.source}', '${value.replacement}', '${value.authorization}',
    '${value.subscription}', '${value.customer}', '${value.price}', '${value.checkout}', '${value.event}', ${value.livemode},
    '${value.metadataClient}', '${value.metadataAccount}', '${value.metadataSource}', '${value.metadataKind}',
    '${value.metadataMode}', '${value.metadataAuthorization}')::text`;
}

async function seed(port, { projection = "unbound", duplicatePackage = false } = {}) {
  await query(port, `
    truncate table public.commercial_stripe_entitlement_migrations,
      public.commercial_stripe_subscriptions,
      public.account_commercial_packages,
      public.client_account_entitlements,
      public.commercial_stripe_migration_authorizations,
      public.commercial_stripe_checkout_attempts,
      public.client_instagram_accounts,
      public.ig_accounts restart identity cascade;
    insert into public.ig_accounts(id) values ('${ACCOUNT}'),('${OTHER_ACCOUNT}');
    insert into public.client_instagram_accounts(client_id,account_id) values ('${CLIENT}','${ACCOUNT}');
    insert into public.commercial_stripe_checkout_attempts(
      id,client_id,account_id,stripe_checkout_session_id,stripe_subscription_id,checkout_mode,
      commercial_test_mode,status,metadata_safe,payment_confirmed_at,created_at,commercial_checkout_session_id
    ) values (
      '${ATTEMPT}','${CLIENT}','${ACCOUNT}','cs_claim_ordering_test','${SUBSCRIPTION}','subscription',
      'stripe_test','reconciliation_required',jsonb_build_object(
        'source_entitlement_id','${SOURCE}',
        'commercial_migration_kind','simulated_to_stripe_test',
        'commercial_migration_authorization_id','${AUTHORIZATION}'
      ),'2026-08-30T19:01:43Z','2026-08-30T18:56:00Z','${CHECKOUT}'
    );
    insert into public.commercial_stripe_migration_authorizations(
      id,client_id,account_id,source_entitlement_id,migration_kind,commercial_test_mode,status,expires_at
    ) values ('${AUTHORIZATION}','${CLIENT}','${ACCOUNT}','${SOURCE}','simulated_to_stripe_test','stripe_test','authorized','2026-08-30T19:54:48Z');
    insert into public.client_account_entitlements(
      id,client_id,account_id,status,plan_key,commercial_package_code,checkout_session_id,metadata,created_at,updated_at
    ) values
      ('${SOURCE}','${CLIENT}','${ACCOUNT}','entitlement_consumed','premium','premium','${CHECKOUT}',
       '{"checkout_mode":"simulated","billing_excluded":true}',now(),now()),
      ('${REPLACEMENT}','${CLIENT}',null,'entitlement_reserved','premium','premium','${CHECKOUT}',
       '{"checkout_mode":"stripe","billing_excluded":false}',now(),now());
    insert into public.account_commercial_packages(id,account_id,package_code,status,starts_at,ends_at)
      values (gen_random_uuid(),'${ACCOUNT}','premium','active','2026-08-25T17:28:59Z',null);
    ${duplicatePackage ? `insert into public.account_commercial_packages(id,account_id,package_code,status,starts_at,ends_at) values (gen_random_uuid(),'${ACCOUNT}','premium','active','2026-08-26T17:28:59Z',null);` : ""}
    ${projection === "none" ? "" : `insert into public.commercial_stripe_subscriptions(
      id,client_id,stripe_subscription_id,stripe_customer_id,stripe_price_id,status,livemode,account_id,metadata_safe
    ) values (gen_random_uuid(),'${CLIENT}','${SUBSCRIPTION}','${CUSTOMER}','${PRICE}','active',false,
      ${projection === "foreign" ? `'${OTHER_ACCOUNT}'` : "null"},'{}');`}
  `);
}

test("Stripe subscription claim ordering is atomic, idempotent, and cross-account fail-closed", { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "stripe-claim-ordering-pg-"));
  const dataDir = path.join(root, "data");
  const socketDir = path.join(root, "socket");
  const logPath = path.join(root, "postgres.log");
  const bootstrapPath = path.join(root, "bootstrap.sql");
  const port = 56200 + Math.floor(Math.random() * 300);
  const migrationPath = new URL("../../../supabase/migrations/20260830191718_commercial_stripe_subscription_claim_binding_ordering_v1.sql", import.meta.url);
  const bootstrap = `
    create extension if not exists pgcrypto;
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
    create schema private;
    create table public.ig_accounts(id uuid primary key);
    create table public.client_instagram_accounts(client_id uuid not null, account_id uuid not null);
    create table public.commercial_stripe_checkout_attempts(
      id uuid primary key, client_id uuid, account_id uuid, stripe_checkout_session_id text,
      stripe_subscription_id text, checkout_mode text, commercial_test_mode text, status text,
      metadata_safe jsonb default '{}', payment_confirmed_at timestamptz, created_at timestamptz,
      commercial_checkout_session_id uuid
    );
    create table public.client_account_entitlements(
      id uuid primary key, client_id uuid, account_id uuid, status text, plan_key text,
      commercial_package_code text, checkout_session_id uuid, metadata jsonb default '{}',
      consumed_at timestamptz, created_at timestamptz, updated_at timestamptz
    );
    create table public.commercial_stripe_migration_authorizations(
      id uuid primary key, client_id uuid, account_id uuid, source_entitlement_id uuid,
      migration_kind text, commercial_test_mode text, status text, expires_at timestamptz,
      consumed_at timestamptz, updated_at timestamptz
    );
    create table public.commercial_stripe_subscriptions(
      id uuid primary key default gen_random_uuid(), client_id uuid, stripe_subscription_id text unique, stripe_customer_id text,
      stripe_price_id text, status text, livemode boolean, client_account_entitlement_id uuid,
      account_id uuid, commercial_checkout_session_id uuid, commercial_mode text, pricing_mode text,
      metadata_safe jsonb default '{}', updated_at timestamptz
    );
    create table public.commercial_stripe_entitlement_migrations(
      id uuid primary key default gen_random_uuid(), client_id uuid, account_id uuid,
      source_entitlement_id uuid unique, replacement_entitlement_id uuid unique,
      authorization_id uuid, migration_kind text, state text, package_code text,
      stripe_subscription_id text, stripe_customer_id text, stripe_price_id text,
      stripe_checkout_session_id text, stripe_event_id text, completed_at timestamptz,
      metadata_safe jsonb default '{}'
    );
    create table public.account_commercial_packages(
      id uuid primary key, account_id uuid, package_code text, status text,
      starts_at timestamptz, ends_at timestamptz
    );
  `;
  await execFileAsync(INITDB, ["-D", dataDir, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  await execFileAsync("/bin/mkdir", ["-p", socketDir]);
  await execFileAsync(PG_CTL, ["-D", dataDir, "-l", logPath, "-o", `-p ${port} -k ${socketDir}`, "-w", "start"]);
  t.after(async () => {
    await execFileAsync(PG_CTL, ["-D", dataDir, "-m", "fast", "-w", "stop"]).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(bootstrapPath, bootstrap);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", bootstrapPath]);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", migrationPath.pathname]);

  // A/C: subscription.created or subscription.updated first leaves one unbound
  // projection. checkout.session.completed claims it and switches entitlements.
  await seed(port, { projection: "unbound" });
  const first = JSON.parse(await query(port, `begin; ${call()}; commit;`));
  assert.equal(first.ok, true);
  assert.equal(first.unbound_projection_claimed, true);
  assert.equal(await query(port, `select account_id from public.commercial_stripe_subscriptions where stripe_subscription_id='${SUBSCRIPTION}'`), ACCOUNT);
  assert.equal(await query(port, `select status from public.client_account_entitlements where id='${SOURCE}'`), "entitlement_cancelled");
  assert.equal(await query(port, `select status from public.client_account_entitlements where id='${REPLACEMENT}'`), "entitlement_consumed");

  // E/F/G: duplicate subscription delivery and checkout replay remain one logical
  // result; later subscription projections cannot erase the bound account.
  const replay = JSON.parse(await query(port, `begin; ${call()}; commit;`));
  assert.equal(replay.idempotent_replay, true);
  assert.equal(await query(port, `select count(*) from public.commercial_stripe_subscriptions where stripe_subscription_id='${SUBSCRIPTION}'`), "1");
  assert.equal(await query(port, `select count(*) from public.commercial_stripe_entitlement_migrations where source_entitlement_id='${SOURCE}'`), "1");

  // B: checkout.session.completed first transactionally seeds and binds the
  // projection without waiting for subscription.created.
  await seed(port, { projection: "none" });
  assert.equal(JSON.parse(await query(port, `begin; ${call()}; commit;`)).ok, true);
  assert.equal(await query(port, `select account_id from public.commercial_stripe_subscriptions where stripe_subscription_id='${SUBSCRIPTION}'`), ACCOUNT);

  // H: a real non-null foreign account remains a hard conflict.
  await seed(port, { projection: "foreign" });
  await assert.rejects(query(port, `begin; ${call()}; commit;`), /stripe_subscription_cross_account_conflict/);
  assert.equal(await query(port, `select account_id from public.commercial_stripe_subscriptions where stripe_subscription_id='${SUBSCRIPTION}'`), OTHER_ACCOUNT);

  // Normal (non-migration) Stripe Test ordering uses the same generic account
  // invariant: NULL can become the exact checkout target, but a real owner can
  // never be replaced by another account.
  await seed(port, { projection: "unbound" });
  await query(port, `update public.commercial_stripe_subscriptions set account_id='${ACCOUNT}' where stripe_subscription_id='${SUBSCRIPTION}'`);
  assert.equal(await query(port, `select account_id from public.commercial_stripe_subscriptions where stripe_subscription_id='${SUBSCRIPTION}'`), ACCOUNT);
  await assert.rejects(
    query(port, `update public.commercial_stripe_subscriptions set account_id='${OTHER_ACCOUNT}' where stripe_subscription_id='${SUBSCRIPTION}'`),
    /stripe_subscription_cross_account_conflict/,
  );

  // I/J/K/L/M: every Stripe metadata dimension is mandatory and exact.
  for (const mismatch of [
    { metadataAccount: OTHER_ACCOUNT },
    { metadataClient: "10000000-0000-4000-8000-000000000099" },
    { metadataSource: "30000000-0000-4000-8000-000000000099" },
    { metadataKind: "historical_tracker" },
    { subscription: "sub_historical_tracker", metadataAccount: OTHER_ACCOUNT },
  ]) {
    await seed(port, { projection: "unbound" });
    await assert.rejects(query(port, `begin; ${call(mismatch)}; commit;`), /stripe_subscription_metadata_mismatch/);
    assert.equal(await query(port, `select account_id is null from public.commercial_stripe_subscriptions limit 1`), "t");
  }

  // N: the database identity itself rejects a second possible projection.
  await seed(port, { projection: "unbound" });
  await assert.rejects(query(port, `insert into public.commercial_stripe_subscriptions(
    id,client_id,stripe_subscription_id,stripe_customer_id,stripe_price_id,status,livemode,account_id
  ) values (gen_random_uuid(),'${CLIENT}','${SUBSCRIPTION}','${CUSTOMER}','${PRICE}','active',false,null)`), /duplicate key/);

  // Atomicity: a late cardinality failure rolls the claim and entitlement switch
  // back together.
  await seed(port, { projection: "unbound", duplicatePackage: true });
  await assert.rejects(query(port, `begin; ${call()}; commit;`), /post_reconciliation_cardinality_violation/);
  assert.equal(await query(port, `select account_id is null from public.commercial_stripe_subscriptions where stripe_subscription_id='${SUBSCRIPTION}'`), "t");
  assert.equal(await query(port, `select status from public.client_account_entitlements where id='${SOURCE}'`), "entitlement_consumed");
  assert.equal(await query(port, `select status from public.client_account_entitlements where id='${REPLACEMENT}'`), "entitlement_reserved");
});
