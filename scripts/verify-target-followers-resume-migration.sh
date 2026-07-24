#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migration="$repo_dir/supabase/migrations/20260724215200_target_followers_progressive_resume_v2.sql"
pg_root="$(mktemp -d "/private/tmp/tfrv2pg.XXXXXX")"
pg_data="$pg_root/data"
pg_socket="$pg_root/socket"
pg_log="$pg_root/postgres.log"
mkdir -p "$pg_socket"

cleanup() {
  if [[ -d "$pg_data" ]]; then
    pg_ctl -D "$pg_data" -m fast stop >/dev/null 2>&1 || true
  fi
  rm -rf "$pg_root"
}
trap cleanup EXIT

initdb -D "$pg_data" --no-locale --encoding=UTF8 >/dev/null
if ! pg_ctl -D "$pg_data" -l "$pg_log" -o "-k $pg_socket -p 55442" start >/dev/null; then
  sed -n '1,160p' "$pg_log" >&2
  exit 1
fi

psql=(psql -X -v ON_ERROR_STOP=1 -h "$pg_socket" -p 55442 -d postgres)

"${psql[@]}" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create table public.ig_accounts (id uuid primary key);
create table public.ig_targets (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id)
);
SQL

# Repository migrations are rerunnable in an empty certification database.
"${psql[@]}" -f "$migration" >/dev/null
"${psql[@]}" -f "$migration" >/dev/null

"${psql[@]}" <<'SQL'
do $certification$
declare
  function_name text;
begin
  if (select count(*) from public.ig_target_followers_resume_checkpoints) <> 0 then
    raise exception 'migration invented a checkpoint';
  end if;
  if (select count(*) from public.ig_target_followers_resume_checkpoint_events) <> 0 then
    raise exception 'migration invented an event';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.ig_target_followers_resume_checkpoints'::regclass) then
    raise exception 'checkpoint RLS disabled';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.ig_target_followers_resume_checkpoint_events'::regclass) then
    raise exception 'event RLS disabled';
  end if;
  if has_table_privilege('anon', 'public.ig_target_followers_resume_checkpoints', 'select')
     or has_table_privilege('authenticated', 'public.ig_target_followers_resume_checkpoints', 'select') then
    raise exception 'client role can read checkpoints';
  end if;
  if has_table_privilege('service_role', 'public.ig_target_followers_resume_checkpoints', 'insert')
     or has_table_privilege('service_role', 'public.ig_target_followers_resume_checkpoints', 'update')
     or has_table_privilege('service_role', 'public.ig_target_followers_resume_checkpoint_events', 'update')
     or has_table_privilege('service_role', 'public.ig_target_followers_resume_checkpoint_events', 'delete') then
    raise exception 'service role bypasses atomic RPC or append-only event contract';
  end if;
  foreach function_name in array array[
    'get_target_followers_resume_checkpoint(uuid,uuid,text)',
    'claim_target_followers_resume_checkpoint(uuid,uuid,text,text,uuid,text,bigint,integer)',
    'commit_target_followers_resume_checkpoint(uuid,uuid,text,uuid,text,bigint,integer,text,text,jsonb,text,text,text)',
    'invalidate_target_followers_resume_checkpoint(uuid,uuid,text,uuid,bigint,text,text)',
    'reset_target_followers_resume_checkpoint(uuid,uuid,text,uuid,bigint,text,boolean,boolean)'
  ] loop
    if has_function_privilege('anon', 'public.' || function_name, 'execute')
       or has_function_privilege('authenticated', 'public.' || function_name, 'execute') then
      raise exception 'client execute leaked for %', function_name;
    end if;
    if not has_function_privilege('service_role', 'public.' || function_name, 'execute') then
      raise exception 'service execute missing for %', function_name;
    end if;
  end loop;
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like '%target_followers_resume_checkpoint%'
      and (not p.prosecdef or not ('search_path=""' = any(coalesce(p.proconfig, '{}'::text[]))))
  ) then
    raise exception 'RPC security definer or search_path contract failed';
  end if;
end
$certification$;

insert into public.ig_accounts(id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');
insert into public.ig_targets(id, account_id) values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001'
);

