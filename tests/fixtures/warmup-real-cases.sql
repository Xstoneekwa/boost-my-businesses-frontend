-- Synthetic rows only. Real triggers stay enabled throughout setup and tests.
CREATE FUNCTION pg_temp.assert_true(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'qualification_assertion: %', message; END IF; END $$;

CREATE FUNCTION pg_temp.seed_account(tag text, initial_package text, final_cap integer, manual_cap boolean, account_override integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  aid uuid := md5('account:' || tag)::uuid;
  cid uuid := md5('client:' || tag)::uuid;
  cia uuid := md5('client-account:' || tag)::uuid;
  sid uuid := md5('subscription:' || tag)::uuid;
  sa uuid := md5('subscription-account:' || tag)::uuid;
  did uuid := md5('device:' || tag)::uuid;
  appid uuid := md5('app:' || tag)::uuid;
  start_time timestamptz := date_trunc('day', now()) - interval '30 days';
  package_cap integer;
BEGIN
  SELECT default_follow_day_cap INTO STRICT package_cap FROM commercial_packages WHERE code = initial_package;
  INSERT INTO ig_accounts(id, username, status) VALUES(aid, 'fixture_' || tag, 'active');
  INSERT INTO clients(id, name) VALUES(cid, 'Synthetic tenant ' || tag);
  INSERT INTO client_instagram_accounts(id, client_id, account_id) VALUES(cia, cid, aid);
  INSERT INTO client_subscriptions(id, client_id, subscription_type) VALUES(sid, cid, 'full_cycle');
  INSERT INTO client_subscription_accounts(id, subscription_id, client_instagram_account_id, account_id) VALUES(sa, sid, cia, aid);
  INSERT INTO phone_devices(id, device_kind, name, pool_type, timezone) VALUES(did, 'physical_phone', 'Synthetic ' || tag, 'full_cycle', 'Africa/Johannesburg');
  INSERT INTO phone_app_instances(id, device_id, instance_type, instance_index, visible_label, package_name, launch_activity, is_launchable, usable_for_auto_login, status)
    VALUES(appid, did, 'primary_app', 0, 'Synthetic', 'com.example.fixture', 'FixtureActivity', true, true, 'available');
  INSERT INTO ig_account_settings(account_id, app_package, clone_mode, cloned_app_mode, max_actions_per_day, follow_limit, max_follow_per_run, likes_per_follow_min, likes_per_follow_max, total_likes_limit)
    VALUES(aid, 'com.example.fixture', 'off', false, package_cap, package_cap, package_cap, 0, 2, 100);
  INSERT INTO account_follow_source_settings(account_id, max_follows_per_target_per_run, max_targets_per_run) VALUES(aid, 30, 4);
  INSERT INTO ig_account_unfollow_settings(account_id, unfollow_per_day_limit, unfollow_per_session_limit) VALUES(aid, 120, 120);
  INSERT INTO ig_account_dm_settings(account_id, welcome_enabled, outreach_enabled, welcome_per_day_limit, welcome_per_session_limit, outreach_per_day_limit, outreach_per_session_limit)
    VALUES(aid, false, false, 0, 0, 0, 0);
  INSERT INTO account_commercial_packages(account_id, package_code, starts_at) VALUES(aid, initial_package, start_time);
  INSERT INTO account_assignments(client_id, subscription_id, subscription_account_id, account_id, device_id, app_instance_id, assignment_type, slot_kind, schedule_mode, starts_at, ends_at, status)
    VALUES(cid, sid, sa, aid, did, appid, 'full_cycle', 'manual_only', 'manual_only', NULL, NULL, 'active');
  PERFORM pg_temp.assert_true((account_package_runtime_contract_status(aid)->>'ok')::boolean, 'seed runtime must be genuinely healthy: ' || tag);
  UPDATE account_warmup_settings SET day_4_plus_follow_cap = final_cap,
    updated_at = start_time + CASE WHEN manual_cap THEN interval '1 hour' ELSE interval '0 hours' END WHERE account_id = aid;
  IF account_override IS NOT NULL THEN
    INSERT INTO ig_account_follow_limit_overrides(account_id, follow_day_cap_override, follow_session_cap_override, source, classification)
      VALUES(aid, account_override, account_override, 'admin', 'explicit');
    PERFORM apply_account_follow_limit_provenance_v1(aid);
  END IF;
  RETURN aid;
END $$;

CREATE FUNCTION pg_temp.change_package(aid uuid, next_package text) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE transition_time timestamptz := date_trunc('day', now()) - interval '1 day';
BEGIN
  UPDATE account_commercial_packages SET status = 'ended', ends_at = transition_time WHERE account_id = aid AND status = 'active';
  INSERT INTO account_commercial_packages(account_id, package_code, starts_at) VALUES(aid, next_package, transition_time);
  PERFORM pg_temp.assert_true((account_package_runtime_contract_status(aid)->>'ok')::boolean, 'runtime healthy after package transition');
END $$;

CREATE FUNCTION pg_temp.seed_verified_follow_days(aid uuid, prior_days integer)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  i integer;
  rid uuid;
  event_id uuid;
  target_name text;
  event_time timestamptz;
BEGIN
  IF prior_days < 0 OR prior_days > 10 THEN RAISE EXCEPTION 'invalid_fixture_day_count'; END IF;
  FOR i IN 1..prior_days LOOP
    rid := gen_random_uuid();
    target_name := 'synthetic_target_' || i;
    event_time := (((now() AT TIME ZONE 'Africa/Johannesburg')::date - i) + time '12:00') AT TIME ZONE 'Africa/Johannesburg';
    INSERT INTO ig_runs(id, account_id) VALUES(rid, aid);
    INSERT INTO ig_interacted_users(account_id, run_id, username, interaction_type, was_successful, followed_at)
      VALUES(aid, rid, target_name, 'follow', true, event_time);
    INSERT INTO ig_interaction_events(account_id, run_id, username, event_type, event_status, interaction_type, interaction_status, event_at)
      VALUES(aid, rid, target_name, 'follow_verified_persisted_v1', 'success', 'follow', 'success', event_time)
      RETURNING id INTO event_id;
    PERFORM pg_temp.assert_true((SELECT ever_followed_action_id = event_id AND ever_followed_canonical_at = event_time
      FROM ig_interacted_users WHERE account_id = aid AND username = target_name), 'canonical interaction projection must be produced by the real trigger');
  END LOOP;
END $$;

SET LOCAL ROLE service_role;
INSERT INTO commercial_packages(code, label, default_follow_day_cap, max_follow_day_cap, default_follow_session_cap, max_follow_session_cap, default_unfollow_day_cap, default_unfollow_session_cap)
  VALUES ('growth','Synthetic Growth',80,80,80,80,120,120), ('pro','Synthetic Pro',120,120,120,120,120,120),
  ('premium','Synthetic Premium',120,120,120,120,120,120), ('lower','Synthetic Lower',60,60,60,60,120,120), ('higher','Synthetic Higher',160,160,160,160,120,120);
INSERT INTO commercial_package_runtime_settings(package_code,max_follows_per_target_per_run,max_targets_per_run,likes_per_follow_min,likes_per_follow_max,likes_per_day_limit,welcome_per_session_limit,outreach_per_session_limit,unfollow_after_days,runtime_profile,schedule_mode,slot_kind,warmup_day_1_cap,warmup_day_2_cap,warmup_day_3_cap)
  SELECT code,30,4,0,2,100,0,5,3,'full_cycle','manual_only','manual_only',10,20,40 FROM commercial_packages;
