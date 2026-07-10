-- Fix PGRST203: auto_restart_release_device_lock had three overloads
-- ((uuid,text), (uuid,text,uuid), (uuid,text,uuid,text)) created by successive
-- migrations. Because the newer signatures use DEFAULT parameters, PostgREST
-- calls with 2 or 3 named arguments matched several candidates and failed with
-- "function overloading cannot be resolved" — breaking explicit CP4 preflight
-- lock releases (locks were only freed by lease expiry).
--
-- Canonical function kept: auto_restart_release_device_lock(uuid, text, uuid, text)
-- (superset behavior: optional request scoping + device_ui_lease audit + release reason).
-- All existing named-parameter call shapes (2, 3 or 4 keys) resolve to it once
-- the ambiguous overloads are dropped.

drop function if exists public.auto_restart_release_device_lock(uuid, text);
drop function if exists public.auto_restart_release_device_lock(uuid, text, uuid);