do $test$
declare
  result jsonb;
  claimed jsonb;
  committed jsonb;
  invalidated jsonb;
  reset_result jsonb;
  version_after_claim bigint;
begin
  set local role service_role;

  result := public.claim_target_followers_resume_checkpoint(
    '00000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'neutral.target', 'followers',
    '20000000-0000-0000-0000-000000000009',
    'shadow', null, 180
  );
  if result->>'reason' <> 'target_account_mismatch' then
    raise exception 'cross-account target was accepted: %', result;
  end if;

  claimed := public.claim_target_followers_resume_checkpoint(
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'neutral.target', 'followers',
    '20000000-0000-0000-0000-000000000001',
    'shadow', null, 180
  );
  if not coalesce((claimed->>'ok')::boolean, false) then
    raise exception 'initial claim failed: %', claimed;
  end if;
  version_after_claim := (claimed->>'optimistic_version')::bigint;

  result := public.claim_target_followers_resume_checkpoint(
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'neutral.target', 'followers',
    '20000000-0000-0000-0000-000000000002',
    'shadow', version_after_claim, 180
  );
  if result->>'reason' <> 'lease_held' then
    raise exception 'concurrent lease was not rejected: %', result;
  end if;

  result := public.commit_target_followers_resume_checkpoint(
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'followers', '20000000-0000-0000-0000-000000000001',
    'shadow', version_after_claim - 1, 1,
    'a2:111111111111111111111111',
    'v2:222222222222222222222222',
    '["a2:111111111111111111111111"]'::jsonb,
    '372.0.0.48.60', 'active', 'validated_transition'
  );
  if result->>'reason' <> 'optimistic_version_conflict' then
    raise exception 'stale CAS commit was accepted: %', result;
  end if;

  result := public.commit_target_followers_resume_checkpoint(
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'followers', '20000000-0000-0000-0000-000000000001',
    'shadow', version_after_claim, 2,
    null, null, '[]'::jsonb, null, 'active', 'unproven_jump'
  );
  if result->>'reason' <> 'unproven_depth_jump_rejected' then
    raise exception 'unproven depth jump was accepted: %', result;
  end if;

  committed := public.commit_target_followers_resume_checkpoint(
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'followers', '20000000-0000-0000-0000-000000000001',
    'shadow', version_after_claim, 1,
    'a2:111111111111111111111111',
    'v2:222222222222222222222222',
    '["a2:111111111111111111111111"]'::jsonb,
    '372.0.0.48.60', 'active', 'validated_transition'
  );
  if not coalesce((committed->>'ok')::boolean, false) then
    raise exception 'valid commit failed: %', committed;
  end if;

  reset role;
  if (select shadow_last_safe_depth from public.ig_target_followers_resume_checkpoints) <> 1
     or (select last_safe_depth from public.ig_target_followers_resume_checkpoints) <> 0 then
    raise exception 'shadow commit crossed into enforce state';
  end if;

  set local role service_role;
  invalidated := public.invalidate_target_followers_resume_checkpoint(
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'followers', '20000000-0000-0000-0000-000000000001',
    (committed->>'optimistic_version')::bigint,
    'target_changed', 'stale'
  );
  if not coalesce((invalidated->>'ok')::boolean, false) then
    raise exception 'invalidation failed: %', invalidated;
  end if;

  reset_result := public.reset_target_followers_resume_checkpoint(
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'followers', '20000000-0000-0000-0000-000000000001',
    (invalidated->>'optimistic_version')::bigint,
    'operator_reset', true, false
  );
  if not coalesce((reset_result->>'ok')::boolean, false) then
    raise exception 'reset failed: %', reset_result;
  end if;
end
$test$;

do $final$
begin
  if (select count(*) from public.ig_target_followers_resume_checkpoints) <> 1 then
    raise exception 'unexpected checkpoint count';
  end if;
  if (select count(*) from public.ig_target_followers_resume_checkpoint_events) <> 4 then
    raise exception 'append-only event count mismatch';
  end if;
  if exists (
    select 1 from public.ig_target_followers_resume_checkpoints
    where last_safe_depth <> 0 or shadow_last_safe_depth <> 0
  ) then
    raise exception 'reset did not return both tested depths to zero';
  end if;
end
$final$;
SQL

printf 'target followers resume migration verification: ok\n'
