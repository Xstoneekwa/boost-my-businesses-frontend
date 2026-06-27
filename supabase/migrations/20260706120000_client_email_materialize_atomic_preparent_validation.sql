-- Client email materialize RPC: pre-parent validation for create-intent operations (TASK 14E).
-- CREATE OR REPLACE only — create_*_intent paths raise before parent write; no ok:false after parent create-or-get.

create or replace function public.materialize_client_email_outbox_candidate_v1(
  p_account_id uuid,
  p_client_id uuid,
  p_category text,
  p_operation text,
  p_parent_episode_key text,
  p_started_at timestamptz,
  p_source_action_id uuid default null,
  p_eligible_target_count_at_start integer default null,
  p_recipient_email text default null,
  p_idempotency_key text default null,
  p_trigger text default null,
  p_reminder_index smallint default null,
  p_template_id uuid default null,
  p_template_version integer default null,
  p_snapshot_subject text default null,
  p_snapshot_body_text text default null,
  p_snapshot_body_html text default null,
  p_from_email text default null,
  p_from_email_snapshot text default null,
  p_support_email_snapshot text default null,
  p_parent_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent_id uuid;
  v_parent_created boolean := false;
  v_parent_kind text;
  v_parent_status text;
  v_intent_id uuid;
  v_intent_created boolean := false;
  v_existing_intent public.client_email_send_intents%rowtype;
  v_reminder_index smallint;
  v_is_create_intent boolean;
begin
  v_is_create_intent := p_operation in (
    'create_lifecycle_initial_intent',
    'create_needs_more_initial_intent',
    'create_needs_more_reminder_intent'
  );

  if p_account_id is null or p_client_id is null then
    return jsonb_build_object('ok', false, 'code', 'missing_account_or_client');
  end if;

  if p_category not in (
    'account_paused',
    'account_canceled',
    'needs_assistance',
    'needs_more_target_accounts'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_category');
  end if;

  if p_parent_episode_key is null or btrim(p_parent_episode_key) = '' then
    return jsonb_build_object('ok', false, 'code', 'missing_parent_episode_key');
  end if;

  if p_started_at is null then
    return jsonb_build_object('ok', false, 'code', 'missing_started_at');
  end if;

  perform pg_advisory_xact_lock(
    hashtext('client_email_materialize'),
    hashtext(p_account_id::text)
  );

  if not exists (
    select 1
    from public.client_instagram_accounts cia
    where cia.account_id = p_account_id
      and cia.client_id = p_client_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'client_email_account_client_ownership_mismatch');
  end if;

  v_reminder_index := coalesce(p_reminder_index, 0);

  if p_category = 'needs_more_target_accounts' then
    v_parent_kind := 'sequence';

    if p_operation not in (
      'open_needs_more_sequence',
      'create_needs_more_initial_intent',
      'create_needs_more_reminder_intent'
    ) then
      return jsonb_build_object('ok', false, 'code', 'invalid_operation');
    end if;

    if p_operation = 'create_needs_more_initial_intent' and v_reminder_index <> 0 then
      if v_is_create_intent then
        raise exception using
          errcode = 'P0001',
          message = 'client_email_needs_more_initial_index_required';
      end if;
      return jsonb_build_object('ok', false, 'code', 'needs_more_initial_index_required');
    end if;

    if p_operation = 'create_needs_more_reminder_intent'
       and (v_reminder_index < 1 or v_reminder_index > 5) then
      if v_is_create_intent then
        raise exception using
          errcode = 'P0001',
          message = 'client_email_needs_more_reminder_index_out_of_range';
      end if;
      return jsonb_build_object('ok', false, 'code', 'needs_more_reminder_index_out_of_range');
    end if;
  else
    v_parent_kind := 'lifecycle_episode';

    if p_operation not in (
      'open_lifecycle_episode',
      'create_lifecycle_initial_intent'
    ) then
      return jsonb_build_object('ok', false, 'code', 'invalid_operation');
    end if;

    if v_reminder_index <> 0 then
      if v_is_create_intent then
        raise exception using
          errcode = 'P0001',
          message = 'client_email_lifecycle_initial_index_required';
      end if;
      return jsonb_build_object('ok', false, 'code', 'lifecycle_initial_index_required');
    end if;
  end if;

  if v_is_create_intent then
    if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
      raise exception using
        errcode = 'P0001',
        message = 'client_email_missing_idempotency_key';
    end if;

    select *
      into v_existing_intent
    from public.client_email_send_intents i
    where i.idempotency_key = p_idempotency_key
    limit 1;

    if found then
      if v_existing_intent.account_id is distinct from p_account_id
         or v_existing_intent.client_id is distinct from p_client_id
         or v_existing_intent.intent_kind is distinct from 'client'
         or v_existing_intent.category is distinct from p_category
         or v_existing_intent.trigger is distinct from p_trigger
         or v_existing_intent.reminder_index is distinct from v_reminder_index then
        raise exception 'client_email_idempotency_identity_conflict'
          using errcode = '23514';
      end if;

      if p_category = 'needs_more_target_accounts' then
        if v_existing_intent.sequence_id is null then
          raise exception 'client_email_idempotency_identity_conflict'
            using errcode = '23514';
        end if;
        v_parent_id := v_existing_intent.sequence_id;
      else
        if v_existing_intent.lifecycle_episode_id is null then
          raise exception 'client_email_idempotency_identity_conflict'
            using errcode = '23514';
        end if;
        v_parent_id := v_existing_intent.lifecycle_episode_id;
      end if;

      return jsonb_build_object(
        'ok', true,
        'parent', jsonb_build_object(
          'id', v_parent_id,
          'kind', v_parent_kind,
          'created', false
        ),
        'intent', jsonb_build_object(
          'id', v_existing_intent.id,
          'created', false,
          'status', v_existing_intent.status,
          'idempotency_key', v_existing_intent.idempotency_key
        )
      );
    end if;

    if p_from_email is null
       or btrim(p_from_email) = ''
       or p_from_email_snapshot is null
       or btrim(p_from_email_snapshot) = ''
    then
      raise exception using
        errcode = 'P0001',
        message = 'client_email_from_email_snapshot_missing';
    end if;

    if btrim(p_from_email) is distinct from btrim(p_from_email_snapshot) then
      raise exception using
        errcode = 'P0001',
        message = 'client_email_from_email_snapshot_mismatch';
    end if;

    if p_recipient_email is null or btrim(p_recipient_email) = '' then
      raise exception using
        errcode = 'P0001',
        message = 'client_email_missing_recipient_email';
    end if;

    if p_trigger is null
       or btrim(p_trigger) = ''
       or p_template_id is null
       or p_template_version is null
       or p_snapshot_subject is null
       or btrim(p_snapshot_subject) = ''
       or p_snapshot_body_text is null
       or btrim(p_snapshot_body_text) = ''
       or p_snapshot_body_html is null
       or btrim(p_snapshot_body_html) = ''
       or p_support_email_snapshot is null
       or btrim(p_support_email_snapshot) = '' then
      raise exception using
        errcode = 'P0001',
        message = 'client_email_missing_intent_snapshot_fields';
    end if;

    if p_operation = 'create_needs_more_reminder_intent' then
      if p_parent_id is null then
        raise exception using
          errcode = 'P0001',
          message = 'client_email_needs_more_active_sequence_required';
      end if;

      select s.id, s.status
        into v_parent_id, v_parent_status
      from public.client_email_needs_more_targets_sequences s
      where s.id = p_parent_id
        and s.account_id = p_account_id
        and s.client_id = p_client_id
        and s.status = 'active'
      limit 1;

      if v_parent_id is null then
        raise exception using
          errcode = 'P0001',
          message = 'client_email_needs_more_active_sequence_required';
      end if;

      if exists (
        select 1
        from public.client_email_needs_more_targets_sequences s
        where s.episode_key = p_parent_episode_key
          and s.status <> 'active'
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'client_email_parent_episode_not_reopenable';
      end if;
    end if;
  end if;

  if p_category = 'needs_more_target_accounts' then
    if p_operation = 'create_needs_more_reminder_intent' then
      null;
    elsif p_parent_id is not null then
      select s.id, s.status
        into v_parent_id, v_parent_status
      from public.client_email_needs_more_targets_sequences s
      where s.id = p_parent_id
        and s.account_id = p_account_id
        and s.client_id = p_client_id
      limit 1;

      if v_parent_id is null then
        if v_is_create_intent then
          raise exception using
            errcode = 'P0001',
            message = 'client_email_parent_id_not_found';
        end if;
        return jsonb_build_object('ok', false, 'code', 'parent_id_not_found');
      end if;

      if v_parent_status <> 'active' then
        if v_is_create_intent then
          raise exception using
            errcode = 'P0001',
            message = 'client_email_parent_episode_not_reopenable';
        end if;
        return jsonb_build_object('ok', false, 'code', 'parent_episode_not_reopenable');
      end if;
    else
      select s.id, s.status
        into v_parent_id, v_parent_status
      from public.client_email_needs_more_targets_sequences s
      where s.account_id = p_account_id
        and s.status = 'active'
      limit 1;

      if v_parent_id is not null then
        null;
      else
        if exists (
          select 1
          from public.client_email_needs_more_targets_sequences s
          where s.episode_key = p_parent_episode_key
            and s.status <> 'active'
        ) then
          if v_is_create_intent then
            raise exception using
              errcode = 'P0001',
              message = 'client_email_parent_episode_not_reopenable';
          end if;
          return jsonb_build_object('ok', false, 'code', 'parent_episode_not_reopenable');
        end if;

        insert into public.client_email_needs_more_targets_sequences (
          account_id,
          client_id,
          source_action_id,
          status,
          eligible_target_count_at_start,
          threshold_at_start,
          started_at,
          episode_key
        )
        values (
          p_account_id,
          p_client_id,
          p_source_action_id,
          'active',
          coalesce(p_eligible_target_count_at_start, 0),
          5,
          p_started_at,
          p_parent_episode_key
        )
        on conflict (episode_key) do nothing
        returning id into v_parent_id;

        if v_parent_id is not null then
          v_parent_created := true;
        else
          select s.id, s.status
            into v_parent_id, v_parent_status
          from public.client_email_needs_more_targets_sequences s
          where s.episode_key = p_parent_episode_key
          limit 1;

          if v_parent_status is distinct from 'active' then
            if v_is_create_intent then
              raise exception using
                errcode = 'P0001',
                message = 'client_email_parent_episode_not_reopenable';
            end if;
            return jsonb_build_object('ok', false, 'code', 'parent_episode_not_reopenable');
          end if;
        end if;
      end if;
    end if;
  else
    if p_parent_id is not null then
      select e.id, e.status
        into v_parent_id, v_parent_status
      from public.client_email_lifecycle_episodes e
      where e.id = p_parent_id
        and e.account_id = p_account_id
        and e.client_id = p_client_id
        and e.category = p_category
      limit 1;

      if v_parent_id is null then
        if v_is_create_intent then
          raise exception using
            errcode = 'P0001',
            message = 'client_email_parent_id_not_found';
        end if;
        return jsonb_build_object('ok', false, 'code', 'parent_id_not_found');
      end if;

      if v_parent_status <> 'active' then
        if v_is_create_intent then
          raise exception using
            errcode = 'P0001',
            message = 'client_email_parent_episode_not_reopenable';
        end if;
        return jsonb_build_object('ok', false, 'code', 'parent_episode_not_reopenable');
      end if;
    else
      select e.id, e.status
        into v_parent_id, v_parent_status
      from public.client_email_lifecycle_episodes e
      where e.account_id = p_account_id
          and e.category = p_category
          and e.status = 'active'
      limit 1;

      if v_parent_id is null then
        if exists (
          select 1
          from public.client_email_lifecycle_episodes e
          where e.episode_key = p_parent_episode_key
            and e.status <> 'active'
        ) then
          if v_is_create_intent then
            raise exception using
              errcode = 'P0001',
              message = 'client_email_parent_episode_not_reopenable';
          end if;
          return jsonb_build_object('ok', false, 'code', 'parent_episode_not_reopenable');
        end if;

        insert into public.client_email_lifecycle_episodes (
          account_id,
          client_id,
          category,
          source_action_id,
          status,
          started_at,
          episode_key
        )
        values (
          p_account_id,
          p_client_id,
          p_category,
          p_source_action_id,
          'active',
          p_started_at,
          p_parent_episode_key
        )
        on conflict (episode_key) do nothing
        returning id into v_parent_id;

        if v_parent_id is not null then
          v_parent_created := true;
        else
          select e.id, e.status
            into v_parent_id, v_parent_status
          from public.client_email_lifecycle_episodes e
          where e.episode_key = p_parent_episode_key
          limit 1;

          if v_parent_status is distinct from 'active' then
            if v_is_create_intent then
              raise exception using
                errcode = 'P0001',
                message = 'client_email_parent_episode_not_reopenable';
            end if;
            return jsonb_build_object('ok', false, 'code', 'parent_episode_not_reopenable');
          end if;
        end if;
      end if;
    end if;
  end if;

  if v_parent_id is null then
    if v_is_create_intent then
      raise exception using
        errcode = 'P0001',
        message = 'client_email_parent_create_failed';
    end if;
    return jsonb_build_object('ok', false, 'code', 'parent_create_failed');
  end if;

  if p_operation in ('open_lifecycle_episode', 'open_needs_more_sequence') then
    return jsonb_build_object(
      'ok', true,
      'parent', jsonb_build_object(
        'id', v_parent_id,
        'kind', v_parent_kind,
        'created', v_parent_created
      ),
      'intent', null
    );
  end if;

  if p_category = 'needs_more_target_accounts' then
    insert into public.client_email_send_intents (
      category,
      client_id,
      account_id,
      recipient_email,
      from_email,
      trigger,
      reminder_index,
      template_id,
      template_version,
      snapshot_subject,
      snapshot_body_text,
      snapshot_body_html,
      idempotency_key,
      status,
      intent_kind,
      sequence_id,
      lifecycle_episode_id,
      from_email_snapshot,
      support_email_snapshot
    )
    values (
      p_category,
      p_client_id,
      p_account_id,
      btrim(p_recipient_email),
      btrim(p_from_email),
      p_trigger,
      v_reminder_index,
      p_template_id,
      p_template_version,
      p_snapshot_subject,
      p_snapshot_body_text,
      p_snapshot_body_html,
      p_idempotency_key,
      'pending',
      'client',
      v_parent_id,
      null,
      btrim(p_from_email_snapshot),
      btrim(p_support_email_snapshot)
    )
    on conflict (idempotency_key) do nothing
    returning id into v_intent_id;
  else
    insert into public.client_email_send_intents (
      category,
      client_id,
      account_id,
      recipient_email,
      from_email,
      trigger,
      reminder_index,
      template_id,
      template_version,
      snapshot_subject,
      snapshot_body_text,
      snapshot_body_html,
      idempotency_key,
      status,
      intent_kind,
      sequence_id,
      lifecycle_episode_id,
      from_email_snapshot,
      support_email_snapshot
    )
    values (
      p_category,
      p_client_id,
      p_account_id,
      btrim(p_recipient_email),
      btrim(p_from_email),
      p_trigger,
      v_reminder_index,
      p_template_id,
      p_template_version,
      p_snapshot_subject,
      p_snapshot_body_text,
      p_snapshot_body_html,
      p_idempotency_key,
      'pending',
      'client',
      null,
      v_parent_id,
      btrim(p_from_email_snapshot),
      btrim(p_support_email_snapshot)
    )
    on conflict (idempotency_key) do nothing
    returning id into v_intent_id;
  end if;

  v_intent_created := v_intent_id is not null;

  if v_intent_id is null then
    select *
      into v_existing_intent
    from public.client_email_send_intents i
    where i.idempotency_key = p_idempotency_key
    limit 1;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'client_email_intent_create_failed';
    end if;

    if v_existing_intent.account_id is distinct from p_account_id
       or v_existing_intent.client_id is distinct from p_client_id
       or v_existing_intent.intent_kind is distinct from 'client'
       or v_existing_intent.category is distinct from p_category
       or v_existing_intent.trigger is distinct from p_trigger
       or v_existing_intent.reminder_index is distinct from v_reminder_index
       or (
         p_category = 'needs_more_target_accounts'
         and v_existing_intent.sequence_id is distinct from v_parent_id
       )
       or (
         p_category <> 'needs_more_target_accounts'
         and v_existing_intent.lifecycle_episode_id is distinct from v_parent_id
       ) then
      raise exception 'client_email_idempotency_identity_conflict'
        using errcode = '23514';
    end if;

    v_intent_id := v_existing_intent.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'parent', jsonb_build_object(
      'id', v_parent_id,
      'kind', v_parent_kind,
      'created', v_parent_created
    ),
    'intent', jsonb_build_object(
      'id', v_intent_id,
      'created', v_intent_created,
      'status', 'pending',
      'idempotency_key', p_idempotency_key
    )
  );
end;
$$;

comment on function public.materialize_client_email_outbox_candidate_v1(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  uuid,
  integer,
  text,
  text,
  text,
  smallint,
  uuid,
  integer,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
) is
  'Server-only transactional materialize for client email outbox. Create-intent operations validate recipient/snapshots before parent writes and raise on business failures to prevent orphan parents.';

revoke all on function public.materialize_client_email_outbox_candidate_v1(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  uuid,
  integer,
  text,
  text,
  text,
  smallint,
  uuid,
  integer,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.materialize_client_email_outbox_candidate_v1(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  uuid,
  integer,
  text,
  text,
  text,
  smallint,
  uuid,
  integer,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
) to service_role;
