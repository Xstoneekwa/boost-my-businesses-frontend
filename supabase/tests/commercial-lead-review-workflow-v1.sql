select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.review_commercial_lead_v1(uuid,uuid,text,integer,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.review_commercial_lead_v1(uuid,uuid,text,integer,text,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.review_commercial_lead_v1(uuid,uuid,text,integer,text,jsonb)', 'EXECUTE'),
  'review mutation RPC is service-role-only'
);
select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.commercial_review_queue_read_model_v1(jsonb,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commercial_review_queue_read_model_v1(jsonb,integer,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.commercial_review_queue_read_model_v1(jsonb,integer,integer)', 'EXECUTE'),
  'review queue RPC is service-role-only'
);

insert into public.commercial_businesses (
  id, business_name, country_code, city, vertical, subsegment, website, instagram_handle, source
) values
  ('b0000000-0000-4000-8000-000000000003', 'Review Fixture Approve', 'SA', 'Johannesburg', 'beauty', 'Aesthetic Clinic', 'https://approve.test', '@ReviewApprove', 'test_fixture'),
  ('b0000000-0000-4000-8000-000000000004', 'Review Fixture Reject', 'SA', 'Cape Town', 'beauty', 'Hair Salon', 'https://reject.test', '@ReviewReject', 'test_fixture'),
  ('b0000000-0000-4000-8000-000000000005', 'Review Fixture Already Approved', 'SA', 'Johannesburg', 'beauty', 'Aesthetic Clinic', null, '@ReviewApproved', 'test_fixture'),
  ('b0000000-0000-4000-8000-000000000006', 'Review Fixture Rejected', 'SA', 'Johannesburg', 'beauty', 'Aesthetic Clinic', null, '@ReviewRejected', 'test_fixture'),
  ('b0000000-0000-4000-8000-000000000007', 'Review Fixture Not Qualified', 'SA', 'Johannesburg', 'beauty', 'Aesthetic Clinic', null, '@ReviewNotQualified', 'test_fixture'),
  ('b0000000-0000-4000-8000-000000000008', 'Review Fixture Contacted', 'SA', 'Johannesburg', 'beauty', 'Aesthetic Clinic', null, '@ReviewContacted', 'test_fixture'),
  ('b0000000-0000-4000-8000-000000000009', 'Review Fixture Paid', 'SA', 'Johannesburg', 'beauty', 'Aesthetic Clinic', null, '@ReviewPaid', 'test_fixture'),
  ('b0000000-0000-4000-8000-000000000010', 'Review Fixture Access Matrix', 'SA', 'Johannesburg', 'beauty', 'Aesthetic Clinic', null, '@ReviewAccess', 'test_fixture');

insert into public.commercial_leads (
  id, campaign_id, business_id, qualification_status, outreach_status, sales_status,
  score, priority, outreach_channel, message_angle, personalization_context_safe,
  audience_context_safe, approved_by, approved_at
) values
  ('e0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'qualified', 'not_started', 'not_started', 97, 'urgent', null, null, '{"why":"Strong visual content"}', '{"competitor":"Clinic A"}', null, null),
  ('e0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000004', 'qualified', 'not_started', 'not_started', 88, 'high', 'instagram', 'B', '{}', '{}', null, null),
  ('e0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000005', 'approved', 'not_started', 'not_started', 91, 'high', 'instagram', 'A', '{}', '{}', '580d7856-d60f-4838-a5f9-3b405d6ae79b', now()),
  ('e0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000006', 'rejected', 'stopped', 'not_started', 45, 'low', null, null, '{}', '{}', null, null),
  ('e0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000007', 'not_qualified', 'stopped', 'not_started', 20, 'low', null, null, '{}', '{}', null, null),
  ('e0000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000008', 'approved', 'contacted', 'not_started', 90, 'high', 'email', 'B', '{}', '{}', '580d7856-d60f-4838-a5f9-3b405d6ae79b', now()),
  ('e0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000009', 'approved', 'replied', 'paid', 99, 'urgent', 'instagram', 'B', '{}', '{}', '580d7856-d60f-4838-a5f9-3b405d6ae79b', now()),
  ('e0000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000010', 'qualified', 'not_started', 'not_started', 75, 'normal', 'email', 'A', '{}', '{}', null, null);

select pg_temp.assert_true(
  (public.commercial_review_queue_read_model_v1('{"search":"Review Fixture"}'::jsonb, 1, 20)#>>'{needs_approval,total}')::integer = 3
  and (public.commercial_review_queue_read_model_v1('{"search":"Review Fixture"}'::jsonb, 1, 20)#>>'{ready_for_outreach,total}')::integer = 1,
  'only qualified leads need approval and only approved not-started leads are ready'
);
select pg_temp.assert_true(
  public.commercial_review_queue_read_model_v1('{"search":"Review Fixture"}'::jsonb, 1, 1)#>>'{needs_approval,rows,0,id}' = 'e0000000-0000-4000-8000-000000000003'
  and jsonb_array_length(public.commercial_review_queue_read_model_v1('{"search":"Review Fixture"}'::jsonb, 2, 1)#>'{needs_approval,rows}') = 1,
  'review pagination and priority-score ordering are deterministic'
);

select pg_temp.expect_error(
  $$select public.review_commercial_lead_v1('11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-000000000010', 'approve', 1, 'review-tenant-denied', '{"outreach_channel":"email","message_angle":"A"}'::jsonb)$$,
  'commercial_crm_owner_access_required', 'client review mutation denied'
);
select pg_temp.expect_error(
  $$select public.review_commercial_lead_v1('44444444-4444-4444-8444-444444444444', 'e0000000-0000-4000-8000-000000000010', 'approve', 1, 'review-admin-denied', '{"outreach_channel":"email","message_angle":"A"}'::jsonb)$$,
  'commercial_crm_owner_access_required', 'ordinary admin review mutation denied'
);
select pg_temp.expect_error(
  $$select public.review_commercial_lead_v1('22222222-2222-4222-8222-222222222222', 'e0000000-0000-4000-8000-000000000010', 'approve', 1, 'review-superadmin-denied', '{"outreach_channel":"email","message_angle":"A"}'::jsonb)$$,
  'commercial_crm_owner_access_required', 'superadmin without grant review mutation denied'
);
update public.internal_access_grants set active = false, revoked_at = now()
where auth_user_id = '580d7856-d60f-4838-a5f9-3b405d6ae79b' and permission_key = 'commercial_crm_access';
select pg_temp.expect_error(
  $$select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b', 'e0000000-0000-4000-8000-000000000010', 'approve', 1, 'review-revoked-denied', '{"outreach_channel":"email","message_angle":"A"}'::jsonb)$$,
  'commercial_crm_owner_access_required', 'revoked owner grant review mutation denied'
);
update public.internal_access_grants set active = true, revoked_at = null
where auth_user_id = '580d7856-d60f-4838-a5f9-3b405d6ae79b' and permission_key = 'commercial_crm_access';

select public.review_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b', 'e0000000-0000-4000-8000-000000000004',
  'update_context', 1, 'review-edit-1',
  '{"priority":"urgent","personalization_note":"Founder correction","audience_note":"Clinic B"}'::jsonb
);
select pg_temp.assert_true(
  (select version = 2 and priority = 'urgent'
     and personalization_context_safe->>'review_note' = 'Founder correction'
     and audience_context_safe->>'review_note' = 'Clinic B'
   from public.commercial_leads where id = 'e0000000-0000-4000-8000-000000000004')
  and (select count(*) = 1 from public.commercial_events where idempotency_key = 'review-edit-1' and event_type = 'lead_review_updated'),
  'review context edit is versioned and audited exactly once'
);

select public.review_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b', 'e0000000-0000-4000-8000-000000000003',
  'approve', 1, 'review-approve-1',
  '{"outreach_channel":"instagram","message_angle":"B","priority":"urgent","personalization_note":"Use booking flow","audience_note":"Clinic A and Doctor C"}'::jsonb
);
select pg_temp.assert_true(
  (select qualification_status = 'approved' and outreach_status = 'not_started'
     and approved_by = '580d7856-d60f-4838-a5f9-3b405d6ae79b' and approved_at is not null
     and outreach_channel = 'instagram' and message_angle = 'B' and version = 2
   from public.commercial_leads where id = 'e0000000-0000-4000-8000-000000000003'),
  'approval atomically persists actor timestamp channel angle and one version increment'
);
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(actor_auth_user_id = '580d7856-d60f-4838-a5f9-3b405d6ae79b')
     and bool_and(metadata_safe->>'outreach_channel' = 'instagram')
   from public.commercial_events where idempotency_key = 'review-approve-1' and event_type = 'lead_approved'),
  'approval event is appended exactly once with review metadata'
);
select pg_temp.assert_true(
  (public.review_commercial_lead_v1(
    '580d7856-d60f-4838-a5f9-3b405d6ae79b', 'e0000000-0000-4000-8000-000000000003',
    'approve', 1, 'review-approve-1', '{"outreach_channel":"instagram","message_angle":"B"}'::jsonb
  )->>'idempotent_replay')::boolean,
  'same approval retry is deterministic and idempotent'
);
select pg_temp.expect_error(
  $$select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b', 'e0000000-0000-4000-8000-000000000003', 'reject', 1, 'review-tab-b-stale', '{}'::jsonb)$$,
  'commercial_review_stale_version', 'conflicting second tab transition fails closed'
);

select public.review_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b', 'e0000000-0000-4000-8000-000000000004',
  'reject', 2, 'review-reject-1', '{"rejection_reason":"poor_targeting_potential"}'::jsonb
);
select pg_temp.assert_true(
  (select qualification_status = 'rejected' and outreach_status = 'stopped' and version = 3
   from public.commercial_leads where id = 'e0000000-0000-4000-8000-000000000004')
  and (select count(*) = 1 and bool_and(metadata_safe->>'rejection_reason' = 'poor_targeting_potential')
   from public.commercial_events where idempotency_key = 'review-reject-1' and event_type = 'lead_rejected'),
  'rejection is terminal and reason is persisted in one append-only event'
);
select pg_temp.assert_true(
  (public.review_commercial_lead_v1(
    '580d7856-d60f-4838-a5f9-3b405d6ae79b', 'e0000000-0000-4000-8000-000000000004',
    'reject', 2, 'review-reject-1', '{"rejection_reason":"poor_targeting_potential"}'::jsonb
  )->>'idempotent_replay')::boolean,
  'same rejection retry is deterministic and idempotent'
);
select pg_temp.expect_error(
  $$select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b', 'e0000000-0000-4000-8000-000000000004', 'approve', 3, 'review-rejected-approve', '{"outreach_channel":"email","message_angle":"A"}'::jsonb)$$,
  'commercial_review_lead_not_eligible', 'rejected lead cannot be approved'
);
select pg_temp.expect_error(
  $$select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b', 'e0000000-0000-4000-8000-000000000005', 'reject', 1, 'review-approved-reject', '{}'::jsonb)$$,
  'commercial_review_lead_not_eligible', 'approved lead cannot be rejected'
);

select pg_temp.assert_true(
  (public.commercial_review_queue_read_model_v1('{"search":"Review Fixture"}'::jsonb, 1, 20)#>>'{needs_approval,total}')::integer = 1
  and (public.commercial_review_queue_read_model_v1('{"search":"Review Fixture"}'::jsonb, 1, 20)#>>'{ready_for_outreach,total}')::integer = 2,
  'decisions update review and ready queue counts without reproposing rejected leads'
);

select 'COMMERCIAL_LEAD_REVIEW_WORKFLOW_V1_SQL_CERTIFIED' as certification;
