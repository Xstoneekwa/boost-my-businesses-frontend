-- Synthetic local-only fixtures. No identifier below belongs to production.
set request.jwt.claim.role = 'service_role';

insert into public.commercial_packages (
  code,label,default_follow_day_cap,default_unfollow_day_cap,
  default_follow_session_cap,default_unfollow_session_cap,
  advanced_ct_enabled,ai_comment_enabled,ai_targeting_enabled,active
) values
  ('growth','Growth',20,20,20,20,false,false,false,true),
  ('pro','Pro',35,35,35,35,true,false,true,true),
  ('premium','Premium',50,50,50,50,true,true,true,true)
on conflict (code) do nothing;

insert into auth.users (id,email) values
  ('10000000-0000-0000-0000-000000000001','mono@example.invalid'),
  ('20000000-0000-0000-0000-000000000001','agency@example.invalid'),
  ('30000000-0000-0000-0000-000000000001','mixed@example.invalid'),
  ('90000000-0000-0000-0000-000000000001','outsider@example.invalid')
on conflict (id) do nothing;

insert into public.clients (id,name,status) values
  ('10000000-0000-0000-0000-000000000000','Synthetic Premium Mono','active'),
  ('20000000-0000-0000-0000-000000000000','Synthetic Premium Agency','active'),
  ('30000000-0000-0000-0000-000000000000','Synthetic Mixed Agency','active')
on conflict (id) do nothing;

insert into public.client_users (id,client_id,auth_user_id,role,status) values
  ('11000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000001','owner','active'),
  ('21000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000001','owner','active'),
  ('31000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000000','30000000-0000-0000-0000-000000000001','owner','active')
on conflict (client_id,auth_user_id) do nothing;

insert into public.ig_accounts (id,username,status,admin_lifecycle_status) values
  ('10000000-0000-0000-0001-000000000001','synthetic_mono','active','active'),
  ('20000000-0000-0000-0001-000000000001','synthetic_agency_1','active','active'),
  ('20000000-0000-0000-0001-000000000002','synthetic_agency_2','active','active'),
  ('20000000-0000-0000-0001-000000000003','synthetic_agency_3','active','active'),
  ('30000000-0000-0000-0001-000000000001','synthetic_mixed_growth','active','active'),
  ('30000000-0000-0000-0001-000000000002','synthetic_mixed_pro','active','active'),
  ('30000000-0000-0000-0001-000000000003','synthetic_mixed_premium','active','active')
on conflict (id) do nothing;

insert into public.client_instagram_accounts (client_id,account_id,onboarding_status,provisioning_status,login_status,active) values
  ('10000000-0000-0000-0000-000000000000','10000000-0000-0000-0001-000000000001','ready','ready','connected',true),
  ('20000000-0000-0000-0000-000000000000','20000000-0000-0000-0001-000000000001','ready','ready','connected',true),
  ('20000000-0000-0000-0000-000000000000','20000000-0000-0000-0001-000000000002','ready','ready','connected',true),
  ('20000000-0000-0000-0000-000000000000','20000000-0000-0000-0001-000000000003','ready','ready','connected',true),
  ('30000000-0000-0000-0000-000000000000','30000000-0000-0000-0001-000000000001','ready','ready','connected',true),
  ('30000000-0000-0000-0000-000000000000','30000000-0000-0000-0001-000000000002','ready','ready','connected',true),
  ('30000000-0000-0000-0000-000000000000','30000000-0000-0000-0001-000000000003','ready','ready','connected',true)
on conflict (client_id,account_id) do nothing;

