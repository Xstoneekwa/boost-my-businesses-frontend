-- Fleet policy mutations use the existing policy authority, guards and audit log.
-- This migration does not activate a policy or change any account setting.
begin;

create unique index fleet_policy_mutation_request_v1_uidx
  on public.ig_action_logs ((payload->>'request_id'))
  where action_type='fleet_policy_mutation_v1' and payload ? 'request_id';

create function public.fleet_mutate_policy_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid; account uuid; tenant uuid; operation_id uuid;
  operation text; expected bigint; cap integer; bindings uuid[];
  before_row public.fleet_account_policy_v1%rowtype;
  after_row public.fleet_account_policy_v1%rowtype;
  existing jsonb; receipt jsonb; identity jsonb; before_json jsonb;
  next_payload jsonb; next_state text; changed boolean:=false; had_policy boolean;
begin
  -- Check the actual database role before input parsing or receipt disclosure.
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception using errcode='42501',message='service_role_required';
  end if;
  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception using errcode='22023',message='fleet_policy_input_invalid';
  end if;
  actor:=(p_input->>'actor_id')::uuid;
  if actor is null or not exists(
    select 1 from public.tenant_users u where u.user_id=actor and u.role='superadmin'
  ) then
    raise exception using errcode='42501',message='fleet_policy_actor_forbidden';
  end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in
    ('actor_id','account_id','tenant_id','request_id','action','expected_revision','cap')) then
    raise exception using errcode='22023',message='fleet_policy_input_invalid';
  end if;
  account:=(p_input->>'account_id')::uuid;
  tenant:=(p_input->>'tenant_id')::uuid;
  operation_id:=(p_input->>'request_id')::uuid;
  operation:=p_input->>'action';
  if account is null or tenant is null or operation_id is null
    or operation is null or operation not in ('hold','release','set_cap','remove_cap')
    or not (p_input ? 'expected_revision') then
    raise exception using errcode='22023',message='fleet_policy_input_invalid';
  end if;
  if p_input->'expected_revision' <> 'null'::jsonb then
    if jsonb_typeof(p_input->'expected_revision') <> 'number'
      or (p_input->>'expected_revision') !~ '^[0-9]+$' then
      raise exception using errcode='22023',message='fleet_policy_input_invalid';
    end if;
    expected:=(p_input->>'expected_revision')::bigint;
    if expected>9007199254740990 then
      raise exception using errcode='22023',message='fleet_policy_input_invalid';
    end if;
  end if;
  if operation='set_cap' then
    if jsonb_typeof(p_input->'cap') is distinct from 'number'
      or (p_input->>'cap') !~ '^[0-9]+$' then
      raise exception using errcode='22023',message='fleet_policy_input_invalid';
    end if;
    cap:=(p_input->>'cap')::integer;
  elsif p_input ? 'cap' then
    raise exception using errcode='22023',message='fleet_policy_input_invalid';
  end if;

  -- A request key cannot race across accounts. Policy and runtime guards share
  -- the account lock; no device/request lock is acquired in this transaction.
  perform pg_advisory_xact_lock(hashtextextended('fleet-policy:'||operation_id::text,0));
  perform 1 from public.ig_accounts a where a.id=account for update;
  if not found then
    raise exception using errcode='42501',message='fleet_policy_binding_forbidden';
  end if;
  select array_agg(c.client_id) into bindings from public.client_instagram_accounts c
    where c.account_id=account;
  if cardinality(bindings) is distinct from 1 or bindings[1] is distinct from tenant then
    raise exception using errcode='42501',message='fleet_policy_binding_forbidden';
  end if;
  identity:=jsonb_build_object('actor_id',actor,'account_id',account,'tenant_id',tenant,
    'request_id',operation_id,'action',operation,'expected_revision',expected);
  if operation='set_cap' then identity:=identity||jsonb_build_object('cap',cap); end if;
  select l.payload into existing from public.ig_action_logs l
    where l.action_type='fleet_policy_mutation_v1' and l.payload->>'request_id'=operation_id::text;
  if found then
    if existing->'input' is distinct from identity then
      raise exception using errcode='P0001',message='fleet_policy_replay_conflict';
    end if;
    select * into after_row from public.fleet_account_policy_v1 where account_id=account;
    return jsonb_build_object('receipt',existing->'receipt','replayed',true,
      'current_policy',case when found then to_jsonb(after_row) else 'null'::jsonb end);
  end if;
  select * into before_row from public.fleet_account_policy_v1 where account_id=account for update;
  had_policy:=found;
  if (had_policy and before_row.client_id is distinct from tenant) then
    raise exception using errcode='42501',message='fleet_policy_binding_forbidden';
  end if;
  if (had_policy and before_row.revision is distinct from expected)
    or (not had_policy and expected is not null) then
    raise exception using errcode='P0001',message='fleet_policy_revision_conflict';
  end if;
  before_json:=case when had_policy then to_jsonb(before_row) else 'null'::jsonb end;
  next_payload:=case when had_policy then before_row.policy_payload else '{}'::jsonb end;
  next_state:=case when had_policy then before_row.hold_state else 'CLEARED' end;
  if operation='hold' and next_state not in ('REQUESTED','ACTIVE') then
    next_state:='REQUESTED'; changed:=true;
  elsif operation='release' and next_state in ('REQUESTED','ACTIVE') then
    next_state:='RELEASING'; changed:=true;
  elsif operation='set_cap' and next_payload->'emergency_cap' is distinct from to_jsonb(cap) then
    next_payload:=next_payload||jsonb_build_object('emergency_cap',cap); changed:=true;
  elsif operation='remove_cap' and next_payload ? 'emergency_cap' then
    next_payload:=next_payload-'emergency_cap'; changed:=true;
  end if;
  if changed then
    if operation<>'release' and next_state='ACTIVE' then next_state:='REQUESTED'; end if;
    if had_policy then
      update public.fleet_account_policy_v1 set revision=before_row.revision+1,
        hold_state=next_state,policy_payload=next_payload,updated_at=clock_timestamp()
        where account_id=account returning * into after_row;
    else
      insert into public.fleet_account_policy_v1(account_id,client_id,revision,hold_state,policy_payload)
        values(account,tenant,1,next_state,next_payload) returning * into after_row;
    end if;
  else
    after_row:=before_row;
  end if;
  receipt:=jsonb_build_object('request_id',operation_id,'account_id',account,'tenant_id',tenant,
    'actor_id',actor,'action',operation,'changed',changed,'before',before_json,
    'after',case when had_policy or changed then to_jsonb(after_row) else 'null'::jsonb end,
    'recorded_at',clock_timestamp());
  insert into public.ig_action_logs(account_id,run_id,target_username,action_type,status,message,payload)
    values(account,null,null,'fleet_policy_mutation_v1','success','Fleet policy mutation',
      jsonb_build_object('request_id',operation_id,'input',identity,'receipt',receipt));
  return jsonb_build_object('receipt',receipt,'replayed',false,'current_policy',receipt->'after');
end $$;
revoke all on function public.fleet_mutate_policy_v1(jsonb) from public,anon,authenticated;
grant execute on function public.fleet_mutate_policy_v1(jsonb) to service_role;
commit;
