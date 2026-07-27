-- Preserve a safe partial phase plan as a first-class canonical resume state.
-- Worker code has emitted this state since the phase-aware contract shipped;
-- the previous database check constraint rejected it and left the durable plan
-- stuck at run_active even though the run summary was correctly resumable.

alter table public.account_session_resume_plans
  drop constraint if exists account_session_resume_plans_resume_state_check;

alter table public.account_session_resume_plans
  add constraint account_session_resume_plans_resume_state_check
  check (
    resume_state = any (
      array[
        'run_active'::text,
        'partial_resumable'::text,
        'awaiting_human_resume_authorization'::text,
        'resume_requested'::text,
        'resume_succeeded'::text,
        'not_recoverable'::text,
        'completed'::text
      ]
    )
  );
