begin;

alter table public.follow_60s_canary_controls
  drop constraint follow_60s_canary_controls_counts_check;

alter table public.follow_60s_canary_controls
  add constraint follow_60s_canary_controls_counts_check
  check (
    baseline_follow_count between 0 and 50
    and evaluation_increment between 1 and 50
    and target_follow_count between 1 and 50
    and baseline_follow_count + evaluation_increment <= target_follow_count
  );

commit;
