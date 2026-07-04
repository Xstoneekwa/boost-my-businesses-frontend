-- Commercial account lifecycle (pause / resume / cancel) — durable server-side state.
-- Not applied to production in this checkpoint; code/tests only.
--
-- Rollback plan before real lifecycle usage:
--   1. Revert this migration in git.
--   2. Drop commercial_account_lifecycle_operations and commercial_account_lifecycle_states.
--   3. Drop billing_paused and pause_collection_behavior from commercial_stripe_subscriptions if no
--      application code has read them.
--   4. Restore the previous release_schedule_capacity_on_account_admin_lifecycle function/trigger body.
--
-- Rollback plan after real lifecycle usage:
--   Do not drop the lifecycle tables or columns. They become the audit ledger and source of truth
--   for paused/cancelled commercial accounts. Ship a forward migration that disables new lifecycle
--   entrypoints, reconciles every pending/action_required row, then preserves the ledger read-only.

create table if not exists public.commercial_account_lifecycle_states (
  account_id uuid primary key references public.ig_accounts(id) on delete cascade,
  entitlement_id uuid null references public.client_account_entitlements(id) on delete set null,
  stripe_subscription_id text null,
  commercial_state text not null default 'active',
  pause_expires_at timestamptz null,
  paused_at timestamptz null,
  stripe_billing_paused boolean not null default false,
  action_required_reason text null,
  last_operation_id uuid null,
  last_idempotency_key text null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_account_lifecycle_states_state_check check (
    commercial_state in (
      'active',
      'pause_requested',
      'paused',
      'resume_requested',
      'cancel_requested',
      'cancelled',
      'action_required'
    )
  )
);

create index if not exists commercial_account_lifecycle_states_pause_expiry_idx
  on public.commercial_account_lifecycle_states (pause_expires_at)
  where commercial_state = 'paused';

create index if not exists commercial_account_lifecycle_states_action_required_idx
  on public.commercial_account_lifecycle_states (updated_at)
  where commercial_state in ('pause_requested', 'resume_requested', 'cancel_requested', 'action_required');

create table if not exists public.commercial_account_lifecycle_operations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  entitlement_id uuid null references public.client_account_entitlements(id) on delete set null,
  operation_type text not null,
  idempotency_key text not null,
  state text not null default 'pending',
  reason text null,
  actor_type text null,
  actor_id uuid null,
  source_surface text null,
  error_redacted text null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_account_lifecycle_operations_type_check check (
    operation_type in ('pause', 'resume', 'cancel')
  ),
  constraint commercial_account_lifecycle_operations_state_check check (
    state in ('pending', 'in_progress', 'completed', 'failed')
  ),
  constraint commercial_account_lifecycle_operations_idempotency_key unique (idempotency_key)
);

create index if not exists commercial_account_lifecycle_operations_account_idx
  on public.commercial_account_lifecycle_operations (account_id, created_at desc);

create unique index if not exists commercial_account_lifecycle_operations_one_open_idx
  on public.commercial_account_lifecycle_operations (account_id)
  where state in ('pending', 'in_progress');

alter table public.commercial_stripe_subscriptions
  add column if not exists billing_paused boolean not null default false,
  add column if not exists pause_collection_behavior text null;

alter table public.commercial_account_lifecycle_states enable row level security;
alter table public.commercial_account_lifecycle_operations enable row level security;

revoke all on table public.commercial_account_lifecycle_states from anon, authenticated;
revoke all on table public.commercial_account_lifecycle_operations from anon, authenticated;
grant select, insert, update, delete on table public.commercial_account_lifecycle_states to service_role;
grant select, insert, update, delete on table public.commercial_account_lifecycle_operations to service_role;

drop policy if exists commercial_account_lifecycle_states_service_role_all on public.commercial_account_lifecycle_states;
create policy commercial_account_lifecycle_states_service_role_all
  on public.commercial_account_lifecycle_states
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists commercial_account_lifecycle_operations_service_role_all on public.commercial_account_lifecycle_operations;
create policy commercial_account_lifecycle_operations_service_role_all
  on public.commercial_account_lifecycle_operations
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.release_schedule_capacity_on_account_admin_lifecycle()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_reason text;
  v_commercial_state text;
begin
  if old.admin_lifecycle_status is not distinct from new.admin_lifecycle_status then
    return new;
  end if;

  if new.admin_lifecycle_status in ('paused', 'needs_assistance') then
    perform public.audit_schedule_capacity_event(
      'schedule_capacity_release_skipped',
      new.id,
      null,
      null,
      case
        when new.admin_lifecycle_status = 'paused' then 'account_paused_keep_assignment'
        else 'account_needs_assistance_keep_assignment'
      end,
      jsonb_build_object(
        'source', 'ig_accounts_admin_lifecycle_trigger',
        'old_admin_lifecycle_status', old.admin_lifecycle_status,
        'new_admin_lifecycle_status', new.admin_lifecycle_status
      )
    );
    return new;
  end if;

  if new.admin_lifecycle_status not in ('cancelled') then
    return new;
  end if;

  select commercial_state into v_commercial_state
  from public.commercial_account_lifecycle_states
  where account_id = new.id
  limit 1;

  if v_commercial_state in ('cancel_requested', 'action_required', 'cancelled') then
    perform public.audit_schedule_capacity_event(
      'schedule_capacity_release_skipped',
      new.id,
      null,
      null,
      'commercial_lifecycle_release_owner',
      jsonb_build_object(
        'source', 'ig_accounts_admin_lifecycle_trigger',
        'commercial_state', v_commercial_state,
        'old_admin_lifecycle_status', old.admin_lifecycle_status,
        'new_admin_lifecycle_status', new.admin_lifecycle_status
      )
    );
    return new;
  end if;

  v_reason := 'account_cancelled_release';

  perform public.release_account_schedule_capacity(
    new.id,
    v_reason,
    'ig_accounts_admin_lifecycle_trigger',
    null
  );

  return new;
end;
$function$;

comment on table public.commercial_account_lifecycle_states is
  'Canonical per-account commercial lifecycle (pause/resume/cancel). Server-owned; survives restarts.';
comment on table public.commercial_account_lifecycle_operations is
  'Idempotent commercial lifecycle operation ledger for pause/resume/cancel.';
