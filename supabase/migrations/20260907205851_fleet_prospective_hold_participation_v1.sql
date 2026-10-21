-- Prospective evidence only. No backfill, runtime activation or account mutation.
begin;

create table public.fleet_hold_participation_v1 (
  account_id uuid not null references public.ig_accounts(id),
  revision bigint not null,
  client_id uuid not null,
  epoch_revision bigint not null,
  classification text not null check (classification in
    ('NO_EXECUTION_PARTICIPATED','EXECUTION_PARTICIPATED','UNKNOWN')),
  evidence jsonb not null check (jsonb_typeof(evidence)='object'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  primary key(account_id,revision),
  check (epoch_revision<=revision)
);
alter table public.fleet_hold_participation_v1 enable row level security;
revoke all on public.fleet_hold_participation_v1 from public,anon,authenticated,service_role;

create function public.fleet_hold_participation_immutable_v1()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'fleet_hold_participation_immutable' using errcode='22023';
end $$;
revoke all on function public.fleet_hold_participation_immutable_v1() from public,anon,authenticated,service_role;
create trigger fleet_hold_participation_immutable_v1
before update or delete on public.fleet_hold_participation_v1
for each row execute function public.fleet_hold_participation_immutable_v1();

create function public.fleet_capture_hold_participation_v1()
returns trigger language plpgsql set search_path='' as $$
declare
  prior public.fleet_hold_participation_v1%rowtype;
  fresh boolean; epoch bigint; kind text; witness jsonb;
  requests bigint; runs bigint; owners bigint; leases bigint;
begin
  if new.hold_state='CLEARED' then return new; end if;
  if tg_op='UPDATE' and new.revision=old.revision then return new; end if;
  -- Same authority as the canonical atomic enqueue. Claim is unchanged.
  perform 1 from public.ig_accounts where id=new.account_id for update;
  fresh:=new.hold_state='REQUESTED' and
    (tg_op='INSERT' or (tg_op='UPDATE' and old.hold_state='CLEARED'));
  if tg_op='UPDATE' then
    select * into prior from public.fleet_hold_participation_v1
      where account_id=new.account_id and revision=old.revision;
  end if;
  select count(*) into requests from public.account_run_requests where account_id=new.account_id;
  select count(*) into runs from public.ig_runs where account_id=new.account_id;
  select count(*) into owners from public.fleet_runtime_owners_v1 where account_id=new.account_id;
  select count(*) into leases from public.auto_restart_device_locks where account_id=new.account_id;
  -- Conservatively retain historical entries as participation. Terminal status
  -- alone never establishes process quiescence. No retrospective idle proof.
  if fresh then
    epoch:=new.revision;
    kind:=case when requests+runs+owners+leases=0
      then 'NO_EXECUTION_PARTICIPATED' else 'EXECUTION_PARTICIPATED' end;
  elsif prior.account_id is null or prior.client_id is distinct from new.client_id then
    epoch:=new.revision; kind:='UNKNOWN';
  else
    epoch:=prior.epoch_revision; kind:=prior.classification;
    if kind='NO_EXECUTION_PARTICIPATED' and requests+runs+owners+leases>0 then
      kind:='EXECUTION_PARTICIPATED';
    end if;
  end if;
  witness:=jsonb_build_object('schema','FLEET_HOLD_PARTICIPATION_V1',
    'serialization','CANONICAL_ENQUEUE_ACCOUNT_LOCK_V1','account_id',new.account_id,
    'client_id',new.client_id,'revision',new.revision,'epoch_revision',epoch,
    'classification',kind,'fresh_hold',fresh,'hold_state',new.hold_state,
    'policy_payload',new.policy_payload,'requests',requests,'runs',runs,'owners',owners,'leases',leases,
    'previous_sha256',case when fresh then null else prior.evidence_sha256 end,
    'origin_sha256',case when fresh then null else
      coalesce(prior.evidence->>'origin_sha256',prior.evidence_sha256) end);
  insert into public.fleet_hold_participation_v1
    values(new.account_id,new.revision,new.client_id,epoch,kind,witness,
      encode(sha256(convert_to(witness::text,'UTF8')),'hex'));
  return new;
end $$;
revoke all on function public.fleet_capture_hold_participation_v1() from public,anon,authenticated,service_role;
create trigger fleet_capture_hold_participation_v1
after insert or update on public.fleet_account_policy_v1
for each row execute function public.fleet_capture_hold_participation_v1();

create function public.fleet_idle_release_proven_v1(p_account_id uuid,p_revision bigint)
returns boolean language sql set search_path='' as $$
  select exists (
    select 1 from public.fleet_account_policy_v1 p
    join public.fleet_hold_participation_v1 proof
      on proof.account_id=p.account_id and proof.revision=p.revision and proof.client_id=p.client_id
    join public.fleet_hold_participation_v1 origin
      on origin.account_id=proof.account_id and origin.revision=proof.epoch_revision
        and origin.client_id=proof.client_id
    where p.account_id=p_account_id and p.revision=p_revision and p.hold_state='RELEASING'
      and proof.classification='NO_EXECUTION_PARTICIPATED'
      and origin.classification='NO_EXECUTION_PARTICIPATED'
      and origin.evidence->>'fresh_hold'='true'
      and origin.evidence->>'hold_state'='REQUESTED'
      and proof.evidence->>'origin_sha256'=origin.evidence_sha256
      and proof.evidence->'policy_payload'=p.policy_payload
      and proof.evidence_sha256=encode(sha256(convert_to(proof.evidence::text,'UTF8')),'hex')
      and origin.evidence_sha256=encode(sha256(convert_to(origin.evidence::text,'UTF8')),'hex')
      and not exists(select 1 from public.account_run_requests where account_id=p_account_id)
      and not exists(select 1 from public.ig_runs where account_id=p_account_id)
      and not exists(select 1 from public.fleet_runtime_owners_v1 where account_id=p_account_id)
      and not exists(select 1 from public.auto_restart_device_locks where account_id=p_account_id)
  );
$$;
revoke all on function public.fleet_idle_release_proven_v1(uuid,bigint) from public,anon,authenticated,service_role;

-- Preserve the existing positive owner/ACK branch byte-for-byte. Only the
-- RELEASE branch gains a separate, prospective proof predicate.
do $$
declare source text; anchor text:='select p_kind in (''HOLD'',''RELEASE'')';
begin
  source:=pg_get_functiondef('public.fleet_current_revision_converged_v1(uuid,bigint,text)'::regprocedure);
  if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
    raise exception 'fleet_convergence_source_anchor_mismatch';
  end if;
  execute replace(source,anchor,
    'select (p_kind=''RELEASE'' and public.fleet_idle_release_proven_v1(p_account_id,p_revision)) or p_kind in (''HOLD'',''RELEASE'')');
end $$;

-- Clear only after the new release revision and its evidence are durable within
-- this transaction. Audit RETURNING sees the actual final state, never a stale
-- RELEASING projection. No ACK or owner is fabricated.
do $$
declare source text; anchor text:='  receipt:=jsonb_build_object(';
begin
  source:=pg_get_functiondef('public.fleet_mutate_policy_v1(jsonb)'::regprocedure);
  if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
    raise exception 'fleet_policy_mutation_source_anchor_mismatch';
  end if;
  execute replace(source,anchor,
    '  if operation=''release'' and after_row.hold_state=''RELEASING''
      and public.fleet_idle_release_proven_v1(account,after_row.revision) then
      update public.fleet_account_policy_v1 set hold_state=''CLEARED'',updated_at=clock_timestamp()
        where account_id=account and revision=after_row.revision returning * into after_row;
    end if;
'||anchor);
end $$;
commit;
