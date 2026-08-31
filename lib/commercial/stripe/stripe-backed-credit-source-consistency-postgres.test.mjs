import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const INITDB = "/opt/homebrew/bin/initdb";
const PG_CTL = "/opt/homebrew/bin/pg_ctl";
const PSQL = "/opt/homebrew/bin/psql";

const CLIENT = "10000000-0000-4000-8000-000000000001";
const ACCOUNT = "20000000-0000-4000-8000-000000000002";
const SOURCE = "30000000-0000-4000-8000-000000000003";
const REPLACEMENT = "30000000-0000-4000-8000-000000000004";
const SOURCE_SESSION = "40000000-0000-4000-8000-000000000005";
const NEW_SESSION = "40000000-0000-4000-8000-000000000006";
const QUOTE = "50000000-0000-4000-8000-000000000007";
const SUBSCRIPTION = "sub_credit_consistency";
const PRICE = "price_pro_3m";
const EVENT = "evt_credit_consistency";
const IDEMPOTENCY = `${ACCOUNT}:pro:credit-consistency`;

function psqlArgs(port, sql) {
  return ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-c", sql];
}

async function query(port, sql) {
  const { stdout } = await execFileAsync(PSQL, psqlArgs(port, sql));
  return stdout.trim();
}

function activateCall(overrides = {}) {
  const value = {
    event: EVENT,
    subscription: SUBSCRIPTION,
    price: PRICE,
    quotedCredit: 26_967,
    actualCredit: 13_585,
    ...overrides,
  };
  return `set local role service_role; select public.activate_stripe_commercial_plan_change_per_account_v1(
    '${QUOTE}', '${IDEMPOTENCY}', '${value.event}', '${value.subscription}', '${value.price}',
    ${value.quotedCredit}, 'pending_invoice_items', 0, ${value.actualCredit}, -${value.actualCredit},
    53190, '2026-08-25T17:28:59Z', '2026-11-25T17:28:59Z',
    '["ii_growth_unused","ii_pro_remaining"]'::jsonb, '2026-08-31T14:20:01Z')::text`;
}

