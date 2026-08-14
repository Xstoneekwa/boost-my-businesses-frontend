-- Future-only commercial lifecycle transition evidence for the canonical client email outbox.
--
-- Deliberately no backfill: historical completed operations (including the first Tracker Pause)
-- must not create retroactive email episodes when this migration is deployed.

create unique index if not exists ig_action_logs_commercial_lifecycle_operation_evidence_uidx
  on public.ig_action_logs ((payload ->> 'commercial_lifecycle_operation_id'))
  where action_type = 'account_admin_status_changed'
    and payload ? 'commercial_lifecycle_operation_id';

create or replace function public.project_commercial_lifecycle_email_transition_evidence_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_message text;
begin
  if old.state is not distinct from new.state or new.state <> 'completed' then
    return new;
  end if;

  v_message := case new.operation_type
    when 'pause' then 'account_paused'
    when 'resume' then 'account_reactivated'
    when 'cancel' then 'account_cancelled'
    else null
  end;

  if v_message is null then
    return new;
  end if;

  insert into public.ig_action_logs (
    account_id,
    run_id,
    target_username,
    action_type,
    status,
    message,
    payload,
    created_at
  ) values (
    new.account_id,
    null,
    null,
    'account_admin_status_changed',
    'success',
    v_message,
    jsonb_build_object(
      'commercial_lifecycle_operation_id', new.id,
      'commercial_lifecycle_operation_type', new.operation_type,
      'transition_evidence_version', 1,
      'source', 'commercial_account_lifecycle_operations.completed'
    ),
    coalesce(new.updated_at, now())
  ) on conflict do nothing;

  return new;
end;
$function$;

revoke all on function public.project_commercial_lifecycle_email_transition_evidence_v1() from public;
revoke all on function public.project_commercial_lifecycle_email_transition_evidence_v1() from anon;
revoke all on function public.project_commercial_lifecycle_email_transition_evidence_v1() from authenticated;

drop trigger if exists commercial_lifecycle_email_transition_evidence_v1
  on public.commercial_account_lifecycle_operations;

create trigger commercial_lifecycle_email_transition_evidence_v1
after update of state on public.commercial_account_lifecycle_operations
for each row
execute function public.project_commercial_lifecycle_email_transition_evidence_v1();

comment on function public.project_commercial_lifecycle_email_transition_evidence_v1() is
  'Projects future completed commercial lifecycle transitions into the canonical account_admin_status_changed evidence stream. No historical backfill.';
