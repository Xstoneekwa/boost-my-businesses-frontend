begin;

alter table public.phone_app_instances
  drop constraint if exists phone_app_instances_business_gate_launchability_v1;

drop function if exists public.reconcile_login_provisioning_app_instance_launchability_v1(uuid);
drop function if exists public.is_login_provisioning_business_gate_v1(text);

-- Deliberately do not re-disable reconciled instances. Recreating the invalid
-- identity-to-technical-launchability coupling would make rollback unsafe.

commit;
