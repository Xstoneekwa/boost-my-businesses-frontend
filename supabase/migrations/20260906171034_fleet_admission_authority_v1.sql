-- Local candidate foundation. NOT approved for production application.
-- The complete owner/ACK protocol and HTTP surfaces must be qualified before deploy.
begin;

create table public.fleet_account_policy_v1 (
  account_id uuid primary key references public.ig_accounts(id),
  client_id uuid not null,
  revision bigint not null check (revision >= 0),
  hold_state text not null check (hold_state in ('REQUESTED','ACTIVE','RELEASING','CLEARED')),
  policy_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(policy_payload)='object'),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.fleet_account_policy_v1 enable row level security;
revoke all on public.fleet_account_policy_v1 from public, anon, authenticated;
grant select, insert, update on public.fleet_account_policy_v1 to service_role;

-- These are private authority records, not client-supplied ACK booleans.
-- Service callers cannot insert or rewrite proofs directly. Canonical registration
-- and terminal reconciliation RPCs must populate them before runtime activation.
create table public.fleet_runtime_owners_v1 (
  account_id uuid not null references public.ig_accounts(id),
  consumer_instance_id text not null check (length(consumer_instance_id)>0),
  consumer_boot_id text not null check (length(consumer_boot_id)>0),
  request_id uuid not null references public.account_run_requests(id),
  attempt_id uuid not null references public.ig_runs(id),
  registered_revision bigint not null check (registered_revision>=0),
  retired boolean not null default false,
  terminal_reconciled boolean not null default false,
  process_group_absent boolean not null default false,
  isolation_version text not null,
  process_generation text not null check (length(process_generation)>0),
  primary key(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id)
);
create unique index fleet_runtime_live_attempt_owner_v1
  on public.fleet_runtime_owners_v1(account_id,consumer_instance_id,request_id,attempt_id)
  where not retired;
create table public.fleet_runtime_acks_v1 (
  account_id uuid not null,
  consumer_instance_id text not null,
  consumer_boot_id text not null,
  request_id uuid not null,
  attempt_id uuid not null,
  revision bigint not null check (revision>=0),
  ack_kind text not null check (ack_kind in ('HOLD','RELEASE')),
  process_generation text not null,
  primary key(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,revision,ack_kind),
  foreign key(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id)
    references public.fleet_runtime_owners_v1(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id)
);
alter table public.fleet_runtime_owners_v1 enable row level security;
alter table public.fleet_runtime_acks_v1 enable row level security;
revoke all on public.fleet_runtime_owners_v1,public.fleet_runtime_acks_v1 from public,anon,authenticated,service_role;
grant select on public.fleet_runtime_owners_v1,public.fleet_runtime_acks_v1 to service_role;

-- Transition-only inventory. Never adopt a pre-Fleet process from a caller's
-- self-asserted identity. A historical request and its run count once, while
-- orphan/misbound runs remain independently blocking. Unknown statuses fail closed.
create function public.fleet_legacy_execution_count_v1(p_account_id uuid)
returns bigint language sql security invoker set search_path='' as $$
  with unresolved as (
    select case when q.run_id is null then 'request:'||q.id::text
      else 'run:'||q.run_id::text end as identity
    from public.account_run_requests q
    where q.account_id=p_account_id
      and (q.status is null or q.status::text not in ('queued','completed','failed','canceled','expired'))
      and not exists (
        select 1 from public.fleet_runtime_owners_v1 o
        where o.account_id=q.account_id and o.request_id=q.id and o.attempt_id=q.run_id
          and o.consumer_instance_id=q.claimed_by and not o.retired
          and o.isolation_version='isolated_process_group_v1'
      )
    union
    select 'run:'||r.id::text
    from public.ig_runs r
    where r.account_id=p_account_id
      and (r.status is null or r.status::text not in ('completed','failed','canceled','stopped','expired'))
      and not exists (
        select 1 from public.fleet_runtime_owners_v1 o
        join public.account_run_requests q on q.id=o.request_id and q.account_id=o.account_id
          and q.run_id=o.attempt_id and q.claimed_by=o.consumer_instance_id
        where o.account_id=r.account_id and o.attempt_id=r.id and not o.retired
          and o.isolation_version='isolated_process_group_v1'
      )
  ) select count(*) from unresolved;
$$;
revoke all on function public.fleet_legacy_execution_count_v1(uuid) from public,anon,authenticated;
grant execute on function public.fleet_legacy_execution_count_v1(uuid) to service_role;

create function public.fleet_current_revision_converged_v1(p_account_id uuid,p_revision bigint,p_kind text)
returns boolean language sql security invoker set search_path='' as $$
  select p_kind in ('HOLD','RELEASE')
    and public.fleet_legacy_execution_count_v1(p_account_id)=0
    -- No owners is NOT evidence of quiescence or an unavailable Worker's ACK.
    and exists (select 1 from public.fleet_runtime_owners_v1 o
      where o.account_id=p_account_id and not o.retired)
    and not exists (
      select 1 from public.fleet_runtime_owners_v1 o
      where o.account_id=p_account_id and not o.retired and (
        o.registered_revision>p_revision or not o.terminal_reconciled
        or not o.process_group_absent or o.isolation_version<>'isolated_process_group_v1'
        or not exists (
          select 1 from public.account_run_requests r join public.ig_runs run on run.id=r.run_id
          where r.id=o.request_id and r.account_id=o.account_id and r.run_id=o.attempt_id
            and r.claimed_by=o.consumer_instance_id and run.account_id=o.account_id
            and r.status::text in ('completed','failed','canceled','expired')
            and run.status::text not in ('queued','starting','running')
        )
        or not exists (
          select 1 from public.fleet_runtime_acks_v1 a
          where a.account_id=o.account_id and a.consumer_instance_id=o.consumer_instance_id
            and a.consumer_boot_id=o.consumer_boot_id and a.request_id=o.request_id
            and a.attempt_id=o.attempt_id and a.revision=p_revision and a.ack_kind=p_kind
            and a.process_generation=o.process_generation
        )
      )
    )
    and not exists (select 1 from public.account_run_requests r where r.account_id=p_account_id
      and r.status::text in ('queued','claimed','starting','running'))
    and not exists (select 1 from public.ig_runs r where r.account_id=p_account_id
      and r.status::text in ('queued','starting','running'));
$$;
revoke all on function public.fleet_current_revision_converged_v1(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.fleet_current_revision_converged_v1(uuid,bigint,text) to service_role;

create function public.fleet_owner_serialization_guard_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.account_id,new.consumer_instance_id,new.consumer_boot_id,new.request_id,new.attempt_id,new.process_generation)
      is distinct from (old.account_id,old.consumer_instance_id,old.consumer_boot_id,old.request_id,old.attempt_id,old.process_generation) then
    raise exception 'fleet_owner_binding_immutable' using errcode='22023';
  end if;
  perform 1 from public.ig_accounts where id=new.account_id for update;
  return new;
end;
$$;
revoke all on function public.fleet_owner_serialization_guard_v1() from public,anon,authenticated;
create trigger fleet_owner_serialization_guard_v1 before insert or update on public.fleet_runtime_owners_v1
for each row execute function public.fleet_owner_serialization_guard_v1();

