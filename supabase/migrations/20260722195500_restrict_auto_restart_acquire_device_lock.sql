-- Device lease acquisition is a server-side control-plane operation.

revoke all on function public.auto_restart_acquire_device_lock(
  uuid,
  text,
  uuid,
  uuid,
  integer,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.auto_restart_acquire_device_lock(
  uuid,
  text,
  uuid,
  uuid,
  integer,
  text,
  text,
  text
) to service_role;
