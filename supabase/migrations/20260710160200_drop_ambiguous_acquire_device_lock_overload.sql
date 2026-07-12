-- Fix PGRST203: auto_restart_acquire_device_lock had two overloads:
--   (uuid, text, uuid, uuid, integer, text)
--   (uuid, text, uuid, uuid, integer, text, text, text)
--
-- The 8-argument signature is canonical: it records lease_id, owner_kind,
-- operation_phase and device UI lease audit events. Its final two parameters
-- have defaults, so existing 6-key named RPC payloads continue to work once
-- the obsolete 6-argument overload is removed.

drop function if exists public.auto_restart_acquire_device_lock(
  uuid,
  text,
  uuid,
  uuid,
  integer,
  text
);
