-- Reconcile terminal runs whose canonical plan remained run_active because an
-- older resume_state constraint rejected the final partial_resumable write.
--
-- Fail closed: only a terminal run carrying a fully explicit safe resume plan
-- (restart allowed, positive remaining quota, at least one enabled phase and
-- no unsafe markers) is made eligible.  Unknown or contradictory rows remain
-- untouched for investigation.

with safe_terminal_plans as (
  select
    p.id as resume_plan_id,
    r.performance_summary -> 'auto_restart_resume_plan' as final_plan
  from public.account_session_resume_plans p
  join public.ig_runs r on r.id = p.run_id
  where p.resume_state = 'run_active'
    and r.status in ('completed', 'failed', 'blocked', 'cancelled')
    and jsonb_typeof(r.performance_summary -> 'auto_restart_resume_plan') = 'object'
    and lower(
      coalesce(r.performance_summary -> 'auto_restart_resume_plan' ->> 'restart_allowed', '')
    ) = 'true'
    and case
      when coalesce(
        r.performance_summary -> 'auto_restart_resume_plan' -> 'quota_remaining' ->> 'total',
        ''
      ) ~ '^[0-9]+$'
        then (
          r.performance_summary -> 'auto_restart_resume_plan' -> 'quota_remaining' ->> 'total'
        )::integer > 0
      else false
    end
    and (
      lower(coalesce(
        r.performance_summary -> 'auto_restart_resume_plan' -> 'phases_to_run' ->> 'welcome',
        ''
      )) = 'true'
      or lower(coalesce(
        r.performance_summary -> 'auto_restart_resume_plan' -> 'phases_to_run' ->> 'follow',
        ''
      )) = 'true'
      or lower(coalesce(
        r.performance_summary -> 'auto_restart_resume_plan' -> 'phases_to_run' ->> 'unfollow',
        ''
      )) = 'true'
    )
    and coalesce(
      jsonb_array_length(
        case
          when jsonb_typeof(r.performance_summary -> 'auto_restart_resume_plan' -> 'unsafe_markers') = 'array'
            then r.performance_summary -> 'auto_restart_resume_plan' -> 'unsafe_markers'
          else '[]'::jsonb
        end
      ),
      0
    ) = 0
)
update public.account_session_resume_plans p
set
  resume_stage = 'phases',
  resume_state = 'partial_resumable',
  restart_allowed = true,
  restart_block_reason = coalesce(s.final_plan ->> 'restart_block_reason', ''),
  plan = coalesce(p.plan, '{}'::jsonb) || s.final_plan,
  last_updated_at = now()
from safe_terminal_plans s
where p.id = s.resume_plan_id;
