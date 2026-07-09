-- CP4 late preflight: accept preflight_ready until business_action_deadline.
-- T-10 rows still use expires_at = session_start; late rows use business_action_deadline.

create or replace function public.get_valid_scheduled_session_preflight(
  p_account_id uuid,
  p_assignment_id uuid,
  p_device_id uuid,
  p_app_instance_id uuid,
  p_expected_package text,
  p_scheduled_window_start timestamptz,
  p_scheduled_window_end timestamptz,
  p_now timestamptz default now()
)
returns public.scheduled_session_preflights
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scheduled_session_preflights%rowtype;
begin
  select * into v_row
  from public.scheduled_session_preflights
  where account_id = p_account_id
    and assignment_id = p_assignment_id
    and device_id = p_device_id
    and app_instance_id = p_app_instance_id
    and expected_package = coalesce(p_expected_package, '')
    and scheduled_window_start = p_scheduled_window_start
    and scheduled_window_end = p_scheduled_window_end
    and status = 'preflight_ready'
    and business_action_deadline > p_now
  limit 1;
  return v_row;
end;
$$;

revoke all on function public.get_valid_scheduled_session_preflight from public;
grant execute on function public.get_valid_scheduled_session_preflight to service_role;