insert into public.commercial_checkout_sessions (
  id,idempotency_key,flow_type,status,client_id,auth_user_id,purchaser_email,
  plan_key,billing_interval_months,billable_account_count,applied_discount_type,
  pack_base_monthly_cents,pack_monthly_discounted_cents,pack_period_total_cents,
  total_period_cents,catalog_snapshot,metadata,commercial_mode
)
select
  md5('checkout:'||a.account_id::text)::uuid,
  'synthetic-checkout-'||a.account_id::text,
  'first_purchase','checkout_paid',a.client_id,a.user_id,'fixture@example.invalid',
  a.plan_key,1,1,'none',100,100,100,100,'{}'::jsonb,'{"fixture":true}'::jsonb,'full_cycle'
from (values
  ('10000000-0000-0000-0000-000000000000'::uuid,'10000000-0000-0000-0000-000000000001'::uuid,'10000000-0000-0000-0001-000000000001'::uuid,'premium'),
  ('20000000-0000-0000-0000-000000000000'::uuid,'20000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0001-000000000001'::uuid,'premium'),
  ('20000000-0000-0000-0000-000000000000'::uuid,'20000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0001-000000000002'::uuid,'premium'),
  ('20000000-0000-0000-0000-000000000000'::uuid,'20000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0001-000000000003'::uuid,'premium'),
  ('30000000-0000-0000-0000-000000000000'::uuid,'30000000-0000-0000-0000-000000000001'::uuid,'30000000-0000-0000-0001-000000000001'::uuid,'growth'),
  ('30000000-0000-0000-0000-000000000000'::uuid,'30000000-0000-0000-0000-000000000001'::uuid,'30000000-0000-0000-0001-000000000002'::uuid,'pro'),
  ('30000000-0000-0000-0000-000000000000'::uuid,'30000000-0000-0000-0000-000000000001'::uuid,'30000000-0000-0000-0001-000000000003'::uuid,'premium')
) a(client_id,user_id,account_id,plan_key)
on conflict (id) do nothing;

insert into public.client_account_entitlements (
  id,client_id,checkout_session_id,plan_key,commercial_package_code,billing_interval_months,
  applied_discount_type,pack_monthly_discounted_cents,pack_period_total_cents,total_period_cents,
  catalog_snapshot,status,account_id,consumed_at,metadata
)
select
  md5('entitlement:'||a.account_id::text)::uuid,a.client_id,
  md5('checkout:'||a.account_id::text)::uuid,a.plan_key,a.plan_key,1,'none',100,100,100,
  '{}'::jsonb,'entitlement_consumed',a.account_id,now(),'{"commercial_mode":"full_cycle","version":"fixture-v1"}'::jsonb
from (values
  ('10000000-0000-0000-0000-000000000000'::uuid,'10000000-0000-0000-0001-000000000001'::uuid,'premium'),
  ('20000000-0000-0000-0000-000000000000'::uuid,'20000000-0000-0000-0001-000000000001'::uuid,'premium'),
  ('20000000-0000-0000-0000-000000000000'::uuid,'20000000-0000-0000-0001-000000000002'::uuid,'premium'),
  ('20000000-0000-0000-0000-000000000000'::uuid,'20000000-0000-0000-0001-000000000003'::uuid,'premium'),
  ('30000000-0000-0000-0000-000000000000'::uuid,'30000000-0000-0000-0001-000000000001'::uuid,'growth'),
  ('30000000-0000-0000-0000-000000000000'::uuid,'30000000-0000-0000-0001-000000000002'::uuid,'pro'),
  ('30000000-0000-0000-0000-000000000000'::uuid,'30000000-0000-0000-0001-000000000003'::uuid,'premium')
) a(client_id,account_id,plan_key)
on conflict (id) do nothing;

insert into public.ig_targets (
  id,account_id,target_username,status,source,input_username,normalized_username,
  canonical_username,verification_status,quality_status,actor_type
)
select
  md5('target:'||s::text)::uuid,
  '10000000-0000-0000-0001-000000000001'::uuid,
  'synthetic_target_'||s,'valid','fixture','synthetic_target_'||s,
  'synthetic_target_'||s,'synthetic_target_'||s,'found','eligible','system'
from generate_series(1,6) s
on conflict (id) do nothing;
