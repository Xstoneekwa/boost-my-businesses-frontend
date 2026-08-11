drop trigger if exists account_assignments_device_recurring_exclusivity_v1 on public.account_assignments;
drop function if exists public.reconcile_account_assignment_schedule_v1(uuid);
drop function if exists public.list_available_assignment_slots(uuid,uuid,text,date);
alter function public.list_available_assignment_slots_absolute_legacy_v1(uuid,uuid,text,date)
  rename to list_available_assignment_slots;
revoke all on function public.list_available_assignment_slots(uuid,uuid,text,date) from public, anon, authenticated;
grant execute on function public.list_available_assignment_slots(uuid,uuid,text,date) to service_role;
drop function if exists public.enforce_device_recurring_assignment_exclusivity_v1();
drop function if exists public.find_device_recurring_assignment_conflict_v1(uuid,uuid,timestamptz,timestamptz);
drop function if exists public.recurring_daily_windows_overlap_v1(timestamptz,timestamptz,timestamptz,timestamptz,text);
