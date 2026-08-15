select pg_temp.assert_true(
  (select count(*) = 4 from public.commercial_outreach_templates)
  and (select count(*) = 1 from public.commercial_outreach_templates where template_key = 'IG_BEAUTY_ANGLE_A_V1')
  and (select count(*) = 1 from public.commercial_outreach_templates where template_key = 'IG_BEAUTY_ANGLE_B_V1')
  and (select count(*) = 1 from public.commercial_outreach_templates where template_key = 'EMAIL_BEAUTY_ANGLE_A_V1')
  and (select count(*) = 1 from public.commercial_outreach_templates where template_key = 'EMAIL_BEAUTY_ANGLE_B_V1'),
  'exactly four immutable V1 template families exist'
);

select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.commercial_outreach_items', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.commercial_outreach_items', 'SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('service_role', 'public.commercial_outreach_items', 'SELECT,INSERT,UPDATE')
  and not has_function_privilege('anon', 'public.mutate_commercial_outreach_item_v1(uuid,uuid,text,integer,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.mutate_commercial_outreach_item_v1(uuid,uuid,text,integer,text,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.mutate_commercial_outreach_item_v1(uuid,uuid,text,integer,text,jsonb)', 'EXECUTE'),
  'outreach data and mutation RPC fail closed outside service role'
);

insert into public.commercial_businesses (
  id, business_name, country_code, city, vertical, subsegment, instagram_handle, source
) values
  ('b1000000-0000-4000-8000-000000000001', 'Outreach Fixture Studio', 'SA', 'Johannesburg', 'beauty', 'Hair Salon', '@OutreachFixture', 'test_fixture'),
  ('b1000000-0000-4000-8000-000000000002', 'Outreach Reject Fixture', 'SA', 'Cape Town', 'beauty', 'Aesthetic Clinic', '@OutreachReject', 'test_fixture');

insert into public.commercial_leads (
  id, campaign_id, business_id, qualification_status, outreach_status, sales_status,
  score, priority, city_snapshot, subsegment_snapshot, outreach_channel, message_angle
) values
  ('e1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'qualified', 'not_started', 'not_started', 99, 'urgent', 'Johannesburg', 'Hair Salon', 'instagram', 'A'),
  ('e1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'qualified', 'not_started', 'not_started', 98, 'urgent', 'Cape Town', 'Aesthetic Clinic', 'email', 'B');

select public.review_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b', 'e1000000-0000-4000-8000-000000000001',
  'approve', 1, 'outreach-fixture-approve-1', '{"outreach_channel":"instagram","message_angle":"A"}'::jsonb
);

select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(channel = 'instagram') and bool_and(angle = 'A')
   from public.commercial_outreach_items
   where lead_id = 'e1000000-0000-4000-8000-000000000001' and state <> 'cancelled'),
  'approval atomically materializes exactly one active outreach path'
);

select public.review_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b', 'e1000000-0000-4000-8000-000000000001',
  'approve', 1, 'outreach-fixture-approve-1', '{"outreach_channel":"instagram","message_angle":"A"}'::jsonb
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.commercial_outreach_items
   where lead_id = 'e1000000-0000-4000-8000-000000000001' and state <> 'cancelled'),
  'approval replay does not duplicate the active outreach path'
);