test("Stripe-backed activation compiles, converges exact cents and replays idempotently", { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp("/private/tmp/stripe-credit-pg-");
  const dataDir = path.join(root, "data");
  const socketDir = path.join(root, "socket");
  const logPath = path.join(root, "postgres.log");
  const bootstrapPath = path.join(root, "bootstrap.sql");
  const port = 56500 + Math.floor(Math.random() * 250);
  const migrationPath = new URL("../../../supabase/migrations/20260831153633_stripe_backed_credit_source_consistency_v1.sql", import.meta.url);
  const bootstrap = `
    create extension if not exists pgcrypto;
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

    create table public.commercial_plan_change_quotes(
      id uuid primary key, client_id uuid, account_id uuid, change_scope text,
      idempotency_key text unique, existing_customer_credit_cents integer,
      metadata jsonb default '{}', status text, provider_transaction_id text,
      actual_stripe_remaining_credit_cents integer, actual_stripe_source text,
      source_entitlement_id uuid, source_checkout_session_id uuid,
      active_commercial_period_value_cents integer, source_revision text,
      quote_expires_at timestamptz, payment_provider text, payment_status text,
      payment_confirmed_at timestamptz, updated_at timestamptz,
      activated_checkout_session_id uuid, currency text default 'EUR'
    );
    create table public.commercial_stripe_webhook_events(
      id uuid primary key default gen_random_uuid(), stripe_event_id text unique,
      event_type text, livemode boolean, stripe_subscription_id text, status text
    );
    create table public.commercial_stripe_subscriptions(
      id uuid primary key default gen_random_uuid(), client_id uuid,
      account_id uuid, plan_change_quote_id uuid, stripe_subscription_id text unique,
      stripe_price_id text, status text, livemode boolean
    );
    create table public.client_credit_ledger(
      id uuid primary key default gen_random_uuid(), client_id uuid, account_id uuid,
      source_entitlement_id uuid, currency text, entry_type text, direction text,
      amount_cents integer, balance_after_cents integer, source_quote_id uuid,
      source_checkout_session_id uuid, idempotency_key text unique, metadata jsonb default '{}'
    );

    create function public.account_scoped_credit_balance_cents(uuid, uuid, text)
    returns integer language sql stable as $$
      select coalesce(sum(case when direction='credit' then amount_cents else -amount_cents end),0)::integer
      from public.client_credit_ledger where client_id=$1 and account_id=$2 and currency=$3
    $$;
    create function public.commercial_plan_change_source_revision_for_account_source(uuid, uuid, uuid, integer)
    returns text language sql stable as $$ select 'source-revision'::text $$;

    create function public.activate_commercial_plan_change_per_account(uuid, text, text, boolean)
    returns jsonb language plpgsql security definer as $$
    declare v_quote public.commercial_plan_change_quotes%rowtype; v_balance integer;
    begin
      select * into v_quote from public.commercial_plan_change_quotes where id=$1 for update;
      v_balance := public.account_scoped_credit_balance_cents(v_quote.client_id,v_quote.account_id,'EUR');
      if v_balance <> v_quote.existing_customer_credit_cents then
        return jsonb_build_object('ok',false,'code','credit_balance_changed');
      end if;
      insert into public.client_credit_ledger(client_id,account_id,source_entitlement_id,currency,entry_type,direction,amount_cents,balance_after_cents,source_quote_id,source_checkout_session_id,idempotency_key)
      values(v_quote.client_id,v_quote.account_id,v_quote.source_entitlement_id,'EUR','proration_credit_generated','credit',39343,v_balance+39343,v_quote.id,v_quote.source_checkout_session_id,$2||':proration_credit');
      insert into public.client_credit_ledger(client_id,account_id,source_entitlement_id,currency,entry_type,direction,amount_cents,balance_after_cents,source_quote_id,source_checkout_session_id,idempotency_key)
      values(v_quote.client_id,v_quote.account_id,'${REPLACEMENT}','EUR','plan_change_credit_applied','debit',52725,v_balance+39343-52725,v_quote.id,'${NEW_SESSION}',$2||':credit_applied');
      update public.commercial_plan_change_quotes set status='quote_activated',activated_checkout_session_id='${NEW_SESSION}' where id=$1;
      return jsonb_build_object('ok',true,'idempotent_replay',false,'quote_id',$1,'checkout_session_id','${NEW_SESSION}','entitlement_id','${REPLACEMENT}','client_id',v_quote.client_id,'account_id',v_quote.account_id);
    end $$;

    create function public.reconcile_plan_change_stripe_financial_actual_v1(
      uuid,text,text,integer,integer,integer,integer,timestamptz,timestamptz,jsonb,timestamptz
    ) returns jsonb language plpgsql security definer as $$
    begin
      update public.commercial_plan_change_quotes
      set actual_stripe_remaining_credit_cents=$5,actual_stripe_source=$3
      where id=$1 and status='quote_activated';
      return jsonb_build_object('ok',found);
    end $$;

    insert into public.commercial_plan_change_quotes(
      id,client_id,account_id,change_scope,idempotency_key,existing_customer_credit_cents,
      metadata,status,provider_transaction_id,actual_stripe_remaining_credit_cents,actual_stripe_source,
      source_entitlement_id,source_checkout_session_id,active_commercial_period_value_cents,source_revision,
      quote_expires_at,payment_provider,payment_status,payment_confirmed_at,updated_at,activated_checkout_session_id,currency
    ) values(
      '${QUOTE}','${CLIENT}','${ACCOUNT}','per_account','${IDEMPOTENCY}',26967,
      jsonb_build_object('canonical_target_stripe_price_id','${PRICE}'),'quote_stale','${SUBSCRIPTION}',
      null,null,'${SOURCE}','${SOURCE_SESSION}',39690,'source-revision',
      '2026-08-31T14:34:00Z','stripe','confirmed','2026-08-31T14:20:00Z','2026-08-31T14:20:23Z',null,'EUR'
    );
    insert into public.commercial_stripe_webhook_events(stripe_event_id,event_type,livemode,stripe_subscription_id,status)
    values('${EVENT}','customer.subscription.updated',false,'${SUBSCRIPTION}','processing');
    insert into public.commercial_stripe_subscriptions(client_id,account_id,plan_change_quote_id,stripe_subscription_id,stripe_price_id,status,livemode)
    values('${CLIENT}','${ACCOUNT}','${QUOTE}','${SUBSCRIPTION}','${PRICE}','active',false);
    insert into public.client_credit_ledger(client_id,account_id,source_entitlement_id,currency,entry_type,direction,amount_cents,balance_after_cents,source_quote_id,source_checkout_session_id,idempotency_key)
    values('${CLIENT}','${ACCOUNT}','${SOURCE}','EUR','manual_adjustment','credit',26976,26976,'${QUOTE}','${SOURCE_SESSION}','historical-growth-credit');
  `;

  await execFileAsync(INITDB, [
    "-D", dataDir,
    "--no-locale",
    "--encoding=UTF8",
    "--auth=trust",
    "-c", "shared_memory_type=mmap",
    "-c", "dynamic_shared_memory_type=mmap",
  ]);
  await execFileAsync("/bin/mkdir", ["-p", socketDir]);
  await execFileAsync(PG_CTL, ["-D", dataDir, "-l", logPath, "-o", `-p ${port} -k ${socketDir}`, "-w", "start"]);
  t.after(async () => {
    await execFileAsync(PG_CTL, ["-D", dataDir, "-m", "fast", "-w", "stop"]).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(bootstrapPath, bootstrap);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", bootstrapPath]);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", migrationPath.pathname]);

  const adjustmentProbe = JSON.parse(await query(port, `begin; ${activateCall({ actualCredit: 13_584 })}; rollback;`));
  assert.equal(adjustmentProbe.ok, true);
  assert.equal(adjustmentProbe.actual_stripe_remaining_credit_cents, 13_584);

  const first = JSON.parse(await query(port, `begin; ${activateCall()}; commit;`));
  assert.equal(first.ok, true);
  assert.equal(first.idempotent_replay, false);
  assert.equal(await query(port, `select public.account_scoped_credit_balance_cents('${CLIENT}','${ACCOUNT}','EUR')`), "13585");
  assert.equal(await query(port, `select status from public.commercial_plan_change_quotes where id='${QUOTE}'`), "quote_activated");
  assert.equal(await query(port, `select actual_stripe_remaining_credit_cents from public.commercial_plan_change_quotes where id='${QUOTE}'`), "13585");
  assert.equal(
    await query(port, `select extract(epoch from quote_expires_at)::bigint from public.commercial_plan_change_quotes where id='${QUOTE}'`),
    "1788186840",
  );

  const replay = JSON.parse(await query(port, `begin; ${activateCall()}; commit;`));
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(await query(port, `select count(*) from public.client_credit_ledger where idempotency_key like '${IDEMPOTENCY}:%'`), "3");

  const wrongPrice = JSON.parse(await query(port, `begin; ${activateCall({ price: "price_wrong" })}; rollback;`));
  assert.equal(wrongPrice.ok, false);
  assert.equal(wrongPrice.code, "stripe_price_plan_lineage_mismatch");
});
