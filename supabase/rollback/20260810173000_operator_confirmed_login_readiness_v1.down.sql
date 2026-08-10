begin;

drop function if exists public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text);
drop trigger if exists a_stamp_worker_login_identity_provenance_v1 on public.client_instagram_accounts;
drop function if exists public.stamp_worker_login_identity_provenance_v1();

alter table public.client_instagram_accounts
  drop constraint if exists cia_login_identity_source_check,
  drop constraint if exists cia_login_identity_lineage_object_check,
  drop column if exists login_identity_verification_source,
  drop column if exists login_identity_verification_method,
  drop column if exists login_identity_verified_by,
  drop column if exists login_identity_verified_account_id,
  drop column if exists login_identity_verified_device_id,
  drop column if exists login_identity_verified_app_instance_id,
  drop column if exists login_identity_verified_assignment_id,
  drop column if exists login_identity_login_lineage;

commit;
