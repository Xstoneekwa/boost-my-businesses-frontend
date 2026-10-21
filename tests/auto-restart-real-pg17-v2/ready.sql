begin;
insert into ig_account_settings(account_id,account_status,follow_enabled,follow_limit,max_actions_per_day,total_follows_limit) values ('00000000-0000-0000-0000-000000009002','active',true,80,80,80);
update client_instagram_accounts set login_identity_proof_status='verified',login_identity_profile_opened=true,login_identity_username_match=true,login_identity_verified_at=now(),login_identity_expected_username='local_cert_identity',login_identity_detected_username='local_cert_identity',login_status='connected',onboarding_status='ready',provisioning_status='ready' where account_id='00000000-0000-0000-0000-000000009002';
insert into ig_targets(account_id,target_username,status,verification_status,quality_status,followers_count,is_private,is_verified) values ('00000000-0000-0000-0000-000000009002','synthetic_target','valid','found','eligible',10000,false,false);
delete from auto_restart_tick_locks;
commit;
