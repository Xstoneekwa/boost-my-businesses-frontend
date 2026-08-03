begin;

alter table public.ig_runs
  add column if not exists live_counter_revision bigint not null default 0;

alter table public.ig_runs
  drop constraint if exists ig_runs_live_counter_revision_nonnegative;

alter table public.ig_runs
  add constraint ig_runs_live_counter_revision_nonnegative
  check (live_counter_revision >= 0);

create or replace function public.bump_ig_run_live_counter_revision_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (new.total_follow, new.total_like, new.total_dm, new.total_story)
     is distinct from
     (old.total_follow, old.total_like, old.total_dm, old.total_story) then
    new.live_counter_revision := greatest(
      coalesce(old.live_counter_revision, 0) + 1,
      coalesce(new.live_counter_revision, 0)
    );
  else
    new.live_counter_revision := coalesce(old.live_counter_revision, 0);
  end if;
  return new;
end;
$function$;

revoke all on function public.bump_ig_run_live_counter_revision_v1() from public, anon, authenticated;
grant execute on function public.bump_ig_run_live_counter_revision_v1() to service_role;

drop trigger if exists ig_runs_live_counter_revision_v1 on public.ig_runs;
create trigger ig_runs_live_counter_revision_v1
before update of total_follow, total_like, total_dm, total_story
on public.ig_runs
for each row
execute function public.bump_ig_run_live_counter_revision_v1();

commit;
