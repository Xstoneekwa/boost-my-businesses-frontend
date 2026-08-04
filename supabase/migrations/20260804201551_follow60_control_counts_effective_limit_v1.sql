begin;

alter table public.follow_60s_canary_controls
  drop constraint follow_60s_canary_controls_counts_check;

alter table public.follow_60s_canary_controls
  add constraint follow_60s_canary_controls_counts_check
  check (
    baseline_follow_count >= 0
    and evaluation_increment between 1 and 50
    and target_follow_count >= 1
    and baseline_follow_count + evaluation_increment <= target_follow_count
  );

comment on constraint follow_60s_canary_controls_counts_check
  on public.follow_60s_canary_controls is
  'Structural Follow60 counter invariants. The authoritative account/day ceiling is enforced transactionally by create_or_rearm_follow_60s_canary_control_v1.';

commit;