select pg_temp.expect_error(
  $$select public.mutate_commercial_outreach_item_v1(
    '22222222-2222-4222-8222-222222222222',
    (select id from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000001' and state <> 'cancelled'),
    'cancel', 1, 'outreach-superadmin-denied', '{}'::jsonb
  )$$,
  'commercial_crm_owner_access_required', 'superadmin without explicit grant is denied'
);
select pg_temp.expect_error(
  $$select public.mutate_commercial_outreach_item_v1(
    '44444444-4444-4444-8444-444444444444',
    (select id from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000001' and state <> 'cancelled'),
    'cancel', 1, 'outreach-admin-denied', '{}'::jsonb
  )$$,
  'commercial_crm_owner_access_required', 'ordinary admin is denied'
);
select pg_temp.expect_error(
  $$select public.mutate_commercial_outreach_item_v1(
    '11111111-1111-4111-8111-111111111111',
    (select id from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000001' and state <> 'cancelled'),
    'cancel', 1, 'outreach-client-denied', '{}'::jsonb
  )$$,
  'commercial_crm_owner_access_required', 'client actor is denied'
);

select * from public.claim_commercial_outreach_items_v1(20, 'sql-outreach-worker');
select public.complete_commercial_outreach_generation_v1(
  (select id from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000001' and state = 'generating'),
  'sql-outreach-worker', true,
  '{
    "subject": null,
    "body": "Hi Outreach Fixture Studio — I noticed your Johannesburg salon on Instagram. Would it be useful to make your local visibility more consistent without adding more manual work? BMB helps automate that workflow. Open to a quick look?",
    "personalization_summary": "Used the verified business name and city.",
    "facts_used": [{"key":"business_name","value":"Outreach Fixture Studio"},{"key":"city","value":"Johannesburg"}],
    "confidence": 0.95,
    "model": "test-model",
    "prompt_version": "commercial_outreach_prompt_v1",
    "content_hash": "test-content-hash"
  }'::jsonb,
  '{}'::text[]
);

select public.mutate_commercial_outreach_item_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b',
  (select id from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000001' and state = 'ready_for_review'),
  'approve_message',
  (select version from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000001' and state = 'ready_for_review'),
  'outreach-message-approve-1', '{}'::jsonb
);
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(state = 'queued_dry_run') and bool_and(approved_at is not null)
   from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000001' and state <> 'cancelled'),
  'owner approval terminates at queued dry run with no transport state'
);

select public.mutate_commercial_outreach_item_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b',
  (select id from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000001' and state = 'queued_dry_run'),
  'change_selection',
  (select version from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000001' and state = 'queued_dry_run'),
  'outreach-selection-change-1', '{"channel":"email","angle":"B"}'::jsonb
);
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(channel = 'email') and bool_and(angle = 'B') and bool_and(template_key = 'EMAIL_BEAUTY_ANGLE_B_V1')
   from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000001' and state <> 'cancelled')
  and (select count(*) = 1 from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000001' and state = 'cancelled'),
  'channel switch cancels the old path and creates exactly one replacement'
);

select public.mutate_commercial_outreach_item_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b',
  (select id from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000001' and state <> 'cancelled'),
  'cancel',
  (select version from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000001' and state <> 'cancelled'),
  'outreach-cancel-1', '{"reason":"test_safe_cancel"}'::jsonb
);
select pg_temp.assert_true(
  (select count(*) = 0 from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000001' and state <> 'cancelled'),
  'safe cancel leaves no active outreach path'
);

select public.review_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b', 'e1000000-0000-4000-8000-000000000002',
  'approve', 1, 'outreach-reject-fixture-approve', '{"outreach_channel":"email","message_angle":"B"}'::jsonb
);
select set_config('app.commercial_crm_transition_v1', 'on', true);
update public.commercial_leads
set qualification_status = 'rejected', outreach_status = 'stopped', approved_by = null, approved_at = null, version = version + 1
where id = 'e1000000-0000-4000-8000-000000000002';
select pg_temp.assert_true(
  (select count(*) = 0 from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000002' and state <> 'cancelled')
  and (select count(*) = 1 and bool_and(cancellation_reason = 'lead_no_longer_eligible') from public.commercial_outreach_items where lead_id = 'e1000000-0000-4000-8000-000000000002'),
  'lead rejection cancels every pending outreach item'
);

select pg_temp.expect_error(
  $$update public.commercial_outreach_items
    set state = 'sent', approved_by = '580d7856-d60f-4838-a5f9-3b405d6ae79b', approved_at = now()
    where id = (select id from public.commercial_outreach_items where state = 'generating' limit 1)$$,
  'commercial_outreach_items_transport_forbidden_v1', 'real send states are impossible in V1'
);

select pg_temp.assert_true(
  (select count(*) = 0 from public.commercial_outreach_items where state in ('sending', 'sent', 'delivery_failed')),
  'NO_REAL_SEND_OCCURRED'
);

select 'COMMERCIAL_OUTREACH_ORCHESTRATION_V1_SQL_CERTIFIED' as certification;
