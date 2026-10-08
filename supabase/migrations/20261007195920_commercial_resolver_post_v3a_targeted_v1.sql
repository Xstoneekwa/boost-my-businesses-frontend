begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Append-only post-V3A control. The historical resolver_v2 value is never
-- changed; this writes a separate summary key for exactly four fixed items.
create function public.commercial_resolver_v2_post_v3a_control(
  p_actor_user_id uuid,
  p_action text,
  p_item_id uuid default null,
  p_kind text default null,
  p_key text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  s public.commercial_structured_run_state%rowtype;
  v jsonb;
  inputs jsonb;
  calls jsonb;
  input jsonb;
  result jsonb;
  cap integer;
  expected_items uuid[] := array[
    'b5327fe9-a147-4f27-b49d-22ee422d881e'::uuid,
    '92670a4d-8aea-4dd5-920f-87439bded8ac'::uuid,
    '6756be90-8ef0-431a-aadc-672e87421e89'::uuid,
    '4c798eab-e64f-4955-8e97-b61b54fa941b'::uuid
  ];
  expected_businesses uuid[] := array[
    '53d9149a-a54e-4cf2-a0de-21dd3b136f91'::uuid,
    'c9b1fd45-2430-438e-9758-5b0dd4949c5f'::uuid,
    '412d04cc-9a32-4fe8-9253-69a6784b4414'::uuid,
    '2f1e59f6-9515-4665-b335-b2fea1035a8a'::uuid
  ];
  expected_sirets text[] := array['05580205200039','10000706100011','10001008100014','10001013100025'];
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role'
     or not public.commercial_crm_actor_authorized_v1(p_actor_user_id)
  then
    raise exception 'commercial_owner_required' using errcode='42501';
  end if;

  select * into s
  from public.commercial_structured_run_state
  where authorization_key='commercial-france-wide-sirene-poc15-v1'
  for update;
  if not found or s.run_id <> '7243d1fe-1554-4cf5-ba07-2c6ad07d731d'::uuid then
    raise exception 'existing_poc_required';
  end if;

  v := s.summary->'resolver_v2_post_v3a';
  if p_action='start' then
    if v is not null then
      return jsonb_build_object('replay',true,'status',v->>'status');
    end if;
    if s.summary#>>'{alias_v3a,status}' is distinct from 'completed'
       or s.summary#>>'{alias_v3a,schemaVerification}' is distinct from 'PASS'
       or jsonb_array_length(coalesce(s.summary#>'{alias_v3a,calls}','[]'::jsonb)) <> 4
       or not exists(
         select 1 from public.commercial_discovery_runs r
         where r.id=s.run_id and r.status='completed' and r.requested_by=p_actor_user_id
       )
    then
      raise exception 'post_v3a_preconditions_required';
    end if;

    select jsonb_agg(
      jsonb_build_object(
        'itemId',i.id,
        'businessId',i.business_id,
        'siret',i.provider_external_id,
        'hash',md5(i.source_snapshot_safe::text),
        'candidate',i.source_snapshot_safe || jsonb_build_object(
          'business_aliases',coalesce(a.aliases,'[]'::jsonb)
        ),
        'previous',i.enrichment_snapshot_safe->'resolver_v2'->'match',
        'v3aAliases',coalesce(a.aliases,'[]'::jsonb)
      ) order by array_position(expected_items,i.id)
    ) into inputs
    from public.commercial_discovery_items i
    join public.commercial_businesses b on b.id=i.business_id
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'value',x->>'value',
          'alias_type',case x->>'alias_type'
            when 'ESTABLISHMENT_USUAL_NAME' then 'establishment_name'
            when 'SIGN_NAME' then 'trade_name'
            when 'LEGAL_NAME' then 'legal_name'
            when 'LEGAL_UNIT_USUAL_NAME' then 'legal_name'
            else null end,
          'provider',x->>'provider',
          'evidence',x->>'source_reference',
          'observed_at',x->>'observed_at'
        )
      ) aliases
      from jsonb_array_elements(s.summary#>'{alias_v3a,calls}') c
      cross join lateral jsonb_array_elements(coalesce(c->'aliases','[]'::jsonb)) x
      where c->>'siret'=i.provider_external_id
        and c->>'outcome'='SUCCESS'
    ) a on true
    where i.run_id=s.run_id
      and i.provider='sirene'
      and i.provider_external_id=any(expected_sirets)
      and i.id=any(expected_items)
      and i.business_id=any(expected_businesses)
      and array_position(expected_items,i.id)=array_position(expected_businesses,i.business_id)
      and array_position(expected_items,i.id)=array_position(expected_sirets,i.provider_external_id::text)
      and not i.selected_for_processing
      and i.lead_id is null
      and not (i.enrichment_snapshot_safe ? 'resolver_v2_post_v3a')
      and b.identity_mode='structured'
      and b.metadata_safe#>>'{instagram_match,confidence}'='MEDIUM'
      and i.source_snapshot_safe#>>'{eligibility,prospectingEligible}'='true'
      and jsonb_array_length(coalesce(a.aliases,'[]'::jsonb)) > 0;

    if jsonb_array_length(coalesce(inputs,'[]'::jsonb)) <> 4 then
      raise exception 'post_v3a_exact_four_required';
    end if;

    v := jsonb_build_object(
      'status','running',
      'version','COMMERCIAL_RESOLVER_V2_POST_V3A_TARGETED_V1',
      'actor',p_actor_user_id,
      'startedAt',clock_timestamp(),
      'inputs',inputs,
      'calls','[]'::jsonb,
      'historicalResolverV2Immutable',true,
      'ai_scoring',false,
      'live_send_eligible',false,
      'human_review_required',true
    );
  elsif p_action in ('reserve','record','complete','fail') then
    if v is null or v->>'status' <> 'running' or v->>'actor' <> p_actor_user_id::text then
      raise exception 'post_v3a_not_running';
    end if;

    if p_action in ('reserve','record') then
      select x into input
      from jsonb_array_elements(v->'inputs') x
      where x->>'itemId'=p_item_id::text;
      if input is null or not exists(
        select 1 from public.commercial_discovery_items i
        join public.commercial_businesses b on b.id=i.business_id
        where i.id=p_item_id
          and i.business_id=(input->>'businessId')::uuid
          and md5(i.source_snapshot_safe::text)=input->>'hash'
          and i.lead_id is null
          and not i.selected_for_processing
          and b.metadata_safe#>>'{instagram_match,confidence}'='MEDIUM'
      ) then
        raise exception 'post_v3a_identity_changed';
      end if;
    end if;

    if p_action='reserve' then
      if clock_timestamp()>(v->>'startedAt')::timestamptz+interval '5 minutes' then
        raise exception 'post_v3a_deadline';
      end if;
      select x into input from jsonb_array_elements(v->'inputs') x where x->>'itemId'=p_item_id::text;
      cap:=case p_kind when 'search' then 1 when 'page' then 2 when 'robots' then 2 else 0 end;
      calls:=v->'calls';
      if cap=0 or p_key is null or char_length(p_key) not between 1 and 500 then
        raise exception 'post_v3a_call_kind_denied';
      end if;
      if (select count(*) from jsonb_array_elements(calls) c where c->>'itemId'=p_item_id::text and c->>'kind'=p_kind)>=cap
         or exists(select 1 from jsonb_array_elements(calls) c where c->>'itemId'=p_item_id::text and c->>'kind'=p_kind and c->>'key'=p_key)
      then
        raise exception 'post_v3a_budget_or_replay_denied';
      end if;
      v:=jsonb_set(v,'{calls}',calls||jsonb_build_array(jsonb_build_object('itemId',p_item_id,'kind',p_kind,'key',p_key,'outcome','RESERVED','startedAt',clock_timestamp())));
    elsif p_action='record' then
      if coalesce(p_payload->>'outcome','') not in ('SUCCESS','EMPTY_RESULTS','TIMEOUT','HTTP_ERROR','INVALID_PAYLOAD','PROVIDER_ERROR','PARSER_ERROR','SITE_ERROR')
         or length(p_payload::text)>2000 then
        raise exception 'post_v3a_outcome_invalid';
      end if;
      if not exists(select 1 from jsonb_array_elements(v->'calls') c where c->>'itemId'=p_item_id::text and c->>'kind'=p_kind and c->>'key'=p_key and c->>'outcome'='RESERVED') then
        raise exception 'post_v3a_reservation_required';
      end if;
      select jsonb_agg(case when c->>'itemId'=p_item_id::text and c->>'kind'=p_kind and c->>'key'=p_key then c||jsonb_build_object('outcome',p_payload->>'outcome','reason',left(p_payload->>'reason',150),'httpStatus',p_payload->'httpStatus','durationMs',p_payload->'durationMs','finishedAt',clock_timestamp()) else c end order by ord) into calls
      from jsonb_array_elements(v->'calls') with ordinality x(c,ord);
      v:=jsonb_set(v,'{calls}',calls);
    elsif p_action='complete' then
      if jsonb_typeof(p_payload->'results') is distinct from 'array' or jsonb_array_length(p_payload->'results')<>4 or length(p_payload::text)>240000 then
        raise exception 'post_v3a_results_invalid';
      end if;
      if (select count(distinct x->>'itemId') from jsonb_array_elements(p_payload->'results') x)<>4 then
        raise exception 'post_v3a_results_duplicate';
      end if;
      if exists(select 1 from jsonb_array_elements(v->'calls') c where c->>'outcome'='RESERVED') then
        raise exception 'post_v3a_calls_unfinished';
      end if;
      for result in select * from jsonb_array_elements(p_payload->'results') loop
        select x into input from jsonb_array_elements(v->'inputs') x where x->>'itemId'=result->>'itemId';
        if input is null
           or result->>'businessId' is distinct from input->>'businessId'
           or result#>>'{resolution,match,confidence}' not in ('HIGH','MEDIUM','LOW')
           or result#>>'{resolution,match,resolverVersion}' is distinct from 'COMMERCIAL_INSTAGRAM_RESOLVER_V2'
        then
          raise exception 'post_v3a_result_identity_invalid';
        end if;
        if not exists(
          select 1 from public.commercial_discovery_items i
          join public.commercial_businesses b on b.id=i.business_id
          where i.id=(input->>'itemId')::uuid
            and i.business_id=(input->>'businessId')::uuid
            and md5(i.source_snapshot_safe::text)=input->>'hash'
            and i.lead_id is null
            and not i.selected_for_processing
            and b.metadata_safe#>>'{instagram_match,confidence}'='MEDIUM'
            and not (i.enrichment_snapshot_safe ? 'resolver_v2_post_v3a')
        ) then
          raise exception 'post_v3a_identity_changed';
        end if;
        update public.commercial_discovery_items
        set enrichment_snapshot_safe=enrichment_snapshot_safe||jsonb_build_object('resolver_v2_post_v3a',result->'resolution')
        where id=(input->>'itemId')::uuid;
      end loop;
      v:=v||jsonb_build_object('status','completed','completedAt',clock_timestamp(),'results',p_payload->'results');
    else
      v:=v||jsonb_build_object('status','failed','completedAt',clock_timestamp(),'reason','post_v3a_execution_failed_no_automatic_retry');
    end if;
  else
    raise exception 'post_v3a_action_denied';
  end if;

  update public.commercial_structured_run_state
  set summary=jsonb_set(summary,'{resolver_v2_post_v3a}',v)
  where run_id=s.run_id;
  return jsonb_build_object('replay',false,'status',v->>'status','inputs',case when p_action='start' then v->'inputs' else null end);
end $$;

revoke all on function public.commercial_resolver_v2_post_v3a_control(uuid,text,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commercial_resolver_v2_post_v3a_control(uuid,text,uuid,text,text,jsonb) to service_role;
commit;
