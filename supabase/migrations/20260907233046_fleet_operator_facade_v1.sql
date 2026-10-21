-- Operator facade only. Existing Fleet mutation/convergence remains authoritative.
begin;

create table public.fleet_bulk_receipts_v1 (
  bulk_action_id uuid primary key,
  actor_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  input jsonb not null,
  receipt jsonb not null
);
create index fleet_bulk_history_v1 on public.fleet_bulk_receipts_v1(created_at desc, bulk_action_id desc);
alter table public.fleet_bulk_receipts_v1 enable row level security;
revoke all on public.fleet_bulk_receipts_v1 from public, anon, authenticated, service_role;
create function public.fleet_bulk_receipt_immutable_v1() returns trigger
language plpgsql set search_path='' as $$ begin
  raise exception 'fleet_bulk_receipt_immutable' using errcode='42501';
end $$;
create trigger fleet_bulk_receipt_immutable_v1 before update or delete on public.fleet_bulk_receipts_v1
for each row execute function public.fleet_bulk_receipt_immutable_v1();
revoke all on function public.fleet_bulk_receipt_immutable_v1() from public,anon,authenticated,service_role;

create function public.fleet_operator_guard_v1(p_actor uuid) returns void
language plpgsql stable security definer set search_path='' as $$ begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  if p_actor is null or not exists(select 1 from public.tenant_users where user_id=p_actor and role='superadmin') then
    raise exception 'fleet_policy_actor_forbidden' using errcode='42501';
  end if;
end $$;
revoke all on function public.fleet_operator_guard_v1(uuid) from public,anon,authenticated;
grant execute on function public.fleet_operator_guard_v1(uuid) to service_role;

-- Bounded server-side selection. No caller-provided caps, ownership or state.
create function public.fleet_operator_targets_v1(p_actor uuid,p_scope jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; kind text;
begin
  perform public.fleet_operator_guard_v1(p_actor);
  kind:=p_scope->>'kind';
  if jsonb_typeof(p_scope) is distinct from 'object' or kind is null
    or kind not in ('ALL','GROWTH','PRO','PREMIUM','DEVICE','SELECTED_ACCOUNTS')
    or exists(select 1 from jsonb_object_keys(p_scope) k where k not in ('kind','device_id','account_ids')) then
    raise exception 'fleet_operator_input_invalid' using errcode='22023';
  end if;
  if kind='DEVICE' then
    if p_scope->>'device_id' is null then raise exception 'fleet_operator_input_invalid' using errcode='22023'; end if;
    perform (p_scope->>'device_id')::uuid;
  elsif p_scope ? 'device_id' then raise exception 'fleet_operator_input_invalid' using errcode='22023';
  end if;
  if kind='SELECTED_ACCOUNTS' then
    if jsonb_typeof(p_scope->'account_ids') is distinct from 'array' then
      raise exception 'fleet_operator_input_invalid' using errcode='22023'; end if;
    if jsonb_array_length(p_scope->'account_ids') not between 1 and 500 then
      raise exception 'fleet_scope_limit' using errcode='22023'; end if;
    perform value::uuid from jsonb_array_elements_text(p_scope->'account_ids');
  elsif p_scope ? 'account_ids' then raise exception 'fleet_operator_input_invalid' using errcode='22023';
  end if;
  with resolved as materialized (
    select a.id,to_jsonb(a) account,
      public.account_package_runtime_contract_status(a.id) contract,
      (select jsonb_agg(c.client_id order by c.client_id) from public.client_instagram_accounts c where c.account_id=a.id) bindings,
      to_jsonb(p) policy
    from public.ig_accounts a left join public.fleet_account_policy_v1 p on p.account_id=a.id
    where kind<>'SELECTED_ACCOUNTS' or a.id in (select value::uuid from jsonb_array_elements_text(p_scope->'account_ids'))
  ), scoped as materialized (
    select * from resolved where kind in ('ALL','SELECTED_ACCOUNTS')
      or (kind in ('GROWTH','PRO','PREMIUM') and lower(contract->>'commercial_package_code')=lower(kind))
      or (kind='DEVICE' and contract->'assignment'->>'device_id'=p_scope->>'device_id')
    order by id limit 501
  ), capped as (
    select *, public.resolve_authoritative_follow_day_limit_v1(id,(now() at time zone 'Africa/Johannesburg')::date) cap
    from scoped
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'account_id',id,'username',account->>'username',
    'package',contract->>'commercial_package_code','device_id',contract->'assignment'->>'device_id',
    'tenant_id',case when jsonb_array_length(bindings)=1 then bindings->0 else 'null'::jsonb end,
    'binding_valid',coalesce(jsonb_array_length(bindings)=1 and (policy is null or policy->'client_id'=bindings->0),false),
    'revision',policy->'revision','state',coalesce(policy->>'hold_state','CLEARED'),
    'fleet_cap',policy->'policy_payload'->'emergency_cap',
    'normal_effective_cap',case when cap->>'ok'='true' then cap->'effective_follow_day_limit' else 'null'::jsonb end,
    'resulting_effective_cap',case when cap->>'ok'='true' then
      least((cap->>'effective_follow_day_limit')::integer,(policy->'policy_payload'->>'emergency_cap')::integer) else null end,
    'last_mutation_at',policy->'updated_at',
    'lifecycle',coalesce(account->>'lifecycle_status',account->>'lifecycle'),
    'contract_status',contract->>'status'
  ) order by id),'[]'::jsonb) into result from capped;
  if jsonb_array_length(result)>500 then raise exception 'fleet_scope_limit' using errcode='22023'; end if;
  if kind='SELECTED_ACCOUNTS' and jsonb_array_length(result)<>(select count(distinct value) from jsonb_array_elements_text(p_scope->'account_ids')) then
    raise exception 'fleet_scope_unresolved' using errcode='22023';
  end if;
  return result;
