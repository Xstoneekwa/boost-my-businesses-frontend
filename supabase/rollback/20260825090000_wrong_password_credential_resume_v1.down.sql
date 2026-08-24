begin;

drop trigger if exists accepted_instagram_credential_password_remediation_v1
  on public.account_credentials;
drop trigger if exists client_instagram_password_remediation_v1
  on public.client_instagram_accounts;
drop function if exists public.trigger_instagram_password_remediation_v1();
drop function if exists public.reconcile_instagram_password_remediation_v1(uuid,text);

commit;
