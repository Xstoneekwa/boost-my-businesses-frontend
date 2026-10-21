-- Synthetic qualification-only fixtures for the real production-schema paths.
-- No identifier or credential below comes from production.
set request.jwt.claim.role='service_role';

-- The certified baseline dump is owner-neutral. Restore the live owner for the
-- validator so the migration contract is exercised exactly as production.
alter function public.jsonb_has_forbidden_safe_metadata_key(jsonb) owner to postgres;

update public.commercial_checkout_sessions
set status='checkout_activated_test'
where id=md5('checkout:'||'20000000-0000-0000-0001-000000000001')::uuid;

insert into public.client_instagram_onboarding_sessions(
  id,client_id,entitlement_id,account_id,created_by,idempotency_key,
  requested_username,package_code,status,current_step
) values (
  '21000000-0000-4000-8000-000000000009',
  '20000000-0000-0000-0000-000000000000',
  md5('entitlement:'||'20000000-0000-0000-0001-000000000001')::uuid,
  '20000000-0000-0000-0001-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '21000000-0000-4000-8000-000000000008',
  'synthetic_agency_1','premium','active','targets'
);

insert into public.client_subscriptions(id,client_id,subscription_type,status)
values ('21000000-0000-4000-8000-000000000010','20000000-0000-0000-0000-000000000000','full_cycle','active');

insert into public.client_subscription_accounts(id,subscription_id,client_instagram_account_id,account_id,status)
select '21000000-0000-4000-8000-000000000011',
       '21000000-0000-4000-8000-000000000010',cia.id,cia.account_id,'active'
from public.client_instagram_accounts cia
where cia.client_id='20000000-0000-0000-0000-000000000000'
  and cia.account_id='20000000-0000-0000-0001-000000000001';

insert into public.phone_devices(id,device_kind,name,pool_type,status)
values ('21000000-0000-4000-8000-000000000012','physical_phone','v3-fixture-phone','full_cycle','active');

insert into public.phone_app_instances(id,device_id,instance_type,instance_index,visible_label,status,current_account_id)
values ('21000000-0000-4000-8000-000000000013','21000000-0000-4000-8000-000000000012','primary_app',0,'V3 fixture','occupied','20000000-0000-0000-0001-000000000001');

insert into public.device_heartbeats(device_id,status,current_account_id,current_assignment_id,current_clone_id)
values ('21000000-0000-4000-8000-000000000012','online',null,null,null);

insert into public.account_assignments(
 id,client_id,subscription_id,subscription_account_id,account_id,device_id,assignment_type,
 slot_kind,status,app_instance_id,schedule_mode,starts_at,ends_at,assigned_at
) values (
 '21000000-0000-4000-8000-000000000014','20000000-0000-0000-0000-000000000000',
 '21000000-0000-4000-8000-000000000010','21000000-0000-4000-8000-000000000011',
 '20000000-0000-0000-0001-000000000001','21000000-0000-4000-8000-000000000012',
 'full_cycle','manual_only','active','21000000-0000-4000-8000-000000000013',
 'manual_only',null,null,now()
);

insert into public.account_incidents(
 id,status,severity,incident_type,dedupe_key,client_id,account_id,account_username
) values (
 '21000000-0000-4000-8000-000000000015','open','error','login_package_mismatch','v3-login-package-mismatch',
 '20000000-0000-0000-0000-000000000000','20000000-0000-0000-0001-000000000001','synthetic_agency_1'
);

insert into public.ig_targets(
 id,account_id,target_username,status,source,input_username,normalized_username,
 canonical_username,verification_status,quality_status,actor_type
) values (
 '21000000-0000-4000-8000-000000000020','20000000-0000-0000-0001-000000000001',
 'v3_onboarding_target','valid','fixture','v3_onboarding_target','v3_onboarding_target',
 'v3_onboarding_target','found','eligible','system'
);

update public.ct_target_lifecycle_runtime_state set
 producer_enabled=true,current_projector_enabled=true,shadow_enabled=true,scope_mode='all_active_accounts',
 auto_killed=false,human_reenable_required=false,enforce_enabled=false,business_actions_enabled=false,
 lifecycle_actions_enabled=false,replacement_enabled=false,notifications_enabled=false,
 archiving_enabled=false,premium_replacement_enabled=false
where id='global';

-- Additional synthetic targets keep every post-guard path independent. They
-- share the already-certified CT fixture tenant/account and contain no live data.
insert into public.ig_targets (
  id,account_id,target_username,status,source,input_username,normalized_username,
  canonical_username,verification_status,quality_status,actor_type
)
select
  md5('target:'||s::text)::uuid,
  '10000000-0000-0000-0001-000000000001'::uuid,
  'synthetic_target_'||s,'valid','fixture','synthetic_target_'||s,
  'synthetic_target_'||s,'synthetic_target_'||s,'found','eligible','system'
from generate_series(7,30) s
on conflict (id) do nothing;