end $$;
revoke all on function public.fleet_operator_targets_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fleet_operator_targets_v1(uuid,jsonb) to service_role;

create function public.fleet_operator_preview_v1(p_actor uuid,p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare targets jsonb; rows jsonb:='[]'; r jsonb; classification text; reason text; operation text; result jsonb;
begin
  perform public.fleet_operator_guard_v1(p_actor);
  if jsonb_typeof(p_input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('operation','scope','cap')) then
    raise exception 'fleet_operator_input_invalid' using errcode='22023'; end if;
  operation:=p_input->>'operation';
  if operation is null or operation not in ('HOLD','RELEASE','SET_CAP','CLEAR_CAP') then
    raise exception 'fleet_operator_input_invalid' using errcode='22023'; end if;
  if operation='SET_CAP' then
    if jsonb_typeof(p_input->'cap') is distinct from 'number' or (p_input->>'cap') !~ '^[0-9]+$' then
      raise exception 'fleet_operator_input_invalid' using errcode='22023'; end if;
    perform (p_input->>'cap')::integer;
  elsif p_input ? 'cap' then raise exception 'fleet_operator_input_invalid' using errcode='22023'; end if;
  targets:=public.fleet_operator_targets_v1(p_actor,p_input->'scope');
  for r in select value from jsonb_array_elements(targets) loop
    classification:='WILL_CHANGE'; reason:='policy_change';
    if r->>'binding_valid'<>'true' then classification:='AMBIGUOUS'; reason:='ownership_unproven';
    elsif r->>'state' not in ('REQUESTED','ACTIVE','WAITING','PARTIAL','RELEASING','CLEARED') then
      classification:='AMBIGUOUS'; reason:='state_unrecognized';
    elsif r->>'lifecycle' in ('archived','bin','deleted') then classification:='SKIPPED'; reason:='inactive_lifecycle';
    elsif operation in ('HOLD','RELEASE') and r->>'state' in ('WAITING','PARTIAL') then
      classification:='BLOCKED'; reason:='policy_transition_unresolved';
    elsif operation='HOLD' and r->>'state' in ('REQUESTED','ACTIVE') then classification:='NO_CHANGE'; reason:='hold_already_requested';
    elsif operation='RELEASE' and r->>'state' in ('CLEARED','RELEASING') then classification:='NO_CHANGE'; reason:='release_already_requested';
    elsif operation='SET_CAP' and r->>'normal_effective_cap' is null then classification:='AMBIGUOUS'; reason:='canonical_cap_unresolved';
    elsif operation='SET_CAP' and r->'fleet_cap'=p_input->'cap' then classification:='NO_CHANGE'; reason:='cap_unchanged';
    elsif operation='CLEAR_CAP' and r->>'fleet_cap' is null then classification:='NO_CHANGE'; reason:='overlay_absent';
    end if;
    -- A lower normal ceiling is preserved even when the overlay itself changes.
    rows:=rows||jsonb_build_array(r||jsonb_build_object('classification',classification,'reason',reason,
      'proposed_effective_cap',case when operation='CLEAR_CAP' then r->'normal_effective_cap'
        when operation='SET_CAP' and r->>'normal_effective_cap' is not null then to_jsonb(least((r->>'normal_effective_cap')::integer,(p_input->>'cap')::integer))
        else r->'resulting_effective_cap' end));
  end loop;
  result:=jsonb_build_object('input',p_input,'targets',rows,'resolved_account_count',jsonb_array_length(rows),
    'eligible_count',(select count(*) from jsonb_array_elements(rows) x where x->>'classification'='WILL_CHANGE'),
    'blocked_count',(select count(*) from jsonb_array_elements(rows) x where x->>'classification' in ('BLOCKED','AMBIGUOUS')),
    'counts',(select coalesce(jsonb_object_agg(k,n),'{}') from (select x->>'classification' k,count(*) n from jsonb_array_elements(rows) x group by 1) c));
  -- Fingerprint is not authorization; APPLY re-resolves it under account locks.
  return result||jsonb_build_object('preview_hash',md5(jsonb_build_object('actor',p_actor,'preview',result)::text));
end $$;
revoke all on function public.fleet_operator_preview_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fleet_operator_preview_v1(uuid,jsonb) to service_role;

create function public.fleet_operator_apply_v1(p_actor uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare bulk uuid; prior public.fleet_bulk_receipts_v1%rowtype; preview jsonb; r jsonb;
  outcome jsonb; outcomes jsonb:='[]'; child jsonb; receipt jsonb; result_status text; identity jsonb;
begin
  perform public.fleet_operator_guard_v1(p_actor);
  if jsonb_typeof(p_input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('bulk_action_id','preview_hash','change')) then
    raise exception 'fleet_operator_input_invalid' using errcode='22023'; end if;
  bulk:=(p_input->>'bulk_action_id')::uuid;
  if bulk is null or p_input->>'preview_hash' is null or p_input->>'preview_hash' !~ '^[a-f0-9]{32}$' then
    raise exception 'fleet_operator_input_invalid' using errcode='22023'; end if;
  identity:=jsonb_build_object('actor',p_actor,'input',p_input);
  perform pg_advisory_xact_lock(hashtextextended('fleet-bulk:'||bulk::text,0));
  select * into prior from public.fleet_bulk_receipts_v1 where bulk_action_id=bulk;
  if found then
    if prior.input is distinct from identity then raise exception 'fleet_bulk_replay_conflict' using errcode='P0001'; end if;
    return jsonb_build_object('receipt',prior.receipt,'replayed',true);
  end if;
  preview:=public.fleet_operator_preview_v1(p_actor,p_input->'change');
  perform 1 from public.ig_accounts where id in (select (x->>'account_id')::uuid from jsonb_array_elements(preview->'targets') x) order by id for update;
  preview:=public.fleet_operator_preview_v1(p_actor,p_input->'change');
  if preview->>'preview_hash' is distinct from p_input->>'preview_hash' then
    raise exception 'fleet_preview_stale' using errcode='P0001'; end if;
  for r in select value from jsonb_array_elements(preview->'targets') loop
    result_status:=r->>'classification';
    outcome:=jsonb_build_object('account_id',r->'account_id','revision',r->'revision','state',r->'state','reason',r->'reason');
    if result_status='AMBIGUOUS' then result_status:='BLOCKED'; end if;
    if result_status='WILL_CHANGE' then
      child:=jsonb_build_object('actor_id',p_actor,'account_id',r->'account_id','tenant_id',r->'tenant_id',
        'request_id',gen_random_uuid(),'expected_revision',r->'revision','action',case p_input->'change'->>'operation'
          when 'HOLD' then 'hold' when 'RELEASE' then 'release' when 'SET_CAP' then 'set_cap' else 'remove_cap' end);
      if p_input->'change'->>'operation'='SET_CAP' then child:=child||jsonb_build_object('cap',p_input->'change'->'cap'); end if;
      child:=public.fleet_mutate_policy_v1(child);
      result_status:=case when child->'receipt'->>'changed'='true' then 'CHANGED' else 'NO_CHANGE' end;
      outcome:=outcome||jsonb_build_object('child_request_id',child->'receipt'->'request_id',
        'revision',child->'current_policy'->'revision','state',child->'current_policy'->'hold_state');
    end if;
    outcomes:=outcomes||jsonb_build_array(outcome||jsonb_build_object('result',result_status));
  end loop;
  receipt:=jsonb_build_object('bulk_action_id',bulk,'actor_id',p_actor,'operation',p_input->'change'->'operation',
    'scope',p_input->'change'->'scope','cap',p_input->'change'->'cap','created_at',clock_timestamp(),
    'target_count',jsonb_array_length(outcomes),'outcomes',outcomes,
    'transaction_model','ATOMIC_POLICY_MUTATIONS_AND_RECEIPT; classified non-mutating targets retained',
    'counts',(select coalesce(jsonb_object_agg(k,n),'{}') from (select x->>'result' k,count(*) n from jsonb_array_elements(outcomes) x group by 1) c),
    'status',case when exists(select 1 from jsonb_array_elements(outcomes) x where x->>'result'='BLOCKED') then 'PARTIAL' else 'RECORDED' end);
  insert into public.fleet_bulk_receipts_v1(bulk_action_id,actor_id,input,receipt) values(bulk,p_actor,identity,receipt);
  return jsonb_build_object('receipt',receipt,'replayed',false);
end $$;
revoke all on function public.fleet_operator_apply_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fleet_operator_apply_v1(uuid,jsonb) to service_role;

create function public.fleet_operator_history_v1(p_actor uuid,p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare page_size integer; cursor_time timestamptz; cursor_id uuid; rows jsonb;
begin
  perform public.fleet_operator_guard_v1(p_actor);
  if jsonb_typeof(p_input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('limit','before_time','before_id')) then
    raise exception 'fleet_operator_input_invalid' using errcode='22023'; end if;
  page_size:=coalesce((p_input->>'limit')::integer,20);
  cursor_time:=(p_input->>'before_time')::timestamptz; cursor_id:=(p_input->>'before_id')::uuid;
  if page_size not between 1 and 100 or (cursor_time is null)<>(cursor_id is null) then
    raise exception 'fleet_operator_input_invalid' using errcode='22023'; end if;
  select coalesce(jsonb_agg(item order by created_at desc,bulk_action_id desc),'[]') into rows from (
    select created_at,bulk_action_id,(receipt-'outcomes'-'transaction_model')||jsonb_build_object('cursor_time',created_at) item
    from public.fleet_bulk_receipts_v1 where cursor_time is null or (created_at,bulk_action_id)<(cursor_time,cursor_id)
    order by created_at desc,bulk_action_id desc limit page_size
  ) q;
  return jsonb_build_object('items',rows,'next_cursor',case when jsonb_array_length(rows)=page_size then
    jsonb_build_object('before_time',rows->-1->'cursor_time','before_id',rows->-1->'bulk_action_id') else null end);
end $$;
revoke all on function public.fleet_operator_history_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fleet_operator_history_v1(uuid,jsonb) to service_role;
commit;