create function public.fleet_ack_binding_guard_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.fleet_account_policy_v1%rowtype;
begin
  perform 1 from public.ig_accounts where id=new.account_id for update;
  select * into p from public.fleet_account_policy_v1 where account_id=new.account_id;
  if p.account_id is null or new.revision<>p.revision then
    raise exception 'fleet_stale_ack' using errcode='22023';
  end if;
  if (new.ack_kind='HOLD' and p.hold_state not in ('REQUESTED','ACTIVE'))
      or (new.ack_kind='RELEASE' and p.hold_state not in ('RELEASING','CLEARED')) then
    raise exception 'fleet_misbound_ack_kind' using errcode='22023';
  end if;
  if not exists (select 1 from public.fleet_runtime_owners_v1 o
      where o.account_id=new.account_id and o.consumer_instance_id=new.consumer_instance_id
        and o.consumer_boot_id=new.consumer_boot_id and o.request_id=new.request_id
        and o.attempt_id=new.attempt_id and not o.retired
        and o.registered_revision<=new.revision and o.process_generation=new.process_generation
        and o.terminal_reconciled and o.process_group_absent
        and o.isolation_version='isolated_process_group_v1') then
    raise exception 'fleet_misbound_owner_ack' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function public.fleet_ack_binding_guard_v1() from public,anon,authenticated;
create trigger fleet_ack_binding_guard_v1 before insert or update on public.fleet_runtime_acks_v1
for each row execute function public.fleet_ack_binding_guard_v1();

-- Every policy mutation uses the same account-first lock order as admission.
-- Ownership is checked from canonical bindings, never from username or UI state.
create function public.fleet_policy_binding_guard_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_clients uuid[];
begin
  if tg_op = 'UPDATE' and (new.account_id is distinct from old.account_id
      or new.client_id is distinct from old.client_id) then
    raise exception 'fleet_policy_binding_immutable' using errcode='22023';
  end if;
  perform 1 from public.ig_accounts where id=new.account_id for update;
  if not found then raise exception 'fleet_account_not_found' using errcode='22023'; end if;
  lock table public.client_instagram_accounts in share mode;
  select array_agg(client_id) into v_clients
    from public.client_instagram_accounts where account_id=new.account_id;
  if cardinality(v_clients) is distinct from 1 or v_clients[1] is distinct from new.client_id then
    raise exception 'fleet_account_binding_mismatch' using errcode='22023';
  end if;
  if tg_op='INSERT' and new.hold_state not in ('REQUESTED','CLEARED') then
    raise exception 'fleet_initial_convergence_unproven' using errcode='22023';
  end if;
  if tg_op='UPDATE' then
    if new.revision<old.revision or new.revision>old.revision+1 then
      raise exception 'fleet_stale_or_skipped_revision' using errcode='22023';
    end if;
    if new.revision=old.revision then
      if new.policy_payload is distinct from old.policy_payload then
        raise exception 'fleet_policy_mutation_requires_revision' using errcode='22023';
      end if;
      if new.hold_state is distinct from old.hold_state then
        -- A handoff invalidates convergence, not policy. Never retain ACTIVE
        -- while the newly bound generation has no fresh terminal/ACK proof.
        if old.hold_state='ACTIVE' and new.hold_state='REQUESTED'
           and not public.fleet_current_revision_converged_v1(new.account_id,new.revision,'HOLD')
           and exists (select 1 from public.fleet_runtime_owners_v1 o
             where o.account_id=new.account_id and not o.retired
               and o.previous_consumer_boot_id is not null
               and o.registered_revision=new.revision and not o.terminal_reconciled) then
          return new;
        end if;
        if not ((old.hold_state='REQUESTED' and new.hold_state='ACTIVE')
            or (old.hold_state='RELEASING' and new.hold_state='CLEARED')) then
          raise exception 'fleet_policy_mutation_requires_revision' using errcode='22023';
        end if;
        if not public.fleet_current_revision_converged_v1(new.account_id,new.revision,
            case when new.hold_state='ACTIVE' then 'HOLD' else 'RELEASE' end) then
          raise exception 'fleet_current_revision_convergence_unproven' using errcode='22023';
        end if;
      end if;
    elsif new.hold_state='ACTIVE' or (old.hold_state<>'CLEARED' and new.hold_state='CLEARED') then
      raise exception 'fleet_new_revision_requires_convergence' using errcode='22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.fleet_policy_binding_guard_v1() from public,anon,authenticated;
grant execute on function public.fleet_policy_binding_guard_v1() to service_role;
create trigger fleet_policy_binding_guard_v1 before insert or update
on public.fleet_account_policy_v1 for each row
execute function public.fleet_policy_binding_guard_v1();

alter table public.fleet_runtime_owners_v1
  add column owner_generation bigint not null default 1 check(owner_generation > 0),
  add column previous_consumer_boot_id text,
  add column succession_evidence_sha256 text,
  add column authority_snapshot jsonb;
alter table public.account_run_requests add column fleet_runtime_v1 jsonb;

