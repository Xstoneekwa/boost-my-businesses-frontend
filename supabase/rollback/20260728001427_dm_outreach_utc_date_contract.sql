-- Pre-migration function contract captured from production before
-- 20260728001427_dm_outreach_sast_business_date_v1.
-- This file is evidence/rollback material only and must never be applied as a
-- forward migration: it restores the obsolete UTC daily boundary.

alter table public.ig_account_dm_counters
  alter column counter_date
  set default (timezone('utc', now()))::date;

create or replace function public.ensure_dm_counter_row(
  p_account_id uuid,
  p_counter_date date default (timezone('utc', now()))::date
)
returns public.ig_account_dm_counters
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.ig_account_dm_counters;
begin
  insert into public.ig_account_dm_counters (account_id, counter_date)
  values (p_account_id, p_counter_date)
  on conflict (account_id, counter_date) do nothing;

  select * into v_row
  from public.ig_account_dm_counters
  where account_id = p_account_id
    and counter_date = p_counter_date;

  return v_row;
end;
$function$;

-- The former complete_dm_job body is represented by its exact contract-changing
-- fragment below. The full pre-change pg_get_functiondef output was captured in
-- the delivery audit before any DDL was executed.
--
-- declare
--   v_job public.ig_dm_jobs;
--   v_counter public.ig_account_dm_counters;
--   v_today date := (timezone('utc', now()))::date;
-- ...
-- v_counter := public.ensure_dm_counter_row(v_job.account_id, v_today);

grant execute on function public.ensure_dm_counter_row(uuid, date) to public, anon, authenticated, service_role;
grant execute on function public.complete_dm_job(uuid, public.dm_job_status, text, text, boolean, integer, jsonb) to public, anon, authenticated, service_role;
