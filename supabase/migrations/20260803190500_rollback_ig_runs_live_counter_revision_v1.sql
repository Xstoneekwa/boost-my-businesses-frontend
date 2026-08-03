begin;

drop trigger if exists ig_runs_live_counter_revision_v1 on public.ig_runs;
drop function if exists public.bump_ig_run_live_counter_revision_v1();
alter table public.ig_runs drop constraint if exists ig_runs_live_counter_revision_nonnegative;
alter table public.ig_runs drop column if exists live_counter_revision;

commit;