create function public.fleet_admission_reason_v1(p_account_id uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare v_policy public.fleet_account_policy_v1%rowtype; v_clients uuid[];
begin
  -- Serializes against creating the first policy as well as changing an existing one.
  -- This is part of the existing RPC transaction, not an additional HTTP/RPC call.
  perform 1 from public.ig_accounts where id=p_account_id for update;
  select * into v_policy from public.fleet_account_policy_v1 where account_id=p_account_id;
  if not found then return null; end if;
  lock table public.client_instagram_accounts in share mode;
  select array_agg(client_id) into v_clients
    from public.client_instagram_accounts where account_id=p_account_id;
  if cardinality(v_clients) is distinct from 1 or v_clients[1] is distinct from v_policy.client_id then
    raise exception 'fleet_account_binding_mismatch' using errcode='22023';
  end if;
  return case v_policy.hold_state
    when 'REQUESTED' then 'fleet_hold_requested'
    when 'ACTIVE' then 'fleet_hold_active'
    when 'RELEASING' then 'fleet_hold_releasing'
    when 'CLEARED' then null
    else 'fleet_invalid_authority' end;
end;
$$;
revoke all on function public.fleet_admission_reason_v1(uuid) from public,anon,authenticated;
grant execute on function public.fleet_admission_reason_v1(uuid) to service_role;

create function public.assert_fleet_admission_v1(p_account_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare v_reason text;
begin
  v_reason:=public.fleet_admission_reason_v1(p_account_id);
  if v_reason is not null then raise exception '%',v_reason using errcode='P0001'; end if;
end;
$$;
revoke all on function public.assert_fleet_admission_v1(uuid) from public,anon,authenticated;
grant execute on function public.assert_fleet_admission_v1(uuid) to service_role;

-- Read-only operational projection; zero legacy is necessary, not a fabricated
-- runtime ACK. Existing exact-revision convergence remains the sole authority.
create function public.fleet_transition_status_v1(p_account_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_reason text; v_legacy bigint; v_policy public.fleet_account_policy_v1%rowtype;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') <> 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  -- Reuse canonical account ownership and admission serialization.
  v_reason:=public.fleet_admission_reason_v1(p_account_id);
  select * into v_policy from public.fleet_account_policy_v1 where account_id=p_account_id;
  if not found then raise exception 'fleet_policy_not_found' using errcode='22023'; end if;
  v_legacy:=public.fleet_legacy_execution_count_v1(p_account_id);
  return jsonb_build_object('account_id',p_account_id,'revision',v_policy.revision,
    'hold_state',v_policy.hold_state,'legacy_unverifiable_executions',v_legacy,
    'zero_legacy_gate',v_legacy=0,'admission_reason',v_reason,
    'transition_state',case when v_legacy>0 then 'WAITING_LEGACY_EXECUTION'
      else 'LEGACY_DRAIN_COMPLETE' end,
    'reason',case when v_legacy>0 then 'legacy_unverifiable_execution' else null end);
end;
$$;
revoke all on function public.fleet_transition_status_v1(uuid) from public,anon,authenticated;
grant execute on function public.fleet_transition_status_v1(uuid) to service_role;

-- Preserve the full deployed definitions, including all historical guards.
-- Refuse unexpected lineage rather than replacing them with an older copy.
do $migration$
declare
  v_create regprocedure := 'public.create_account_run_request(uuid,uuid,text,text,text,text,integer,jsonb)'::regprocedure;
  v_admit regprocedure := 'public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamptz,timestamptz,integer)'::regprocedure;
  v_definition text;
  v_anchor text;
begin
  v_definition:=pg_get_functiondef(v_create);
  v_anchor:='  insert into public.account_run_requests (';
  if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) <> 1
      or position('assert_fleet_admission_v1' in v_definition)>0 then
    raise exception 'fleet_create_request_lineage_mismatch';
  end if;
  execute replace(v_definition,v_anchor,
    E'  perform public.assert_fleet_admission_v1(p_account_id);\n\n'||v_anchor);
  v_definition:=pg_get_functiondef(v_admit);
  v_anchor:='  if v_plan.zero_work_contract_version = 1 then';
  if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) <> 1
      or position('assert_fleet_admission_v1' in v_definition)>0 then
    raise exception 'fleet_admit_attempt_lineage_mismatch';
  end if;
  execute replace(v_definition,v_anchor,
    E'  perform public.assert_fleet_admission_v1(v_account_id);\n\n'||v_anchor);
end;
$migration$;
-- Durable terminal evidence is separate from a cancellation intent and from
-- revision-scoped ACKs. Only the reconciliation authority may eventually write
-- this table; service callers deliberately have no direct write grant.
create table public.fleet_terminal_receipts_v1 (
  account_id uuid not null,
  consumer_instance_id text not null,
  consumer_boot_id text not null,
  request_id uuid not null,
  attempt_id uuid not null,
  process_generation text not null check (length(process_generation) > 0),
  terminal_state text not null check (terminal_state in ('canceled','stopped','completed','failed')),
  cancellation_receipt jsonb not null check (jsonb_typeof(cancellation_receipt) = 'object'),
  terminal_evidence jsonb not null check (jsonb_typeof(terminal_evidence) = 'object'),
  evidence_sha256 text not null,
  primary key(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id),
  foreign key(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id)
    references public.fleet_runtime_owners_v1(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id),
  check (evidence_sha256 = encode(sha256(convert_to(terminal_evidence::text, 'UTF8')), 'hex'))
);
alter table public.fleet_terminal_receipts_v1 enable row level security;
revoke all on public.fleet_terminal_receipts_v1 from public, anon, authenticated, service_role;
grant select on public.fleet_terminal_receipts_v1 to service_role;

create function public.fleet_terminal_receipt_immutable_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'fleet_terminal_receipt_immutable' using errcode = '22023';
end;
$$;
revoke all on function public.fleet_terminal_receipt_immutable_v1() from public, anon, authenticated;
create trigger fleet_terminal_receipt_immutable_v1 before update or delete
on public.fleet_terminal_receipts_v1 for each row execute function public.fleet_terminal_receipt_immutable_v1();

create function public.fleet_terminal_receipt_valid_v1(p_binding jsonb, p_receipt jsonb)
returns boolean language sql security invoker set search_path = '' as $$
  select exists (
    select 1 from public.fleet_terminal_receipts_v1 t
    join public.fleet_runtime_owners_v1 o using(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id)
    join public.account_run_requests q on q.id=t.request_id and q.account_id=t.account_id
      and q.run_id=t.attempt_id and q.claimed_by=t.consumer_instance_id
    join public.ig_runs r on r.id=t.attempt_id and r.account_id=t.account_id
    where t.account_id::text=p_binding->>'account_id'
      and t.request_id::text=p_binding->>'request_id'
      and t.attempt_id::text=p_binding->>'attempt_id'
      and t.consumer_instance_id=p_binding->>'consumer_instance_id'
      and t.consumer_boot_id=p_binding->>'consumer_boot_id'
      and t.cancellation_receipt=p_receipt
      and p_receipt @> (p_binding || '{"termination_source":"fleet_control","termination_reason":"fleet_hold"}'::jsonb)
      and not o.retired and o.terminal_reconciled and o.process_group_absent
      and o.process_generation=t.process_generation
      and o.isolation_version='isolated_process_group_v1'
      and q.status::text in ('canceled','completed','failed')
      and r.status::text=t.terminal_state
      and t.terminal_evidence @> (p_binding || jsonb_build_object(
        'process_generation', t.process_generation, 'terminal_state', t.terminal_state,
        'process_group_absent', true, 'termination_source', 'fleet_control'))
      and not exists (select 1 from public.account_run_requests live
        where live.account_id=t.account_id and live.status::text in ('queued','claimed','starting','running'))
      and not exists (select 1 from public.ig_runs live
        where live.account_id=t.account_id and live.status::text in ('queued','starting','running'))
  );
$$;
revoke all on function public.fleet_terminal_receipt_valid_v1(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.fleet_terminal_receipt_valid_v1(jsonb,jsonb) to service_role;

-- Policy-specific stop intent only. Runtime/group reconciliation is a separate
-- obligation; cancellation must never invoke operator incident overrides.
create function public.fleet_cancel_execution_attempt_v1(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_account uuid;
  v_request uuid;
  v_attempt uuid;
  v_revision bigint;
  v_instance text;
  v_boot text;
  v_policy public.fleet_account_policy_v1%rowtype;
  v_row public.account_run_requests%rowtype;
  v_receipt jsonb;
  v_existing_receipt jsonb;
  v_binding jsonb;
  v_clients uuid[];
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
     or jsonb_typeof(p_payload -> 'revision') is distinct from 'number'
     or (p_payload ->> 'revision') !~ '^[0-9]+$' then
    raise exception 'fleet_invalid_cancellation_payload' using errcode = '22023';
  end if;
  v_account := (p_payload ->> 'account_id')::uuid;
  v_request := (p_payload ->> 'request_id')::uuid;
  v_attempt := (p_payload ->> 'attempt_id')::uuid;
  v_revision := (p_payload ->> 'revision')::bigint;
  v_instance := nullif(p_payload ->> 'consumer_instance_id', '');
  v_boot := nullif(p_payload ->> 'consumer_boot_id', '');
  if v_account is null or v_request is null or v_attempt is null
     or v_instance is null or v_boot is null
     or jsonb_typeof(p_payload -> 'consumer_instance_id') <> 'string'
     or jsonb_typeof(p_payload -> 'consumer_boot_id') <> 'string' then
    raise exception 'fleet_incomplete_cancellation_binding' using errcode = '22023';
  end if;
  perform 1 from public.ig_accounts where id = v_account for update;
  if not found then
    raise exception 'fleet_account_not_found' using errcode = '22023';
  end if;
  select * into v_policy from public.fleet_account_policy_v1 where account_id = v_account;
  if not found or v_policy.revision <> v_revision
     or v_policy.hold_state not in ('REQUESTED', 'ACTIVE', 'RELEASING') then
    raise exception 'fleet_cancellation_policy_mismatch' using errcode = '22023';
  end if;
  lock table public.client_instagram_accounts in share mode;
  select array_agg(client_id) into v_clients from public.client_instagram_accounts
    where account_id = v_account;
  if coalesce(cardinality(v_clients), 0) <> 1
     or v_clients[1] is distinct from v_policy.client_id then
    raise exception 'fleet_account_binding_mismatch' using errcode = '22023';
  end if;
  if not exists (select 1 from public.fleet_runtime_owners_v1 o
    where o.account_id = v_account and o.request_id = v_request and o.attempt_id = v_attempt
      and o.consumer_instance_id = v_instance and o.consumer_boot_id = v_boot
      and not o.retired and o.registered_revision <= v_revision) then
    raise exception 'fleet_cancellation_owner_mismatch' using errcode = '22023';
  end if;
  select * into v_row from public.account_run_requests
    where id = v_request and account_id = v_account for update;
  if not found or v_row.run_id is distinct from v_attempt
     or v_row.claimed_by is distinct from v_instance then
    raise exception 'fleet_cancellation_attempt_mismatch' using errcode = '22023';
  end if;
  v_binding := jsonb_build_object('account_id', v_account, 'request_id', v_request,
    'attempt_id', v_attempt, 'consumer_instance_id', v_instance, 'consumer_boot_id', v_boot);
  v_receipt := v_binding || jsonb_build_object('revision', v_revision,
    'termination_source', 'fleet_control', 'termination_reason', 'fleet_hold');
  if v_row.cancel_requested_at is not null then
    if v_row.cancel_reason = 'fleet_hold' then
      v_existing_receipt := v_row.metadata_safe -> 'fleet_cancellation_v1';
      if jsonb_typeof(v_existing_receipt) is distinct from 'object'
         or not (v_existing_receipt @> (v_binding || '{"termination_source":"fleet_control","termination_reason":"fleet_hold"}'::jsonb))
         or jsonb_typeof(v_existing_receipt -> 'revision') is distinct from 'number'
         or (v_existing_receipt ->> 'revision') !~ '^[0-9]+$' then
        raise exception 'fleet_cancellation_receipt_conflict' using errcode = '22023';
      end if;
      if (v_existing_receipt ->> 'revision')::bigint > v_revision then
        raise exception 'fleet_cancellation_receipt_conflict' using errcode = '22023';
      end if;
      if (v_existing_receipt ->> 'revision')::bigint < v_revision
         and not public.fleet_terminal_receipt_valid_v1(v_binding,v_existing_receipt) then
        raise exception 'fleet_durable_terminal_receipt_unproven' using errcode = '22023';
      end if;
    elsif v_row.metadata_safe ? 'fleet_cancellation_v1' then
      raise exception 'fleet_cancellation_receipt_conflict' using errcode = '22023';
    end if;
    -- First cancellation wins, including a pre-existing individual Stop.
    return v_binding || jsonb_build_object('ok', true, 'revision', v_revision, 'request', to_jsonb(v_row));
  end if;
  if v_row.status::text not in ('claimed', 'starting', 'running')
     or v_row.cancel_reason is not null or v_row.metadata_safe ? 'fleet_cancellation_v1' then
    raise exception 'fleet_cancellation_request_not_live' using errcode = '22023';
  end if;
  update public.account_run_requests set
    cancel_requested_at = clock_timestamp(), cancel_reason = 'fleet_hold',
    metadata_safe = coalesce(metadata_safe, '{}'::jsonb)
      || jsonb_build_object('fleet_cancellation_v1', v_receipt)
    where id = v_request returning * into v_row;
  -- No terminal status, phase plan, incident, setting or lease is changed here.
  return v_binding || jsonb_build_object('ok', true, 'revision', v_revision, 'request', to_jsonb(v_row));
end;
$$;
revoke all on function public.fleet_cancel_execution_attempt_v1(jsonb) from public, anon, authenticated;
grant execute on function public.fleet_cancel_execution_attempt_v1(jsonb) to service_role;

create function public.fleet_succeed_execution_owner_v1(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  a uuid; q uuid; r uuid; rev bigint; instance text; boot text;
  old_owner public.fleet_runtime_owners_v1%rowtype;
  successor public.fleet_runtime_owners_v1%rowtype;
  policy public.fleet_account_policy_v1%rowtype;
  terminal public.fleet_terminal_receipts_v1%rowtype;
  old_binding jsonb; binding jsonb; proposal jsonb; frame jsonb;
  clients uuid[];
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
      nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') <> 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
     or p_payload->>'registration_intent' is distinct from 'REGISTER_SUCCESSOR'
     or jsonb_typeof(p_payload->'revision') is distinct from 'number'
     or p_payload->>'revision' !~ '^[0-9]+$' then
    raise exception 'fleet_invalid_successor_intent' using errcode='22023';
  end if;
  a:=(p_payload->>'account_id')::uuid; q:=(p_payload->>'request_id')::uuid;
  r:=(p_payload->>'attempt_id')::uuid; rev:=(p_payload->>'revision')::bigint;
  instance:=nullif(p_payload->>'consumer_instance_id',''); boot:=nullif(p_payload->>'consumer_boot_id','');
  proposal:=p_payload->'succession';
  if a is null or q is null or r is null or instance is null or boot is null
     or jsonb_typeof(proposal) is distinct from 'object'
     or proposal->>'schema' is distinct from 'FLEET_OWNER_SUCCESSION_V1'
     or proposal->'observed_process_group_absent' is distinct from 'true'::jsonb
     or jsonb_typeof(proposal->'previous_generation') is distinct from 'number'
     or proposal->>'previous_generation' !~ '^[1-9][0-9]*$' then
    raise exception 'fleet_successor_proof_required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fleet-owner:'||instance,0));
  perform 1 from public.ig_accounts where id=a for update;
  if not found then raise exception 'fleet_account_not_found' using errcode='22023'; end if;
  select * into policy from public.fleet_account_policy_v1 where account_id=a;
  if not found or policy.revision<>rev then
    raise exception 'fleet_stale_successor_revision' using errcode='22023';
  end if;
  lock table public.client_instagram_accounts in share mode;
  select array_agg(client_id) into clients from public.client_instagram_accounts where account_id=a;
  if cardinality(clients) is distinct from 1 or clients[1] is distinct from policy.client_id then
    raise exception 'fleet_account_binding_mismatch' using errcode='22023';
  end if;
  perform 1 from public.account_run_requests where id=q and account_id=a
    and run_id=r and claimed_by=instance for update;
  if not found then raise exception 'fleet_successor_attempt_mismatch' using errcode='22023'; end if;
  if exists(select 1 from public.fleet_runtime_owners_v1 where consumer_instance_id=instance
      and consumer_boot_id=boot and retired) then
    raise exception 'fleet_retired_boot_fenced' using errcode='22023';
  end if;
  select * into old_owner from public.fleet_runtime_owners_v1 where account_id=a
    and request_id=q and attempt_id=r and consumer_instance_id=instance and not retired for update;
  if not found then raise exception 'fleet_current_owner_required' using errcode='22023'; end if;
  binding:=jsonb_build_object('account_id',a,'request_id',q,'attempt_id',r,
    'consumer_instance_id',instance,'consumer_boot_id',boot);
  if old_owner.consumer_boot_id=boot then
    if old_owner.previous_consumer_boot_id is distinct from proposal#>>'{previous_binding,consumer_boot_id}'
       or old_owner.owner_generation<>(proposal->>'previous_generation')::bigint+1
       or old_owner.succession_evidence_sha256 is distinct from proposal->>'terminal_evidence_sha256'
       or old_owner.authority_snapshot->>'revision' is distinct from rev::text then
      raise exception 'fleet_successor_retry_conflict' using errcode='22023';
    end if;
    return binding || jsonb_build_object('ok',true,'revision',rev,'owner_generation',old_owner.owner_generation,
      'authority',old_owner.authority_snapshot);
  end if;
  old_binding:=binding || jsonb_build_object('consumer_boot_id',old_owner.consumer_boot_id);
  if exists(select 1 from public.fleet_runtime_owners_v1 o
      where o.consumer_instance_id=instance and o.consumer_boot_id=old_owner.consumer_boot_id
        and not o.retired and (o.account_id<>a or o.request_id<>q or o.attempt_id<>r)) then
    raise exception 'fleet_successor_requires_complete_owner_scope' using errcode='22023';
  end if;
  if proposal->'previous_binding' is distinct from old_binding
     or (proposal->>'previous_generation')::bigint<>old_owner.owner_generation then
    raise exception 'fleet_successor_predecessor_mismatch' using errcode='22023';
  end if;
  select * into terminal from public.fleet_terminal_receipts_v1 t where t.account_id=a
    and t.request_id=q and t.attempt_id=r and t.consumer_instance_id=instance
    and t.consumer_boot_id=old_owner.consumer_boot_id;
  if not found or not public.fleet_terminal_receipt_valid_v1(old_binding,terminal.cancellation_receipt)
     or terminal.evidence_sha256 is distinct from proposal->>'terminal_evidence_sha256'
     or terminal.process_generation is distinct from proposal->>'process_generation'
     or jsonb_typeof(terminal.terminal_evidence->'process_group_id') is distinct from 'number'
     or terminal.terminal_evidence->'process_group_id' is distinct from proposal->'process_group_id'
     or (terminal.terminal_evidence->>'process_group_id')::bigint<=1 then
    raise exception 'fleet_successor_terminal_proof_unproven' using errcode='22023';
  end if;
  if jsonb_typeof(old_owner.authority_snapshot) is distinct from 'object'
     or old_owner.authority_snapshot->>'schema' is distinct from 'FLEET_EXECUTION_AUTHORITY_V1'
     or old_owner.authority_snapshot->>'tenant_id' is distinct from policy.client_id::text then
    raise exception 'fleet_successor_authority_unproven' using errcode='22023';
  end if;
  frame:=old_owner.authority_snapshot || binding || jsonb_build_object(
    'execution_registered',true,'revision',rev,'owner_generation',old_owner.owner_generation+1,
    'hold',case when policy.hold_state='ACTIVE' then 'REQUESTED' else policy.hold_state end,
    'emergency_cap',policy.policy_payload->'emergency_cap');
  update public.fleet_runtime_owners_v1 set retired=true where account_id=a and request_id=q
    and attempt_id=r and consumer_instance_id=instance and consumer_boot_id=old_owner.consumer_boot_id;
  insert into public.fleet_runtime_owners_v1(account_id,consumer_instance_id,consumer_boot_id,
    request_id,attempt_id,registered_revision,isolation_version,process_generation,owner_generation,
    previous_consumer_boot_id,succession_evidence_sha256,authority_snapshot)
    values(a,instance,boot,q,r,rev,old_owner.isolation_version,old_owner.process_generation,
      old_owner.owner_generation+1,old_owner.consumer_boot_id,terminal.evidence_sha256,frame)
    returning * into successor;
  -- Fresh reconciliation and current-revision ACK remain mandatory.
  if policy.hold_state='ACTIVE' then
    update public.fleet_account_policy_v1 set hold_state='REQUESTED' where account_id=a;
  end if;
  update public.account_run_requests set fleet_runtime_v1=frame where id=q;
  return binding || jsonb_build_object('ok',true,'revision',rev,'owner_generation',successor.owner_generation,
    'authority',frame);
end;
$$;
revoke all on function public.fleet_succeed_execution_owner_v1(jsonb) from public,anon,authenticated;
grant execute on function public.fleet_succeed_execution_owner_v1(jsonb) to service_role;

-- ACK is a derived convergence event, never a policy revision mutation.
-- The protected owner/ACK tables and their existing guards remain authoritative.
create function public.fleet_ack_runtime_revision_v1(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  a uuid; q uuid; r uuid; rev bigint; instance text; boot text;
  owner_row public.fleet_runtime_owners_v1%rowtype;
  policy public.fleet_account_policy_v1%rowtype;
  clients uuid[]; kind text; binding jsonb; converged boolean;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
      nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') <> 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
     or jsonb_typeof(p_payload->'revision') is distinct from 'number'
     or p_payload->>'revision' !~ '^[0-9]+$'
     or jsonb_typeof(p_payload->'consumer_instance_id') is distinct from 'string'
     or jsonb_typeof(p_payload->'consumer_boot_id') is distinct from 'string' then
    raise exception 'fleet_invalid_runtime_ack' using errcode='22023';
  end if;
  a:=(p_payload->>'account_id')::uuid; q:=(p_payload->>'request_id')::uuid;
  r:=(p_payload->>'attempt_id')::uuid; rev:=(p_payload->>'revision')::bigint;
  instance:=nullif(p_payload->>'consumer_instance_id',''); boot:=nullif(p_payload->>'consumer_boot_id','');
  if a is null or q is null or r is null or instance is null or boot is null then
    raise exception 'fleet_incomplete_ack_binding' using errcode='22023';
  end if;
  perform 1 from public.ig_accounts where id=a for update;
  if not found then raise exception 'fleet_account_not_found' using errcode='22023'; end if;
  select * into policy from public.fleet_account_policy_v1 where account_id=a;
  if not found or policy.revision<>rev then
    raise exception 'fleet_stale_ack' using errcode='22023';
  end if;
  lock table public.client_instagram_accounts in share mode;
  select array_agg(client_id) into clients from public.client_instagram_accounts where account_id=a;
  if cardinality(clients) is distinct from 1 or clients[1] is distinct from policy.client_id then
    raise exception 'fleet_account_binding_mismatch' using errcode='22023';
  end if;
  select * into owner_row from public.fleet_runtime_owners_v1 o
    where o.account_id=a and o.request_id=q and o.attempt_id=r
      and o.consumer_instance_id=instance and o.consumer_boot_id=boot and not o.retired;
  if not found or not owner_row.terminal_reconciled or not owner_row.process_group_absent
     or owner_row.isolation_version<>'isolated_process_group_v1'
     or owner_row.registered_revision>rev then
    raise exception 'fleet_misbound_owner_ack' using errcode='22023';
  end if;
  if not exists(select 1 from public.account_run_requests req join public.ig_runs run
      on run.id=req.run_id and run.account_id=req.account_id
      where req.id=q and req.account_id=a and req.run_id=r and req.claimed_by=instance
        and req.status::text in ('completed','failed','canceled','expired')
        and run.status::text in ('completed','failed','canceled','stopped','expired')) then
    raise exception 'fleet_ack_terminal_state_unproven' using errcode='22023';
  end if;
  kind:=case when policy.hold_state in ('REQUESTED','ACTIVE') then 'HOLD' else 'RELEASE' end;
  insert into public.fleet_runtime_acks_v1(account_id,consumer_instance_id,consumer_boot_id,
    request_id,attempt_id,revision,ack_kind,process_generation)
    values(a,instance,boot,q,r,rev,kind,owner_row.process_generation)
    on conflict(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,revision,ack_kind)
    do nothing;
  converged:=public.fleet_current_revision_converged_v1(a,rev,kind);
  if converged and policy.hold_state in ('REQUESTED','RELEASING') then
    update public.fleet_account_policy_v1
      set hold_state=case when kind='HOLD' then 'ACTIVE' else 'CLEARED' end
      where account_id=a returning * into policy;
  end if;
  binding:=jsonb_build_object('account_id',a,'request_id',q,'attempt_id',r,
    'consumer_instance_id',instance,'consumer_boot_id',boot);
  return binding || jsonb_build_object('ok',true,'revision',rev,
    'owner_generation',owner_row.owner_generation,'state',policy.hold_state,'converged',converged);
end;
$$;
revoke all on function public.fleet_ack_runtime_revision_v1(jsonb) from public,anon,authenticated;
grant execute on function public.fleet_ack_runtime_revision_v1(jsonb) to service_role;

-- Internal context gate. Not exposed to service_role as a standalone RPC.
create function public.fleet_owner_rpc_context_v1(p jsonb, require_owner boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  a uuid; q uuid; r uuid; rev bigint; instance text; boot text; clients uuid[];
  policy public.fleet_account_policy_v1%rowtype;
  request_row public.account_run_requests%rowtype;
  owner_row public.fleet_runtime_owners_v1%rowtype;
  binding jsonb;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') <> 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  if jsonb_typeof(p) is distinct from 'object'
    or jsonb_typeof(p->'revision') is distinct from 'number' or p->>'revision' !~ '^[0-9]+$'
    or jsonb_typeof(p->'consumer_instance_id') is distinct from 'string'
    or jsonb_typeof(p->'consumer_boot_id') is distinct from 'string' then
    raise exception 'fleet_invalid_owner_payload' using errcode='22023';
  end if;
  a:=(p->>'account_id')::uuid; q:=(p->>'request_id')::uuid; r:=(p->>'attempt_id')::uuid;
  rev:=(p->>'revision')::bigint; instance:=nullif(p->>'consumer_instance_id','');
  boot:=nullif(p->>'consumer_boot_id','');
  if a is null or q is null or r is null or instance is null or boot is null then
    raise exception 'fleet_incomplete_owner_binding' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fleet-owner:'||instance,0));
  perform 1 from public.ig_accounts where id=a for update;
  if not found then raise exception 'fleet_account_not_found' using errcode='22023'; end if;
  select * into policy from public.fleet_account_policy_v1 where account_id=a;
  if not found or policy.revision<>rev then raise exception 'fleet_stale_owner_revision' using errcode='22023'; end if;
  lock table public.client_instagram_accounts in share mode;
  select array_agg(client_id) into clients from public.client_instagram_accounts where account_id=a;
  if cardinality(clients) is distinct from 1 or clients[1] is distinct from policy.client_id
    or (p ? 'tenant_id' and p->>'tenant_id' is distinct from policy.client_id::text) then
    raise exception 'fleet_account_binding_mismatch' using errcode='22023';
  end if;
  select * into request_row from public.account_run_requests where id=q and account_id=a for update;
  if not found or request_row.run_id is distinct from r or request_row.claimed_by is distinct from instance
    or not exists(select 1 from public.ig_runs where id=r and account_id=a) then
    raise exception 'fleet_owner_attempt_mismatch' using errcode='22023';
  end if;
  if exists(select 1 from public.fleet_runtime_owners_v1 where consumer_instance_id=instance
    and consumer_boot_id=boot and retired) then
    raise exception 'fleet_retired_boot_fenced' using errcode='22023';
  end if;
  select * into owner_row from public.fleet_runtime_owners_v1 where account_id=a and request_id=q
    and attempt_id=r and consumer_instance_id=instance and consumer_boot_id=boot and not retired;
  if require_owner and (not found or owner_row.registered_revision>rev) then
    raise exception 'fleet_current_owner_required' using errcode='22023';
  end if;
  if owner_row.account_id is not null and p ? 'owner_generation'
    and p->'owner_generation' is distinct from to_jsonb(owner_row.owner_generation) then
    raise exception 'fleet_owner_generation_mismatch' using errcode='22023';
  end if;
  binding:=jsonb_build_object('account_id',a,'request_id',q,'attempt_id',r,
    'consumer_instance_id',instance,'consumer_boot_id',boot);
  return jsonb_build_object('binding',binding,'policy',to_jsonb(policy),
    'request',to_jsonb(request_row),'owner',to_jsonb(owner_row));
end $$;
revoke all on function public.fleet_owner_rpc_context_v1(jsonb,boolean) from public,anon,authenticated,service_role;

create function public.fleet_register_execution_attempt_v1(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  ctx jsonb; b jsonb; frame jsonb; owner_json jsonb; rev bigint; generation text;
  a uuid; q uuid; r uuid; instance text; boot text;
begin
  ctx:=public.fleet_owner_rpc_context_v1(p_payload,false);
  if p_payload->>'registration_intent' is distinct from 'REGISTER_OR_RETRY' then
    raise exception 'fleet_explicit_registration_intent_required' using errcode='22023';
  end if;
  b:=ctx->'binding'; owner_json:=ctx->'owner'; rev:=(ctx#>>'{policy,revision}')::bigint;
  a:=(b->>'account_id')::uuid; q:=(b->>'request_id')::uuid; r:=(b->>'attempt_id')::uuid;
  instance:=b->>'consumer_instance_id'; boot:=b->>'consumer_boot_id';
  if owner_json->>'account_id' is not null then
    frame:=owner_json->'authority_snapshot';
    if jsonb_typeof(frame) is distinct from 'object' or frame->'revision' is distinct from to_jsonb(rev)
      or not(frame @> b) then raise exception 'fleet_registration_authority_revision_mismatch' using errcode='22023'; end if;
    return b || jsonb_build_object('ok',true,'revision',rev,'owner_generation',owner_json->'owner_generation','authority',frame);
  end if;
  if exists(select 1 from public.fleet_runtime_owners_v1 where not retired
    and ((consumer_instance_id=instance and consumer_boot_id<>boot)
      or (consumer_boot_id=boot and consumer_instance_id<>instance))) then
    raise exception 'fleet_explicit_succession_required' using errcode='22023';
  end if;
  if ctx#>>'{request,status}' not in ('claimed','starting','running')
    or ctx#>>'{policy,hold_state}'='ACTIVE' then
    raise exception 'fleet_registration_admission_state_unproven' using errcode='22023';
  end if;
  if p_payload->'child_pid' is not null and p_payload->'child_pid'<>'null'::jsonb then
    raise exception 'fleet_live_enrollment_process_binding_required' using errcode='22023';
  end if;
  -- This frame is produced/persisted by the Backend admission authority.
  -- Never enroll from the client-provided authority object.
  frame:=ctx#>'{request,fleet_runtime_v1}';
  if jsonb_typeof(frame) is distinct from 'object'
    or frame->>'schema' is distinct from 'FLEET_EXECUTION_AUTHORITY_V1'
    or frame->>'tenant_id' is distinct from ctx#>>'{policy,client_id}'
    or not(frame @> (b-'consumer_boot_id'))
    or frame->'revision' is distinct from to_jsonb(rev)
    or frame->'execution_registered' is distinct from 'false'::jsonb
    or coalesce(frame->'consumer_boot_id','null'::jsonb)<>'null'::jsonb
    or jsonb_typeof(frame->'attempt_revision') is distinct from 'number'
    or frame->>'attempt_revision' !~ '^[0-9]+$'
    or (frame->>'attempt_revision')::bigint>rev
    or jsonb_typeof(frame->'normal_effective_day_cap') is distinct from 'number'
    or frame->>'normal_effective_day_cap' !~ '^[0-9]+$'
    or jsonb_typeof(frame->'canonical_follows_before_run') is distinct from 'number'
    or frame->>'canonical_follows_before_run' !~ '^[0-9]+$'
    or jsonb_typeof(frame->'business_day') is distinct from 'string' then
    raise exception 'fleet_canonical_registration_frame_required' using errcode='22023';
  end if;
  generation:=replace(gen_random_uuid()::text,'-','');
  frame:=frame || b || jsonb_build_object('execution_registered',true,'owner_generation',1,
    'process_generation',generation,'hold',ctx#>>'{policy,hold_state}',
    'emergency_cap',ctx#>'{policy,policy_payload,emergency_cap}');
  insert into public.fleet_runtime_owners_v1(account_id,consumer_instance_id,consumer_boot_id,
    request_id,attempt_id,registered_revision,isolation_version,process_generation,authority_snapshot)
  values(a,instance,boot,q,r,rev,'isolated_process_group_v1',generation,frame);
  update public.account_run_requests set fleet_runtime_v1=frame where id=q;
  return b || jsonb_build_object('ok',true,'revision',rev,'owner_generation',1,'authority',frame);
end $$;
revoke all on function public.fleet_register_execution_attempt_v1(jsonb) from public,anon,authenticated;
grant execute on function public.fleet_register_execution_attempt_v1(jsonb) to service_role;

create function public.fleet_reconcile_execution_attempt_v1(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  ctx jsonb; b jsonb; owner_json jsonb; pg jsonb; receipt jsonb; evidence jsonb;
  existing public.fleet_terminal_receipts_v1%rowtype;
  a uuid; q uuid; r uuid; rev bigint; instance text; boot text; digest text;
begin
  ctx:=public.fleet_owner_rpc_context_v1(p_payload,true);
  b:=ctx->'binding'; owner_json:=ctx->'owner'; pg:=p_payload->'process_group';
  a:=(b->>'account_id')::uuid; q:=(b->>'request_id')::uuid; r:=(b->>'attempt_id')::uuid;
  instance:=b->>'consumer_instance_id'; boot:=b->>'consumer_boot_id'; rev:=(ctx#>>'{policy,revision}')::bigint;
  if p_payload->'child_gone' is distinct from 'true'::jsonb
    or p_payload->'process_group_absent' is distinct from 'true'::jsonb
    or jsonb_typeof(pg) is distinct from 'object' or not(pg @> b)
    or pg->>'isolation_version' is distinct from 'isolated_process_group_v1'
    or pg->>'process_generation' is distinct from owner_json->>'process_generation'
    or jsonb_typeof(pg->'process_group_id') is distinct from 'number'
    or pg->>'process_group_id' !~ '^[0-9]+$' or (pg->>'process_group_id')::bigint<=1
    or pg->'leader_pid' is distinct from pg->'process_group_id'
    or p_payload->'pid' is distinct from pg->'leader_pid'
    or pg->'fleet_revision' is distinct from owner_json#>'{authority_snapshot,attempt_revision}' then
    raise exception 'fleet_terminal_process_proof_required' using errcode='22023';
  end if;
  if p_payload->'orphan_proof' is not null and p_payload->'orphan_proof'<>'null'::jsonb
    and (p_payload#>'{orphan_proof,binding}' is distinct from b
      or p_payload#>'{orphan_proof,pid}' is distinct from pg->'leader_pid'
      or p_payload#>'{orphan_proof,process_group_absent}' is distinct from 'true'::jsonb
      or p_payload#>'{orphan_proof,heartbeat_expiry_used}' is distinct from 'false'::jsonb) then
    raise exception 'fleet_orphan_proof_invalid' using errcode='22023';
  end if;
  receipt:=ctx#>'{request,metadata_safe,fleet_cancellation_v1}';
  if ctx#>>'{request,cancel_reason}' is distinct from 'fleet_hold'
    or ctx#>>'{request,cancel_requested_at}' is null
    or jsonb_typeof(receipt) is distinct from 'object'
    or not(receipt @> (b || '{"termination_source":"fleet_control","termination_reason":"fleet_hold"}'::jsonb))
    or jsonb_typeof(receipt->'revision') is distinct from 'number'
    or receipt->>'revision' !~ '^[0-9]+$' or (receipt->>'revision')::bigint>rev then
    raise exception 'fleet_durable_cancellation_receipt_required' using errcode='22023';
  end if;
  evidence:=b || jsonb_build_object('termination_source','fleet_control','terminal_state','stopped',
    'process_generation',pg->>'process_generation','process_group_id',pg->'process_group_id',
    'process_group_absent',true,'process_group',pg);
  digest:=encode(sha256(convert_to(evidence::text,'UTF8')),'hex');
  select * into existing from public.fleet_terminal_receipts_v1 where account_id=a and request_id=q
    and attempt_id=r and consumer_instance_id=instance and consumer_boot_id=boot;
  if found then
    if existing.terminal_evidence is distinct from evidence or existing.cancellation_receipt is distinct from receipt
      or not public.fleet_terminal_receipt_valid_v1(b,receipt) then
      raise exception 'fleet_terminal_replay_conflict' using errcode='22023';
    end if;
    return b || jsonb_build_object('ok',true,'revision',rev,'canonical_terminal',true,'evidence_sha256',digest);
  end if;
  if ctx#>>'{request,status}' not in ('claimed','starting','running','canceled') then
    raise exception 'fleet_terminal_request_state_conflict' using errcode='22023';
  end if;
  perform 1 from public.ig_runs where id=r and account_id=a for update;
  if not exists(select 1 from public.ig_runs where id=r and account_id=a
    and status::text in ('queued','starting','running','stopped')) then
    raise exception 'fleet_terminal_run_state_conflict' using errcode='22023';
  end if;
  update public.ig_runs set status='stopped' where id=r and account_id=a;
  update public.account_run_requests set status='canceled' where id=q and account_id=a;
  update public.fleet_runtime_owners_v1 set terminal_reconciled=true,process_group_absent=true
    where account_id=a and request_id=q and attempt_id=r and consumer_instance_id=instance and consumer_boot_id=boot;
  insert into public.fleet_terminal_receipts_v1(account_id,consumer_instance_id,consumer_boot_id,
    request_id,attempt_id,process_generation,terminal_state,cancellation_receipt,terminal_evidence,evidence_sha256)
    values(a,instance,boot,q,r,pg->>'process_generation','stopped',receipt,evidence,digest);
  return b || jsonb_build_object('ok',true,'revision',rev,'canonical_terminal',true,'evidence_sha256',digest);
end $$;
revoke all on function public.fleet_reconcile_execution_attempt_v1(jsonb) from public,anon,authenticated;
grant execute on function public.fleet_reconcile_execution_attempt_v1(jsonb) to service_role;

create table public.fleet_cap_acks_v1 (
  account_id uuid not null, consumer_instance_id text not null, consumer_boot_id text not null,
  request_id uuid not null, attempt_id uuid not null, revision bigint not null check(revision>=0),
  boundary_ack jsonb not null check(jsonb_typeof(boundary_ack)='object'),
  primary key(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id,revision),
  foreign key(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id)
    references public.fleet_runtime_owners_v1(account_id,consumer_instance_id,consumer_boot_id,request_id,attempt_id)
);
alter table public.fleet_cap_acks_v1 enable row level security;
revoke all on public.fleet_cap_acks_v1 from public,anon,authenticated,service_role;
grant select on public.fleet_cap_acks_v1 to service_role;

create function public.fleet_ack_cap_revision_v1(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  ctx jsonb; b jsonb; ack jsonb; saved jsonb; contract jsonb; policy_cap jsonb;
  a uuid; q uuid; r uuid; rev bigint; normal_cap bigint; effective bigint; consumed bigint;
  business_day date; day_start timestamptz;
begin
  ctx:=public.fleet_owner_rpc_context_v1(p_payload,true); b:=ctx->'binding'; ack:=p_payload->'boundary_ack';
  a:=(b->>'account_id')::uuid; q:=(b->>'request_id')::uuid; r:=(b->>'attempt_id')::uuid;
  rev:=(ctx#>>'{policy,revision}')::bigint;
  business_day:=(clock_timestamp() at time zone 'Africa/Johannesburg')::date;
  day_start:=business_day::timestamp at time zone 'Africa/Johannesburg';
  if jsonb_typeof(ack) is distinct from 'object'
    or ack->>'schema' is distinct from 'FLEET_CAP_BOUNDARY_ACK_V1'
    or ack->>'account_id' is distinct from b->>'account_id'
    or ack->>'request_id' is distinct from b->>'request_id'
    or ack->>'owner_boot_id' is distinct from b->>'consumer_boot_id'
    or ack->'revision' is distinct from to_jsonb(rev)
    or ack->>'boundary' is distinct from 'before_candidate_selection'
    or ack->>'business_day' is distinct from business_day::text
    or jsonb_typeof(ack->'canonical_consumed') is distinct from 'number'
    or ack->>'canonical_consumed' !~ '^[0-9]+$'
    or jsonb_typeof(ack->'effective_day_cap') is distinct from 'number'
    or ack->>'effective_day_cap' !~ '^[0-9]+$'
    or jsonb_typeof(ack->'remaining') is distinct from 'number'
    or ack->>'remaining' !~ '^[0-9]+$' then
    raise exception 'fleet_invalid_cap_boundary_evidence' using errcode='22023';
  end if;
  if ctx#>'{owner,authority_snapshot,revision}' is distinct from to_jsonb(rev) then
    raise exception 'fleet_stale_cap_channel' using errcode='22023';
  end if;
  select boundary_ack into saved from public.fleet_cap_acks_v1 where account_id=a and request_id=q
    and attempt_id=r and consumer_instance_id=b->>'consumer_instance_id'
    and consumer_boot_id=b->>'consumer_boot_id' and revision=rev;
  if found then
    if saved is distinct from ack then raise exception 'fleet_cap_ack_replay_conflict' using errcode='22023'; end if;
    return b || jsonb_build_object('ok',true,'revision',rev);
  end if;
  contract:=public.account_package_runtime_contract_status(a);
  if contract->'ok' is distinct from 'true'::jsonb
    or jsonb_typeof(contract#>'{settings,follow_day,effective}') is distinct from 'number'
    or contract#>>'{settings,follow_day,effective}' !~ '^[0-9]+$' then
    raise exception 'fleet_canonical_cap_unavailable' using errcode='22023';
  end if;
  normal_cap:=(contract#>>'{settings,follow_day,effective}')::bigint;
  policy_cap:=ctx#>'{policy,policy_payload,emergency_cap}';
  if policy_cap is null or policy_cap='null'::jsonb then effective:=normal_cap;
  else
    if jsonb_typeof(policy_cap) is distinct from 'number' or policy_cap::text !~ '^[0-9]+$' then
      raise exception 'fleet_invalid_emergency_cap' using errcode='22023';
    end if;
    effective:=least(normal_cap,policy_cap::text::bigint);
  end if;
  select coalesce(max(follow_done),0) into consumed
    from public.auto_restart_daily_action_counts_v1(array[a],day_start) where account_id=a;
  if ack->'canonical_consumed' is distinct from to_jsonb(consumed)
    or ack->'effective_day_cap' is distinct from to_jsonb(effective)
    or ack->'remaining' is distinct from to_jsonb(greatest(0,effective-consumed)) then
    raise exception 'fleet_unreconciled_cap_counters' using errcode='22023';
  end if;
  insert into public.fleet_cap_acks_v1(account_id,consumer_instance_id,consumer_boot_id,
    request_id,attempt_id,revision,boundary_ack)
    values(a,b->>'consumer_instance_id',b->>'consumer_boot_id',q,r,rev,ack);
  return b || jsonb_build_object('ok',true,'revision',rev);
end $$;
revoke all on function public.fleet_ack_cap_revision_v1(jsonb) from public,anon,authenticated;
grant execute on function public.fleet_ack_cap_revision_v1(jsonb) to service_role;

-- The account lock acquired by the policy guard also serializes registration
-- and succession. Publish the durable expectation in the SAME transaction;
-- neither channel publication nor an ACK is evidence for this update.
create function public.fleet_sync_owner_authority_revision_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o record; frame jsonb; projected jsonb; binding jsonb;
begin
  if new.revision = old.revision then return new; end if;
  for o in select * from public.fleet_runtime_owners_v1
    where account_id=new.account_id and not retired
    order by request_id,attempt_id,consumer_instance_id,consumer_boot_id for update
  loop
    binding:=jsonb_build_object('account_id',o.account_id,'request_id',o.request_id,
      'attempt_id',o.attempt_id,'consumer_instance_id',o.consumer_instance_id,
      'consumer_boot_id',o.consumer_boot_id,'process_generation',o.process_generation,
      'owner_generation',o.owner_generation,'tenant_id',new.client_id);
    frame:=o.authority_snapshot;
    if jsonb_typeof(frame) is distinct from 'object'
      or frame->>'schema' is distinct from 'FLEET_EXECUTION_AUTHORITY_V1'
      or frame->'execution_registered' is distinct from 'true'::jsonb
      or frame->'revision' is distinct from to_jsonb(old.revision)
      or not (frame @> binding) then
      raise exception 'fleet_owner_authority_sync_required' using errcode='22023';
    end if;
    select fleet_runtime_v1 into projected from public.account_run_requests
      where id=o.request_id and account_id=o.account_id and run_id=o.attempt_id
        and claimed_by=o.consumer_instance_id for update;
    if not found or projected is distinct from frame then
      raise exception 'fleet_request_authority_sync_required' using errcode='22023';
    end if;
    frame:=frame || jsonb_build_object('revision',new.revision,'hold',new.hold_state,
      'emergency_cap',new.policy_payload->'emergency_cap');
    update public.fleet_runtime_owners_v1 set authority_snapshot=frame
      where account_id=o.account_id and request_id=o.request_id and attempt_id=o.attempt_id
        and consumer_instance_id=o.consumer_instance_id and consumer_boot_id=o.consumer_boot_id
        and not retired;
    update public.account_run_requests set fleet_runtime_v1=frame where id=o.request_id;
  end loop;
  -- ACK rows remain immutable historical evidence. Exact-revision guards make
  -- them stale; no ACK or owner generation is copied into the new revision.
  return new;
end $$;
revoke all on function public.fleet_sync_owner_authority_revision_v1()
  from public,anon,authenticated,service_role;
create trigger fleet_sync_owner_authority_revision_v1
after update on public.fleet_account_policy_v1
for each row execute function public.fleet_sync_owner_authority_revision_v1();

commit;

-- Exact generation fencing for device-lease renewal. The legacy overload is
-- retained until all callers are migrated; it is not a certification bypass.
create or replace function public.auto_restart_renew_device_lock(
  p_device_id uuid, p_worker_id text, p_request_id uuid,
  p_lease_seconds integer, p_expected_lease_id uuid, p_account_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $device_renew_fenced$
declare
  v_row record;
  v_request record;
  v_now timestamptz;
begin
  if p_expected_lease_id is null or p_account_id is null or p_request_id is null
     or p_device_id is null or nullif(trim(p_worker_id), '') is null then
    return jsonb_build_object('ok',false,'renewed',false,'reason','device_lock_expected_identity_required');
  end if;
  select * into v_row from public.auto_restart_device_locks
    where device_id=p_device_id for update;
  if not found then
    return jsonb_build_object('ok',false,'renewed',false,'reason','device_lock_missing');
  end if;
  -- Canonical order: device before request, including concurrent admission.
  select id, account_id, status into v_request
    from public.account_run_requests where id=p_request_id for share;
  if not found or v_request.account_id is distinct from p_account_id
     or v_request.status not in ('queued','claimed','starting','running','cancel_requested') then
    return jsonb_build_object('ok',false,'renewed',false,'reason','device_lock_request_mismatch');
  end if;
  if v_row.lease_id is distinct from p_expected_lease_id
     or v_row.worker_id is distinct from p_worker_id
     or v_row.account_id is distinct from p_account_id
     or v_row.request_id is distinct from p_request_id then
    return jsonb_build_object('ok',false,'renewed',false,'reason','device_lock_fencing_mismatch');
  end if;
  v_now := clock_timestamp();
  update public.auto_restart_device_locks
    set lease_expires_at=v_now+make_interval(secs=>greatest(coalesce(p_lease_seconds,900),30)),
        heartbeat_at=v_now, updated_at=v_now
    where device_id=p_device_id and lease_id=p_expected_lease_id;
  return jsonb_build_object('ok',true,'renewed',true,
    'device_id',p_device_id,'account_id',p_account_id,'request_id',p_request_id,
    'worker_id',p_worker_id,'lease_id',p_expected_lease_id);
end;
$device_renew_fenced$;
revoke all on function public.auto_restart_renew_device_lock(uuid,text,uuid,integer,uuid,uuid) from public, anon, authenticated;
grant execute on function public.auto_restart_renew_device_lock(uuid,text,uuid,integer,uuid,uuid) to service_role;
