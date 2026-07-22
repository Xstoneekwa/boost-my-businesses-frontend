#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migration="$repo_dir/supabase/migrations/20260722100000_target_followers_progressive_resume_v2.sql"
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
  cat "$pg_log" >&2
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
grant select on table public.ig_targets to service_role;
SQL

"${psql[@]}" -f "$migration" >/dev/null

"${psql[@]}" <<'SQL'
insert into public.ig_accounts(id) values ('00000000-0000-0000-0000-000000000001');
insert into public.ig_targets(id, account_id) values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001'
);

do $test$
declare
  claimed jsonb;
  conflict jsonb;
  committed jsonb;
  reset_result jsonb;
  version_after_claim bigint;
begin
  if not (
    select relrowsecurity from pg_class
    where oid = 'public.ig_target_followers_resume_checkpoints'::regclass
  ) then
    raise exception 'checkpoint RLS is not enabled';
  end if;
  if has_table_privilege('anon', 'public.ig_target_followers_resume_checkpoints', 'select') then
    raise exception 'anon unexpectedly has checkpoint select';
  end if;
  if has_function_privilege(
    'anon',
    'public.claim_target_followers_resume_checkpoint(uuid,uuid,text,text,uuid,text,bigint,integer)',
    'execute'
  ) then
    raise exception 'anon unexpectedly has claim execute';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.claim_target_followers_resume_checkpoint(uuid,uuid,text,text,uuid,text,bigint,integer)',
    'execute'
  ) then
    raise exception 'service_role lacks claim execute';
  end if;

  set local role service_role;
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

  conflict := public.claim_target_followers_resume_checkpoint(
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'neutral.target', 'followers',
    '20000000-0000-0000-0000-000000000002',
    'shadow', version_after_claim, 180
  );
  if conflict->>'reason' <> 'lease_held' then
    raise exception 'concurrent claim was not rejected: %', conflict;
  end if;

  conflict := public.commit_target_followers_resume_checkpoint(
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'followers', '20000000-0000-0000-0000-000000000001',
    'shadow', version_after_claim - 1, 1,
    'a2:111111111111111111111111',
    'v2:222222222222222222222222',
    '["a2:111111111111111111111111"]'::jsonb,
    '372.0.0.48.60', 'active', 'validated_transition'
  );
  if conflict->>'reason' <> 'optimistic_version_conflict' then
    raise exception 'stale CAS commit was not rejected: %', conflict;
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
  if (select shadow_last_safe_depth from public.ig_target_followers_resume_checkpoints) <> 1 then
    raise exception 'shadow depth not committed';
  end if;
  if (select last_safe_depth from public.ig_target_followers_resume_checkpoints) <> 0 then
    raise exception 'shadow commit changed enforce depth';
  end if;
  if (select count(*) from public.ig_target_followers_resume_checkpoint_events) <> 2 then
    raise exception 'unexpected audit event count';
  end if;

  set local role service_role;
  reset_result := public.reset_target_followers_resume_checkpoint(
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'followers', '20000000-0000-0000-0000-000000000001',
    (committed->>'optimistic_version')::bigint,
    'admin_reset', true, false
  );
  if not coalesce((reset_result->>'ok')::boolean, false) then
    raise exception 'reset failed: %', reset_result;
  end if;
end
$test$;
SQL

printf 'target followers resume migration verification: ok\n'
