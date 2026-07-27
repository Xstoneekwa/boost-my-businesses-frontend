create or replace function public.client_can_manage_instagram_account(
  p_auth_user_id uuid,
  p_account_id uuid
)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.client_users cu
    join public.clients c
      on c.id = cu.client_id
     and c.status = 'active'
    join public.client_instagram_accounts cia
      on cia.client_id = c.id
     and cia.account_id = p_account_id
     and cia.active = true
    join public.ig_accounts a
      on a.id = cia.account_id
     and a.archived_at is null
     and a.trashed_at is null
     and lower(coalesce(a.status, '')) not in (
       'archived', 'trashed', 'cancelled', 'canceled', 'deleted', 'rolled_back_test_onboarding'
     )
     and lower(coalesce(a.admin_lifecycle_status, '')) not in (
       'archived', 'trashed', 'cancelled', 'canceled', 'deleted', 'rolled_back_test_onboarding'
     )
    where cu.auth_user_id = p_auth_user_id
      and cu.status = 'active'
      and cu.role in ('owner', 'admin', 'assistant')
      and p_auth_user_id is not null
      and p_account_id is not null
  );
$function$;

revoke execute on function public.client_can_manage_instagram_account(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.client_can_manage_instagram_account(uuid, uuid)
to service_role;
