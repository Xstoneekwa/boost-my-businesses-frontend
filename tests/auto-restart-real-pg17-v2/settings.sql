begin;
insert into ig_account_unfollow_settings(account_id,unfollow_enabled,unfollow_per_day_limit,unfollow_per_session_limit) values ('00000000-0000-0000-0000-000000009002',false,80,80);
insert into ig_account_dm_settings(account_id,welcome_enabled,outreach_enabled,welcome_per_day_limit,welcome_per_session_limit,outreach_per_day_limit,outreach_per_session_limit,total_dm_per_day_limit) values ('00000000-0000-0000-0000-000000009002',false,false,0,0,0,0,0);
insert into account_follow_source_settings(account_id,max_targets_per_run,max_follows_per_target_per_run) values ('00000000-0000-0000-0000-000000009002',4,20);
select account_package_runtime_contract_status('00000000-0000-0000-0000-000000009002');
commit;
