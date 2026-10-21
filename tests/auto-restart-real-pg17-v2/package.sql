begin;
insert into commercial_packages(code,label,default_follow_day_cap,default_unfollow_day_cap,default_follow_session_cap,default_unfollow_session_cap,default_welcome_day_cap,default_outreach_day_cap,max_follow_day_cap,max_follow_session_cap) values ('growth','Synthetic Growth',80,80,80,80,0,0,80,80);
insert into commercial_package_runtime_settings(package_code,max_follows_per_target_per_run,max_targets_per_run,likes_per_follow_min,likes_per_follow_max,likes_per_day_limit,welcome_per_session_limit,outreach_per_session_limit,unfollow_after_days,runtime_profile,schedule_mode,slot_kind,warmup_day_1_cap,warmup_day_2_cap,warmup_day_3_cap) values ('growth',20,4,0,2,100,0,0,3,'full_cycle','scheduled','full_cycle_6h',20,40,80);
insert into account_commercial_packages(account_id,package_code) values ('00000000-0000-0000-0000-000000009002','growth');
select reconcile_legacy_account_assignment_binding_v1('00000000-0000-0000-0000-000000009002','local-fixture');
select account_package_runtime_contract_status('00000000-0000-0000-0000-000000009002');
commit;
