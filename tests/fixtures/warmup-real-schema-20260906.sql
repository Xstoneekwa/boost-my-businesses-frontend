-- Generated from read-only PostgreSQL 17.6 production catalogs; no business rows.
-- Dedicated local cluster only. Complete conservative SQL dependency closure.
SET check_function_bodies = false;
CREATE ROLE "authenticated" NOLOGIN NOSUPERUSER INHERIT NOBYPASSRLS;
CREATE ROLE "anon" NOLOGIN NOSUPERUSER INHERIT NOBYPASSRLS;
CREATE ROLE "service_role" NOLOGIN NOSUPERUSER INHERIT BYPASSRLS;
CREATE ROLE "supabase_auth_admin" NOLOGIN NOSUPERUSER NOINHERIT NOBYPASSRLS;
CREATE ROLE "postgres" NOLOGIN NOSUPERUSER INHERIT BYPASSRLS;
CREATE ROLE "dashboard_user" NOLOGIN NOSUPERUSER INHERIT NOBYPASSRLS;
CREATE ROLE "supabase_admin" NOLOGIN NOSUPERUSER INHERIT NOBYPASSRLS;
CREATE SCHEMA private AUTHORIZATION postgres; CREATE SCHEMA auth AUTHORIZATION supabase_admin; CREATE SCHEMA extensions AUTHORIZATION postgres;
CREATE EXTENSION btree_gist; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role, postgres; GRANT USAGE ON SCHEMA private TO service_role; GRANT USAGE, CREATE ON SCHEMA auth TO supabase_auth_admin; SET search_path = public, extensions;
CREATE TYPE "auth"."factor_type" AS ENUM ('totp','webauthn','phone');
CREATE TYPE "auth"."factor_status" AS ENUM ('unverified','verified');
CREATE TYPE "auth"."aal_level" AS ENUM ('aal1','aal2','aal3');
CREATE TYPE "auth"."code_challenge_method" AS ENUM ('s256','plain');
CREATE TYPE "auth"."one_time_token_type" AS ENUM ('confirmation_token','reauthentication_token','recovery_token','email_change_token_new','email_change_token_current','phone_change_token');
CREATE TYPE "auth"."oauth_registration_type" AS ENUM ('dynamic','manual');
CREATE TYPE "auth"."oauth_authorization_status" AS ENUM ('pending','approved','denied','expired');
CREATE TYPE "auth"."oauth_response_type" AS ENUM ('code');
CREATE TYPE "auth"."oauth_client_type" AS ENUM ('public','confidential');
CREATE TYPE "public"."welcome_dm_status" AS ENUM ('not_eligible_baseline','pending','reserved','sent','skipped','failed');
CREATE TYPE "public"."dm_type" AS ENUM ('welcome','outreach');
CREATE TYPE "public"."dm_job_source" AS ENUM ('welcome_scan','n8n','dashboard','campaign','manual');
CREATE TYPE "public"."dm_job_status" AS ENUM ('pending','reserved','running','sent','skipped','failed','cancelled');
CREATE TYPE "public"."dm_template_type" AS ENUM ('welcome','outreach');
CREATE TYPE "public"."restaurant_app_plan" AS ENUM ('starter','pro','enterprise');
CREATE TYPE "public"."restaurant_reservation_status" AS ENUM ('pending','confirmed','cancelled','completed','no_show');
CREATE TYPE "public"."restaurant_call_status" AS ENUM ('started','in_progress','completed','failed','escalated','abandoned');
CREATE TYPE "public"."restaurant_call_event_type" AS ENUM ('call_started','intent_detected','tool_called','tool_succeeded','tool_failed','reservation_created','reservation_updated','reservation_cancelled','rag_search','rag_low_confidence','human_escalation_requested','human_escalation_completed','call_ended','system_error','handoff_created','handoff_notification_sent','handoff_notification_failed','fallback_returned','escalation_detected','handoff_reminder_sent','handoff_reminder_failed','handoff_escalated','handoff_acknowledged','route_selected','agent_called','call_completed','fallback_triggered','whatsapp_reply_received','booking_link_sent');
CREATE TYPE "public"."restaurant_escalation_status" AS ENUM ('pending','transferring','connected','missed','resolved','failed');
CREATE TYPE "public"."restaurant_doc_type" AS ENUM ('menu','faq','policy','events','internal_note','allergen_guide','service_script');
CREATE TYPE "public"."restaurant_chunk_status" AS ENUM ('active','archived');
CREATE TYPE "public"."restaurant_job_status" AS ENUM ('queued','processing','completed','failed','dead_letter');
CREATE TYPE "public"."user_role" AS ENUM ('tenant','superadmin');
CREATE TYPE "public"."lead_status" AS ENUM ('new','low_score','qualified','contacted','replied','booked','closed','not_interested','unreachable');
CREATE TYPE "public"."lead_priority" AS ENUM ('high','medium','low');
CREATE TYPE "public"."task_status" AS ENUM ('pending_review','approved','sent','cancelled','failed');
CREATE TYPE "public"."recommended_channel" AS ENUM ('email','whatsapp','call','manual_review');
CREATE TABLE "public"."account_warmup_settings" (
"account_id" uuid NOT NULL,
"warmup_enabled" boolean NOT NULL,
"package_started_at" timestamp with time zone,
"warmup_profile_code" text NOT NULL,
"day_1_follow_cap" integer NOT NULL,
"day_2_follow_cap" integer NOT NULL,
"day_3_follow_cap" integer NOT NULL,
"day_4_plus_follow_cap" integer,
"status" text NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"warmup_started_at" timestamp with time zone
);
CREATE TABLE "public"."commercial_packages" (
"code" text NOT NULL,
"label" text NOT NULL,
"default_follow_day_cap" integer,
"default_unfollow_day_cap" integer,
"default_follow_session_cap" integer,
"default_unfollow_session_cap" integer,
"default_welcome_enabled" boolean NOT NULL,
"default_outreach_enabled" boolean NOT NULL,
"default_welcome_day_cap" integer,
"default_outreach_day_cap" integer,
"advanced_ct_enabled" boolean NOT NULL,
"ai_comment_enabled" boolean NOT NULL,
"ai_targeting_enabled" boolean NOT NULL,
"active" boolean NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"max_follow_day_cap" integer,
"max_follow_session_cap" integer
);
CREATE TABLE "public"."account_commercial_packages" (
"id" uuid NOT NULL,
"account_id" uuid NOT NULL,
"package_code" text NOT NULL,
"status" text NOT NULL,
"starts_at" timestamp with time zone NOT NULL,
"ends_at" timestamp with time zone,
"source" text NOT NULL,
"metadata_safe" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."ig_account_social_profile_snapshots" (
"id" uuid NOT NULL,
"account_id" uuid NOT NULL,
"username_normalized" text NOT NULL,
"followers_count" integer,
"following_count" integer,
"posts_count" integer,
"observed_at" timestamp with time zone NOT NULL,
"snapshot_local_date" date NOT NULL,
"account_timezone" text NOT NULL,
"timezone_source" text NOT NULL,
"source_provider" text NOT NULL,
"source_trigger" text NOT NULL,
"source_event_id" text,
"source_run_id" uuid,
"source_business_session_id" uuid,
"lookup_status" text NOT NULL,
"freshness_status" text NOT NULL,
"idempotency_key" text NOT NULL,
"created_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."ig_account_follow_limit_overrides" (
"account_id" uuid NOT NULL,
"classification" text NOT NULL,
"follow_day_cap_override" integer,
"follow_session_cap_override" integer,
"max_follow_per_run_legacy" integer,
"source" text NOT NULL,
"source_surface" text,
"updated_by" uuid,
"reason" text,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."ig_accounts" (
"id" uuid NOT NULL,
"username" text NOT NULL,
"display_name" text,
"platform" text,
"device_name" text,
"device_udid" text,
"status" text,
"email" text,
"password" text,
"two_fa_enabled" boolean,
"notes" text,
"created_at" timestamp with time zone,
"updated_at" timestamp with time zone,
"archived_at" timestamp with time zone,
"trashed_at" timestamp with time zone,
"scheduled_trash_at" timestamp with time zone,
"scheduled_delete_at" timestamp with time zone,
"restored_at" timestamp with time zone,
"device_id" uuid,
"clone_mode" text,
"login_method" text,
"internal_label" text,
"username_verification_status" text NOT NULL,
"username_verified_at" timestamp with time zone,
"username_verification_reason" text,
"instagram_user_id" text,
"external_profile_id" text,
"is_private" boolean,
"is_verified" boolean,
"followers_count" integer,
"avatar_url" text,
"avatar_checked_at" timestamp with time zone,
"public_profile_metadata" jsonb NOT NULL,
"admin_lifecycle_status" text NOT NULL
);
CREATE TABLE "public"."ig_devices" (
"id" uuid NOT NULL,
"device_name" text NOT NULL,
"device_udid" text,
"platform" text,
"status" text,
"appium_port" integer,
"notes" text,
"created_at" timestamp with time zone,
"updated_at" timestamp with time zone
);
CREATE TABLE "public"."client_account_entitlements" (
"id" uuid NOT NULL,
"client_id" uuid NOT NULL,
"checkout_session_id" uuid NOT NULL,
"plan_key" text,
"commercial_package_code" text,
"billing_interval_months" integer NOT NULL,
"outreach_addon_key" text,
"outreach_variant" text,
"backend_addon_code" text,
"applied_discount_percent" numeric(5,4) NOT NULL,
"applied_discount_type" text NOT NULL,
"pack_monthly_discounted_cents" integer,
"pack_period_total_cents" integer,
"outreach_monthly_discounted_cents" integer,
"outreach_period_total_cents" integer,
"total_period_cents" integer NOT NULL,
"catalog_snapshot" jsonb NOT NULL,
"status" text NOT NULL,
"account_id" uuid,
"consumed_at" timestamp with time zone,
"metadata" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"pricing_snapshot" jsonb
);
CREATE TABLE "public"."account_package_runtime_contract_events" (
"id" uuid NOT NULL,
"account_id" uuid,
"assignment_id" uuid,
"request_id" uuid,
"event_type" text NOT NULL,
"source" text NOT NULL,
"idempotency_key" text,
"details_safe" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."ig_account_unfollow_settings" (
"account_id" uuid NOT NULL,
"unfollow_enabled" boolean NOT NULL,
"unfollow_only" boolean NOT NULL,
"do_unfollow_first" boolean NOT NULL,
"unfollow_after_days" integer NOT NULL,
"unfollow_mode" text NOT NULL,
"unfollow_sort_mode" text NOT NULL,
"unfollow_per_session_limit" integer NOT NULL,
"unfollow_per_day_limit" integer NOT NULL,
"package_default_snapshot" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"runtime_cap_mode" text NOT NULL,
"runtime_safety_cap" integer
);
CREATE TABLE "public"."clients" (
"id" uuid NOT NULL,
"name" text NOT NULL,
"status" text NOT NULL,
"metadata" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."account_assignments" (
"id" uuid NOT NULL,
"client_id" uuid NOT NULL,
"subscription_id" uuid NOT NULL,
"subscription_account_id" uuid NOT NULL,
"account_id" uuid NOT NULL,
"device_id" uuid NOT NULL,
"clone_id" uuid,
"assignment_type" text NOT NULL,
"slot_kind" text NOT NULL,
"status" text NOT NULL,
"starts_at" timestamp with time zone,
"ends_at" timestamp with time zone,
"assigned_at" timestamp with time zone,
"released_at" timestamp with time zone,
"metadata" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"assignment_source" text NOT NULL,
"app_instance_id" uuid,
"schedule_mode" text NOT NULL
);
CREATE TABLE "public"."commercial_checkout_sessions" (
"id" uuid NOT NULL,
"idempotency_key" text NOT NULL,
"flow_type" text NOT NULL,
"status" text NOT NULL,
"client_id" uuid,
"auth_user_id" uuid,
"purchaser_email" text NOT NULL,
"plan_key" text,
"billing_interval_months" integer NOT NULL,
"outreach_addon_key" text,
"billable_account_count" integer NOT NULL,
"term_discount_percent" numeric(5,4) NOT NULL,
"agency_discount_percent" numeric(5,4) NOT NULL,
"applied_discount_percent" numeric(5,4) NOT NULL,
"applied_discount_type" text NOT NULL,
"pack_base_monthly_cents" integer,
"pack_monthly_discounted_cents" integer,
"pack_period_total_cents" integer,
"outreach_base_monthly_cents" integer,
"outreach_monthly_discounted_cents" integer,
"outreach_period_total_cents" integer,
"total_period_cents" integer NOT NULL,
"catalog_snapshot" jsonb NOT NULL,
"metadata" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"activated_at" timestamp with time zone,
"pricing_snapshot" jsonb,
"commercial_mode" text,
"stripe_pricing_mode" text,
"pricing_snapshot_fingerprint" text,
"commercial_test_mode" text
);
CREATE TABLE "public"."account_run_requests" (
"id" uuid NOT NULL,
"account_id" uuid NOT NULL,
"requested_by" uuid,
"actor_type" text NOT NULL,
"source_surface" text NOT NULL,
"requested_run_type" text NOT NULL,
"status" text NOT NULL,
"priority" integer NOT NULL,
"idempotency_key" text NOT NULL,
"run_id" uuid,
"claimed_by" text,
"lease_expires_at" timestamp with time zone,
"cancel_requested_at" timestamp with time zone,
"cancel_reason" text,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"claimed_at" timestamp with time zone,
"started_at" timestamp with time zone,
"completed_at" timestamp with time zone,
"canceled_at" timestamp with time zone,
"metadata_safe" jsonb NOT NULL,
"error_code" text,
"error_message_safe" text,
"root_business_session_id" uuid NOT NULL,
"execution_attempt_no" smallint NOT NULL,
"retry_index" smallint NOT NULL
);
CREATE TABLE "public"."ig_account_settings" (
"id" uuid NOT NULL,
"account_id" uuid,
"campaign_name" text,
"welcome_dm_enabled" boolean NOT NULL,
"welcome_dm_message" text,
"cold_dm_enabled" boolean NOT NULL,
"cold_dm_message" text,
"watch_story_enabled" boolean,
"like_enabled" boolean NOT NULL,
"follow_enabled" boolean NOT NULL,
"max_dm_per_run" integer NOT NULL,
"max_follow_per_run" integer,
"max_likes_per_run" integer,
"delay_min_seconds" integer,
"delay_max_seconds" integer,
"safe_review_mode" boolean NOT NULL,
"send_enabled" boolean NOT NULL,
"created_at" timestamp with time zone,
"updated_at" timestamp with time zone,
"dry_run_enabled" boolean NOT NULL,
"account_status" text,
"app_package" text,
"clone_mode" text,
"login_method" text,
"device_udid" text,
"device_name" text,
"story_watch_enabled" boolean NOT NULL,
"change_source_if_crash" boolean NOT NULL,
"delete_interacted_users" boolean NOT NULL,
"skipped_posts_limit" integer NOT NULL,
"source_accounts" text,
"truncate_sources_min" integer NOT NULL,
"truncate_sources_max" integer NOT NULL,
"sort_followers_mode" text,
"unfollow_non_followers" boolean NOT NULL,
"unfollow_any" boolean NOT NULL,
"unfollow_skip_limit" integer NOT NULL,
"mute_posts_after_follow" boolean NOT NULL,
"mute_stories_after_follow" boolean NOT NULL,
"do_follows_first" boolean NOT NULL,
"disable_block_detection" boolean NOT NULL,
"relog_after_block" boolean NOT NULL,
"relog_delay_seconds" integer NOT NULL,
"rotate_ip" boolean NOT NULL,
"restart_uiautomator2" boolean NOT NULL,
"close_apps" boolean NOT NULL,
"close_apps_device" boolean NOT NULL,
"log_out_all_before_session" boolean NOT NULL,
"total_crashes_limit" integer NOT NULL,
"screen_sleep" boolean NOT NULL,
"screen_record" boolean NOT NULL,
"debug_mode" boolean NOT NULL,
"random_delay_min_seconds" integer NOT NULL,
"random_delay_max_seconds" integer NOT NULL,
"total_interactions_limit" integer NOT NULL,
"total_successful_interactions_limit" integer NOT NULL,
"interactions_count" integer NOT NULL,
"interact_percentage" integer NOT NULL,
"end_if_follow_limit_reached" boolean NOT NULL,
"end_if_dm_limit_reached" boolean NOT NULL,
"end_if_likes_limit_reached" boolean NOT NULL,
"max_actions_per_hour" integer NOT NULL,
"max_actions_per_day" integer NOT NULL,
"random_pause_every_actions" integer NOT NULL,
"long_break_after_interactions" integer NOT NULL,
"long_break_min_minutes" integer NOT NULL,
"long_break_max_minutes" integer NOT NULL,
"warmup_mode" boolean NOT NULL,
"stop_on_suspicious_screen" boolean NOT NULL,
"stop_on_login_challenge" boolean NOT NULL,
"stop_on_checkpoint" boolean NOT NULL,
"stop_on_repeated_navigation_failure" boolean NOT NULL,
"max_repeated_errors" integer NOT NULL,
"username" text NOT NULL,
"display_name" text NOT NULL,
"email" text NOT NULL,
"password" text NOT NULL,
"two_fa_enabled" boolean NOT NULL,
"cloned_app_mode" boolean NOT NULL,
"timeslot_start" text NOT NULL,
"timeslot_end" text NOT NULL,
"total_sessions" integer NOT NULL,
"stop_interactions_after_minutes" integer NOT NULL,
"timeout_startup_seconds" integer NOT NULL,
"pause_account_days" integer NOT NULL,
"pause_account_until" text NOT NULL,
"randomize_start_enabled" boolean NOT NULL,
"speed_multiplier" numeric NOT NULL,
"follow_limit" integer NOT NULL,
"total_follows_limit" integer NOT NULL,
"follow_percentage" integer NOT NULL,
"unfollow_enabled" boolean NOT NULL,
"total_unfollows_limit" integer NOT NULL,
"unfollow_delay_days" integer NOT NULL,
"total_likes_limit" integer NOT NULL,
"likes_per_follow_min" integer NOT NULL,
"likes_per_follow_max" integer NOT NULL,
"likes_percentage" integer NOT NULL,
"watch_photo_time_min" integer NOT NULL,
"watch_photo_time_max" integer NOT NULL,
"watch_video_time_min" integer NOT NULL,
"watch_video_time_max" integer NOT NULL,
"max_consecutive_dms" integer NOT NULL,
"check_chat_before_welcoming" boolean NOT NULL,
"current_run_status" text NOT NULL,
"last_error" text NOT NULL,
"last_successful_action" text NOT NULL,
"manual_stop_requested" boolean NOT NULL,
"fling_when_skipped" boolean NOT NULL,
"followback_on_followers" boolean NOT NULL,
"max_followback_skips" integer NOT NULL,
"max_followback_ignore" integer NOT NULL
);
CREATE TABLE "public"."ig_account_unfollow_enablement_overrides" (
"account_id" uuid NOT NULL,
"override_enabled" boolean NOT NULL,
"source" text NOT NULL,
"source_surface" text,
"updated_by" uuid,
"reason" text,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."commercial_account_lifecycle_states" (
"account_id" uuid NOT NULL,
"entitlement_id" uuid,
"stripe_subscription_id" text,
"commercial_state" text NOT NULL,
"pause_expires_at" timestamp with time zone,
"paused_at" timestamp with time zone,
"stripe_billing_paused" boolean NOT NULL,
"action_required_reason" text,
"last_operation_id" uuid,
"last_idempotency_key" text,
"metadata_safe" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"terminal_cancel_operation_id" uuid,
"terminal_cancelled_at" timestamp with time zone,
"terminal_cancel_entitlement_id" uuid,
"terminal_cancel_stripe_subscription_id" text
);
CREATE TABLE "public"."ig_account_dm_settings" (
"account_id" uuid NOT NULL,
"welcome_enabled" boolean NOT NULL,
"outreach_enabled" boolean NOT NULL,
"welcome_template_id" uuid,
"default_outreach_template_id" uuid,
"welcome_per_session_limit" integer NOT NULL,
"welcome_per_day_limit" integer NOT NULL,
"outreach_per_session_limit" integer NOT NULL,
"outreach_per_day_limit" integer NOT NULL,
"total_dm_per_day_limit" integer NOT NULL,
"check_chat_before_welcome" boolean NOT NULL,
"welcome_skip_if_existing_thread" boolean NOT NULL,
"outreach_skip_if_existing_thread" boolean NOT NULL,
"max_welcoming_skips" integer NOT NULL,
"random_delay_min_seconds" integer NOT NULL,
"random_delay_max_seconds" integer NOT NULL,
"welcome_baseline_completed_at" timestamp with time zone,
"welcome_baseline_scan_run_id" uuid,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."ig_interaction_events" (
"id" uuid NOT NULL,
"account_id" uuid,
"run_id" uuid,
"session_id" text,
"username" text NOT NULL,
"source_profile" text,
"event_type" text NOT NULL,
"event_status" text NOT NULL,
"event_reason" text,
"event_at" timestamp with time zone,
"created_at" timestamp with time zone,
"payload" jsonb,
"target_id" uuid,
"ct_id" uuid,
"source_target_id" uuid,
"source_target_username" text,
"request_id" uuid,
"device_id" uuid,
"safe_device_label" text,
"interaction_type" text,
"interaction_status" text,
"evidence_source" text,
"evidence_confidence" text,
"evidence_summary" text,
"metadata_safe" jsonb,
"stage_idempotency_key" text
);
CREATE TABLE "public"."commercial_plan_change_quotes" (
"id" uuid NOT NULL,
"client_id" uuid NOT NULL,
"idempotency_key" text NOT NULL,
"source_entitlement_id" uuid NOT NULL,
"source_checkout_session_id" uuid NOT NULL,
"source_plan_key" text NOT NULL,
"target_plan_key" text NOT NULL,
"billing_interval_months" integer NOT NULL,
"currency" text NOT NULL,
"period_start_at" timestamp with time zone NOT NULL,
"period_end_at" timestamp with time zone NOT NULL,
"active_commercial_period_value_cents" integer NOT NULL,
"remaining_ratio_bps" integer NOT NULL,
"current_unused_credit_cents" integer NOT NULL,
"target_full_period_price_cents" integer NOT NULL,
"target_remaining_cost_cents" integer NOT NULL,
"existing_customer_credit_cents" integer NOT NULL,
"available_credit_cents" integer NOT NULL,
"credit_applied_cents" integer NOT NULL,
"amount_due_cents" integer NOT NULL,
"remaining_credit_cents" integer NOT NULL,
"payment_provider" text,
"payment_status" text NOT NULL,
"provider_transaction_id" text,
"payment_confirmed_at" timestamp with time zone,
"source_revision" text NOT NULL,
"status" text NOT NULL,
"quote_expires_at" timestamp with time zone NOT NULL,
"activated_at" timestamp with time zone,
"activated_checkout_session_id" uuid,
"metadata" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"account_id" uuid,
"target_outreach_addon_key" text,
"change_scope" text NOT NULL,
"pricing_snapshot" jsonb,
"actual_stripe_amount_due_cents" integer,
"actual_stripe_remaining_credit_cents" integer,
"actual_stripe_proration_net_cents" integer,
"actual_stripe_plan_period_total_cents" integer,
"actual_stripe_period_start_at" timestamp with time zone,
"actual_stripe_period_end_at" timestamp with time zone,
"actual_stripe_source" text,
"actual_stripe_object_ids" jsonb NOT NULL,
"actual_stripe_reconciled_at" timestamp with time zone
);
CREATE TABLE "public"."client_users" (
"id" uuid NOT NULL,
"client_id" uuid NOT NULL,
"auth_user_id" uuid NOT NULL,
"role" text NOT NULL,
"status" text NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."client_entitlements" (
"id" uuid NOT NULL,
"client_id" uuid NOT NULL,
"feature_code" text NOT NULL,
"entitlement_type" text NOT NULL,
"active" boolean NOT NULL,
"valid_from" timestamp with time zone,
"valid_until" timestamp with time zone,
"metadata" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"account_id" uuid,
"source_subscription_id" uuid,
"source_subscription_account_id" uuid,
"source_subscription_module_id" uuid
);
CREATE TABLE "public"."client_subscriptions" (
"id" uuid NOT NULL,
"client_id" uuid NOT NULL,
"subscription_type" text NOT NULL,
"status" text NOT NULL,
"starts_at" timestamp with time zone NOT NULL,
"ends_at" timestamp with time zone,
"metadata" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."client_subscription_accounts" (
"id" uuid NOT NULL,
"subscription_id" uuid NOT NULL,
"client_instagram_account_id" uuid NOT NULL,
"account_id" uuid NOT NULL,
"status" text NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."phone_clones" (
"id" uuid NOT NULL,
"device_id" uuid NOT NULL,
"clone_index" integer NOT NULL,
"clone_label" text,
"status" text NOT NULL,
"current_account_id" uuid,
"metadata" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."phone_devices" (
"id" uuid NOT NULL,
"device_kind" text NOT NULL,
"name" text NOT NULL,
"device_name" text,
"adb_serial" text,
"device_udid" text,
"host_machine" text,
"hub_label" text,
"hub_port" text,
"pool_type" text NOT NULL,
"max_clones" integer NOT NULL,
"status" text NOT NULL,
"status_reason" text,
"metadata" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"timezone" text NOT NULL,
"retired_at" timestamp with time zone
);
CREATE TABLE "public"."phone_app_instances" (
"id" uuid NOT NULL,
"device_id" uuid NOT NULL,
"instance_type" text NOT NULL,
"instance_index" integer NOT NULL,
"visible_label" text NOT NULL,
"package_name" text,
"launch_activity" text,
"is_launchable" boolean NOT NULL,
"status" text NOT NULL,
"current_account_id" uuid,
"usable_for_auto_login" boolean NOT NULL,
"metadata" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."runtime_events" (
"id" uuid NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"event_type" text NOT NULL,
"severity" text NOT NULL,
"visibility" text NOT NULL,
"account_id" uuid,
"run_id" uuid,
"assignment_id" uuid,
"device_id" uuid,
"clone_id" uuid,
"job_id" uuid,
"dm_type" text,
"source" text,
"reason" text,
"message" text,
"metadata" jsonb NOT NULL
);
CREATE TABLE "public"."account_commercial_addons" (
"id" uuid NOT NULL,
"account_id" uuid NOT NULL,
"addon_code" text NOT NULL,
"addon_variant" text,
"source_type" text,
"status" text NOT NULL,
"starts_at" timestamp with time zone NOT NULL,
"ends_at" timestamp with time zone,
"source" text NOT NULL,
"metadata_safe" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."commercial_account_lifecycle_operations" (
"id" uuid NOT NULL,
"account_id" uuid NOT NULL,
"entitlement_id" uuid,
"operation_type" text NOT NULL,
"idempotency_key" text NOT NULL,
"state" text NOT NULL,
"reason" text,
"actor_type" text,
"actor_id" uuid,
"source_surface" text,
"error_redacted" text,
"metadata_safe" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."client_instagram_accounts" (
"id" uuid NOT NULL,
"client_id" uuid NOT NULL,
"account_id" uuid NOT NULL,
"label" text,
"onboarding_status" text NOT NULL,
"provisioning_status" text NOT NULL,
"login_status" text NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"active" boolean NOT NULL,
"onboarding_rollback_at" timestamp with time zone,
"onboarding_rollback_id" uuid,
"login_identity_proof_status" text NOT NULL,
"login_identity_expected_username" text,
"login_identity_detected_username" text,
"login_identity_profile_opened" boolean,
"login_identity_username_match" boolean,
"login_identity_verified_at" timestamp with time zone,
"login_identity_source_run_id" uuid,
"login_identity_failure_reason" text,
"login_identity_proof_version" integer NOT NULL,
"login_state_source_at" timestamp with time zone NOT NULL,
"login_state_version" bigint NOT NULL,
"login_state_invalidation_reason" text,
"login_identity_verification_source" text,
"login_identity_verification_method" text,
"login_identity_verified_by" text,
"login_identity_verified_account_id" uuid,
"login_identity_verified_device_id" uuid,
"login_identity_verified_app_instance_id" uuid,
"login_identity_verified_assignment_id" uuid,
"login_identity_login_lineage" jsonb NOT NULL,
"capacity_status" text NOT NULL,
"capacity_released_at" timestamp with time zone,
"capacity_release_reason" text,
"capacity_release_operation_id" uuid
);
CREATE TABLE "auth"."users" (
"instance_id" uuid,
"id" uuid NOT NULL,
"aud" character varying(255),
"role" character varying(255),
"email" character varying(255),
"encrypted_password" character varying(255),
"email_confirmed_at" timestamp with time zone,
"invited_at" timestamp with time zone,
"confirmation_token" character varying(255),
"confirmation_sent_at" timestamp with time zone,
"recovery_token" character varying(255),
"recovery_sent_at" timestamp with time zone,
"email_change_token_new" character varying(255),
"email_change" character varying(255),
"email_change_sent_at" timestamp with time zone,
"last_sign_in_at" timestamp with time zone,
"raw_app_meta_data" jsonb,
"raw_user_meta_data" jsonb,
"is_super_admin" boolean,
"created_at" timestamp with time zone,
"updated_at" timestamp with time zone,
"phone" text,
"phone_confirmed_at" timestamp with time zone,
"phone_change" text,
"phone_change_token" character varying(255),
"phone_change_sent_at" timestamp with time zone,
"confirmed_at" timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
"email_change_token_current" character varying(255),
"email_change_confirm_status" smallint,
"banned_until" timestamp with time zone,
"reauthentication_token" character varying(255),
"reauthentication_sent_at" timestamp with time zone,
"is_sso_user" boolean NOT NULL,
"deleted_at" timestamp with time zone,
"is_anonymous" boolean NOT NULL
);
CREATE TABLE "public"."ig_dm_templates" (
"id" uuid NOT NULL,
"account_id" uuid NOT NULL,
"template_type" dm_template_type NOT NULL,
"name" text NOT NULL,
"body" text NOT NULL,
"is_default" boolean NOT NULL,
"active" boolean NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."ig_targets" (
"id" uuid NOT NULL,
"account_id" uuid,
"target_username" text NOT NULL,
"status" text,
"source" text,
"last_action_at" timestamp with time zone,
"created_at" timestamp with time zone,
"updated_at" timestamp with time zone NOT NULL,
"last_error" text,
"processed_at" timestamp with time zone,
"retry_count" integer NOT NULL,
"metadata" jsonb NOT NULL,
"last_run_at" timestamp with time zone,
"input_username" text,
"normalized_username" text,
"canonical_username" text,
"verification_status" text NOT NULL,
"verification_reason" text,
"quality_status" text NOT NULL,
"avatar_url" text,
"followers_count" integer,
"is_verified" boolean,
"is_private" boolean,
"provider_checked_at" timestamp with time zone,
"batch_id" uuid,
"actor_type" text,
"archive_reason" text,
"rejected_reason" text,
"archived_at" timestamp with time zone,
"deleted_at" timestamp with time zone,
"metadata_safe" jsonb NOT NULL,
"follows_sent_count" integer NOT NULL,
"followbacks_count" integer NOT NULL,
"followback_ratio" numeric,
"last_selected_at" timestamp with time zone,
"last_used_at" timestamp with time zone,
"last_successful_candidate_at" timestamp with time zone,
"last_exhausted_at" timestamp with time zone,
"exhaustion_reason" text,
"cooldown_until" timestamp with time zone,
"metrics_updated_at" timestamp with time zone,
"auto_archived_at" timestamp with time zone,
"readd_blocked_until" timestamp with time zone,
"followbacks_metrics_reliable_at" timestamp with time zone,
"readd_blocked_permanently" boolean NOT NULL,
"readd_block_reason" text,
"readd_blocked_at" timestamp with time zone,
"periodic_revalidation_last_terminal_at" timestamp with time zone,
"periodic_revalidation_next_due_at" timestamp with time zone,
"periodic_revalidation_window_key" text
);
CREATE TABLE "public"."client_subscription_modules" (
"id" uuid NOT NULL,
"subscription_id" uuid NOT NULL,
"feature_code" text NOT NULL,
"enabled" boolean NOT NULL,
"entitlement_type" text NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."account_follow_source_settings" (
"account_id" uuid NOT NULL,
"max_follows_per_target_per_run" integer NOT NULL,
"max_targets_per_run" integer NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"updated_by" text,
"metadata" jsonb NOT NULL
);
CREATE TABLE "public"."account_dashboard_actions" (
"id" uuid NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"account_id" uuid NOT NULL,
"client_id" uuid,
"incident_id" uuid,
"action_type" text NOT NULL,
"status" text NOT NULL,
"severity" text NOT NULL,
"audience" text NOT NULL,
"requires_client_action" boolean NOT NULL,
"blocking_campaign" boolean NOT NULL,
"title" text NOT NULL,
"safe_client_message" text,
"assistant_message" text,
"admin_message" text,
"action_label" text,
"action_deep_link" text,
"dedupe_key" text NOT NULL,
"resolved_at" timestamp with time zone,
"dismissed_at" timestamp with time zone,
"acknowledged_at" timestamp with time zone,
"metadata" jsonb NOT NULL,
"created_by_actor_type" text,
"created_by_actor_id" text,
"metadata_safe" jsonb NOT NULL
);
CREATE TABLE "public"."commercial_package_runtime_settings" (
"package_code" text NOT NULL,
"max_follows_per_target_per_run" integer NOT NULL,
"max_targets_per_run" integer NOT NULL,
"likes_per_follow_min" integer NOT NULL,
"likes_per_follow_max" integer NOT NULL,
"likes_per_day_limit" integer NOT NULL,
"welcome_per_session_limit" integer NOT NULL,
"outreach_per_session_limit" integer NOT NULL,
"unfollow_after_days" integer NOT NULL,
"runtime_profile" text NOT NULL,
"schedule_mode" text NOT NULL,
"slot_kind" text NOT NULL,
"warmup_enabled" boolean NOT NULL,
"warmup_profile_code" text NOT NULL,
"warmup_day_1_cap" integer NOT NULL,
"warmup_day_2_cap" integer NOT NULL,
"warmup_day_3_cap" integer NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."ig_runs" (
"id" uuid NOT NULL,
"account_id" uuid,
"status" text,
"started_at" timestamp with time zone,
"finished_at" timestamp with time zone,
"total_targets" integer,
"total_dm" integer,
"total_follow" integer,
"total_like" integer,
"total_story" integer,
"error_message" text,
"created_at" timestamp with time zone,
"performance_summary" jsonb,
"totals" jsonb,
"worker_type" text,
"completed_at" timestamp with time zone,
"updated_at" timestamp with time zone,
"live_counter_revision" bigint NOT NULL
);
CREATE TABLE "public"."incident_resume_authorizations" (
"id" uuid NOT NULL,
"incident_id" uuid NOT NULL,
"account_id" uuid NOT NULL,
"run_id" uuid,
"resume_plan_id" uuid,
"resume_window_key" text NOT NULL,
"scheduled_window_start" timestamp with time zone,
"scheduled_window_end" timestamp with time zone,
"status" text NOT NULL,
"armed_source" text NOT NULL,
"armed_by" text,
"armed_at" timestamp with time zone NOT NULL,
"consumed_at" timestamp with time zone,
"consumed_by_request_id" uuid,
"expired_at" timestamp with time zone,
"consume_error" text,
"resolution_note" text,
"metadata_safe" jsonb NOT NULL,
"test" boolean NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"retry_generation" integer NOT NULL,
"retry_credit_restored_at" timestamp with time zone,
"retry_credit_restore_reason" text,
"frozen_phase_plan" jsonb,
"source_run_id" uuid,
"source_request_id" uuid,
"resolved_by" uuid,
"resolved_at" timestamp with time zone,
"cause_fixed_version" text,
"business_date" date,
"expected_worker_sha" text,
"expires_at" timestamp with time zone,
"idempotency_key" text,
"canceled_at" timestamp with time zone
);
CREATE TABLE "public"."ig_account_unfollow_limit_overrides" (
"account_id" uuid NOT NULL,
"classification" text NOT NULL,
"unfollow_day_cap_override" integer,
"unfollow_session_cap_override" integer,
"source" text NOT NULL,
"source_surface" text,
"updated_by" uuid,
"reason" text,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."phonefarm_runtime_barriers" (
"barrier_name" text NOT NULL,
"active" boolean NOT NULL,
"owner_token" text,
"acquired_at" timestamp with time zone,
"expires_at" timestamp with time zone,
"released_at" timestamp with time zone,
"release_reason" text,
"metadata_safe" jsonb NOT NULL,
"generation" bigint NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."account_session_resume_plans" (
"id" uuid NOT NULL,
"run_id" uuid NOT NULL,
"run_request_id" uuid,
"account_id" uuid NOT NULL,
"assignment_id" uuid,
"device_id" uuid,
"app_instance_id" uuid,
"expected_username" text,
"expected_package" text,
"scheduled_window_start" timestamp with time zone,
"scheduled_window_end" timestamp with time zone,
"resume_window_key" text,
"source_surface" text,
"run_trigger" text,
"resume_stage" text NOT NULL,
"resume_state" text NOT NULL,
"restart_allowed" boolean NOT NULL,
"restart_block_reason" text NOT NULL,
"terminal_reason_code" text,
"incident_id" uuid,
"attempts_in_window" integer NOT NULL,
"plan" jsonb NOT NULL,
"test" boolean NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"last_updated_at" timestamp with time zone NOT NULL,
"zero_work_contract_version" smallint,
"irreversible_work_state" text,
"zero_work_certified_at" timestamp with time zone,
"worker_spawned_at" timestamp with time zone,
"runner_started_at" timestamp with time zone,
"device_activity_started_at" timestamp with time zone,
"device_connected_at" timestamp with time zone,
"instagram_launch_requested_at" timestamp with time zone,
"instagram_foreground_verified_at" timestamp with time zone
);
CREATE TABLE "public"."ig_action_logs" (
"id" uuid NOT NULL,
"account_id" uuid,
"run_id" uuid,
"target_username" text,
"action_type" text NOT NULL,
"status" text,
"message" text,
"payload" jsonb,
"created_at" timestamp with time zone,
"metadata" jsonb
);
CREATE TABLE "public"."ig_interacted_users" (
"id" uuid NOT NULL,
"account_id" uuid,
"run_id" uuid,
"username" text NOT NULL,
"source_profile" text,
"interaction_type" text NOT NULL,
"follow_status" text,
"was_successful" boolean,
"followed_at" timestamp with time zone,
"unfollowed_at" timestamp with time zone,
"last_interaction_at" timestamp with time zone,
"created_at" timestamp with time zone,
"updated_at" timestamp with time zone,
"payload" jsonb,
"first_source_profile" text,
"last_source_profile" text,
"first_run_id" uuid,
"last_run_id" uuid,
"last_session_id" text,
"follow_requested_at" timestamp with time zone,
"muted_posts" boolean,
"muted_stories" boolean,
"last_muted_at" timestamp with time zone,
"posts_liked_count" integer,
"stories_liked_count" integer,
"stories_watched_count" integer,
"dm_sent" boolean,
"welcome_dm_sent" boolean,
"is_following_back" boolean,
"followback_detected_at" timestamp with time zone,
"followed_by_bot" boolean,
"eligible_unfollow_at" timestamp with time zone,
"unfollow_mode_applied" text,
"unfollow_result" text,
"unfollow_attempts" integer NOT NULL,
"last_unfollow_attempt_at" timestamp with time zone,
"unfollow_skip_reason" text,
"whitelist_protected" boolean NOT NULL,
"interaction_lifecycle_state" text,
"ct_id" uuid,
"source_target_id" uuid,
"source_target_username" text,
"request_id" uuid,
"device_id" uuid,
"safe_device_label" text,
"interaction_status" text,
"evidence_source" text,
"evidence_confidence" text,
"evidence_summary" text,
"metadata_safe" jsonb,
"ever_followed_canonical_at" timestamp with time zone,
"ever_followed_action_id" uuid
);
CREATE TABLE "public"."auto_restart_device_locks" (
"device_id" uuid NOT NULL,
"worker_id" text NOT NULL,
"account_id" uuid,
"app_instance_id" uuid,
"lease_expires_at" timestamp with time zone NOT NULL,
"reason" text NOT NULL,
"metadata_safe" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"request_id" uuid,
"run_id" uuid,
"lease_id" uuid NOT NULL,
"owner_kind" text NOT NULL,
"operation_phase" text NOT NULL,
"heartbeat_at" timestamp with time zone NOT NULL,
"release_reason" text
);
CREATE TABLE "public"."account_incidents" (
"id" uuid NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"first_seen_at" timestamp with time zone NOT NULL,
"last_seen_at" timestamp with time zone NOT NULL,
"resolved_at" timestamp with time zone,
"status" text NOT NULL,
"severity" text NOT NULL,
"incident_type" text NOT NULL,
"dedupe_key" text NOT NULL,
"occurrence_count" integer NOT NULL,
"client_id" uuid,
"account_id" uuid,
"account_username" text,
"run_id" uuid,
"assignment_id" uuid,
"device_id" uuid,
"clone_id" uuid,
"source_event_id" uuid,
"source" text,
"reason" text,
"failure_reason" text,
"action_required" text,
"safe_client_message" text,
"assistant_message" text,
"admin_message" text,
"metadata" jsonb NOT NULL,
"acknowledged_at" timestamp with time zone,
"acknowledged_by" uuid,
"resolved_by" uuid,
"archived_at" timestamp with time zone,
"legal_hold" boolean NOT NULL,
"retention_class" text NOT NULL,
"retention_policy_version" text,
"purge_after" timestamp with time zone,
"lifecycle_version" bigint NOT NULL,
"resolution_reason" text,
"resolution_note" text
);
CREATE TABLE "public"."account_credentials" (
"id" uuid NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"account_id" uuid NOT NULL,
"client_id" uuid,
"provider" text NOT NULL,
"username_at_submission" text,
"secret_ref" text,
"secret_provider" text,
"credentials_version" integer NOT NULL,
"status" text NOT NULL,
"last_submitted_at" timestamp with time zone NOT NULL,
"last_rotated_at" timestamp with time zone,
"reauth_required" boolean NOT NULL,
"reauth_reason" text,
"submitted_by" uuid,
"submitted_via" text,
"revoked_at" timestamp with time zone,
"metadata" jsonb NOT NULL,
"last_updated_at" timestamp with time zone NOT NULL,
"updated_by_actor_type" text,
"updated_by_actor_id" text,
"source" text,
"metadata_safe" jsonb NOT NULL
);
CREATE TABLE "public"."commercial_stripe_subscriptions" (
"id" uuid NOT NULL,
"client_id" uuid NOT NULL,
"stripe_subscription_id" text NOT NULL,
"stripe_customer_id" text NOT NULL,
"stripe_price_id" text,
"status" text NOT NULL,
"livemode" boolean NOT NULL,
"current_period_start" timestamp with time zone,
"current_period_end" timestamp with time zone,
"cancel_at_period_end" boolean NOT NULL,
"metadata_safe" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL,
"client_account_entitlement_id" uuid,
"account_id" uuid,
"commercial_checkout_session_id" uuid,
"plan_change_quote_id" uuid,
"commercial_mode" text,
"pricing_mode" text,
"pricing_snapshot_fingerprint" text,
"projection_package_item" jsonb,
"projection_outreach_item" jsonb,
"rebound_from_subscription_id" uuid,
"rebound_reason" text,
"rebound_at" timestamp with time zone,
"billing_paused" boolean NOT NULL,
"pause_collection_behavior" text
);
CREATE TABLE "public"."instagram_account_restriction_holds" (
"id" uuid NOT NULL,
"account_id" uuid NOT NULL,
"incident_id" uuid NOT NULL,
"generation_id" uuid NOT NULL,
"stable_reason" text NOT NULL,
"status" text NOT NULL,
"previous_admin_lifecycle_status" text,
"detected_at" timestamp with time zone NOT NULL,
"last_seen_at" timestamp with time zone NOT NULL,
"occurrence_count" integer NOT NULL,
"human_resolved_at" timestamp with time zone,
"verification_required_at" timestamp with time zone,
"verified_cleared_at" timestamp with time zone,
"verified_by_run_id" uuid,
"metadata_safe" jsonb NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."profiles" (
"id" uuid NOT NULL,
"email" text,
"full_name" text,
"created_at" timestamp with time zone
);
CREATE TABLE "public"."account_session_transitions" (
"id" uuid NOT NULL,
"schema_version" text NOT NULL,
"transition_key" text NOT NULL,
"account_id" uuid NOT NULL,
"run_id" uuid NOT NULL,
"business_session_id" text NOT NULL,
"attempt_id" text NOT NULL,
"generation" text NOT NULL,
"transition_context" text NOT NULL,
"transition_type" text NOT NULL,
"transition_state" text NOT NULL,
"first_causal_reason" text NOT NULL,
"follow_stop_reason" text,
"session_termination_class" text,
"exact_stable_reason" text,
"actionable_reason" text,
"follows_completed" integer,
"follows_remaining" integer,
"safe_boundary" boolean,
"unfollow_eligible" boolean,
"unfollow_started" boolean NOT NULL,
"unfollow_state" text,
"backlog_remaining" integer,
"next_step" text,
"source_envelope" jsonb NOT NULL,
"source_updated_at" timestamp with time zone,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."notification_business_events" (
"id" uuid NOT NULL,
"idempotency_key" text NOT NULL,
"category" text NOT NULL,
"environment" text NOT NULL,
"event_type" text NOT NULL,
"account_id" uuid,
"client_id" uuid,
"tenant_id" uuid,
"business_payload" jsonb NOT NULL,
"technical_diagnostics" jsonb NOT NULL,
"occurred_at" timestamp with time zone NOT NULL,
"created_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."incident_retention_policies" (
"policy_key" text NOT NULL,
"policy_version" text NOT NULL,
"enabled" boolean NOT NULL,
"normal_resolved_days" integer NOT NULL,
"critical_resolved_days" integer NOT NULL,
"technical_nonblocking_days" integer NOT NULL,
"delivery_log_days" integer NOT NULL,
"physical_delete_grace_days" integer NOT NULL,
"cleanup_batch_size" integer NOT NULL,
"legal_audit_logical_archive_only" boolean NOT NULL,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE TABLE "public"."notification_destination_settings" (
"id" uuid NOT NULL,
"category" text NOT NULL,
"environment" text NOT NULL,
"channel" text NOT NULL,
"enabled" boolean NOT NULL,
"webhook_ciphertext" text,
"webhook_key_version" text,
"destination_label" text,
"external_destination_hint" text,
"configured_at" timestamp with time zone,
"updated_at" timestamp with time zone NOT NULL,
"last_success_at" timestamp with time zone,
"last_test_at" timestamp with time zone,
"last_error_at" timestamp with time zone,
"last_error_summary" text,
"retry_state" jsonb NOT NULL
);
CREATE TABLE "public"."notification_deliveries" (
"id" uuid NOT NULL,
"event_id" uuid NOT NULL,
"destination_id" uuid NOT NULL,
"status" text NOT NULL,
"attempt_count" integer NOT NULL,
"next_retry_at" timestamp with time zone,
"claimed_at" timestamp with time zone,
"claim_owner" text,
"sent_at" timestamp with time zone,
"last_error_summary" text,
"created_at" timestamp with time zone NOT NULL,
"updated_at" timestamp with time zone NOT NULL
);
CREATE OR REPLACE FUNCTION public.reject_social_profile_snapshot_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'social_profile_snapshots_are_append_only';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.initialize_account_warmup_on_package_activation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_started_at timestamptz;
begin
  if new.status <> 'active' or new.ends_at is not null then
    return new;
  end if;

  v_started_at := coalesce(new.starts_at, new.created_at, now());

  insert into public.account_warmup_settings (
    account_id,
    warmup_enabled,
    package_started_at,
    warmup_profile_code,
    day_1_follow_cap,
    day_2_follow_cap,
    day_3_follow_cap,
    day_4_plus_follow_cap,
    status,
    updated_at
  ) values (
    new.account_id,
    true,
    v_started_at,
    'follow_default_v1',
    10,
    20,
    40,
    null,
    'active',
    now()
  )
  on conflict (account_id) do update
    set package_started_at = excluded.package_started_at,
        status = 'active',
        updated_at = now()
    where account_warmup_settings.package_started_at is null;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.preserve_warmup_started_at_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    new.warmup_started_at := coalesce(new.warmup_started_at, new.package_started_at);
    if new.package_started_at is null then
      new.package_started_at := new.warmup_started_at;
    end if;
    return new;
  end if;

  if old.warmup_started_at is not null
     and new.warmup_started_at is distinct from old.warmup_started_at then
    raise exception using
      errcode = '23514',
      message = 'warmup_started_at_is_immutable';
  end if;
  new.warmup_started_at := coalesce(old.warmup_started_at, new.warmup_started_at, old.package_started_at, new.package_started_at);
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_account_package_runtime_contract_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid;
begin
  if coalesce(current_setting('bmb.package_contract_reconcile', true), '') = 'on' then
    return new;
  end if;
  v_account_id := case
    when tg_table_name = 'client_account_entitlements' then coalesce(new.account_id, old.account_id)
    else new.account_id
  end;
  if v_account_id is null then return new; end if;

  perform public.apply_account_unfollow_enablement_provenance_v1(v_account_id);
  begin
    perform public.reconcile_account_package_runtime_contract(v_account_id, tg_table_name || '_trigger');
  exception when others then
    insert into public.account_package_runtime_contract_events (
      account_id, event_type, source, details_safe
    ) values (
      v_account_id, 'package_runtime_contract_blocked', tg_table_name || '_trigger',
      jsonb_build_object('reason', case when sqlerrm in ('package_settings_incomplete','assignment_package_mismatch','app_instance_package_mismatch','clone_package_mismatch','runtime_profile_mismatch') then sqlerrm else 'contract_reconcile_failed' end)
    );
  end;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION auth.email()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$function$
;
CREATE OR REPLACE FUNCTION public.release_schedule_capacity_on_account_admin_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason text;
  v_commercial_state text;
begin
  if old.admin_lifecycle_status is not distinct from new.admin_lifecycle_status then
    return new;
  end if;

  if new.admin_lifecycle_status in ('paused', 'needs_assistance') then
    perform public.audit_schedule_capacity_event(
      'schedule_capacity_release_skipped',
      new.id,
      null,
      null,
      case
        when new.admin_lifecycle_status = 'paused' then 'account_paused_keep_assignment'
        else 'account_needs_assistance_keep_assignment'
      end,
      jsonb_build_object(
        'source', 'ig_accounts_admin_lifecycle_trigger',
        'old_admin_lifecycle_status', old.admin_lifecycle_status,
        'new_admin_lifecycle_status', new.admin_lifecycle_status
      )
    );
    return new;
  end if;

  if new.admin_lifecycle_status not in ('cancelled') then
    return new;
  end if;

  select commercial_state into v_commercial_state
  from public.commercial_account_lifecycle_states
  where account_id = new.id
  limit 1;

  if v_commercial_state in ('cancel_requested', 'action_required', 'cancelled') then
    perform public.audit_schedule_capacity_event(
      'schedule_capacity_release_skipped',
      new.id,
      null,
      null,
      'commercial_lifecycle_release_owner',
      jsonb_build_object(
        'source', 'ig_accounts_admin_lifecycle_trigger',
        'commercial_state', v_commercial_state,
        'old_admin_lifecycle_status', old.admin_lifecycle_status,
        'new_admin_lifecycle_status', new.admin_lifecycle_status
      )
    );
    return new;
  end if;

  v_reason := 'account_cancelled_release';

  perform public.release_account_schedule_capacity(
    new.id,
    v_reason,
    'ig_accounts_admin_lifecycle_trigger',
    null
  );

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.jsonb_has_forbidden_safe_metadata_key(p_metadata jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  with recursive walk(value) as (
    select coalesce(p_metadata, '{}'::jsonb)
    union all
    select child.value
    from walk w
    cross join lateral (
      select e.value
      from jsonb_each(
        case when jsonb_typeof(w.value) = 'object' then w.value else '{}'::jsonb end
      ) as e
      union all
      select a.value
      from jsonb_array_elements(
        case when jsonb_typeof(w.value) = 'array' then w.value else '[]'::jsonb end
      ) as a
    ) as child
  ),
  keys as (
    select lower(k.key) as key
    from walk w
    cross join lateral jsonb_object_keys(
      case when jsonb_typeof(w.value) = 'object' then w.value else '{}'::jsonb end
    ) as k(key)
  )
  select exists (
    select 1
    from keys
    where key in (
      'password',
      'password_hash',
      'password_length',
      'secret',
      'secret_ref',
      'secret_provider',
      'raw_secret',
      'token',
      'raw_token',
      'authorization',
      'bearer',
      'cookie',
      'session_cookie',
      'vault',
      'vault_id',
      'vault_payload',
      'service_role',
      'service_role_key',
      'internal_api_token',
      'webhook',
      'webhook_url',
      'slack_url',
      'discord_url',
      'raw_xml',
      'xml',
      'screenshot',
      'screenshot_path',
      'raw_logs',
      'raw_metadata',
      'request_body',
      'raw_request_body',
      'adb_serial',
      'usb_port',
      'hub_port',
      'device_udid'
    )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.apply_account_unfollow_enablement_provenance_v1(p_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_override public.ig_account_unfollow_enablement_overrides%rowtype;
  v_package_supports boolean := false;
  v_effective boolean := false;
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
begin
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.account_package_summary aps
    where aps.account_id = p_account_id
      and coalesce(nullif(aps.package_caps ->> 'unfollow_day', '')::integer, 0) > 0
      and coalesce(nullif(aps.package_caps ->> 'unfollow_session', '')::integer, 0) > 0
  ) into v_package_supports;

  select * into v_override
  from public.ig_account_unfollow_enablement_overrides o
  where o.account_id = p_account_id;

  -- An explicit true never grants a capability absent from the package.
  v_effective := v_package_supports and coalesce(v_override.override_enabled, true);

  perform set_config('bmb.package_contract_reconcile', 'on', true);
  update public.ig_account_unfollow_settings u
  set unfollow_enabled = v_effective,
      updated_at = case when u.unfollow_enabled is distinct from v_effective then now() else u.updated_at end
  where u.account_id = p_account_id;

  update public.ig_account_settings s
  set unfollow_enabled = v_effective,
      updated_at = case when s.unfollow_enabled is distinct from v_effective then now() else s.updated_at end
  where s.account_id = p_account_id;
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);

  return jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'package_supports_unfollow', v_package_supports,
    'override_present', v_override.account_id is not null,
    'override_enabled', case when v_override.account_id is null then null else v_override.override_enabled end,
    'effective_unfollow_enabled', v_effective,
    'source', case when v_override.account_id is null then 'package_inherited' else 'explicit_override' end
  );
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_account_package_runtime_contract(p_account_id uuid, p_source text DEFAULT 'canonical_reconcile'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_enablement jsonb;
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
begin
  perform set_config('bmb.package_contract_reconcile', 'on', true);
  v_result := public.reconcile_package_runtime_before_unfollow_enablement_v1(p_account_id, p_source);
  v_enablement := public.apply_account_unfollow_enablement_provenance_v1(p_account_id);
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('unfollow_enablement_provenance', v_enablement);
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_terminal_cancel_admin_monotonicity_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.admin_lifecycle_status = 'cancelled' and new.admin_lifecycle_status <> 'cancelled'
    and exists (
      select 1 from public.commercial_account_lifecycle_states st
      where st.account_id = old.id and st.terminal_cancel_operation_id is not null
    ) then
    raise exception 'terminal_cancelled_account_cannot_reactivate' using errcode = '23514';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION auth.jwt()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$
;
CREATE OR REPLACE FUNCTION public.audit_schedule_capacity_event(p_event_type text, p_account_id uuid, p_assignment_id uuid, p_app_instance_id uuid, p_reason text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.runtime_events (
    event_type,
    severity,
    visibility,
    account_id,
    assignment_id,
    reason,
    message,
    metadata
  )
  values (
    p_event_type,
    'info',
    'admin_only',
    p_account_id,
    p_assignment_id,
    p_reason,
    'Schedule app instance capacity updated.',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'app_instance_id', p_app_instance_id,
      'safe_audit', true
    )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.release_account_schedule_capacity(p_account_id uuid, p_reason text, p_source text DEFAULT 'system'::text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'manual_assignment_release');
  v_release_status text := 'released';
  v_assignment record;
  v_released_count integer := 0;
  v_instance_released_count integer := 0;
  v_instance_released boolean;
begin
  if p_account_id is null then
    raise exception 'missing_account_id';
  end if;

  if public.account_has_active_runtime_session(p_account_id) then
    perform public.audit_schedule_capacity_event(
      'schedule_capacity_release_skipped',
      p_account_id,
      null,
      null,
      'active_session_guard',
      jsonb_build_object(
        'requested_reason', v_reason,
        'source', p_source,
        'released_by', coalesce(p_actor_id::text, 'system')
      )
    );
    return jsonb_build_object(
      'ok', false,
      'reason', 'active_session_guard',
      'released_count', 0,
      'app_instances_released_count', 0
    );
  end if;

  v_release_status := case
    when v_reason = 'account_canceled_release' then 'canceled'
    when v_reason = 'account_cancelled_release' then 'canceled'
    when v_reason = 'account_archived_release' then 'archived'
    when v_reason = 'assignment_expired_release' then 'expired'
    when v_reason = 'clone_reset_release' then 'released'
    else 'released'
  end;

  for v_assignment in
    select *
    from public.account_assignments aa
    where aa.account_id = p_account_id
      and aa.status in ('pending', 'reserved', 'active')
    order by aa.created_at desc
    for update
  loop
    update public.account_assignments
    set status = v_release_status,
        released_at = coalesce(released_at, now()),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'release_reason', v_reason,
          'release_source', p_source,
          'released_by', coalesce(p_actor_id::text, 'system'),
          'old_status', v_assignment.status,
          'new_status', v_release_status
        ),
        updated_at = now()
    where id = v_assignment.id;

    v_released_count := v_released_count + 1;

    select exists (
      select 1
      from public.phone_app_instances pai
      where pai.id = v_assignment.app_instance_id
        and pai.status = 'available'
        and pai.current_account_id is null
    )
    into v_instance_released;

    if v_instance_released then
      v_instance_released_count := v_instance_released_count + 1;
    end if;

    perform public.audit_schedule_capacity_event(
      'schedule_assignment_capacity_released',
      p_account_id,
      v_assignment.id,
      v_assignment.app_instance_id,
      v_reason,
      jsonb_build_object(
        'source', p_source,
        'released_by', coalesce(p_actor_id::text, 'system'),
        'old_status', v_assignment.status,
        'new_status', v_release_status,
        'app_instance_released', v_instance_released
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'reason', case when v_released_count = 0 then 'no_open_assignment_after_release' else v_reason end,
    'released_count', v_released_count,
    'app_instances_released_count', v_instance_released_count
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_package_runtime_before_unfollow_enablement_v1(p_account_id uuid, p_source text DEFAULT 'canonical_reconcile'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_limits jsonb;
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
begin
  perform set_config('bmb.package_contract_reconcile', 'on', true);
  v_result := public.reconcile_account_package_runtime_contract_follow_provenance_v1(p_account_id, p_source);
  v_limits := public.apply_account_unfollow_limit_provenance_v1(p_account_id);
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('unfollow_limit_provenance', v_limits);
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_terminal_cancel_entitlement_monotonicity_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.account_id is not null and exists (
    select 1 from public.commercial_account_lifecycle_states st
    where st.account_id = new.account_id
      and st.terminal_cancel_operation_id is not null
      and st.terminal_cancel_entitlement_id is distinct from new.id
  ) then
    raise exception 'terminal_cancelled_account_requires_new_account' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'entitlement_cancelled' and new.status <> 'entitlement_cancelled'
      and exists (
      select 1 from public.commercial_account_lifecycle_states st
      where st.terminal_cancel_entitlement_id = old.id
      ) then
      raise exception 'terminal_cancel_entitlement_cannot_reactivate' using errcode = '23514';
    end if;
    if new.account_id is distinct from old.account_id and exists (
      select 1 from public.commercial_account_lifecycle_states st
      where st.terminal_cancel_entitlement_id = old.id
      ) then
      raise exception 'terminal_cancel_entitlement_cannot_rebind' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.normalize_plan_change_target_pricing_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_snapshot jsonb;
  v_plan_key text;
  v_interval integer;
  v_currency text;
  v_discount_kind text;
  v_quote_id uuid;
  v_payment_provider text;
begin
  if tg_table_name = 'commercial_checkout_sessions' then
    if new.flow_type <> 'plan_change' then
      return new;
    end if;
    v_snapshot := new.catalog_snapshot;
  else
    if coalesce((new.metadata ->> 'per_account_plan')::boolean, false) = false
       and coalesce(new.catalog_snapshot ->> 'pricingContext', '') <> 'plan_change' then
      return new;
    end if;
    v_snapshot := new.catalog_snapshot;
  end if;

  if v_snapshot is null or jsonb_typeof(v_snapshot) <> 'object' then
    raise exception using errcode = '23514', message = 'target_pricing_snapshot_required';
  end if;

  v_plan_key := lower(coalesce(v_snapshot ->> 'planKey', ''));
  v_interval := nullif(v_snapshot ->> 'billingIntervalMonths', '')::integer;
  v_currency := upper(coalesce(v_snapshot ->> 'currency', ''));
  v_discount_kind := coalesce(v_snapshot ->> 'appliedDiscountKind', 'none');

  if v_plan_key not in ('growth', 'pro', 'premium')
     or v_plan_key <> lower(coalesce(new.plan_key, ''))
     or v_interval not in (1, 3, 6, 12)
     or v_interval <> new.billing_interval_months
     or v_currency <> 'EUR' then
    raise exception using errcode = '23514', message = 'target_pricing_snapshot_identity_mismatch';
  end if;

  if tg_table_name = 'commercial_checkout_sessions' then
    new.term_discount_percent := coalesce((v_snapshot ->> 'durationDiscountPercent')::numeric, 0);
    new.agency_discount_percent := coalesce((v_snapshot ->> 'volumeDiscountPercent')::numeric, 0);
    new.applied_discount_percent := coalesce((v_snapshot ->> 'appliedDiscountPercent')::numeric, 0);
    new.applied_discount_type := case v_discount_kind
      when 'duration' then 'term'
      when 'agency_volume' then 'agency'
      else 'none'
    end;
    new.pack_base_monthly_cents := (v_snapshot ->> 'packBaseMonthlyCents')::integer;
    new.pack_monthly_discounted_cents := (v_snapshot ->> 'packFinalMonthlyCents')::integer;
    new.pack_period_total_cents := (v_snapshot ->> 'packPeriodTotalCents')::integer;
    new.outreach_base_monthly_cents := coalesce((v_snapshot ->> 'outreachBaseMonthlyCents')::integer, 0);
    new.outreach_monthly_discounted_cents := coalesce((v_snapshot ->> 'outreachFinalMonthlyCents')::integer, 0);
    new.outreach_period_total_cents := coalesce((v_snapshot ->> 'outreachPeriodTotalCents')::integer, 0);
    new.total_period_cents := (v_snapshot ->> 'totalPeriodCents')::integer;
    v_quote_id := nullif(new.metadata ->> 'plan_change_quote_id', '')::uuid;
    if v_quote_id is not null then
      select payment_provider into v_payment_provider
      from public.commercial_plan_change_quotes
      where id = v_quote_id;
      if v_payment_provider = 'stripe' then
        new.status := 'checkout_paid';
        new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
          'payment_provider', 'stripe',
          'checkout_mode', 'stripe'
        );
      end if;
    end if;
  else
    new.applied_discount_percent := coalesce((v_snapshot ->> 'appliedDiscountPercent')::numeric, 0);
    new.applied_discount_type := case v_discount_kind
      when 'duration' then 'term'
      when 'agency_volume' then 'agency'
      else 'none'
    end;
    new.pack_monthly_discounted_cents := (v_snapshot ->> 'packFinalMonthlyCents')::integer;
    new.pack_period_total_cents := (v_snapshot ->> 'packPeriodTotalCents')::integer;
    new.outreach_monthly_discounted_cents := coalesce((v_snapshot ->> 'outreachFinalMonthlyCents')::integer, 0);
    new.outreach_period_total_cents := coalesce((v_snapshot ->> 'outreachPeriodTotalCents')::integer, 0);
    new.total_period_cents := (v_snapshot ->> 'totalPeriodCents')::integer;
  end if;

  if new.pack_monthly_discounted_cents < 0
     or new.pack_period_total_cents < 0
     or new.total_period_cents < 0 then
    raise exception using errcode = '23514', message = 'target_pricing_snapshot_amount_invalid';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$
;
CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$
;
CREATE OR REPLACE FUNCTION public.block_invalid_login_package_runtime_contract()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_contract jsonb;
  v_reason text;
begin
  if new.requested_run_type in ('login_provisioning', 'login_email_code_resume') then
    v_contract := public.account_package_runtime_contract_status(new.account_id);
    v_reason := coalesce(v_contract ->> 'reason', 'package_settings_incomplete');
    if not coalesce((v_contract ->> 'ok')::boolean, false) then
      raise exception '%', v_reason;
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_assignment_package_runtime_contract()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(current_setting('bmb.package_contract_reconcile', true), '') = 'on' then
    return new;
  end if;
  if new.status in ('pending', 'reserved', 'active') then
    begin
      perform public.reconcile_account_package_runtime_contract(new.account_id, 'assignment_trigger');
    exception when others then
      insert into public.account_package_runtime_contract_events (
        account_id, assignment_id, event_type, source, details_safe
      ) values (
        new.account_id, new.id, 'package_runtime_contract_blocked', 'assignment_trigger',
        jsonb_build_object('reason', case when sqlerrm in ('package_settings_incomplete','assignment_package_mismatch','app_instance_package_mismatch','clone_package_mismatch','runtime_profile_mismatch') then sqlerrm else 'contract_reconcile_failed' end)
      );
    end;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.account_has_active_runtime_session(p_account_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_has_active boolean := false;
begin
  if p_account_id is null then
    return false;
  end if;

  if to_regclass('public.ig_runs') is not null then
    begin
      execute $query$
        select exists (
          select 1
          from public.ig_runs
          where account_id = $1
            and status in ('queued', 'pending', 'starting', 'running', 'in_progress', 'active')
        )
      $query$ into v_has_active using p_account_id;
      if v_has_active then
        return true;
      end if;
    exception
      when undefined_table or undefined_column then
        null;
    end;
  end if;

  if to_regclass('public.account_run_requests') is not null then
    begin
      execute $query$
        select exists (
          select 1
          from public.account_run_requests
          where account_id = $1
            and status in ('queued', 'claimed', 'starting', 'running', 'in_progress')
        )
      $query$ into v_has_active using p_account_id;
      if v_has_active then
        return true;
      end if;
    exception
      when undefined_table or undefined_column then
        null;
    end;
  end if;

  return false;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_app_instance_after_assignment_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old_open boolean := false;
  v_new_open boolean := false;
  v_reason text := 'manual_assignment_release';
  v_instance_released boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_old_open := public.is_open_assignment_status(old.status);
  end if;
  v_new_open := public.is_open_assignment_status(new.status);

  if v_new_open and new.app_instance_id is not null then
    update public.phone_app_instances pai
    set status = 'occupied',
        current_account_id = new.account_id,
        updated_at = now()
    where pai.id = new.app_instance_id
      and pai.status <> 'disabled';
  end if;

  if tg_op = 'UPDATE'
     and old.app_instance_id is not null
     and (
       (v_old_open and not v_new_open)
       or old.app_instance_id is distinct from new.app_instance_id
     ) then
    if public.account_has_active_runtime_session(old.account_id) then
      perform public.audit_schedule_capacity_event(
        'schedule_capacity_release_skipped',
        old.account_id,
        old.id,
        old.app_instance_id,
        'active_session_guard',
        jsonb_build_object(
          'source', 'account_assignments_trigger',
          'old_status', old.status,
          'new_status', new.status
        )
      );
      return new;
    end if;

    v_reason := case
      when old.app_instance_id is distinct from new.app_instance_id then 'reassignment_release_old_instance'
      when new.status = 'canceled' then 'assignment_canceled_release'
      when new.status = 'archived' then 'account_archived_release'
      when new.status = 'expired' then 'assignment_expired_release'
      else 'manual_assignment_release'
    end;

    v_instance_released := public.release_app_instance_if_unused(
      old.app_instance_id,
      old.account_id,
      v_reason,
      'account_assignments_trigger'
    );

    perform public.audit_schedule_capacity_event(
      'schedule_app_instance_released',
      old.account_id,
      old.id,
      old.app_instance_id,
      case when v_instance_released then v_reason else 'no_open_assignment_after_release' end,
      jsonb_build_object(
        'source', 'account_assignments_trigger',
        'old_status', old.status,
        'new_status', new.status,
        'old_app_instance_id', old.app_instance_id,
        'new_app_instance_id', new.app_instance_id,
        'app_instance_released', v_instance_released
      )
    );
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.stamp_assignment_release_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if public.is_open_assignment_status(old.status)
     and public.is_terminal_assignment_status(new.status)
     and public.account_has_active_runtime_session(old.account_id) then
    raise exception 'assignment_terminal_update_blocked_active_run';
  end if;

  if public.is_open_assignment_status(old.status)
     and public.is_terminal_assignment_status(new.status)
     and new.released_at is null then
    new.released_at := now();
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_account_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_subscription_account_account_id uuid;
  v_subscription_id uuid;
  v_subscription_type text;
  v_subscription_status text;
  v_device_pool_type text;
  v_slot_kind text;
  v_app_instance_device_id uuid;
  v_app_instance_status text;
  v_app_instance_account_id uuid;
  v_app_instance_usable boolean;
  v_app_instance_launchable boolean;
  v_clone_device_id uuid;
begin
  select csa.account_id, csa.subscription_id, cs.subscription_type, cs.status
  into v_subscription_account_account_id, v_subscription_id, v_subscription_type, v_subscription_status
  from public.client_subscription_accounts csa
  join public.client_subscriptions cs on cs.id = csa.subscription_id
  where csa.id = new.subscription_account_id;

  if v_subscription_account_account_id is null then
    raise exception 'account_assignments.subscription_account_id does not reference an active account subscription';
  end if;

  if new.subscription_id <> v_subscription_id then
    raise exception 'account_assignments.subscription_id must match client_subscription_accounts.subscription_id';
  end if;

  if v_subscription_status <> 'active' then
    raise exception 'account_assignments.subscription_id must reference an active subscription';
  end if;

  if new.account_id <> v_subscription_account_account_id then
    raise exception 'account_assignments.account_id must match client_subscription_accounts.account_id';
  end if;

  if new.assignment_type <> v_subscription_type then
    raise exception 'account_assignments.assignment_type must match client_subscriptions.subscription_type';
  end if;

  if new.schedule_mode = 'manual_only' then
    if new.slot_kind <> 'manual_only' then
      raise exception 'manual_only assignments require slot_kind=manual_only';
    end if;
    if new.starts_at is not null or new.ends_at is not null then
      raise exception 'manual_only assignments require null starts_at and ends_at';
    end if;
    if new.app_instance_id is null then
      raise exception 'manual_only_requires_app_instance';
    end if;
  else
    v_slot_kind := case
      when new.slot_kind = 'outreach_40m' then 'outreach_short'
      else new.slot_kind
    end;

    if new.assignment_type = 'full_cycle' and v_slot_kind <> 'full_cycle_6h' then
      raise exception 'full_cycle assignments require slot_kind=full_cycle_6h';
    end if;

    if new.assignment_type = 'outreach_only' and v_slot_kind <> 'outreach_short' then
      raise exception 'outreach_only assignments require slot_kind=outreach_short or outreach_40m';
    end if;
  end if;

  if new.app_instance_id is not null then
    select pai.device_id, pai.status, pai.current_account_id, pai.usable_for_auto_login, pai.is_launchable
    into v_app_instance_device_id, v_app_instance_status, v_app_instance_account_id, v_app_instance_usable, v_app_instance_launchable
    from public.phone_app_instances pai
    where pai.id = new.app_instance_id;

    if v_app_instance_device_id is null then
      raise exception 'account_assignments.app_instance_id does not reference an existing app instance';
    end if;

    if new.device_id <> v_app_instance_device_id then
      raise exception 'account_assignments.device_id must match phone_app_instances.device_id';
    end if;

    if new.status in ('pending', 'reserved', 'active') then
      if v_app_instance_status <> 'available'
         and not (v_app_instance_status = 'occupied' and v_app_instance_account_id = new.account_id) then
        raise exception 'app_instance_unavailable';
      end if;

      if not coalesce(v_app_instance_usable, false) or not coalesce(v_app_instance_launchable, false) then
        raise exception 'app_instance_unavailable';
      end if;

      if v_app_instance_account_id is not null and v_app_instance_account_id <> new.account_id then
        raise exception 'app_instance_unavailable';
      end if;
    end if;
  elsif new.clone_id is not null then
    select pc.device_id
    into v_clone_device_id
    from public.phone_clones pc
    where pc.id = new.clone_id;

    if v_clone_device_id is null then
      raise exception 'account_assignments.clone_id does not reference an existing clone';
    end if;

    if new.device_id <> v_clone_device_id then
      raise exception 'account_assignments.device_id must match phone_clones.device_id';
    end if;
  elsif new.status in ('pending', 'reserved', 'active') then
    raise exception 'account_assignments.app_instance_id is required for open assignments';
  end if;

  select pd.pool_type
  into v_device_pool_type
  from public.phone_devices pd
  where pd.id = new.device_id;

  if v_device_pool_type is null then
    raise exception 'account_assignments.device_id does not reference an existing phone device';
  end if;

  if v_device_pool_type <> 'shared' and v_device_pool_type <> new.assignment_type then
    raise exception 'phone_devices.pool_type is incompatible with account_assignments.assignment_type';
  end if;

  if new.schedule_mode <> 'manual_only'
     and new.status in ('pending', 'reserved', 'active')
     and not public.validate_assignment_slot_window(
    new.assignment_type,
    new.starts_at,
    new.ends_at,
    coalesce((select timezone from public.phone_devices where id = new.device_id), 'UTC')
  ) then
    raise exception 'assignment_slot_kind_window_mismatch';
  end if;

  if new.schedule_mode <> 'manual_only'
     and new.status in ('pending', 'reserved', 'active')
     and exists (
    select 1
    from public.account_assignments aa
    where aa.app_instance_id = new.app_instance_id
      and aa.status in ('pending', 'reserved', 'active')
      and aa.schedule_mode = 'scheduled'
      and aa.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and tstzrange(aa.starts_at, aa.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'phone app instance already has an overlapping open assignment';
  end if;

  if new.schedule_mode <> 'manual_only'
     and new.status in ('pending', 'reserved', 'active')
     and exists (
    select 1
    from public.account_assignments aa
    where aa.device_id = new.device_id
      and aa.account_id <> new.account_id
      and aa.status in ('pending', 'reserved', 'active')
      and aa.schedule_mode = 'scheduled'
      and aa.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and tstzrange(aa.starts_at, aa.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'phone device already has an overlapping open assignment slot';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.run_control_metadata_is_safe(p_metadata jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select
    jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object'
    and not exists (
      select 1
      from jsonb_object_keys(coalesce(p_metadata, '{}'::jsonb)) as k(key)
      where lower(k.key) in (
        'password', 'secret', 'secret_ref', 'raw_secret', 'token', 'cookie',
        'webhook', 'webhook_url', 'vault', 'service_role', 'authorization', 'bearer',
        'raw_xml', 'xml', 'screenshot', 'adb_serial', 'device_udid'
      )
    );
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_auto_restart_phase_plan_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_error text;
begin
  if new.source_surface = 'auto_restart_tick'
     and new.requested_run_type = 'account_session' then
    v_error := public.auto_restart_phase_plan_v2_error(new.metadata_safe -> 'resume_plan');
    if v_error is not null then
      raise exception '%', v_error using errcode = '22023';
    end if;
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.apply_account_unfollow_limit_provenance_v1(p_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_policy public.ig_account_unfollow_limit_overrides%rowtype;
  v_package_day integer;
  v_package_session integer;
  v_day integer;
  v_session integer;
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
begin
  select
    nullif(aps.package_caps ->> 'unfollow_day', '')::integer,
    nullif(aps.package_caps ->> 'unfollow_session', '')::integer
  into v_package_day, v_package_session
  from public.account_package_summary aps
  where aps.account_id = p_account_id;

  if coalesce(v_package_day, 0) <= 0 or coalesce(v_package_session, 0) <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'package_settings_incomplete', 'account_id', p_account_id);
  end if;

  select * into v_policy
  from public.ig_account_unfollow_limit_overrides o
  where o.account_id = p_account_id;

  v_day := least(v_package_day, coalesce(v_policy.unfollow_day_cap_override, v_package_day));
  v_session := least(v_package_session, coalesce(v_policy.unfollow_session_cap_override, v_package_session));

  perform set_config('bmb.package_contract_reconcile', 'on', true);
  update public.ig_account_unfollow_settings s
  set unfollow_per_day_limit = v_day,
      unfollow_per_session_limit = v_session,
      updated_at = case
        when (s.unfollow_per_day_limit, s.unfollow_per_session_limit) is distinct from (v_day, v_session)
          then now()
        else s.updated_at
      end
  where s.account_id = p_account_id;
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);

  return jsonb_build_object(
    'ok', true,
    'reason', case when v_policy.account_id is null then 'package_inherited' else v_policy.classification end,
    'account_id', p_account_id,
    'package_day', v_package_day,
    'package_session', v_package_session,
    'configured_day', v_day,
    'configured_session', v_session
  );
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_account_package_runtime_contract_follow_provenance_v1(p_account_id uuid, p_source text DEFAULT 'canonical_reconcile'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_before_follows integer;
  v_before_targets integer;
  v_before_updated_at timestamptz;
  v_before_updated_by text;
  v_before_metadata jsonb;
  v_package_follows integer;
  v_package_targets integer;
  v_restore_follows boolean := false;
  v_restore_targets boolean := false;
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
  v_result jsonb;
  v_contract jsonb;
begin
  if p_account_id is null then
    raise exception 'package_settings_incomplete';
  end if;

  -- Serialize setting saves and package changes for this account before taking
  -- the candidate override snapshot.
  perform 1
  from public.ig_accounts a
  where a.id = p_account_id
  for update;
  if not found then
    raise exception 'package_settings_incomplete';
  end if;

  select
    s.max_follows_per_target_per_run,
    s.max_targets_per_run,
    s.updated_at,
    s.updated_by,
    s.metadata
  into
    v_before_follows,
    v_before_targets,
    v_before_updated_at,
    v_before_updated_by,
    v_before_metadata
  from public.account_follow_source_settings s
  where s.account_id = p_account_id;

  v_result := public.reconcile_package_runtime_contract_pre_source_override_v1(
    p_account_id,
    p_source
  );

  select
    prs.max_follows_per_target_per_run,
    prs.max_targets_per_run
  into v_package_follows, v_package_targets
  from public.account_package_summary aps
  join public.commercial_package_runtime_settings prs
    on prs.package_code = aps.commercial_package_code
  where aps.account_id = p_account_id;

  if coalesce(v_package_follows, 0) <= 0 or coalesce(v_package_targets, 0) <= 0 then
    raise exception 'package_settings_incomplete';
  end if;

  v_restore_follows := v_before_follows between 1 and v_package_follows;
  v_restore_targets := v_before_targets between 1 and v_package_targets;

  perform set_config('bmb.package_contract_reconcile', 'on', true);
  update public.account_follow_source_settings s
  set max_follows_per_target_per_run = case
        when v_restore_follows then v_before_follows
        else s.max_follows_per_target_per_run
      end,
      max_targets_per_run = case
        when v_restore_targets then v_before_targets
        else s.max_targets_per_run
      end,
      updated_at = case
        when v_restore_follows and v_restore_targets
          then coalesce(v_before_updated_at, s.updated_at)
        else s.updated_at
      end,
      updated_by = case
        when v_restore_follows and v_restore_targets then v_before_updated_by
        else s.updated_by
      end,
      metadata = case
        when v_restore_follows or v_restore_targets then
          coalesce(s.metadata, '{}'::jsonb)
          || coalesce(v_before_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'rotation_override_policy', 'positive_account_override_lte_package'
          )
        else s.metadata
      end
  where s.account_id = p_account_id;
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);

  v_contract := public.account_package_runtime_contract_status(p_account_id);
  if not coalesce((v_contract ->> 'ok')::boolean, false) then
    raise exception '%', coalesce(v_contract ->> 'reason', 'package_settings_incomplete');
  end if;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'follow_source_rotation', jsonb_build_object(
      'configured_follows_per_target', v_contract #> '{settings,max_follows_per_target_per_run,db}',
      'package_follows_per_target', v_package_follows,
      'configured_targets_per_run', v_contract #> '{settings,max_targets_per_run,db}',
      'package_targets_per_run', v_package_targets,
      'override_policy', 'positive_account_override_lte_package'
    )
  );
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_device_recurring_assignment_exclusivity_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_conflict_id uuid;
begin
  if new.released_at is not null
     or new.status not in ('pending', 'reserved', 'active')
     or new.schedule_mode <> 'scheduled' then
    return new;
  end if;

  if new.device_id is null or new.starts_at is null or new.ends_at is null then
    raise exception 'invalid_assignment_payload';
  end if;

  -- The physical phone row is the single transactional allocator mutex.
  perform 1 from public.phone_devices pd where pd.id = new.device_id for update;
  if not found then raise exception 'device_unavailable'; end if;

  v_conflict_id := public.find_device_recurring_assignment_conflict_v1(
    new.id, new.device_id, new.starts_at, new.ends_at
  );
  if v_conflict_id is not null then
    raise exception 'assignment_recurring_slot_conflict';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.phonefarm_storage_admission_guard_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform pg_advisory_xact_lock(785215022);

  if exists (
    select 1
    from public.phonefarm_runtime_barriers b
    where b.barrier_name = 'storage_apply_active'
      and b.active
      and b.expires_at > clock_timestamp()
  ) then
    raise exception 'storage_apply_active'
      using errcode = '55000',
            detail = 'Phone Farm request/run admission is temporarily closed for bounded storage maintenance.';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_commercial_cancel_terminal_monotonicity_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.terminal_cancel_operation_id is not null and (
    new.terminal_cancel_operation_id is distinct from old.terminal_cancel_operation_id
    or new.terminal_cancelled_at is distinct from old.terminal_cancelled_at
    or new.terminal_cancel_entitlement_id is distinct from old.terminal_cancel_entitlement_id
    or new.terminal_cancel_stripe_subscription_id is distinct from old.terminal_cancel_stripe_subscription_id
    or new.commercial_state <> 'cancelled'
    or new.action_required_reason is not null
    or new.entitlement_id is distinct from old.terminal_cancel_entitlement_id
    or new.stripe_subscription_id is distinct from old.terminal_cancel_stripe_subscription_id
  ) then
    raise exception 'terminal_cancel_provenance_is_immutable' using errcode = '23514';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.account_run_request_lineage_v1_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'INSERT' then
    new.root_business_session_id := coalesce(new.root_business_session_id, new.id);
    new.execution_attempt_no := coalesce(new.execution_attempt_no, 1);
    new.retry_index := coalesce(new.retry_index, new.execution_attempt_no - 1);
    return new;
  end if;
  if new.root_business_session_id is distinct from old.root_business_session_id
     or new.execution_attempt_no is distinct from old.execution_attempt_no
     or new.retry_index is distinct from old.retry_index then
    raise exception using errcode = '23514', message = 'account_run_request_lineage_immutable';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.trigger_connected_instagram_growth_readiness_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_source text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_table_name = 'client_instagram_accounts' then
    v_account_id := new.account_id;
    v_source := 'identity_success';
  elsif tg_table_name = 'account_run_requests' then
    if lower(coalesce(new.requested_run_type, '')) <> 'login_provisioning'
       or lower(coalesce(new.status, '')) not in ('completed', 'failed', 'canceled', 'cancelled', 'stopped', 'expired') then
      return new;
    end if;
    v_account_id := new.account_id;
    v_source := 'login_request_terminal';
  elsif tg_table_name = 'ig_runs' then
    if lower(coalesce(old.status, '')) in ('completed', 'failed', 'stopped', 'canceled', 'blocked', 'aborted')
       or lower(coalesce(new.status, '')) not in ('completed', 'failed', 'stopped', 'canceled', 'blocked', 'aborted') then
      return new;
    end if;
    v_account_id := new.account_id;
    -- Reuse the existing login-terminal source family accepted by the shared
    -- RPC. The trigger/table identity remains available through TG_TABLE_NAME.
    v_source := 'login_request_terminal';
  elsif tg_table_name = 'account_dashboard_actions' then
    if lower(coalesce(new.status, '')) not in ('resolved', 'dismissed', 'ignored') then
      return new;
    end if;
    if coalesce(new.metadata_safe ->> 'superseded_by_exact_identity_success', 'false') = 'true' then
      return new;
    end if;
    v_account_id := new.account_id;
    v_source := 'login_blocker_terminal';
  else
    return new;
  end if;

  perform public.reconcile_connected_instagram_growth_readiness_v1(v_account_id, v_source);
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.apply_authorized_resume_request_lineage_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_auth public.incident_resume_authorizations%rowtype;
  v_plan public.account_session_resume_plans%rowtype;
  v_source public.account_run_requests%rowtype;
  v_next_attempt integer;
begin
  if new.source_surface <> 'auto_restart_tick'
     or coalesce((new.metadata_safe ->> 'resume_lineage_contract_v1')::boolean, false) is not true then
    return new;
  end if;
  select * into v_auth from public.incident_resume_authorizations
  where id = (new.metadata_safe ->> 'authorization_id')::uuid for update;
  select * into v_plan from public.account_session_resume_plans
  where id = v_auth.resume_plan_id and account_id = new.account_id for update;
  select * into v_source from public.account_run_requests
  where id = v_plan.run_request_id and account_id = new.account_id for share;
  v_next_attempt := v_source.execution_attempt_no + 1;
  if v_auth.id is null or v_plan.id is null or v_source.id is null
     or v_auth.status <> 'consumed'
     or new.metadata_safe ->> 'parent_request_id' <> v_source.id::text
     or new.metadata_safe ->> 'root_business_session_id' <> v_source.root_business_session_id::text
     or (new.metadata_safe ->> 'execution_attempt_no')::integer <> v_next_attempt then
    raise exception 'resume_request_lineage_reconciliation_required' using errcode = '22023';
  end if;
  new.root_business_session_id := v_source.root_business_session_id;
  new.execution_attempt_no := v_next_attempt;
  new.retry_index := v_next_attempt - 1;
  return new;
exception when invalid_text_representation or null_value_not_allowed then
  raise exception 'resume_request_lineage_reconciliation_required' using errcode = '22023';
end
$function$
;
CREATE OR REPLACE FUNCTION public.validate_assignment_slot_window(p_assignment_type text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_timezone text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_tz text := coalesce(nullif(trim(p_timezone), ''), 'UTC');
  v_duration_seconds numeric;
  v_local_start timestamp;
  v_local_hour integer;
  v_local_minute integer;
  v_local_total_minutes integer;
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    return false;
  end if;

  if not public.is_valid_schedule_timezone(v_tz) then
    raise exception 'invalid_timezone';
  end if;

  v_duration_seconds := extract(epoch from (p_ends_at - p_starts_at));
  v_local_start := p_starts_at at time zone v_tz;
  v_local_hour := extract(hour from v_local_start)::integer;
  v_local_minute := extract(minute from v_local_start)::integer;
  v_local_total_minutes := v_local_hour * 60 + v_local_minute;

  if p_assignment_type = 'full_cycle' then
    return v_duration_seconds = 21600
      and v_local_minute = 0
      and v_local_hour in (0, 6, 12, 18);
  end if;

  if p_assignment_type = 'outreach_only' then
    return v_duration_seconds = 2400
      and (v_local_total_minutes % 40) = 0;
  end if;

  return false;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.account_package_runtime_contract_status(p_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_package_code text;
  v_entitlement_package text;
  v_legacy_package_code text;
  v_entitlement_source text;
  v_package_caps jsonb;
  v_effective_preview jsonb;
  v_runtime_profiles jsonb;
  v_runtime public.commercial_package_runtime_settings%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_instance public.phone_app_instances%rowtype;
  v_settings public.ig_account_settings%rowtype;
  v_sources public.account_follow_source_settings%rowtype;
  v_unfollow public.ig_account_unfollow_settings%rowtype;
  v_dm public.ig_account_dm_settings%rowtype;
  v_account public.ig_accounts%rowtype;
  v_subscription_type text;
  v_expected_clone_mode text;
  v_reason text := 'ready';
  v_follow_day integer;
  v_follow_session integer;
  v_follow_run integer;
  v_unfollow_day integer;
  v_unfollow_session integer;
  v_package_follow_day integer;
  v_package_follow_session integer;
  v_package_unfollow_day integer;
  v_package_unfollow_session integer;
begin
  select * into v_account from public.ig_accounts where id = p_account_id;

  select aps.commercial_package_code, aps.package_caps, aps.effective_caps_preview,
         to_jsonb(aps.runtime_profiles)
  into v_package_code, v_package_caps, v_effective_preview, v_runtime_profiles
  from public.account_package_summary aps
  where aps.account_id = p_account_id;

  select cae.commercial_package_code into v_entitlement_package
  from public.client_account_entitlements cae
  where cae.account_id = p_account_id and cae.status = 'entitlement_consumed'
  order by cae.consumed_at desc nulls last, cae.created_at desc
  limit 1;

  if v_entitlement_package is null then
    select acp.package_code into v_legacy_package_code
    from public.account_commercial_packages acp
    where acp.account_id = p_account_id
      and acp.status = 'active'
      and (acp.ends_at is null or acp.ends_at > now())
      and exists (
        select 1
        from public.client_subscription_accounts csa
        join public.client_subscriptions cs on cs.id = csa.subscription_id
        where csa.account_id = p_account_id
          and csa.status = 'active'
          and cs.status = 'active'
      )
    order by acp.starts_at desc, acp.created_at desc
    limit 1;
  end if;

  v_entitlement_source := case
    when v_entitlement_package is not null then 'consumed_entitlement'
    when v_legacy_package_code is not null then 'legacy_active_subscription_package'
    else 'missing'
  end;

  if v_package_code is not null then
    select prs.* into v_runtime
    from public.commercial_package_runtime_settings prs
    where prs.package_code = v_package_code;
  end if;

  select aa.* into v_assignment
  from public.account_assignments aa
  where aa.account_id = p_account_id and aa.status in ('pending', 'reserved', 'active')
  order by aa.updated_at desc, aa.created_at desc limit 1;

  if v_assignment.app_instance_id is not null then
    select pai.* into v_instance from public.phone_app_instances pai where pai.id = v_assignment.app_instance_id;
  end if;
  select s.* into v_settings
  from public.ig_account_settings s
  where s.account_id = p_account_id
  order by s.updated_at desc nulls last, s.created_at desc nulls last
  limit 1;
  select s.* into v_sources from public.account_follow_source_settings s where s.account_id = p_account_id;
  select s.* into v_unfollow from public.ig_account_unfollow_settings s where s.account_id = p_account_id;
  select s.* into v_dm from public.ig_account_dm_settings s where s.account_id = p_account_id;
  select cs.subscription_type into v_subscription_type
  from public.client_subscription_accounts csa
  join public.client_subscriptions cs on cs.id = csa.subscription_id
  where csa.account_id = p_account_id and csa.status = 'active' and cs.status = 'active'
  order by cs.starts_at desc, cs.created_at desc limit 1;

  v_expected_clone_mode := case
    when v_instance.id is null then null
    when v_instance.instance_type = 'primary_app' or coalesce(v_instance.instance_index, 0) = 0 then 'off'
    else 'clone_' || v_instance.instance_index::text
  end;
  v_package_follow_day := coalesce((v_package_caps ->> 'follow_day')::integer, 0);
  v_package_follow_session := coalesce((v_package_caps ->> 'follow_session')::integer, 0);
  v_package_unfollow_day := coalesce((v_package_caps ->> 'unfollow_day')::integer, 0);
  v_package_unfollow_session := coalesce((v_package_caps ->> 'unfollow_session')::integer, 0);

  if v_account.id is null
     or v_account.status in ('archived', 'trashed')
     or v_account.archived_at is not null
     or v_account.trashed_at is not null then
    v_reason := 'account_archived';
  elsif v_package_code is null
     or v_runtime.package_code is null
     or coalesce(v_entitlement_package, v_legacy_package_code) is distinct from v_package_code then
    v_reason := 'package_settings_incomplete';
  elsif v_assignment.id is null or v_assignment.device_id is null or v_assignment.app_instance_id is null then
    v_reason := 'assignment_package_mismatch';
  elsif v_instance.id is null
     or v_instance.device_id is distinct from v_assignment.device_id
     or nullif(trim(v_instance.package_name), '') is null
     or not coalesce(v_instance.is_launchable, false)
     or not coalesce(v_instance.usable_for_auto_login, false) then
    v_reason := 'app_instance_package_mismatch';
  elsif nullif(trim(v_settings.app_package), '') is null
     or v_settings.app_package is distinct from v_instance.package_name then
    v_reason := 'assignment_package_mismatch';
  elsif v_settings.clone_mode is distinct from v_expected_clone_mode
     or v_settings.cloned_app_mode is distinct from (v_expected_clone_mode <> 'off') then
    v_reason := 'clone_package_mismatch';
  elsif v_subscription_type is null
     or v_assignment.assignment_type is distinct from v_subscription_type
     or not coalesce(v_runtime_profiles ? v_subscription_type, false) then
    v_reason := 'runtime_profile_mismatch';
  elsif v_settings.account_id is null
     or v_sources.account_id is null
     or v_unfollow.account_id is null
     or v_dm.account_id is null
     or v_package_follow_day <= 0
     or v_package_follow_session <= 0
     or v_package_unfollow_day <= 0
     or v_package_unfollow_session <= 0
     or coalesce(v_settings.max_actions_per_day, 0) <= 0
     or coalesce(v_settings.follow_limit, 0) <= 0
     or coalesce(v_settings.max_follow_per_run, 0) <= 0
     or coalesce(v_sources.max_follows_per_target_per_run, 0) <= 0
     or coalesce(v_sources.max_targets_per_run, 0) <= 0
     or coalesce(v_unfollow.unfollow_per_day_limit, 0) <= 0
     or coalesce(v_unfollow.unfollow_per_session_limit, 0) <= 0
     or v_settings.likes_per_follow_min is null
     or v_settings.likes_per_follow_max is null
     or v_settings.total_likes_limit is null
     or v_dm.welcome_enabled is null
     or v_dm.welcome_per_session_limit is null
     or v_dm.welcome_per_day_limit is null
     or v_dm.outreach_enabled is null
     or v_dm.outreach_per_session_limit is null
     or v_dm.outreach_per_day_limit is null then
    v_reason := 'package_settings_incomplete';
  -- Account caps and source rotation values are valid lower overrides. Package
  -- values are ceilings, not mandatory persisted defaults.
  elsif v_settings.max_actions_per_day > v_package_follow_day
     or v_settings.follow_limit > v_package_follow_session
     or v_settings.max_follow_per_run > least(v_package_follow_session, v_settings.follow_limit)
     or v_unfollow.unfollow_per_day_limit > v_package_unfollow_day
     or v_unfollow.unfollow_per_session_limit > v_package_unfollow_session
     or v_sources.max_follows_per_target_per_run > v_runtime.max_follows_per_target_per_run
     or v_sources.max_targets_per_run > v_runtime.max_targets_per_run
     or v_settings.likes_per_follow_min is distinct from v_runtime.likes_per_follow_min
     or v_settings.likes_per_follow_max is distinct from v_runtime.likes_per_follow_max
     or v_settings.total_likes_limit is distinct from v_runtime.likes_per_day_limit then
    v_reason := 'package_settings_incomplete';
  elsif v_assignment.schedule_mode = 'scheduled'
     and (v_assignment.starts_at is null or v_assignment.ends_at is null or v_assignment.ends_at <= v_assignment.starts_at) then
    v_reason := 'package_settings_incomplete';
  end if;

  v_follow_day := least(coalesce(v_settings.max_actions_per_day, 2147483647),
                        nullif(v_package_follow_day, 0),
                        coalesce((v_effective_preview ->> 'follow_day')::integer, 2147483647));
  v_follow_session := least(coalesce(v_settings.follow_limit, 2147483647), nullif(v_package_follow_session, 0));
  v_follow_run := least(coalesce(v_settings.max_follow_per_run, 2147483647), v_follow_session);
  v_unfollow_day := least(coalesce(v_unfollow.unfollow_per_day_limit, 2147483647), nullif(v_package_unfollow_day, 0));
  v_unfollow_session := least(coalesce(v_unfollow.unfollow_per_session_limit, 2147483647), nullif(v_package_unfollow_session, 0));

  return jsonb_build_object(
    'ok', v_reason = 'ready',
    'reason', v_reason,
    'commercial_package_code', v_package_code,
    'entitlement_package_code', coalesce(v_entitlement_package, v_legacy_package_code),
    'consumed_entitlement_package_code', v_entitlement_package,
    'entitlement_source', v_entitlement_source,
    'runtime_profile', v_subscription_type,
    'assignment', jsonb_build_object(
      'assignment_id', v_assignment.id, 'device_id', v_assignment.device_id,
      'app_instance_id', v_assignment.app_instance_id, 'schedule_mode', v_assignment.schedule_mode,
      'slot_kind', v_assignment.slot_kind, 'starts_at', v_assignment.starts_at, 'ends_at', v_assignment.ends_at
    ),
    'android', jsonb_build_object(
      'package_name', v_instance.package_name, 'instance_type', v_instance.instance_type,
      'instance_index', v_instance.instance_index, 'expected_clone_mode', v_expected_clone_mode,
      'configured_package_name', v_settings.app_package, 'configured_clone_mode', v_settings.clone_mode
    ),
    'settings', jsonb_build_object(
      'follow_day', jsonb_build_object('db', v_settings.max_actions_per_day, 'package', v_package_follow_day, 'effective', v_follow_day, 'rule', 'positive_account_override_lte_package'),
      'follow_session', jsonb_build_object('db', v_settings.follow_limit, 'package', v_package_follow_session, 'effective', v_follow_session, 'rule', 'positive_account_override_lte_package'),
      'max_follow_per_run', jsonb_build_object('db', v_settings.max_follow_per_run, 'package', v_package_follow_session, 'effective', v_follow_run, 'rule', 'positive_account_override_lte_effective_session'),
      'max_follows_per_target_per_run', jsonb_build_object('db', v_sources.max_follows_per_target_per_run, 'package', v_runtime.max_follows_per_target_per_run, 'effective', v_sources.max_follows_per_target_per_run, 'rule', 'positive_account_override_lte_package'),
      'max_targets_per_run', jsonb_build_object('db', v_sources.max_targets_per_run, 'package', v_runtime.max_targets_per_run, 'effective', v_sources.max_targets_per_run, 'rule', 'positive_account_override_lte_package'),
      'unfollow_day', jsonb_build_object('db', v_unfollow.unfollow_per_day_limit, 'package', v_package_unfollow_day, 'effective', v_unfollow_day, 'rule', 'positive_account_override_lte_package'),
      'unfollow_session', jsonb_build_object('db', v_unfollow.unfollow_per_session_limit, 'package', v_package_unfollow_session, 'effective', v_unfollow_session, 'rule', 'positive_account_override_lte_package'),
      'likes_per_follow', jsonb_build_object('min', v_settings.likes_per_follow_min, 'max', v_settings.likes_per_follow_max, 'rule', 'package_exact'),
      'likes_day', jsonb_build_object('db', v_settings.total_likes_limit, 'effective', v_settings.total_likes_limit, 'rule', 'package_exact'),
      'welcome', jsonb_build_object('enabled', v_dm.welcome_enabled, 'session', v_dm.welcome_per_session_limit, 'day', v_dm.welcome_per_day_limit, 'rule', 'positive_lower_override_when_enabled'),
      'outreach', jsonb_build_object('enabled', v_dm.outreach_enabled, 'session', v_dm.outreach_per_session_limit, 'day', v_dm.outreach_per_day_limit, 'rule', 'positive_lower_override_when_enabled'),
      'ops_controls', jsonb_build_object('dry_run_enabled', v_settings.dry_run_enabled, 'send_enabled', v_settings.send_enabled, 'source', 'ig_account_settings')
    )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_phone_clone_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_max_clones integer;
begin
  select pd.max_clones
  into v_max_clones
  from public.phone_devices pd
  where pd.id = new.device_id;

  if v_max_clones is null then
    raise exception 'phone_clones.device_id does not reference an existing phone device';
  end if;

  if new.clone_index > v_max_clones then
    raise exception 'phone_clones.clone_index exceeds phone_devices.max_clones';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_open_assignment_status(p_status text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(p_status, '') in ('pending', 'reserved', 'active');
$function$
;
CREATE OR REPLACE FUNCTION public.is_terminal_assignment_status(p_status text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(p_status, '') in ('released', 'canceled', 'expired', 'archived');
$function$
;
CREATE OR REPLACE FUNCTION public.release_app_instance_if_unused(p_app_instance_id uuid, p_account_id uuid, p_reason text, p_source text DEFAULT 'system'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_updated_count integer := 0;
begin
  if p_app_instance_id is null then
    return false;
  end if;

  update public.phone_app_instances pai
  set status = 'available',
      current_account_id = null,
      metadata = coalesce(pai.metadata, '{}'::jsonb) || jsonb_build_object(
        'last_release_reason', p_reason,
        'last_release_source', p_source,
        'last_released_at', now()
      ),
      updated_at = now()
  where pai.id = p_app_instance_id
    and pai.status = 'occupied'
    and (pai.current_account_id = p_account_id or pai.current_account_id is null)
    and not exists (
      select 1
      from public.account_assignments aa
      where aa.app_instance_id = pai.id
        and aa.status in ('pending', 'reserved', 'active')
    );

  get diagnostics v_updated_count = row_count;

  if v_updated_count > 0 then
    update public.phone_clones pc
    set status = 'available',
        current_account_id = null,
        updated_at = now()
    where (pc.id = p_app_instance_id or exists (
        select 1
        from public.phone_app_instances pai
        where pai.id = p_app_instance_id
          and pai.metadata ->> 'legacy_phone_clones_id' = pc.id::text
      ))
      and (pc.current_account_id = p_account_id or pc.current_account_id is null);
  end if;

  return v_updated_count > 0;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_client_subscription_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_subscription_client_id uuid;
  v_account_client_id uuid;
  v_account_id uuid;
begin
  select cs.client_id
  into v_subscription_client_id
  from public.client_subscriptions cs
  where cs.id = new.subscription_id;

  select cia.client_id, cia.account_id
  into v_account_client_id, v_account_id
  from public.client_instagram_accounts cia
  where cia.id = new.client_instagram_account_id;

  if v_subscription_client_id is null then
    raise exception 'client_subscription_accounts.subscription_id does not reference an existing subscription';
  end if;

  if v_account_client_id is null then
    raise exception 'client_subscription_accounts.client_instagram_account_id does not reference an existing client account';
  end if;

  if v_subscription_client_id <> v_account_client_id then
    raise exception 'subscription and client_instagram_account must belong to the same client';
  end if;

  if new.account_id <> v_account_id then
    raise exception 'client_subscription_accounts.account_id must match client_instagram_accounts.account_id';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_client_subscription_type()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.subscription_type = 'outreach_only'
     and exists (
       select 1
       from public.client_subscription_modules csm
       where csm.subscription_id = new.id
         and csm.enabled = true
         and csm.feature_code <> 'outreach'
     ) then
    raise exception 'cannot set subscription_type=outreach_only while non-outreach modules are enabled';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_phone_device_timezone()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if not public.is_valid_schedule_timezone(new.timezone) then
    raise exception 'invalid_timezone';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_package_runtime_contract_pre_source_override_v1(p_account_id uuid, p_source text DEFAULT 'canonical_reconcile'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_limits jsonb;
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
begin
  perform set_config('bmb.package_contract_reconcile', 'on', true);
  v_result := public.reconcile_account_package_runtime_contract_legacy_limit_restore_v1(
    p_account_id,
    p_source
  );
  v_limits := public.apply_account_follow_limit_provenance_v1(p_account_id);
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  return coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('follow_limit_provenance', v_limits);
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.auto_restart_phase_plan_v2_error(p_plan jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_phase text;
  v_enabled boolean := false;
  v_recovery_first boolean := false;
begin
  if jsonb_typeof(p_plan) <> 'object'
     or p_plan ->> 'schema' <> 'AUTO_RESTART_RESUME_PLAN_V2'
     or coalesce((p_plan ->> 'plan_version')::integer, 0) <> 2 then
    return 'phase_plan_unknown';
  end if;
  if nullif(p_plan ->> 'account_id', '') is null then
    return 'phase_plan_account_missing';
  end if;
  if jsonb_typeof(p_plan -> 'phases_to_run') <> 'object'
     or jsonb_typeof(p_plan -> 'quota_remaining') <> 'object' then
    return 'phase_plan_unknown';
  end if;

  if coalesce((p_plan ->> 'restriction_preflight_only')::boolean, false) then
    if p_plan -> 'phase_order' <> '["welcome","follow","unfollow"]'::jsonb
       or p_plan ->> 'resume_kind' <> 'instagram_restriction_preflight'
       or nullif(p_plan ->> 'incident_id', '') is null
       or nullif(p_plan ->> 'authorization_id', '') is null then
      return 'restriction_preflight_contract_invalid';
    end if;
    foreach v_phase in array array['welcome','follow','unfollow'] loop
      if not (p_plan -> 'phases_to_run' ? v_phase)
         or (p_plan -> 'phases_to_run' ->> v_phase)::boolean is not false
         or coalesce((p_plan -> 'quota_remaining' ->> v_phase)::integer, -1) <> 0 then
        return 'restriction_preflight_contract_invalid';
      end if;
    end loop;
    if coalesce((p_plan -> 'quota_remaining' ->> 'outreach')::integer, -1) <> 0
       or coalesce((p_plan -> 'quota_remaining' ->> 'total')::integer, -1) <> 0 then
      return 'restriction_preflight_contract_invalid';
    end if;
    return null;
  end if;

  if coalesce((p_plan ->> 'package_contract_ready')::boolean, false) is not true then
    return 'phase_plan_package_unknown';
  end if;
  v_recovery_first := p_plan -> 'phase_order'
    = '["post_follow_recovery","welcome","follow","unfollow"]'::jsonb;
  if not v_recovery_first
     and p_plan -> 'phase_order' <> '["welcome","follow","unfollow"]'::jsonb then
    return 'phase_plan_order_invalid';
  end if;
  if v_recovery_first and (
    coalesce((p_plan -> 'phases_to_run' ->> 'post_follow_recovery')::boolean, false) is not true
    or p_plan ->> 'safe_next_step' <> 'post_follow_recovery'
    or coalesce((p_plan -> 'phases_to_run' ->> 'follow')::boolean, false) is not true
  ) then
    return 'post_follow_recovery_contract_invalid';
  end if;
  if not v_recovery_first
     and coalesce((p_plan -> 'phases_to_run' ->> 'post_follow_recovery')::boolean, false) then
    return 'post_follow_recovery_contract_invalid';
  end if;
  foreach v_phase in array array['welcome','follow','unfollow'] loop
    if coalesce((p_plan -> 'phases_to_run' ->> v_phase)::boolean, false) then
      v_enabled := true;
      if nullif(p_plan -> 'quota_remaining' ->> v_phase, '') is null
         or (p_plan -> 'quota_remaining' ->> v_phase)::integer <= 0 then
        return 'phase_plan_quota_invalid';
      end if;
    end if;
  end loop;
  if not v_enabled then return 'resume_phase_plan_not_actionable'; end if;
  return null;
exception when invalid_text_representation or numeric_value_out_of_range then
  return 'phase_plan_invalid_field';
end
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_client_instagram_ready_identity_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_canonical_username text;
  v_ready_transition boolean;
  v_preproof_transition_allowed boolean := false;
begin
  v_ready_transition :=
    (tg_op = 'INSERT' and (
      lower(coalesce(new.login_status, '')) = 'connected'
      or lower(coalesce(new.provisioning_status, '')) = 'ready'
      or lower(coalesce(new.onboarding_status, '')) = 'ready'
    ))
    or (tg_op = 'UPDATE' and (
      (lower(coalesce(new.login_status, '')) = 'connected'
        and lower(coalesce(old.login_status, '')) <> 'connected')
      or (lower(coalesce(new.provisioning_status, '')) = 'ready'
        and lower(coalesce(old.provisioning_status, '')) <> 'ready')
      or (lower(coalesce(new.onboarding_status, '')) = 'ready'
        and lower(coalesce(old.onboarding_status, '')) <> 'ready')
    ));

  if not v_ready_transition then
    return new;
  end if;

  select public.normalize_instagram_identity_username_v1(ia.username)
    into v_canonical_username
  from public.ig_accounts ia
  where ia.id = new.account_id;

  if tg_op = 'UPDATE'
     and old.login_identity_proof_status = 'proven_false_ready'
     and old.login_identity_failure_reason = 'login_identity_not_verified'
     and old.login_identity_profile_opened is false
     and old.login_identity_username_match is false
     and old.login_state_invalidation_reason is null
     and new.login_identity_proof_status = 'historical_model_missing'
     and new.login_identity_verified_at is null
     and new.login_state_invalidation_reason is null
     and public.normalize_instagram_identity_username_v1(new.login_identity_expected_username) = v_canonical_username
  then
    select exists (
      select 1
      from public.ig_runs r
      join public.account_run_requests rr
        on rr.run_id = r.id
       and rr.account_id = r.account_id
      join public.ig_accounts ia
        on ia.id = r.account_id
      where r.id = new.login_identity_source_run_id
        and r.account_id = new.account_id
        and r.status = 'completed'
        and r.error_message is null
        and coalesce((r.performance_summary ->> 'exit_code')::integer, 0) = 0
        and rr.requested_run_type = 'login_provisioning'
        and rr.status = 'completed'
        and rr.error_code is null
        and rr.source_surface = 'instagram_client_connect'
        and rr.metadata_safe ->> 'mode' = 'login_preflight_now'
        and rr.created_at < timestamptz '2026-08-10 11:19:19+00'
        and lower(coalesce(ia.admin_lifecycle_status, '')) = 'active'
        and ia.archived_at is null
        and ia.trashed_at is null
        and exists (
          select 1
          from public.account_credentials ac
          where ac.account_id = new.account_id
            and ac.provider = 'instagram'
            and ac.status in ('active', 'configured')
            and coalesce(ac.reauth_required, false) is false
        )
    ) into v_preproof_transition_allowed;
  end if;

  if v_preproof_transition_allowed then
    return new;
  end if;

  if new.login_identity_proof_status <> 'verified'
     or new.login_identity_profile_opened is distinct from true
     or new.login_identity_username_match is distinct from true
     or new.login_identity_verified_at is null
     or public.normalize_instagram_identity_username_v1(new.login_identity_expected_username) = ''
     or public.normalize_instagram_identity_username_v1(new.login_identity_detected_username) = ''
     or public.normalize_instagram_identity_username_v1(new.login_identity_expected_username) <> v_canonical_username
     or public.normalize_instagram_identity_username_v1(new.login_identity_detected_username) <> v_canonical_username
  then
    raise exception 'login_identity_not_verified'
      using errcode = '23514';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_login_provisioning_business_gate_v1(p_reason text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select lower(trim(coalesce(p_reason, ''))) in (
    'identity_required_unverified',
    'login_identity_not_verified',
    'instagram_identity_review_pending_identity_unverified',
    'instagram_review_pending',
    'identity_review_required',
    'review_required',
    'challenge_pending',
    'verification_required',
    'identity_mismatch',
    'login_identity_mismatch'
  );
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_connected_instagram_growth_readiness_v1(p_account_id uuid, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account public.ig_accounts%rowtype;
  v_settings public.ig_account_settings%rowtype;
  v_client public.client_instagram_accounts%rowtype;
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_now timestamptz := now();
  v_eligible_targets integer := 0;
  v_actions_resolved integer := 0;
  v_incidents_resolved integer := 0;
  v_changed boolean := false;
begin
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;
  if v_source not in ('identity_success', 'login_request_terminal', 'login_blocker_terminal', 'migration_backfill') then
    raise exception 'post_connection_readiness_source_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'post_connection_growth_readiness:' || p_account_id::text,
    0
  ));

  select * into v_account
  from public.ig_accounts
  where id = p_account_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'account_not_found');
  end if;
  if v_account.archived_at is not null or v_account.trashed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'account_archived_or_trashed');
  end if;
  if lower(coalesce(v_account.admin_lifecycle_status, '')) <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'admin_lifecycle_not_active');
  end if;

  select * into v_client
  from public.client_instagram_accounts
  where account_id = p_account_id
    and active is true
  for update;
  if not found
     or lower(coalesce(v_client.login_status, '')) <> 'connected'
     or lower(coalesce(v_client.provisioning_status, '')) <> 'ready'
     or lower(coalesce(v_client.onboarding_status, '')) <> 'ready'
     or lower(coalesce(v_client.login_identity_proof_status, '')) <> 'verified'
     or coalesce(v_client.login_identity_profile_opened, false) is not true
     or coalesce(v_client.login_identity_username_match, false) is not true
     or v_client.login_identity_verified_at is null
     or nullif(btrim(coalesce(v_client.login_state_invalidation_reason, '')), '') is not null then
    return jsonb_build_object('ok', false, 'reason', 'exact_login_identity_not_ready');
  end if;

  if exists (
    select 1 from public.account_run_requests r
    where r.account_id = p_account_id
      and r.status in ('pending', 'queued', 'claimed', 'starting', 'processing', 'running', 'in_progress', 'active')
  ) or exists (
    select 1 from public.ig_runs r
    where r.account_id = p_account_id
      and r.status in ('pending', 'queued', 'claimed', 'starting', 'processing', 'running', 'in_progress', 'active')
  ) or exists (
    select 1 from public.auto_restart_device_locks l
    where l.account_id = p_account_id
      and l.lease_expires_at > v_now
  ) then
    return jsonb_build_object('ok', false, 'reason', 'account_runtime_active');
  end if;

  select count(*)::integer into v_eligible_targets
  from public.ig_targets t
  where t.account_id = p_account_id
    and lower(coalesce(t.status, '')) in ('valid', 'active')
    and lower(coalesce(t.quality_status, '')) = 'eligible'
    and lower(coalesce(t.verification_status, '')) = 'found'
    and t.archived_at is null
    and t.deleted_at is null;

  select * into v_settings
  from public.ig_account_settings
  where account_id = p_account_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'account_settings_missing');
  end if;

  if not exists (
    select 1 from public.account_credentials c
    where c.account_id = p_account_id
      and c.provider = 'instagram'
      and c.status in ('active', 'configured')
      and coalesce(c.reauth_required, false) is false
      and nullif(btrim(coalesce(c.secret_ref, '')), '') is not null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'active_credentials_required');
  end if;

  if not exists (
    select 1
    from public.account_assignments a
    join public.phone_app_instances i
      on i.id = a.app_instance_id
     and i.current_account_id = p_account_id
     and i.status in ('occupied', 'assigned', 'active')
    join public.phone_devices d
      on d.id = a.device_id
     and d.status in ('available', 'online', 'active', 'busy')
    where a.account_id = p_account_id
      and a.status in ('reserved', 'active')
      and a.schedule_mode in ('manual_only', 'scheduled')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'runtime_assignment_not_ready');
  end if;

  if exists (
    select 1 from public.instagram_account_restriction_holds h
    where h.account_id = p_account_id
      and h.status in ('active', 'verification_required')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'restriction_hold_active');
  end if;

  -- Exact identity success supersedes only older login-specific failures.
  -- Business, restriction, security, and social incidents remain fail-closed.
  -- Resolve the incident first. Its existing AFTER trigger synchronizes linked
  -- operator-review actions exactly once. Resolving actions first would invoke
  -- the legacy BEFORE trigger, update the incident, and then attempt to update
  -- the same action tuple again inside the originating command.
  update public.account_incidents i
  set status = 'resolved',
      resolved_at = coalesce(i.resolved_at, v_now),
      resolution_reason = coalesce(i.resolution_reason, 'superseded_by_exact_identity_success'),
      resolution_note = coalesce(i.resolution_note, 'A later exact assigned-account identity proof completed successfully.'),
      action_required = null,
      updated_at = v_now,
      metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
        'superseded_by_exact_identity_success', true,
        'identity_verified_at', v_client.login_identity_verified_at,
        'reconciliation_source', v_source,
        'blocking_campaign', false,
        'operator_review_required', false,
        'login_block_active', false
      )
  where i.account_id = p_account_id
    and i.created_at <= v_client.login_identity_verified_at
    and i.status in ('open', 'acknowledged', 'investigating')
    and i.resolved_at is null
    and i.archived_at is null
    and coalesce(i.legal_hold, false) is false
    and i.incident_type in (
      'auto_login_failed',
      'auto_login_identity_mismatch',
      'login_identity_mismatch',
      'login_package_mismatch',
      'instagram_login_verification_required',
      'login_verification_required'
    );
  get diagnostics v_incidents_resolved = row_count;

  update public.account_dashboard_actions a
  set status = 'resolved',
      blocking_campaign = false,
      requires_client_action = false,
      resolved_at = coalesce(a.resolved_at, v_now),
      updated_at = v_now,
      metadata_safe = coalesce(a.metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'superseded_by_exact_identity_success', true,
        'identity_verified_at', v_client.login_identity_verified_at,
        'reconciliation_source', v_source
      )
  where a.account_id = p_account_id
    and a.created_at <= v_client.login_identity_verified_at
    and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
    and (
      a.action_type in (
        'review_login_failure',
        'review_login_package_mismatch',
        'submit_instagram_verification_code',
        'instagram_verification_required',
        'login_preflight_scheduled'
      )
      or (
        a.action_type = 'operator_review_required'
        and exists (
          select 1 from public.account_incidents i
          where i.id = a.incident_id
            and i.incident_type in (
              'auto_login_failed',
              'auto_login_identity_mismatch',
              'login_identity_mismatch',
              'login_package_mismatch',
              'instagram_login_verification_required',
              'login_verification_required'
            )
        )
      )
    );
  get diagnostics v_actions_resolved = row_count;

  if exists (
    select 1 from public.account_dashboard_actions a
    where a.account_id = p_account_id
      and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
      and (
        coalesce(a.blocking_campaign, false)
        or a.action_type in ('operator_review_required', 'review_auto_restart_hard_stop')
        or a.status = 'pending_verification'
      )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'blocking_dashboard_action_active');
  end if;

  if exists (
    select 1 from public.account_incidents i
    where i.account_id = p_account_id
      and i.status in ('open', 'acknowledged', 'investigating')
      and i.resolved_at is null
      and i.archived_at is null
      and (
        nullif(btrim(coalesce(i.action_required, '')), '') is not null
        or lower(coalesce(i.severity, '')) = 'critical'
        or coalesce(i.metadata ->> 'blocking_campaign', 'false') = 'true'
        or coalesce(i.metadata ->> 'operator_review_required', 'false') = 'true'
        or coalesce(i.metadata ->> 'login_block_active', 'false') = 'true'
        or coalesce(i.metadata ->> 'social_block_active', 'false') = 'true'
      )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'blocking_incident_active');
  end if;

  if lower(coalesce(v_account.status, '')) <> 'active' then
    update public.ig_accounts
    set status = 'active', updated_at = v_now
    where id = p_account_id;
    v_changed := true;
  end if;
  if lower(coalesce(v_settings.account_status, '')) <> 'active'
     or lower(coalesce(v_settings.current_run_status, '')) <> 'idle' then
    update public.ig_account_settings
    set account_status = 'active',
        current_run_status = 'idle',
        updated_at = v_now
    where account_id = p_account_id;
    v_changed := true;
  end if;

  if v_changed or v_actions_resolved > 0 or v_incidents_resolved > 0 then
    insert into public.ig_action_logs (
      account_id, run_id, target_username, action_type, status, message, payload, created_at
    ) values (
      p_account_id,
      null,
      null,
      'post_connection_growth_readiness_reconciled',
      'success',
      'Exact Instagram identity success reconciled canonical growth readiness.',
      jsonb_build_object(
        'source', v_source,
        'eligible_targets', v_eligible_targets,
        'initial_onboarding_required_eligible_targets', 15,
        'onboarding_target_gate_applied', false,
        'post_onboarding_low_stock_threshold', 5,
        'post_onboarding_low_stock', v_eligible_targets <= 5,
        'actions_resolved', v_actions_resolved,
        'incidents_resolved', v_incidents_resolved,
        'account_status_changed', v_changed,
        'runtime_started', false,
        'schedule_changed', false,
        'package_changed', false,
        'target_changed', false
      ),
      v_now
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', case
      when v_changed or v_actions_resolved > 0 or v_incidents_resolved > 0
        then 'post_connection_growth_readiness_reconciled'
      else 'already_converged'
    end,
    'changed', v_changed,
    'account_id', p_account_id,
    'eligible_targets', v_eligible_targets,
    'initial_onboarding_required_eligible_targets', 15,
    'onboarding_target_gate_applied', false,
    'post_onboarding_low_stock_threshold', 5,
    'post_onboarding_low_stock', v_eligible_targets <= 5,
    'actions_resolved', v_actions_resolved,
    'incidents_resolved', v_incidents_resolved,
    'account_status', 'active',
    'settings_account_status', 'active',
    'current_run_status', 'idle'
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.find_device_recurring_assignment_conflict_v1(p_assignment_id uuid, p_device_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_timezone text;
  v_conflict_id uuid;
begin
  select pd.timezone into v_timezone
  from public.phone_devices pd
  where pd.id = p_device_id;

  if v_timezone is null then return null; end if;

  select aa.id into v_conflict_id
  from public.account_assignments aa
  where aa.device_id = p_device_id
    and aa.id <> coalesce(p_assignment_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and aa.released_at is null
    and aa.status in ('pending', 'reserved', 'active')
    and aa.schedule_mode = 'scheduled'
    and public.recurring_daily_windows_overlap_v1(
      p_starts_at, p_ends_at, aa.starts_at, aa.ends_at, v_timezone
    )
  order by aa.created_at asc, aa.id asc
  limit 1;

  return v_conflict_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_client_instagram_login_monotonic_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_was_verified_connected boolean;
  v_downgrade_requested boolean;
  v_old_ordering_at timestamptz;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- A fresh exact proof starts a new canonical generation. The existing
  -- identity trigger separately verifies username/profile proof correctness.
  if new.login_identity_proof_status = 'verified'
     and new.login_identity_profile_opened is true
     and new.login_identity_username_match is true
     and new.login_identity_verified_at is not null
     and (
       old.login_identity_proof_status is distinct from 'verified'
       or old.login_identity_verified_at is distinct from new.login_identity_verified_at
     )
  then
    new.login_state_source_at := greatest(
      new.login_identity_verified_at,
      coalesce(new.login_state_source_at, new.login_identity_verified_at)
    );
    new.login_state_version := greatest(
      coalesce(new.login_state_version, 0),
      coalesce(old.login_state_version, 0) + 1
    );
    new.login_state_invalidation_reason := null;
  end if;

  v_was_verified_connected :=
    old.login_identity_proof_status = 'verified'
    and old.login_identity_profile_opened is true
    and old.login_identity_username_match is true
    and old.login_identity_verified_at is not null
    and lower(coalesce(old.login_status, '')) = 'connected';

  v_downgrade_requested := v_was_verified_connected and (
    lower(coalesce(new.login_status, '')) <> 'connected'
    or lower(coalesce(new.provisioning_status, '')) <> 'ready'
    or lower(coalesce(new.onboarding_status, '')) <> 'ready'
    or new.login_identity_proof_status <> 'verified'
    or new.login_identity_profile_opened is distinct from true
    or new.login_identity_username_match is distinct from true
  );

  if not v_downgrade_requested then
    return new;
  end if;

  v_old_ordering_at := greatest(
    old.login_identity_verified_at,
    coalesce(old.login_state_source_at, old.login_identity_verified_at)
  );

  if public.normalize_instagram_login_invalidation_reason_v1(new.login_state_invalidation_reason) is null
     or new.login_state_source_at is null
     or new.login_state_source_at <= v_old_ordering_at
     or new.login_state_version <= old.login_state_version
  then
    raise exception 'login_state_downgrade_requires_newer_canonical_invalidation'
      using errcode = '23514';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.stamp_worker_login_identity_provenance_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.login_identity_proof_status = 'verified'
     and new.login_identity_verified_at is not null
     and new.login_identity_verification_source is null then
    new.login_identity_verification_source := 'worker';
    new.login_identity_verification_method := coalesce(
      nullif(new.login_identity_verification_method, ''),
      'own_profile_identity_guard'
    );
    new.login_identity_verified_by := coalesce(
      nullif(new.login_identity_verified_by, ''),
      'worker'
    );
    new.login_identity_verified_account_id := new.account_id;
    new.login_identity_login_lineage := coalesce(new.login_identity_login_lineage, '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
        'source_run_id', new.login_identity_source_run_id,
        'proof_version', new.login_identity_proof_version
      ));
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.project_commercial_lifecycle_email_transition_evidence_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_message text;
begin
  if old.state is not distinct from new.state or new.state <> 'completed' then
    return new;
  end if;

  v_message := case new.operation_type
    when 'pause' then 'account_paused'
    when 'resume' then 'account_reactivated'
    when 'cancel' then 'account_cancelled'
    else null
  end;

  if v_message is null then
    return new;
  end if;

  insert into public.ig_action_logs (
    account_id,
    run_id,
    target_username,
    action_type,
    status,
    message,
    payload,
    created_at
  ) values (
    new.account_id,
    null,
    null,
    'account_admin_status_changed',
    'success',
    v_message,
    jsonb_build_object(
      'commercial_lifecycle_operation_id', new.id,
      'commercial_lifecycle_operation_type', new.operation_type,
      'transition_evidence_version', 1,
      'source', 'commercial_account_lifecycle_operations.completed'
    ),
    coalesce(new.updated_at, now())
  ) on conflict do nothing;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_client_instagram_account_capacity_monotonicity_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.capacity_status = 'released_terminal' then
    if new.capacity_status <> old.capacity_status
      or new.capacity_released_at is distinct from old.capacity_released_at
      or new.capacity_release_reason is distinct from old.capacity_release_reason
      or new.capacity_release_operation_id is distinct from old.capacity_release_operation_id then
      raise exception 'released_terminal_capacity_is_immutable' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.guard_never_follow_twice_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_username text := lower(ltrim(trim(coalesce(new.username, '')), '@'));
begin
  if new.event_type <> 'follow_verified_persisted_v1' then
    return new;
  end if;
  if new.account_id is null or v_username = '' then
    raise exception 'never_follow_twice_identity_required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.account_id::text || ':' || v_username, 0)
  );

  if exists (
    select 1
    from public.ig_interaction_events as prior
    where prior.account_id = new.account_id
      and lower(ltrim(trim(coalesce(prior.username, '')), '@')) = v_username
      and prior.event_type = 'follow_verified_persisted_v1'
      and prior.event_status = 'success'
      and prior.id is distinct from new.id
  ) then
    raise exception 'follow_persistence_canonical_once_already_exists'
      using errcode = '23505';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.project_ever_followed_canonical_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_username text := lower(ltrim(trim(coalesce(new.username, '')), '@'));
begin
  if new.event_type <> 'follow_verified_persisted_v1'
     or new.event_status <> 'success'
     or new.account_id is null
     or v_username = '' then
    return new;
  end if;

  update public.ig_interacted_users as iu
  set ever_followed_canonical_at = coalesce(iu.ever_followed_canonical_at, new.event_at),
      ever_followed_action_id = coalesce(iu.ever_followed_action_id, new.id)
  where iu.account_id = new.account_id
    and lower(ltrim(trim(coalesce(iu.username, '')), '@')) = v_username;
  if not found then
    raise exception 'ever_followed_projection_interaction_row_missing'
      using errcode = '23503';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.trigger_instagram_password_remediation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid;
  v_source text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_table_name = 'client_instagram_accounts' then
    v_account_id := new.account_id;
    v_source := 'identity_success';
  elsif tg_table_name = 'account_credentials' then
    if new.provider <> 'instagram'
       or new.status <> 'active'
       or coalesce(new.reauth_required, false) is true
       or nullif(btrim(coalesce(new.secret_ref, '')), '') is null then
      return new;
    end if;
    v_account_id := new.account_id;
    v_source := 'credential_confirmed';
  else
    return new;
  end if;

  perform public.reconcile_instagram_password_remediation_v1(v_account_id, v_source);
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.notification_router_auto_login_success_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  username text;
  plan_key text;
  event_environment text := 'live';
begin
  if not (
    new.active is true
    and new.login_status = 'connected'
    and new.provisioning_status = 'ready'
    and new.onboarding_status = 'ready'
    and new.login_identity_proof_status = 'verified'
    and new.login_identity_profile_opened is true
    and new.login_identity_username_match is true
    and new.login_identity_verified_at is not null
    and nullif(trim(coalesce(new.login_state_invalidation_reason, '')), '') is null
  ) then return new; end if;

  if exists (
    select 1 from public.account_run_requests request
    where request.account_id = new.account_id
      and request.status in ('pending','queued','claimed','starting','processing','running','in_progress','active','cancel_requested')
  ) or exists (
    select 1 from public.ig_runs run
    where run.account_id = new.account_id
      and run.status in ('pending','queued','claimed','starting','processing','running','in_progress','active')
  ) then return new; end if;

  if new.login_identity_source_run_id is not null and not exists (
    select 1 from public.ig_runs run
    join public.account_run_requests request on request.run_id = run.id and request.account_id = run.account_id
    where run.id = new.login_identity_source_run_id
      and run.account_id = new.account_id
      and run.status in ('completed','failed','stopped','canceled')
      and request.requested_run_type = 'login_provisioning'
      and request.status in ('completed','failed','canceled')
  ) then return new; end if;

  if tg_op = 'UPDATE' and
    old.login_status = 'connected' and old.provisioning_status = 'ready'
    and old.onboarding_status = 'ready' and old.login_identity_proof_status = 'verified'
    and old.login_identity_profile_opened is true and old.login_identity_username_match is true
    and old.login_identity_verified_at is not distinct from new.login_identity_verified_at
  then return new; end if;

  select '@' || trim(leading '@' from account.username) into username
  from public.ig_accounts account where account.id = new.account_id;

  select entitlement.plan_key into plan_key
  from public.client_account_entitlements entitlement
  where entitlement.client_id = new.client_id and entitlement.account_id = new.account_id
    and entitlement.status = 'entitlement_consumed'
  order by entitlement.created_at desc limit 1;

  select case when subscription.livemode is false then 'test' else 'live' end into event_environment
  from public.commercial_stripe_subscriptions subscription
  where subscription.client_id = new.client_id and subscription.account_id = new.account_id
    and subscription.status in ('active','trialing')
  order by subscription.updated_at desc limit 1;

  perform public.emit_notification_business_event_v2(
    'auto_login.connected:' || new.id::text || ':' || new.login_identity_proof_version::text || ':' || extract(epoch from new.login_identity_verified_at)::bigint::text,
    'auto_login', coalesce(event_environment, 'live'), 'auto_login.connected',
    new.account_id, new.client_id, null,
    jsonb_build_object('username', coalesce(username, '@non-renseigné'), 'plan', coalesce(plan_key, 'Formule active')),
    jsonb_build_object('client_instagram_account_id', new.id, 'source_run_id', new.login_identity_source_run_id),
    new.login_identity_verified_at
  );
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.bump_ig_run_live_counter_revision_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (new.total_follow, new.total_like, new.total_dm, new.total_story)
     is distinct from
     (old.total_follow, old.total_like, old.total_dm, old.total_story) then
    new.live_counter_revision := greatest(
      coalesce(old.live_counter_revision, 0) + 1,
      coalesce(new.live_counter_revision, 0)
    );
  else
    new.live_counter_revision := coalesce(old.live_counter_revision, 0);
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.normalize_instagram_identity_username_v1(p_username text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select lower(trim(both '@' from trim(both '/' from trim(coalesce(p_username, '')))));
$function$
;
CREATE OR REPLACE FUNCTION public.validate_client_subscription_module()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_subscription_type text;
begin
  select cs.subscription_type
  into v_subscription_type
  from public.client_subscriptions cs
  where cs.id = new.subscription_id;

  if v_subscription_type is null then
    raise exception 'client_subscription_modules.subscription_id does not reference an existing subscription';
  end if;

  if v_subscription_type = 'outreach_only'
     and new.enabled = true
     and new.feature_code <> 'outreach' then
    raise exception 'outreach_only subscriptions can only enable the outreach module';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_ig_target_followback_ratio_p1c()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.follows_sent_count > 0 then
    new.followback_ratio := round(
      (new.followbacks_count::numeric / new.follows_sent_count::numeric) * 100,
      4
    );
  else
    new.followback_ratio := null;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_ig_targets_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_valid_schedule_timezone(p_timezone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = nullif(trim(p_timezone), '')
  );
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_account_package_runtime_contract_legacy_limit_restore(p_account_id uuid, p_source text DEFAULT 'canonical_reconcile'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_source text := coalesce(nullif(trim(p_source), ''), 'canonical_reconcile');
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
  v_before_status jsonb;
  v_after_status jsonb;
  v_account public.ig_accounts%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_package_caps jsonb;
  v_package_follow_day integer;
  v_package_follow_session integer;
  v_package_unfollow_day integer;
  v_package_unfollow_session integer;
  v_follow_day integer;
  v_follow_session integer;
  v_follow_run integer;
  v_unfollow_day integer;
  v_unfollow_session integer;
  v_welcome_day integer;
  v_welcome_session integer;
  v_outreach_day integer;
  v_outreach_session integer;
  v_total_dm_day integer;
  v_result jsonb;
  v_changed_fields jsonb := '{}'::jsonb;
begin
  if p_account_id is null then
    raise exception 'package_settings_incomplete';
  end if;

  select * into v_account from public.ig_accounts where id = p_account_id for update;
  if v_account.id is null then
    raise exception 'package_settings_incomplete';
  end if;
  if v_account.status in ('archived', 'trashed')
     or v_account.archived_at is not null
     or v_account.trashed_at is not null then
    return jsonb_build_object('ok', true, 'reason', 'account_archived_skipped', 'account_id', p_account_id, 'source', v_source, 'changed', false);
  end if;

  v_before_status := public.account_package_runtime_contract_status(p_account_id);
  if coalesce((v_before_status ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', true, 'reason', 'package_runtime_contract_already_compliant', 'account_id', p_account_id, 'source', v_source, 'changed', false, 'contract', v_before_status);
  end if;

  select aa.* into v_assignment
  from public.account_assignments aa
  where aa.account_id = p_account_id and aa.status in ('pending', 'reserved', 'active')
  order by aa.updated_at desc, aa.created_at desc limit 1 for update;

  select aps.package_caps into v_package_caps
  from public.account_package_summary aps where aps.account_id = p_account_id;
  v_package_follow_day := coalesce((v_package_caps ->> 'follow_day')::integer, 0);
  v_package_follow_session := coalesce((v_package_caps ->> 'follow_session')::integer, 0);
  v_package_unfollow_day := coalesce((v_package_caps ->> 'unfollow_day')::integer, 0);
  v_package_unfollow_session := coalesce((v_package_caps ->> 'unfollow_session')::integer, 0);
  if least(v_package_follow_day, v_package_follow_session, v_package_unfollow_day, v_package_unfollow_session) <= 0 then
    raise exception 'package_settings_incomplete';
  end if;

  select s.max_actions_per_day, s.follow_limit, s.max_follow_per_run
  into v_follow_day, v_follow_session, v_follow_run
  from public.ig_account_settings s
  where s.account_id = p_account_id
  order by s.updated_at desc nulls last, s.created_at desc nulls last limit 1;

  select u.unfollow_per_day_limit, u.unfollow_per_session_limit
  into v_unfollow_day, v_unfollow_session
  from public.ig_account_unfollow_settings u where u.account_id = p_account_id;

  select d.welcome_per_day_limit, d.welcome_per_session_limit,
         d.outreach_per_day_limit, d.outreach_per_session_limit,
         d.total_dm_per_day_limit
  into v_welcome_day, v_welcome_session, v_outreach_day, v_outreach_session,
       v_total_dm_day
  from public.ig_account_dm_settings d where d.account_id = p_account_id;

  -- A missing legacy settings row can be initialized safely from schema
  -- defaults; the exact materializer below fills every contract field.
  if not exists (select 1 from public.ig_account_settings where account_id = p_account_id) then
    insert into public.ig_account_settings (account_id) values (p_account_id);
    v_changed_fields := v_changed_fields || jsonb_build_object('ig_account_settings', 'LEGACY_DEFAULT_MISSING');
  end if;

  perform set_config('bmb.package_contract_reconcile', 'on', true);
  if v_before_status ->> 'entitlement_source' = 'legacy_active_subscription_package' then
    v_result := public.reconcile_legacy_account_assignment_binding_v1(p_account_id, v_source);
  else
    v_result := public.reconcile_account_package_runtime_contract_exact_v1(p_account_id, v_source);
  end if;

  -- Restore only explicit positive lower account overrides. Above-package,
  -- zero and null values stay corrected to the package materializer value.
  update public.ig_account_settings s
  set max_actions_per_day = case when v_follow_day between 1 and v_package_follow_day then v_follow_day else s.max_actions_per_day end,
      follow_limit = case when v_follow_session between 1 and v_package_follow_session then v_follow_session else s.follow_limit end,
      max_follow_per_run = case
        when v_follow_run between 1 and least(v_package_follow_session,
             case when v_follow_session between 1 and v_package_follow_session then v_follow_session else s.follow_limit end)
          then v_follow_run
        else least(s.max_follow_per_run, s.follow_limit)
      end,
      updated_at = case
        when (s.max_actions_per_day, s.follow_limit, s.max_follow_per_run) is distinct from (
          case when v_follow_day between 1 and v_package_follow_day then v_follow_day else s.max_actions_per_day end,
          case when v_follow_session between 1 and v_package_follow_session then v_follow_session else s.follow_limit end,
          case
            when v_follow_run between 1 and least(v_package_follow_session,
                 case when v_follow_session between 1 and v_package_follow_session then v_follow_session else s.follow_limit end)
              then v_follow_run
            else least(s.max_follow_per_run, s.follow_limit)
          end
        ) then now() else s.updated_at end
  where s.account_id = p_account_id;

  update public.ig_account_unfollow_settings u
  set unfollow_per_day_limit = case when v_unfollow_day between 1 and v_package_unfollow_day then v_unfollow_day else u.unfollow_per_day_limit end,
      unfollow_per_session_limit = case when v_unfollow_session between 1 and v_package_unfollow_session then v_unfollow_session else u.unfollow_per_session_limit end,
      updated_at = case
        when (u.unfollow_per_day_limit, u.unfollow_per_session_limit) is distinct from (
          case when v_unfollow_day between 1 and v_package_unfollow_day then v_unfollow_day else u.unfollow_per_day_limit end,
          case when v_unfollow_session between 1 and v_package_unfollow_session then v_unfollow_session else u.unfollow_per_session_limit end
        ) then now() else u.updated_at end
  where u.account_id = p_account_id;

  -- DM values are inherited at provisioning, but explicit positive lower caps
  -- remain safe. Disabled domains remain zeroed by the exact materializer.
  update public.ig_account_dm_settings d
  set welcome_per_day_limit = case when d.welcome_enabled and v_welcome_day between 1 and d.welcome_per_day_limit then v_welcome_day else d.welcome_per_day_limit end,
      welcome_per_session_limit = case when d.welcome_enabled and v_welcome_session between 1 and least(d.welcome_per_session_limit, d.welcome_per_day_limit) then v_welcome_session else d.welcome_per_session_limit end,
      outreach_per_day_limit = case when d.outreach_enabled and v_outreach_day between 1 and d.outreach_per_day_limit then v_outreach_day else d.outreach_per_day_limit end,
      outreach_per_session_limit = case when d.outreach_enabled and v_outreach_session between 1 and least(d.outreach_per_session_limit, d.outreach_per_day_limit) then v_outreach_session else d.outreach_per_session_limit end,
      updated_at = now()
  where d.account_id = p_account_id;

  -- Compute the combined ceiling from the restored domain caps, then preserve a
  -- positive lower combined override when one existed before reconciliation.
  update public.ig_account_dm_settings d
  set total_dm_per_day_limit = case
        when v_total_dm_day between 1 and
          ((case when d.welcome_enabled then d.welcome_per_day_limit else 0 end) +
           (case when d.outreach_enabled then d.outreach_per_day_limit else 0 end))
          then v_total_dm_day
        else
          (case when d.welcome_enabled then d.welcome_per_day_limit else 0 end) +
          (case when d.outreach_enabled then d.outreach_per_day_limit else 0 end)
      end,
      updated_at = case
        when d.total_dm_per_day_limit is distinct from case
          when v_total_dm_day between 1 and
            ((case when d.welcome_enabled then d.welcome_per_day_limit else 0 end) +
             (case when d.outreach_enabled then d.outreach_per_day_limit else 0 end))
            then v_total_dm_day
          else
            (case when d.welcome_enabled then d.welcome_per_day_limit else 0 end) +
            (case when d.outreach_enabled then d.outreach_per_day_limit else 0 end)
        end then now() else d.updated_at end
  where d.account_id = p_account_id;

  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  v_after_status := public.account_package_runtime_contract_status(p_account_id);
  if not coalesce((v_after_status ->> 'ok')::boolean, false) then
    raise exception '%', coalesce(v_after_status ->> 'reason', 'package_settings_incomplete');
  end if;

  insert into public.account_package_runtime_contract_events (
    account_id, assignment_id, event_type, source, idempotency_key, details_safe
  ) values (
    p_account_id, v_assignment.id, 'package_runtime_contract_reconciled', v_source,
    left('contract-reconcile:' || p_account_id::text || ':' || coalesce(v_assignment.id::text, 'none') || ':' || v_source, 205)
      || ':' || md5(v_after_status::text),
    jsonb_build_object(
      'before_reason', v_before_status ->> 'reason',
      'after_reason', v_after_status ->> 'reason',
      'commercial_package_code', v_after_status ->> 'commercial_package_code',
      'override_policy', 'positive_account_override_lte_package',
      'missing_fields', v_changed_fields
    )
  ) on conflict (idempotency_key) where idempotency_key is not null do nothing;

  return jsonb_build_object(
    'ok', true, 'reason', 'package_runtime_contract_reconciled',
    'account_id', p_account_id, 'source', v_source, 'changed', true,
    'contract', v_after_status, 'materializer', v_result
  );
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.resolve_linked_incident_from_dashboard_action_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.incident_id is null
     or new.status <> 'resolved'
     or old.status = 'resolved'
     or new.action_type not in ('operator_review_required', 'review_auto_restart_hard_stop') then
    return new;
  end if;

  new.blocking_campaign := false;
  new.requires_client_action := false;
  new.resolved_at := coalesce(new.resolved_at, now());

  update public.account_incidents
  set status = 'resolved',
      resolved_at = coalesce(resolved_at, new.resolved_at),
      resolution_reason = coalesce(resolution_reason, 'linked_operator_review_resolved'),
      resolution_note = coalesce(resolution_note, 'Resolved from linked operator review.'),
      updated_at = now()
  where id = new.incident_id
    and status in ('open', 'acknowledged', 'investigating');
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.apply_account_follow_limit_provenance_v1(p_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_policy public.ig_account_follow_limit_overrides%rowtype;
  v_package_day integer;
  v_package_session integer;
  v_day integer;
  v_session integer;
  v_run integer;
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
begin
  select
    nullif(aps.package_caps ->> 'follow_day', '')::integer,
    nullif(aps.package_caps ->> 'follow_session', '')::integer
  into v_package_day, v_package_session
  from public.account_package_summary aps
  where aps.account_id = p_account_id;

  if coalesce(v_package_day, 0) <= 0 or coalesce(v_package_session, 0) <= 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'package_settings_incomplete',
      'account_id', p_account_id
    );
  end if;

  select * into v_policy
  from public.ig_account_follow_limit_overrides o
  where o.account_id = p_account_id;

  v_day := least(v_package_day, coalesce(v_policy.follow_day_cap_override, v_package_day));
  v_session := least(v_package_session, coalesce(v_policy.follow_session_cap_override, v_package_session));
  v_run := least(
    v_session,
    coalesce(v_policy.max_follow_per_run_legacy, v_session)
  );

  perform set_config('bmb.package_contract_reconcile', 'on', true);
  update public.ig_account_settings s
  set max_actions_per_day = v_day,
      follow_limit = v_session,
      max_follow_per_run = v_run,
      updated_at = case
        when (s.max_actions_per_day, s.follow_limit, s.max_follow_per_run)
          is distinct from (v_day, v_session, v_run)
        then now()
        else s.updated_at
      end
  where s.account_id = p_account_id;
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);

  return jsonb_build_object(
    'ok', true,
    'reason', case
      when v_policy.account_id is null then 'package_inherited'
      else v_policy.classification
    end,
    'account_id', p_account_id,
    'package_day', v_package_day,
    'package_session', v_package_session,
    'configured_day', v_day,
    'configured_session', v_session,
    'legacy_run_cap', v_run
  );
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.recurring_daily_windows_overlap_v1(p_left_starts_at timestamp with time zone, p_left_ends_at timestamp with time zone, p_right_starts_at timestamp with time zone, p_right_ends_at timestamp with time zone, p_timezone text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_timezone text := coalesce(nullif(trim(p_timezone), ''), 'Africa/Johannesburg');
  v_left_start integer;
  v_left_end integer;
  v_right_start integer;
  v_right_end integer;
begin
  if p_left_starts_at is null or p_left_ends_at is null
     or p_right_starts_at is null or p_right_ends_at is null
     or p_left_ends_at <= p_left_starts_at
     or p_right_ends_at <= p_right_starts_at
     or p_left_ends_at - p_left_starts_at > interval '24 hours'
     or p_right_ends_at - p_right_starts_at > interval '24 hours' then
    return false;
  end if;

  v_left_start := extract(hour from (p_left_starts_at at time zone v_timezone))::integer * 60
    + extract(minute from (p_left_starts_at at time zone v_timezone))::integer;
  v_left_end := extract(hour from (p_left_ends_at at time zone v_timezone))::integer * 60
    + extract(minute from (p_left_ends_at at time zone v_timezone))::integer;
  v_right_start := extract(hour from (p_right_starts_at at time zone v_timezone))::integer * 60
    + extract(minute from (p_right_starts_at at time zone v_timezone))::integer;
  v_right_end := extract(hour from (p_right_ends_at at time zone v_timezone))::integer * 60
    + extract(minute from (p_right_ends_at at time zone v_timezone))::integer;

  if v_left_end <= v_left_start then v_left_end := v_left_end + 1440; end if;
  if v_right_end <= v_right_start then v_right_end := v_right_end + 1440; end if;

  return (v_left_start < v_right_end and v_right_start < v_left_end)
      or (v_left_start < v_right_end + 1440 and v_right_start + 1440 < v_left_end)
      or (v_left_start < v_right_end - 1440 and v_right_start - 1440 < v_left_end);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.normalize_instagram_login_invalidation_reason_v1(p_reason text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select case lower(trim(coalesce(p_reason, '')))
    when 'explicit_logout' then 'explicit_logout'
    when 'logout_confirmed' then 'explicit_logout'
    when 'account_identity_mismatch' then 'identity_mismatch'
    when 'active_instagram_account_mismatch' then 'identity_mismatch'
    when 'identity_mismatch' then 'identity_mismatch'
    when 'auth_session_invalidated' then 'auth_session_invalidated'
    when 'session_expired' then 'instagram_login_screen_confirmed'
    when 'login_screen_signal' then 'instagram_login_screen_confirmed'
    when 'login_screen_detected' then 'instagram_login_screen_confirmed'
    when 'instagram_login_screen_confirmed' then 'instagram_login_screen_confirmed'
    when 'credentials_invalid' then 'credential_invalidation'
    when 'credential_invalidation' then 'credential_invalidation'
    when 'login_failed' then 'credential_invalidation'
    when 'account_disabled' then 'account_disabled'
    when 'two_factor_required' then 'security_challenge_requires_login'
    when 'checkpoint_required' then 'security_challenge_requires_login'
    when 'verification_code_required' then 'security_challenge_requires_login'
    when 'verification_pending' then 'security_challenge_requires_login'
    when 'unsupported_post_submit_challenge' then 'security_challenge_requires_login'
    when 'security_challenge_requires_login' then 'security_challenge_requires_login'
    when 'other_explicit_canonical_invalidation' then 'other_explicit_canonical_invalidation'
    else null
  end;
$function$
;
CREATE OR REPLACE FUNCTION public.project_resolved_operator_review_runtime_v3()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.account_id is null
     or new.incident_id is null
     or new.action_type not in (
       'operator_review_required',
       'review_auto_restart_hard_stop'
     )
     or new.status <> 'resolved'
     or coalesce(new.blocking_campaign, false) then
    return new;
  end if;

  perform public.restore_resolved_operator_review_runtime_v3(
    new.account_id,
    new.incident_id,
    'account_dashboard_actions_resolved_trigger_v3'
  );
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.project_operator_review_runtime_pause_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_changed boolean := false;
begin
  if new.account_id is null
     or new.action_type not in ('operator_review_required', 'review_auto_restart_hard_stop')
     or new.status not in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
     or coalesce(new.blocking_campaign, false) is false
     or not exists (
       select 1
       from public.account_incidents i
       where i.id = new.incident_id
         and i.account_id = new.account_id
         and i.status in ('open', 'acknowledged', 'investigating')
         and i.resolved_at is null
         and i.archived_at is null
     ) then
    return new;
  end if;

  update public.ig_account_settings
  set account_status = 'paused_manual_review',
      current_run_status = 'idle',
      updated_at = now()
  where account_id = new.account_id
    and (
      lower(coalesce(account_status, '')) <> 'paused_manual_review'
      or lower(coalesce(current_run_status, '')) <> 'idle'
    );
  v_changed := found;

  if v_changed then
    insert into public.ig_action_logs (
      account_id, run_id, target_username, action_type, status, message, payload, created_at
    ) values (
      new.account_id, null, null, 'operator_review_runtime_paused', 'success',
      'Active blocking operator-review incident projected to paused_manual_review.',
      jsonb_build_object(
        'dashboard_action_id', new.id, 'incident_id', new.incident_id,
        'runtime_status', 'paused_manual_review', 'scheduler_eligible', false,
        'auto_unpause', false, 'terminal_incidents_ignored', true,
        'terminal_actions_ignored', true, 'source', 'account_dashboard_actions_trigger_v2'
      ), now()
    );
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.capture_account_session_transition_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_projection jsonb;
begin
  v_projection := public.project_account_session_transition_v1(new.account_id, new.id, new.performance_summary, new.updated_at);
  if v_projection is null then
    return new;
  end if;

  insert into public.account_session_transitions (
    schema_version, transition_key, account_id, run_id, business_session_id, attempt_id, generation,
    transition_context, transition_type, transition_state, first_causal_reason, follow_stop_reason,
    session_termination_class, exact_stable_reason, actionable_reason, follows_completed,
    follows_remaining, safe_boundary, unfollow_eligible, unfollow_started, unfollow_state,
    backlog_remaining, next_step, source_envelope, source_updated_at, updated_at
  ) values (
    v_projection ->> 'schema_version', v_projection ->> 'transition_key', new.account_id, new.id,
    v_projection ->> 'business_session_id', v_projection ->> 'attempt_id', v_projection ->> 'generation',
    v_projection ->> 'transition_context', v_projection ->> 'transition_type', v_projection ->> 'transition_state',
    v_projection ->> 'first_causal_reason', v_projection ->> 'follow_stop_reason',
    v_projection ->> 'session_termination_class', v_projection ->> 'exact_stable_reason',
    v_projection ->> 'actionable_reason', (v_projection ->> 'follows_completed')::integer,
    (v_projection ->> 'follows_remaining')::integer, (v_projection ->> 'safe_boundary')::boolean,
    (v_projection ->> 'unfollow_eligible')::boolean, coalesce((v_projection ->> 'unfollow_started')::boolean, false),
    v_projection ->> 'unfollow_state', (v_projection ->> 'backlog_remaining')::integer,
    v_projection ->> 'next_step', v_projection -> 'source_envelope', new.updated_at, now()
  )
  on conflict (transition_key) do update set
    run_id = excluded.run_id,
    transition_state = excluded.transition_state,
    follow_stop_reason = excluded.follow_stop_reason,
    session_termination_class = excluded.session_termination_class,
    exact_stable_reason = excluded.exact_stable_reason,
    actionable_reason = excluded.actionable_reason,
    follows_completed = excluded.follows_completed,
    follows_remaining = excluded.follows_remaining,
    safe_boundary = excluded.safe_boundary,
    unfollow_eligible = excluded.unfollow_eligible,
    unfollow_started = excluded.unfollow_started,
    unfollow_state = excluded.unfollow_state,
    backlog_remaining = excluded.backlog_remaining,
    next_step = excluded.next_step,
    source_envelope = excluded.source_envelope,
    source_updated_at = excluded.source_updated_at,
    updated_at = now();

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_instagram_password_remediation_v1(p_account_id uuid, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_client public.client_instagram_accounts%rowtype;
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_now timestamptz := now();
  v_actions_resolved integer := 0;
begin
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;
  if v_source not in ('identity_success', 'credential_confirmed', 'manual_reconcile') then
    raise exception 'password_remediation_source_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'instagram_password_remediation:' || p_account_id::text,
    0
  ));

  select * into v_client
  from public.client_instagram_accounts
  where account_id = p_account_id
    and active is true
  for update;

  if not found
     or lower(coalesce(v_client.login_status, '')) <> 'connected'
     or lower(coalesce(v_client.provisioning_status, '')) <> 'ready'
     or lower(coalesce(v_client.onboarding_status, '')) <> 'ready'
     or lower(coalesce(v_client.login_identity_proof_status, '')) <> 'verified'
     or coalesce(v_client.login_identity_profile_opened, false) is not true
     or coalesce(v_client.login_identity_username_match, false) is not true
     or v_client.login_identity_verified_at is null
     or nullif(btrim(coalesce(v_client.login_state_invalidation_reason, '')), '') is not null then
    return jsonb_build_object('ok', false, 'reason', 'exact_login_identity_not_ready');
  end if;

  if not exists (
    select 1
    from public.account_credentials c
    where c.account_id = p_account_id
      and c.provider = 'instagram'
      and c.status = 'active'
      and coalesce(c.reauth_required, false) is false
      and nullif(btrim(coalesce(c.secret_ref, '')), '') is not null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'accepted_active_credential_required');
  end if;

  update public.account_dashboard_actions a
  set status = 'resolved',
      blocking_campaign = false,
      requires_client_action = false,
      resolved_at = coalesce(a.resolved_at, v_now),
      updated_at = v_now,
      metadata_safe = coalesce(a.metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'superseded_by_accepted_credential_identity_success', true,
        'identity_verified_at', v_client.login_identity_verified_at,
        'reconciliation_source', v_source
      )
  where a.account_id = p_account_id
    and a.action_type = 'update_instagram_password'
    and a.created_at <= v_client.login_identity_verified_at
    and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted');
  get diagnostics v_actions_resolved = row_count;

  return jsonb_build_object(
    'ok', true,
    'reason', case when v_actions_resolved > 0
      then 'password_remediation_resolved'
      else 'already_converged'
    end,
    'account_id', p_account_id,
    'actions_resolved', v_actions_resolved,
    'identity_verified_at', v_client.login_identity_verified_at,
    'runtime_started', false,
    'commercial_state_changed', false,
    'schedule_changed', false,
    'target_changed', false
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.emit_notification_business_event_v2(p_idempotency_key text, p_category text, p_environment text, p_event_type text, p_account_id uuid DEFAULT NULL::uuid, p_client_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid, p_business_payload jsonb DEFAULT '{}'::jsonb, p_technical_diagnostics jsonb DEFAULT '{}'::jsonb, p_occurred_at timestamp with time zone DEFAULT now())
 RETURNS notification_business_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result public.notification_business_events;
begin
  insert into public.notification_business_events (
    idempotency_key, category, environment, event_type, account_id, client_id,
    tenant_id, business_payload, technical_diagnostics, occurred_at
  ) values (
    trim(p_idempotency_key), p_category, p_environment, trim(p_event_type),
    p_account_id, p_client_id, p_tenant_id,
    coalesce(p_business_payload, '{}'::jsonb),
    coalesce(p_technical_diagnostics, '{}'::jsonb), p_occurred_at
  )
  on conflict (idempotency_key) do nothing
  returning * into result;

  if result.id is null then
    select * into result
    from public.notification_business_events event
    where event.idempotency_key = trim(p_idempotency_key);
  end if;
  return result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_account_package_runtime_contract_exact_v1(p_account_id uuid, p_source text DEFAULT 'canonical_reconcile'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_package public.commercial_packages%rowtype;
  v_runtime public.commercial_package_runtime_settings%rowtype;
  v_account_package public.account_commercial_packages%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_instance public.phone_app_instances%rowtype;
  v_subscription_type text;
  v_expected_clone_mode text;
  v_outreach_enabled boolean := false;
  v_outreach_day integer := 0;
  v_outreach_session integer := 0;
  v_welcome_day integer := 0;
  v_welcome_session integer := 0;
  v_settings_count integer := 0;
begin
  if p_account_id is null then
    raise exception 'package_settings_incomplete';
  end if;

  select acp.* into v_account_package
  from public.account_commercial_packages acp
  where acp.account_id = p_account_id
    and acp.status = 'active'
    and (acp.ends_at is null or acp.ends_at > now())
  order by acp.starts_at desc, acp.created_at desc
  limit 1
  for update;

  if v_account_package.id is null then
    raise exception 'package_settings_incomplete';
  end if;

  select cp.* into v_package
  from public.commercial_packages cp
  where cp.code = v_account_package.package_code
    and cp.active = true;

  if v_package.code is null
     or v_package.default_follow_day_cap is null
     or v_package.default_follow_session_cap is null
     or v_package.default_unfollow_day_cap is null
     or v_package.default_unfollow_session_cap is null then
    raise exception 'package_settings_incomplete';
  end if;

  select prs.* into v_runtime
  from public.commercial_package_runtime_settings prs
  where prs.package_code = v_package.code;
  if v_runtime.package_code is null then
    raise exception 'package_settings_incomplete';
  end if;

  if not exists (
    select 1
    from public.client_account_entitlements cae
    where cae.account_id = p_account_id
      and cae.status = 'entitlement_consumed'
      and cae.commercial_package_code = v_account_package.package_code
  ) then
    raise exception 'package_settings_incomplete';
  end if;

  select aa.* into v_assignment
  from public.account_assignments aa
  where aa.account_id = p_account_id
    and aa.status in ('pending', 'reserved', 'active')
  order by aa.updated_at desc, aa.created_at desc
  limit 1
  for update;

  if v_assignment.id is null
     or v_assignment.device_id is null
     or v_assignment.app_instance_id is null then
    raise exception 'assignment_package_mismatch';
  end if;

  select pai.* into v_instance
  from public.phone_app_instances pai
  where pai.id = v_assignment.app_instance_id
  for update;

  if v_instance.id is null
     or v_instance.device_id <> v_assignment.device_id
     or nullif(trim(v_instance.package_name), '') is null
     or not coalesce(v_instance.is_launchable, false)
     or not coalesce(v_instance.usable_for_auto_login, false) then
    raise exception 'app_instance_package_mismatch';
  end if;

  select cs.subscription_type into v_subscription_type
  from public.client_subscription_accounts csa
  join public.client_subscriptions cs on cs.id = csa.subscription_id
  where csa.account_id = p_account_id
    and csa.status = 'active'
    and cs.status = 'active'
  order by cs.starts_at desc, cs.created_at desc
  limit 1;

  if nullif(trim(v_subscription_type), '') is null
     or v_assignment.assignment_type is distinct from v_subscription_type then
    raise exception 'runtime_profile_mismatch';
  end if;

  v_expected_clone_mode := case
    when v_instance.instance_type = 'primary_app' or coalesce(v_instance.instance_index, 0) = 0 then 'off'
    else 'clone_' || v_instance.instance_index::text
  end;

  select count(*) into v_settings_count
  from public.ig_account_settings s
  where s.account_id = p_account_id
    and s.likes_per_follow_min is not null
    and s.likes_per_follow_max is not null
    and s.total_likes_limit is not null;

  if v_settings_count <> 1 then
    raise exception 'package_settings_incomplete';
  end if;

  select exists (
    select 1
    from public.client_account_entitlements cae
    where cae.account_id = p_account_id
      and cae.status = 'entitlement_consumed'
      and (
        nullif(trim(cae.outreach_addon_key), '') is not null
        or nullif(trim(cae.outreach_variant), '') is not null
        or nullif(trim(cae.backend_addon_code), '') is not null
      )
  ) into v_outreach_enabled;

  if v_outreach_enabled then
    select coalesce(cp.default_outreach_day_cap, 0)
    into v_outreach_day
    from public.commercial_packages cp
    where cp.code = 'outreach_standalone' and cp.active = true;
    if coalesce(v_outreach_day, 0) <= 0 then
      raise exception 'package_settings_incomplete';
    end if;
    v_outreach_session := least(v_outreach_day, v_runtime.outreach_per_session_limit);
  end if;

  v_welcome_day := case
    when coalesce(v_package.default_welcome_enabled, false)
      then coalesce(v_package.default_welcome_day_cap, 0)
    else 0
  end;
  v_welcome_session := least(v_welcome_day, v_runtime.welcome_per_session_limit);

  update public.ig_accounts
  set clone_mode = v_expected_clone_mode,
      device_name = (select coalesce(pd.name, pd.device_name) from public.phone_devices pd where pd.id = v_assignment.device_id),
      updated_at = now()
  where id = p_account_id;

  update public.ig_account_settings
  set app_package = v_instance.package_name,
      clone_mode = v_expected_clone_mode,
      cloned_app_mode = v_expected_clone_mode <> 'off',
      follow_enabled = v_subscription_type = 'full_cycle',
      like_enabled = v_subscription_type = 'full_cycle',
      unfollow_enabled = v_subscription_type = 'full_cycle',
      welcome_dm_enabled = v_subscription_type = 'full_cycle' and coalesce(v_package.default_welcome_enabled, false),
      cold_dm_enabled = v_outreach_enabled,
      max_actions_per_day = v_package.default_follow_day_cap,
      follow_limit = v_package.default_follow_session_cap,
      max_follow_per_run = v_package.default_follow_session_cap,
      total_unfollows_limit = v_package.default_unfollow_day_cap,
      likes_per_follow_min = v_runtime.likes_per_follow_min,
      likes_per_follow_max = v_runtime.likes_per_follow_max,
      total_likes_limit = v_runtime.likes_per_day_limit,
      warmup_mode = v_runtime.warmup_enabled,
      updated_at = now()
  where account_id = p_account_id;

  if not found then
    raise exception 'package_settings_incomplete';
  end if;

  insert into public.account_follow_source_settings (
    account_id, max_follows_per_target_per_run, max_targets_per_run, updated_at, updated_by, metadata
  ) values (
    p_account_id, v_runtime.max_follows_per_target_per_run, v_runtime.max_targets_per_run,
    now(), coalesce(nullif(trim(p_source), ''), 'canonical_reconcile'),
    jsonb_build_object('source', 'canonical_package_runtime_contract', 'package_code', v_package.code)
  )
  on conflict (account_id) do update
  set max_follows_per_target_per_run = excluded.max_follows_per_target_per_run,
      max_targets_per_run = excluded.max_targets_per_run,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by,
      metadata = coalesce(public.account_follow_source_settings.metadata, '{}'::jsonb) || excluded.metadata;

  insert into public.ig_account_unfollow_settings (
    account_id, unfollow_enabled, unfollow_after_days, unfollow_mode,
    unfollow_per_session_limit, unfollow_per_day_limit, runtime_cap_mode,
    runtime_safety_cap, package_default_snapshot, updated_at
  ) values (
    p_account_id, v_subscription_type = 'full_cycle', v_runtime.unfollow_after_days, 'unfollow',
    v_package.default_unfollow_session_cap, v_package.default_unfollow_day_cap,
    'prod_normal', null,
    jsonb_build_object(
      'source', 'commercial_packages',
      'package_code', v_package.code,
      'unfollow_day', v_package.default_unfollow_day_cap,
      'unfollow_session', v_package.default_unfollow_session_cap
    ),
    now()
  )
  on conflict (account_id) do update
  set unfollow_enabled = excluded.unfollow_enabled,
      unfollow_after_days = excluded.unfollow_after_days,
      unfollow_per_session_limit = excluded.unfollow_per_session_limit,
      unfollow_per_day_limit = excluded.unfollow_per_day_limit,
      runtime_cap_mode = excluded.runtime_cap_mode,
      runtime_safety_cap = excluded.runtime_safety_cap,
      package_default_snapshot = excluded.package_default_snapshot,
      updated_at = excluded.updated_at;

  insert into public.account_warmup_settings (
    account_id, warmup_enabled, package_started_at, warmup_profile_code,
    day_1_follow_cap, day_2_follow_cap, day_3_follow_cap, day_4_plus_follow_cap,
    status, updated_at
  ) values (
    p_account_id, v_runtime.warmup_enabled, v_account_package.starts_at,
    v_runtime.warmup_profile_code, v_runtime.warmup_day_1_cap,
    v_runtime.warmup_day_2_cap, v_runtime.warmup_day_3_cap,
    v_package.default_follow_day_cap, 'active', now()
  )
  on conflict (account_id) do update
  set warmup_enabled = excluded.warmup_enabled,
      package_started_at = excluded.package_started_at,
      warmup_profile_code = excluded.warmup_profile_code,
      day_1_follow_cap = excluded.day_1_follow_cap,
      day_2_follow_cap = excluded.day_2_follow_cap,
      day_3_follow_cap = excluded.day_3_follow_cap,
      day_4_plus_follow_cap = excluded.day_4_plus_follow_cap,
      status = excluded.status,
      updated_at = excluded.updated_at;

  insert into public.ig_account_dm_settings (
    account_id, welcome_enabled, outreach_enabled,
    welcome_per_session_limit, welcome_per_day_limit,
    outreach_per_session_limit, outreach_per_day_limit,
    total_dm_per_day_limit, updated_at
  ) values (
    p_account_id,
    v_subscription_type = 'full_cycle' and coalesce(v_package.default_welcome_enabled, false),
    v_outreach_enabled,
    v_welcome_session, v_welcome_day,
    v_outreach_session, v_outreach_day,
    v_welcome_day + v_outreach_day,
    now()
  )
  on conflict (account_id) do update
  set welcome_enabled = excluded.welcome_enabled,
      outreach_enabled = excluded.outreach_enabled,
      welcome_per_session_limit = excluded.welcome_per_session_limit,
      welcome_per_day_limit = excluded.welcome_per_day_limit,
      outreach_per_session_limit = excluded.outreach_per_session_limit,
      outreach_per_day_limit = excluded.outreach_per_day_limit,
      total_dm_per_day_limit = excluded.total_dm_per_day_limit,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'reason', 'package_runtime_contract_reconciled',
    'account_id', p_account_id,
    'commercial_package_code', v_package.code,
    'runtime_profile', v_subscription_type,
    'assignment_id', v_assignment.id,
    'device_id', v_assignment.device_id,
    'app_instance_id', v_instance.id,
    'clone_mode', v_expected_clone_mode,
    'android_package_name', v_instance.package_name,
    'source', coalesce(nullif(trim(p_source), ''), 'canonical_reconcile')
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_account_incident_retention_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_policy public.incident_retention_policies%rowtype;
  v_days integer;
begin
  select * into v_policy
  from public.incident_retention_policies
  where policy_key = 'default';

  if new.legal_hold then
    new.retention_class := 'legal_audit';
    new.purge_after := null;
  elsif new.severity = 'critical' then
    new.retention_class := 'critical';
  elsif new.severity = 'info' and coalesce(new.action_required, '') = '' then
    new.retention_class := 'technical_nonblocking';
  else
    new.retention_class := 'normal';
  end if;

  if new.status in ('resolved', 'ignored') and not new.legal_hold then
    v_days := case new.retention_class
      when 'critical' then v_policy.critical_resolved_days
      when 'technical_nonblocking' then v_policy.technical_nonblocking_days
      else v_policy.normal_resolved_days
    end;
    new.retention_policy_version := v_policy.policy_version;
    new.purge_after := coalesce(new.resolved_at, now()) + make_interval(days => v_days);
  elsif new.status in ('open', 'acknowledged') then
    new.archived_at := null;
    new.purge_after := null;
    new.retention_policy_version := v_policy.policy_version;
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_legacy_account_assignment_binding_v1(p_account_id uuid, p_source text DEFAULT 'canonical_reconcile'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_package public.account_commercial_packages%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_instance public.phone_app_instances%rowtype;
  v_subscription_type text;
  v_expected_clone_mode text;
begin
  select acp.* into v_account_package
  from public.account_commercial_packages acp
  where acp.account_id = p_account_id
    and acp.status = 'active'
    and (acp.ends_at is null or acp.ends_at > now())
  order by acp.starts_at desc, acp.created_at desc
  limit 1
  for update;

  if v_account_package.id is null
     or exists (
       select 1
       from public.client_account_entitlements cae
       where cae.account_id = p_account_id
         and cae.status = 'entitlement_consumed'
     ) then
    raise exception 'legacy_package_contract_not_applicable';
  end if;

  select cs.subscription_type into v_subscription_type
  from public.client_subscription_accounts csa
  join public.client_subscriptions cs on cs.id = csa.subscription_id
  where csa.account_id = p_account_id
    and csa.status = 'active'
    and cs.status = 'active'
  order by cs.starts_at desc, cs.created_at desc
  limit 1;

  select aa.* into v_assignment
  from public.account_assignments aa
  where aa.account_id = p_account_id
    and aa.status in ('pending', 'reserved', 'active')
  order by aa.updated_at desc, aa.created_at desc
  limit 1
  for update;

  if v_subscription_type is null
     or v_assignment.id is null
     or v_assignment.device_id is null
     or v_assignment.app_instance_id is null
     or v_assignment.assignment_type is distinct from v_subscription_type then
    raise exception 'runtime_profile_mismatch';
  end if;

  select pai.* into v_instance
  from public.phone_app_instances pai
  where pai.id = v_assignment.app_instance_id
  for update;

  if v_instance.id is null
     or v_instance.device_id is distinct from v_assignment.device_id
     or nullif(trim(v_instance.package_name), '') is null
     or not coalesce(v_instance.is_launchable, false)
     or not coalesce(v_instance.usable_for_auto_login, false) then
    raise exception 'app_instance_package_mismatch';
  end if;

  v_expected_clone_mode := case
    when v_instance.instance_type = 'primary_app' or coalesce(v_instance.instance_index, 0) = 0 then 'off'
    else 'clone_' || v_instance.instance_index::text
  end;

  update public.ig_accounts
  set clone_mode = v_expected_clone_mode,
      device_name = (
        select coalesce(pd.name, pd.device_name)
        from public.phone_devices pd
        where pd.id = v_assignment.device_id
      ),
      updated_at = now()
  where id = p_account_id;

  update public.ig_account_settings
  set app_package = v_instance.package_name,
      clone_mode = v_expected_clone_mode,
      cloned_app_mode = v_expected_clone_mode <> 'off',
      updated_at = now()
  where account_id = p_account_id;

  if not found then
    raise exception 'package_settings_incomplete';
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', 'legacy_assignment_package_binding_reconciled',
    'account_id', p_account_id,
    'commercial_package_code', v_account_package.package_code,
    'runtime_profile', v_subscription_type,
    'assignment_id', v_assignment.id,
    'app_instance_id', v_instance.id,
    'clone_mode', v_expected_clone_mode,
    'android_package_name', v_instance.package_name,
    'source', coalesce(nullif(trim(p_source), ''), 'canonical_reconcile')
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_instagram_restriction_preflight_required_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.incident_type <> 'instagram_account_restriction'
     or coalesce(new.metadata ->> 'incident_only_blocker_v2', 'false') = 'true' then
    return new;
  end if;
  update public.instagram_account_restriction_holds
  set status='verification_required', human_resolved_at=coalesce(new.resolved_at,now()),
      verification_required_at=now(), metadata_safe=coalesce(metadata_safe,'{}'::jsonb)
        || jsonb_build_object('incident_resolved_but_physical_preflight_pending',true), updated_at=now()
  where incident_id=new.id and status='active';
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.reconcile_operator_actions_from_resolved_incident_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status <> 'resolved' or old.status = 'resolved' then
    return new;
  end if;

  update public.account_dashboard_actions a
  set status = 'resolved',
      blocking_campaign = false,
      requires_client_action = false,
      resolved_at = coalesce(a.resolved_at, new.resolved_at, now()),
      updated_at = now(),
      metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object(
        'incident_resolution_reconciliation',
        jsonb_build_object(
          'contract', 'resolved_incident_operator_action_v1',
          'source', 'linked_incident_resolution',
          'incident_id', new.id,
          'incident_resolution_reason', new.resolution_reason,
          'operator_review_performed', false,
          'reconciled_at', now()
        )
      )
  where a.incident_id = new.id
    and a.action_type in ('operator_review_required', 'review_auto_restart_hard_stop')
    and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted');

  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.restore_resolved_operator_review_runtime_v3(p_account_id uuid, p_incident_id uuid, p_source text DEFAULT 'incident_resolution'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_incident public.account_incidents%rowtype;
  v_previous_status text;
  v_reactivated boolean := false;
  v_blocked_reason text;
begin
  if p_account_id is null or p_incident_id is null then
    raise exception 'operator_review_runtime_restore_payload_invalid'
      using errcode = '22023';
  end if;

  select i.* into v_incident
  from public.account_incidents i
  where i.id = p_incident_id
    and i.account_id = p_account_id
  for update;

  if v_incident.id is null then
    raise exception 'incident_not_found' using errcode = 'P0002';
  elsif v_incident.status <> 'resolved' or v_incident.resolved_at is null then
    v_blocked_reason := 'incident_not_resolved';
  elsif left(lower(coalesce(v_incident.incident_type, '')), 9) = 'security_'
     or lower(coalesce(v_incident.metadata ->> 'security_incident', 'false'))
        in ('true', '1', 'yes') then
    v_blocked_reason := 'security_incident_forbidden';
  elsif exists (
    select 1
    from public.account_dashboard_actions a
    join public.account_incidents i
      on i.id = a.incident_id
     and i.account_id = a.account_id
     and i.status in ('open', 'acknowledged', 'investigating')
     and i.resolved_at is null
     and i.archived_at is null
    where a.account_id = p_account_id
      and a.action_type in (
        'operator_review_required',
        'review_auto_restart_hard_stop'
      )
      and a.status in (
        'pending',
        'acknowledged',
        'pending_verification',
        'code_submitted'
      )
      and coalesce(a.blocking_campaign, false)
  ) then
    v_blocked_reason := 'another_blocking_operator_review_exists';
  else
    select s.account_status into v_previous_status
    from public.ig_account_settings s
    where s.account_id = p_account_id
    for update;

    if lower(coalesce(v_previous_status, '')) = 'paused_manual_review' then
      update public.ig_account_settings
      set account_status = 'active',
          current_run_status = 'idle',
          updated_at = now()
      where account_id = p_account_id
        and lower(coalesce(account_status, '')) = 'paused_manual_review';
      v_reactivated := found;

      if v_reactivated then
        insert into public.ig_action_logs (
          account_id,
          run_id,
          target_username,
          action_type,
          status,
          message,
          payload,
          created_at
        ) values (
          p_account_id,
          v_incident.run_id,
          null,
          'operator_review_runtime_reactivated',
          'success',
          'Resolved operator-review incident atomically restored runtime eligibility.',
          jsonb_build_object(
            'incident_id', p_incident_id,
            'previous_runtime_status', v_previous_status,
            'runtime_status', 'active',
            'schedule_changed', false,
            'commercial_lifecycle_changed', false,
            'run_created', false,
            'tick_created', false,
            'source', left(coalesce(nullif(btrim(p_source), ''), 'incident_resolution'), 120),
            'contract_version', 'incident_resolution_atomic_runtime_reactivation_v3'
          ),
          now()
        );
      end if;
    elsif lower(coalesce(v_previous_status, '')) = 'active' then
      null;
    else
      v_blocked_reason := 'runtime_status_not_operator_review_pause';
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', v_blocked_reason is null,
    'account_id', p_account_id,
    'incident_id', p_incident_id,
    'runtime_reactivated', v_reactivated,
    'runtime_status', case when v_blocked_reason is null then 'active' else null end,
    'blocked_reason', v_blocked_reason,
    'schedule_changed', false,
    'commercial_lifecycle_changed', false,
    'run_created', false,
    'tick_created', false
  ));
end
$function$
;
CREATE OR REPLACE FUNCTION private.enforce_stripe_subscription_account_binding_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
  if old.account_id is not null
     and new.account_id is distinct from old.account_id then
    raise exception 'stripe_subscription_cross_account_conflict';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.project_account_session_transition_v1(p_account_id uuid, p_run_id uuid, p_performance_summary jsonb, p_source_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_summary jsonb := coalesce(p_performance_summary, '{}'::jsonb);
  v_follow jsonb := coalesce(v_summary -> 'follow_outcome', '{}'::jsonb);
  v_scope jsonb := coalesce(v_follow -> 'scope_binding', '{}'::jsonb);
  v_handoff jsonb := coalesce(v_summary -> 'follow_to_unfollow_real', '{}'::jsonb);
  v_unfollow jsonb := coalesce(v_handoff -> 'unfollow_outcome', v_summary -> 'unfollow_outcome', '{}'::jsonb);
  v_first_reason text := coalesce(nullif(v_follow ->> 'first_causal_reason', ''), nullif(v_summary ->> 'first_causal_reason', ''));
  v_follow_stop_reason text := coalesce(nullif(v_summary ->> 'follow_stop_reason', ''), nullif(v_follow ->> 'stable_reason', ''));
  v_termination_class text := nullif(v_summary ->> 'session_termination_class', '');
  v_business_session_id text := coalesce(nullif(v_scope ->> 'business_session_id', ''), nullif(v_summary ->> 'business_session_id', ''));
  v_attempt_id text := coalesce(nullif(v_scope ->> 'attempt_id', ''), nullif(v_summary ->> 'attempt_id', ''), nullif(v_summary #>> '{auto_restart_resume_plan,current_attempt_id}', ''));
  v_generation text := nullif(v_scope ->> 'generation', '');
  v_unfollow_state text := coalesce(nullif(v_unfollow ->> 'phase_status', ''), nullif(v_summary ->> 'unfollow_phase_status', ''), nullif(v_handoff ->> 'status', ''));
  v_skip_reason text := nullif(v_handoff ->> 'skip_reason', '');
  v_blocker text := coalesce(nullif(v_handoff ->> 'failure_reason', ''), nullif(v_unfollow ->> 'actionable_reason', ''), nullif(v_unfollow ->> 'failure_reason', ''));
  v_unfollow_started boolean := coalesce((v_handoff ->> 'executed')::boolean, false);
  v_state text := 'initiated';
  v_key text;
begin
  -- Recognition is intentionally exact and fail-closed. Generic incident fallbacks do not qualify.
  if v_first_reason is distinct from 'follow_to_unfollow_time_handoff'
     or v_business_session_id is null
     or v_attempt_id is null
     or v_generation is null
     or coalesce(v_scope ->> 'account_id', p_account_id::text) is distinct from p_account_id::text
     or coalesce(v_scope ->> 'run_id', p_run_id::text) is distinct from p_run_id::text then
    return null;
  end if;

  if v_blocker is not null or lower(coalesce(v_handoff ->> 'status', '')) in ('blocked', 'failed', 'error') then
    v_state := 'blocked';
  elsif v_unfollow_state in ('completed', 'quota_reached', 'candidates_exhausted') then
    v_state := 'completed';
  elsif v_unfollow_state in ('partial', 'partial_resumable', 'scheduled_safe_stop', 'window_limit_reached') then
    v_state := 'partial';
  elsif not v_unfollow_started and v_skip_reason in ('no_pending_unfollow', 'no_eligible_unfollow_candidates', 'unfollow_plan_empty', 'zero_executable_unfollow') then
    v_state := 'no_work';
  end if;

  v_key := concat_ws(':', v_business_session_id, v_attempt_id, v_generation, 'follow_to_unfollow_handoff');

  return jsonb_build_object(
    'schema_version', 'account_session_transition_v1',
    'transition_key', v_key,
    'account_id', p_account_id,
    'run_id', p_run_id,
    'business_session_id', v_business_session_id,
    'attempt_id', v_attempt_id,
    'generation', v_generation,
    'transition_context', 'business_deadline',
    'transition_type', 'follow_to_unfollow',
    'transition_state', v_state,
    'first_causal_reason', v_first_reason,
    'follow_stop_reason', v_follow_stop_reason,
    'session_termination_class', v_termination_class,
    'exact_stable_reason', coalesce(nullif(v_follow ->> 'stable_reason', ''), v_follow_stop_reason, v_first_reason),
    'actionable_reason', case when v_state = 'blocked' then v_blocker else null end,
    'follows_completed', nullif(v_follow #>> '{follow_quota_state,follows_completed_count}', '')::integer,
    'follows_remaining', nullif(v_follow ->> 'remaining_actions', '')::integer,
    'safe_boundary', nullif(v_follow ->> 'safe_boundary', '')::boolean,
    'unfollow_eligible', nullif(v_handoff ->> 'eligible', '')::boolean,
    'unfollow_started', v_unfollow_started,
    'unfollow_state', v_unfollow_state,
    'backlog_remaining', coalesce(nullif(v_unfollow ->> 'remaining_count', '')::integer, nullif(v_handoff ->> 'remaining_eligible', '')::integer),
    'next_step', coalesce(nullif(v_follow ->> 'safe_next_step', ''), nullif(v_follow ->> 'suggested_next_action', '')),
    'source_updated_at', p_source_updated_at,
    'source_envelope', jsonb_build_object(
      'first_causal_reason', v_first_reason,
      'follow_stop_reason', v_follow_stop_reason,
      'session_termination_class', v_termination_class,
      'business_session_id', v_business_session_id,
      'attempt_id', v_attempt_id,
      'generation', v_generation,
      'follow_outcome', v_follow,
      'follow_to_unfollow_real', v_handoff,
      'unfollow_phase_status', v_summary -> 'unfollow_phase_status'
    )
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    -- Malformed/non-canonical envelopes never receive inferred semantics.
    return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.guard_ever_followed_row_delete_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.ever_followed_canonical_at is not null
     or old.ever_followed_action_id is not null then
    raise exception 'ever_followed_projection_row_delete_forbidden'
      using errcode = '23514';
  end if;
  return old;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.guard_ever_followed_projection_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_username text := lower(ltrim(trim(coalesce(new.username, '')), '@'));
begin
  if tg_op = 'UPDATE'
     and old.ever_followed_canonical_at is not null
     and (
       new.ever_followed_canonical_at is distinct from old.ever_followed_canonical_at
       or new.ever_followed_action_id is distinct from old.ever_followed_action_id
     ) then
    raise exception 'ever_followed_projection_is_monotone' using errcode = '23514';
  end if;
  if new.ever_followed_canonical_at is null
     and new.ever_followed_action_id is null then
    return new;
  end if;
  if new.ever_followed_canonical_at is null
     or new.ever_followed_action_id is null then
    raise exception 'ever_followed_projection_incomplete' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.ig_interaction_events as event
    where event.id = new.ever_followed_action_id
      and event.account_id = new.account_id
      and lower(ltrim(trim(coalesce(event.username, '')), '@')) = v_username
      and event.event_type = 'follow_verified_persisted_v1'
      and event.event_status = 'success'
      and event.event_at is not distinct from new.ever_followed_canonical_at
  ) then
    raise exception 'ever_followed_projection_canonical_proof_missing'
      using errcode = '23514';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_terminal_cancel_subscription_monotonicity_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.account_id is not null and exists (
    select 1 from public.commercial_account_lifecycle_states st
    where st.account_id = new.account_id
      and st.terminal_cancel_operation_id is not null
      and st.terminal_cancel_stripe_subscription_id is distinct from new.stripe_subscription_id
  ) then
    raise exception 'terminal_cancelled_account_requires_new_account' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.status in ('canceled', 'cancelled', 'incomplete_expired')
      and new.status not in ('canceled', 'cancelled', 'incomplete_expired')
      and exists (
      select 1 from public.commercial_account_lifecycle_states st
      where st.terminal_cancel_stripe_subscription_id = old.stripe_subscription_id
      ) then
      raise exception 'terminal_cancel_subscription_cannot_reactivate' using errcode = '23514';
    end if;
    if (new.account_id is distinct from old.account_id
        or new.client_account_entitlement_id is distinct from old.client_account_entitlement_id)
      and exists (
      select 1 from public.commercial_account_lifecycle_states st
      where st.terminal_cancel_stripe_subscription_id = old.stripe_subscription_id
      ) then
      raise exception 'terminal_cancel_subscription_cannot_rebind' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.notification_router_general_incident_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  combined_reason text := lower(coalesce(new.reason, '') || ' ' || coalesce(new.failure_reason, '') || ' ' || coalesce(new.incident_type, ''));
  dashboard_url text := 'https://www.boostmybusinesses.com/instagram-dashboard/incidents?incident_id=' || new.id::text;
begin
  if lower(new.incident_type) like '%login%'
    or combined_reason ~ '(password|challenge|identity|checkpoint|device.*login|provision)'
  then return new; end if;

  if new.status in ('resolved','ignored') then
    perform public.emit_notification_business_event_v2(
      'incident.resolved:' || new.id::text || ':' || new.lifecycle_version::text,
      'incident', case when new.metadata->>'environment' = 'test' then 'test' else 'live' end,
      'incident.resolved', new.account_id, new.client_id, null,
      jsonb_strip_nulls(jsonb_build_object(
        'username', coalesce('@' || trim(leading '@' from new.account_username), '@non-renseigné'),
        'summary', 'La situation signalée a été traitée.',
        'resolutionNote', nullif(left(trim(coalesce(new.resolution_note, '')), 500), ''),
        'resolutionReason', nullif(left(trim(coalesce(new.resolution_reason, '')), 160), ''),
        'resolvedAt', new.resolved_at,
        'operatorId', new.resolved_by,
        'dashboardUrl', dashboard_url
      )),
      jsonb_build_object('incident_id', new.id, 'incident_type', new.incident_type),
      coalesce(new.resolved_at, new.last_seen_at, now())
    );
    return new;
  end if;
  if new.status not in ('open','acknowledged') then return new; end if;

  perform public.emit_notification_business_event_v2(
    'incident.opened:' || new.id::text || ':' || new.lifecycle_version::text,
    'incident', case when new.metadata->>'environment' = 'test' then 'test' else 'live' end,
    'incident.opened', new.account_id, new.client_id, null,
    jsonb_build_object(
      'username', coalesce('@' || trim(leading '@' from new.account_username), '@non-renseigné'),
      'summary', coalesce(new.safe_client_message, 'Une vérification opérationnelle est nécessaire.'),
      'action', coalesce(new.action_required, 'Consulter BotApp.'),
      'dashboardUrl', dashboard_url
    ),
    jsonb_build_object('incident_id', new.id, 'incident_type', new.incident_type),
    coalesce(new.last_seen_at, new.created_at)
  );
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.arm_incident_resolution_auto_resume_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_plan public.account_session_resume_plans%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_window_key text;
  v_authorization_id uuid;
begin
  if coalesce(new.metadata ->> 'incident_only_blocker_v2', 'false') = 'true' then
    return new;
  end if;
  if new.status <> 'resolved' or old.status = 'resolved' or new.run_id is null
     or new.account_id is null or left(lower(coalesce(new.incident_type, '')), 9) = 'security_'
     or lower(coalesce(new.metadata ->> 'security_incident', 'false')) in ('true','1','yes') then
    return new;
  end if;
  select p.* into v_plan from public.account_session_resume_plans p
  where p.run_id = new.run_id and p.account_id = new.account_id
    and p.resume_state = 'awaiting_human_resume_authorization'
  order by p.last_updated_at desc nulls last, p.created_at desc limit 1;
  if v_plan.id is null then return new; end if;
  select a.* into v_assignment from public.account_assignments a
  where a.account_id = new.account_id and a.status in ('reserved','active')
    and (v_plan.assignment_id is null or a.id = v_plan.assignment_id)
    and a.starts_at <= now() and a.ends_at > now()
    and coalesce(a.schedule_mode, '') <> 'manual_only'
  order by case when a.id = v_plan.assignment_id then 0 else 1 end, a.starts_at desc limit 1;
  v_window_start := coalesce(v_plan.scheduled_window_start, v_assignment.starts_at);
  v_window_end := coalesce(v_plan.scheduled_window_end, v_assignment.ends_at);
  if v_window_start is null or v_window_end is null or not (v_window_start <= now() and now() < v_window_end) then
    return new;
  end if;
  v_window_key := coalesce(nullif(v_plan.resume_window_key, ''), new.account_id::text || ':' || v_window_start::text);
  insert into public.incident_resume_authorizations (
    incident_id, account_id, run_id, resume_plan_id, resume_window_key,
    scheduled_window_start, scheduled_window_end, status, armed_source,
    resolution_note, metadata_safe, test
  ) values (
    new.id, new.account_id, new.run_id, v_plan.id, v_window_key,
    v_window_start, v_window_end, 'armed', 'incident_resolution',
    left(coalesce(new.resolution_note, ''), 500),
    jsonb_build_object('incident_type',new.incident_type,'reason_code',coalesce(new.reason,new.failure_reason),'resolution_is_resume_authorization',true,'explicit_security_classification',false),
    lower(coalesce(new.metadata ->> 'test', 'false')) in ('true','1','yes')
  ) on conflict do nothing returning id into v_authorization_id;
  if v_authorization_id is not null then
    update public.account_session_resume_plans set scheduled_window_start=v_window_start,
      scheduled_window_end=v_window_end,resume_window_key=v_window_key,last_updated_at=now()
    where id=v_plan.id;
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('recovery',coalesce(new.metadata->'recovery','{}'::jsonb) || jsonb_build_object('state','ready_to_resume','authorization_id',v_authorization_id,'armed_at',now(),'source','incident_resolution'));
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.notification_router_auto_login_failure_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  combined_reason text := lower(coalesce(new.reason, '') || ' ' || coalesce(new.failure_reason, '') || ' ' || coalesce(new.incident_type, ''));
  routed_type text;
  business_problem text;
  business_action text;
begin
  if new.status not in ('open','acknowledged') or not (
    lower(new.incident_type) like '%login%'
    or combined_reason ~ '(password|challenge|identity|checkpoint|device|provision)'
  ) then return new; end if;

  if combined_reason ~ '(password|credential.*reject)' then
    routed_type := 'auto_login.wrong_password';
    business_problem := 'Le mot de passe Instagram a été refusé.';
    business_action := 'Demander au client de mettre à jour son mot de passe.';
  elsif combined_reason ~ '(challenge|checkpoint|verification)' then
    routed_type := 'auto_login.challenge';
    business_problem := 'Instagram demande une vérification supplémentaire.';
    business_action := 'Une intervention est nécessaire avant de poursuivre.';
  elsif combined_reason ~ '(identity|mismatch|wrong_account)' then
    routed_type := 'auto_login.identity_mismatch';
    business_problem := 'Le compte Instagram ouvert ne correspond pas au compte attendu.';
    business_action := 'Vérifier l’identité du compte avant de poursuivre.';
  elsif combined_reason ~ '(device|app.*unavailable)' then
    routed_type := 'auto_login.device_unavailable';
    business_problem := 'Le téléphone ou l’application Instagram n’est pas disponible.';
    business_action := 'Vérifier la disponibilité du téléphone dans BotApp.';
  else
    routed_type := 'auto_login.failure';
    business_problem := 'La connexion Instagram n’a pas pu être terminée.';
    business_action := 'Consulter BotApp pour poursuivre la vérification.';
  end if;

  perform public.emit_notification_business_event_v2(
    'auto_login.failure:' || new.id::text || ':' || new.lifecycle_version::text,
    'auto_login', case when new.metadata->>'environment' = 'test' then 'test' else 'live' end, routed_type,
    new.account_id, new.client_id, null,
    jsonb_build_object(
      'username', coalesce('@' || trim(leading '@' from new.account_username), '@non-renseigné'),
      'summary', business_problem, 'action', business_action
    ),
    jsonb_build_object('incident_id', new.id, 'incident_type', new.incident_type, 'reason', new.reason, 'run_id', new.run_id),
    coalesce(new.last_seen_at, new.created_at)
  );
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.notification_router_plan_change_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  quote public.commercial_plan_change_quotes%rowtype;
  entitlement public.client_account_entitlements%rowtype;
  username text;
  stripe_event_id text;
begin
  if coalesce(new.metadata_safe ->> 'plan_change_state', '') <> 'webhook_reconciled'
     or coalesce(old.metadata_safe ->> 'plan_change_state', '') = 'webhook_reconciled'
     or new.plan_change_quote_id is null then
    return new;
  end if;
  select * into quote from public.commercial_plan_change_quotes where id = new.plan_change_quote_id;
  select * into entitlement from public.client_account_entitlements
    where id = new.client_account_entitlement_id
      and client_id = new.client_id and account_id = new.account_id
      and status = 'entitlement_consumed';
  stripe_event_id := nullif(new.metadata_safe ->> 'stripe_event_id', '');
  if quote.id is null or quote.status <> 'quote_activated'
     or quote.client_id is distinct from new.client_id
     or quote.account_id is distinct from new.account_id
     or quote.target_plan_key is distinct from entitlement.plan_key
     or quote.actual_stripe_reconciled_at is null
     or quote.actual_stripe_period_end_at is null
     or quote.actual_stripe_remaining_credit_cents is null
     or stripe_event_id is null then
    raise exception 'plan_change_notification_convergence_incomplete' using errcode = '23514';
  end if;
  select '@' || trim(leading '@' from account.username) into username
    from public.ig_accounts account where account.id = new.account_id;
  perform public.emit_notification_business_event_v2(
    'plan_change.completed:' || quote.id::text || ':' || stripe_event_id,
    'plan_change', case when new.livemode then 'live' else 'test' end,
    'plan_change.completed', new.account_id, new.client_id, null,
    jsonb_build_object(
      'username', coalesce(username, '@non-renseigné'),
      'previousPlan', initcap(quote.source_plan_key),
      'newPlan', initcap(quote.target_plan_key),
      'expiry', to_char(quote.actual_stripe_period_end_at at time zone 'UTC', 'DD/MM/YYYY'),
      'remainingCredit', case when quote.actual_stripe_remaining_credit_cents > 0
        then to_char(quote.actual_stripe_remaining_credit_cents::numeric / 100, 'FM999999990D00') || ' €' else null end
    ),
    jsonb_build_object('quote_id', quote.id, 'stripe_event_id', stripe_event_id, 'subscription_id', new.id),
    quote.actual_stripe_reconciled_at
  );
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_terminal_incident_dashboard_actions_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.resolved_at is null
     and new.archived_at is null
     and lower(coalesce(new.status, '')) not in ('resolved', 'ignored', 'archived') then
    return new;
  end if;

  update public.account_dashboard_actions as action
  set status = 'resolved',
      blocking_campaign = false,
      requires_client_action = false,
      resolved_at = coalesce(action.resolved_at, new.resolved_at, now()),
      updated_at = now(),
      metadata_safe = coalesce(action.metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'incident_lifecycle_sync', 'terminal',
        'incident_status', lower(coalesce(new.status, '')),
        'incident_archived', new.archived_at is not null,
        'contract_version', 'incident_dashboard_action_effective_blocker_v1'
      )
  where action.incident_id = new.id
    and action.account_id = new.account_id
    and action.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted');

  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.notification_router_materialize_deliveries_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.notification_deliveries (event_id, destination_id, status, next_retry_at)
  select new.id, destination.id, 'pending', now()
  from public.notification_destination_settings destination
  where destination.category = new.category
    and destination.environment = new.environment
    and destination.enabled = true
    and destination.webhook_ciphertext is not null
  on conflict (event_id, destination_id) do nothing;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.notification_business_events_immutable_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'notification_business_event_immutable' using errcode = '55000';
end;
$function$
;
ALTER TABLE "public"."account_warmup_settings" ALTER COLUMN "warmup_enabled" SET DEFAULT true;
ALTER TABLE "public"."account_warmup_settings" ALTER COLUMN "warmup_profile_code" SET DEFAULT 'follow_default_v1'::text;
ALTER TABLE "public"."account_warmup_settings" ALTER COLUMN "day_1_follow_cap" SET DEFAULT 10;
ALTER TABLE "public"."account_warmup_settings" ALTER COLUMN "day_2_follow_cap" SET DEFAULT 20;
ALTER TABLE "public"."account_warmup_settings" ALTER COLUMN "day_3_follow_cap" SET DEFAULT 40;
ALTER TABLE "public"."account_warmup_settings" ALTER COLUMN "status" SET DEFAULT 'pending_package_start'::text;
ALTER TABLE "public"."account_warmup_settings" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."account_warmup_settings" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."commercial_packages" ALTER COLUMN "default_welcome_enabled" SET DEFAULT false;
ALTER TABLE "public"."commercial_packages" ALTER COLUMN "default_outreach_enabled" SET DEFAULT false;
ALTER TABLE "public"."commercial_packages" ALTER COLUMN "advanced_ct_enabled" SET DEFAULT false;
ALTER TABLE "public"."commercial_packages" ALTER COLUMN "ai_comment_enabled" SET DEFAULT false;
ALTER TABLE "public"."commercial_packages" ALTER COLUMN "ai_targeting_enabled" SET DEFAULT false;
ALTER TABLE "public"."commercial_packages" ALTER COLUMN "active" SET DEFAULT true;
ALTER TABLE "public"."commercial_packages" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."commercial_packages" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."account_commercial_packages" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."account_commercial_packages" ALTER COLUMN "status" SET DEFAULT 'active'::text;
ALTER TABLE "public"."account_commercial_packages" ALTER COLUMN "starts_at" SET DEFAULT now();
ALTER TABLE "public"."account_commercial_packages" ALTER COLUMN "source" SET DEFAULT 'operator'::text;
ALTER TABLE "public"."account_commercial_packages" ALTER COLUMN "metadata_safe" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."account_commercial_packages" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."account_commercial_packages" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."ig_account_social_profile_snapshots" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."ig_account_social_profile_snapshots" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_account_follow_limit_overrides" ALTER COLUMN "classification" SET DEFAULT 'explicit'::text;
ALTER TABLE "public"."ig_account_follow_limit_overrides" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_account_follow_limit_overrides" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."ig_accounts" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."ig_accounts" ALTER COLUMN "platform" SET DEFAULT 'instagram'::text;
ALTER TABLE "public"."ig_accounts" ALTER COLUMN "status" SET DEFAULT 'inactive'::text;
ALTER TABLE "public"."ig_accounts" ALTER COLUMN "two_fa_enabled" SET DEFAULT false;
ALTER TABLE "public"."ig_accounts" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_accounts" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."ig_accounts" ALTER COLUMN "clone_mode" SET DEFAULT 'off'::text;
ALTER TABLE "public"."ig_accounts" ALTER COLUMN "login_method" SET DEFAULT 'manual'::text;
ALTER TABLE "public"."ig_accounts" ALTER COLUMN "username_verification_status" SET DEFAULT 'pending'::text;
ALTER TABLE "public"."ig_accounts" ALTER COLUMN "public_profile_metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."ig_accounts" ALTER COLUMN "admin_lifecycle_status" SET DEFAULT 'active'::text;
ALTER TABLE "public"."ig_devices" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."ig_devices" ALTER COLUMN "platform" SET DEFAULT 'android'::text;
ALTER TABLE "public"."ig_devices" ALTER COLUMN "status" SET DEFAULT 'offline'::text;
ALTER TABLE "public"."ig_devices" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_devices" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."client_account_entitlements" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."client_account_entitlements" ALTER COLUMN "applied_discount_percent" SET DEFAULT 0;
ALTER TABLE "public"."client_account_entitlements" ALTER COLUMN "catalog_snapshot" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."client_account_entitlements" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."client_account_entitlements" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."client_account_entitlements" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."account_package_runtime_contract_events" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."account_package_runtime_contract_events" ALTER COLUMN "details_safe" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."account_package_runtime_contract_events" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_account_unfollow_settings" ALTER COLUMN "unfollow_enabled" SET DEFAULT false;
ALTER TABLE "public"."ig_account_unfollow_settings" ALTER COLUMN "unfollow_only" SET DEFAULT false;
ALTER TABLE "public"."ig_account_unfollow_settings" ALTER COLUMN "do_unfollow_first" SET DEFAULT false;
ALTER TABLE "public"."ig_account_unfollow_settings" ALTER COLUMN "unfollow_after_days" SET DEFAULT 3;
ALTER TABLE "public"."ig_account_unfollow_settings" ALTER COLUMN "unfollow_mode" SET DEFAULT 'unfollow'::text;
ALTER TABLE "public"."ig_account_unfollow_settings" ALTER COLUMN "unfollow_sort_mode" SET DEFAULT 'default'::text;
ALTER TABLE "public"."ig_account_unfollow_settings" ALTER COLUMN "unfollow_per_session_limit" SET DEFAULT 50;
ALTER TABLE "public"."ig_account_unfollow_settings" ALTER COLUMN "unfollow_per_day_limit" SET DEFAULT 200;
ALTER TABLE "public"."ig_account_unfollow_settings" ALTER COLUMN "package_default_snapshot" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."ig_account_unfollow_settings" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_account_unfollow_settings" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."ig_account_unfollow_settings" ALTER COLUMN "runtime_cap_mode" SET DEFAULT 'prod_normal'::text;
ALTER TABLE "public"."clients" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."clients" ALTER COLUMN "status" SET DEFAULT 'active'::text;
ALTER TABLE "public"."clients" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."clients" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."clients" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."account_assignments" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."account_assignments" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
ALTER TABLE "public"."account_assignments" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."account_assignments" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."account_assignments" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."account_assignments" ALTER COLUMN "assignment_source" SET DEFAULT 'manual_dashboard'::text;
ALTER TABLE "public"."account_assignments" ALTER COLUMN "schedule_mode" SET DEFAULT 'scheduled'::text;
ALTER TABLE "public"."commercial_checkout_sessions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."commercial_checkout_sessions" ALTER COLUMN "term_discount_percent" SET DEFAULT 0;
ALTER TABLE "public"."commercial_checkout_sessions" ALTER COLUMN "agency_discount_percent" SET DEFAULT 0;
ALTER TABLE "public"."commercial_checkout_sessions" ALTER COLUMN "applied_discount_percent" SET DEFAULT 0;
ALTER TABLE "public"."commercial_checkout_sessions" ALTER COLUMN "catalog_snapshot" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."commercial_checkout_sessions" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."commercial_checkout_sessions" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."commercial_checkout_sessions" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."account_run_requests" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."account_run_requests" ALTER COLUMN "actor_type" SET DEFAULT 'admin'::text;
ALTER TABLE "public"."account_run_requests" ALTER COLUMN "source_surface" SET DEFAULT 'instagram_dashboard'::text;
ALTER TABLE "public"."account_run_requests" ALTER COLUMN "status" SET DEFAULT 'queued'::text;
ALTER TABLE "public"."account_run_requests" ALTER COLUMN "priority" SET DEFAULT 0;
ALTER TABLE "public"."account_run_requests" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."account_run_requests" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."account_run_requests" ALTER COLUMN "metadata_safe" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "welcome_dm_enabled" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "cold_dm_enabled" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "watch_story_enabled" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "like_enabled" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "follow_enabled" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "max_dm_per_run" SET DEFAULT 2;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "max_follow_per_run" SET DEFAULT 10;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "max_likes_per_run" SET DEFAULT 0;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "delay_min_seconds" SET DEFAULT 8;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "delay_max_seconds" SET DEFAULT 20;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "safe_review_mode" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "send_enabled" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "dry_run_enabled" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "account_status" SET DEFAULT 'active'::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "app_package" SET DEFAULT 'com.instagram.android'::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "clone_mode" SET DEFAULT 'off'::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "login_method" SET DEFAULT 'manual'::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "story_watch_enabled" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "change_source_if_crash" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "delete_interacted_users" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "skipped_posts_limit" SET DEFAULT 20;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "source_accounts" SET DEFAULT ''::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "truncate_sources_min" SET DEFAULT 20;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "truncate_sources_max" SET DEFAULT 80;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "sort_followers_mode" SET DEFAULT 'default'::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "unfollow_non_followers" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "unfollow_any" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "unfollow_skip_limit" SET DEFAULT 50;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "mute_posts_after_follow" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "mute_stories_after_follow" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "do_follows_first" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "disable_block_detection" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "relog_after_block" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "relog_delay_seconds" SET DEFAULT 120;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "rotate_ip" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "restart_uiautomator2" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "close_apps" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "close_apps_device" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "log_out_all_before_session" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "total_crashes_limit" SET DEFAULT 3;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "screen_sleep" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "screen_record" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "debug_mode" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "random_delay_min_seconds" SET DEFAULT 8;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "random_delay_max_seconds" SET DEFAULT 20;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "total_interactions_limit" SET DEFAULT 120;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "total_successful_interactions_limit" SET DEFAULT 80;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "interactions_count" SET DEFAULT 0;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "interact_percentage" SET DEFAULT 100;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "end_if_follow_limit_reached" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "end_if_dm_limit_reached" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "end_if_likes_limit_reached" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "max_actions_per_hour" SET DEFAULT 30;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "max_actions_per_day" SET DEFAULT 120;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "random_pause_every_actions" SET DEFAULT 15;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "long_break_after_interactions" SET DEFAULT 45;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "long_break_min_minutes" SET DEFAULT 8;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "long_break_max_minutes" SET DEFAULT 18;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "warmup_mode" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "stop_on_suspicious_screen" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "stop_on_login_challenge" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "stop_on_checkpoint" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "stop_on_repeated_navigation_failure" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "max_repeated_errors" SET DEFAULT 5;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "username" SET DEFAULT ''::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "display_name" SET DEFAULT ''::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "email" SET DEFAULT ''::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "password" SET DEFAULT ''::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "two_fa_enabled" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "cloned_app_mode" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "timeslot_start" SET DEFAULT '09:00'::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "timeslot_end" SET DEFAULT '18:00'::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "total_sessions" SET DEFAULT 1;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "stop_interactions_after_minutes" SET DEFAULT 45;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "timeout_startup_seconds" SET DEFAULT 120;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "pause_account_days" SET DEFAULT 0;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "pause_account_until" SET DEFAULT ''::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "randomize_start_enabled" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "speed_multiplier" SET DEFAULT 1;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "follow_limit" SET DEFAULT 20;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "total_follows_limit" SET DEFAULT 100;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "follow_percentage" SET DEFAULT 100;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "unfollow_enabled" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "total_unfollows_limit" SET DEFAULT 0;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "unfollow_delay_days" SET DEFAULT 7;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "total_likes_limit" SET DEFAULT 100;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "likes_per_follow_min" SET DEFAULT 0;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "likes_per_follow_max" SET DEFAULT 2;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "likes_percentage" SET DEFAULT 100;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "watch_photo_time_min" SET DEFAULT 3;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "watch_photo_time_max" SET DEFAULT 8;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "watch_video_time_min" SET DEFAULT 5;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "watch_video_time_max" SET DEFAULT 18;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "max_consecutive_dms" SET DEFAULT 3;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "check_chat_before_welcoming" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "current_run_status" SET DEFAULT 'idle'::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "last_error" SET DEFAULT ''::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "last_successful_action" SET DEFAULT ''::text;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "manual_stop_requested" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "fling_when_skipped" SET DEFAULT true;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "followback_on_followers" SET DEFAULT false;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "max_followback_skips" SET DEFAULT 50;
ALTER TABLE "public"."ig_account_settings" ALTER COLUMN "max_followback_ignore" SET DEFAULT 200;
ALTER TABLE "public"."ig_account_unfollow_enablement_overrides" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_account_unfollow_enablement_overrides" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."commercial_account_lifecycle_states" ALTER COLUMN "commercial_state" SET DEFAULT 'active'::text;
ALTER TABLE "public"."commercial_account_lifecycle_states" ALTER COLUMN "stripe_billing_paused" SET DEFAULT false;
ALTER TABLE "public"."commercial_account_lifecycle_states" ALTER COLUMN "metadata_safe" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."commercial_account_lifecycle_states" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."commercial_account_lifecycle_states" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "welcome_enabled" SET DEFAULT false;
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "outreach_enabled" SET DEFAULT false;
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "welcome_per_session_limit" SET DEFAULT 10;
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "welcome_per_day_limit" SET DEFAULT 50;
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "outreach_per_session_limit" SET DEFAULT 25;
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "outreach_per_day_limit" SET DEFAULT 80;
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "total_dm_per_day_limit" SET DEFAULT 100;
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "check_chat_before_welcome" SET DEFAULT true;
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "welcome_skip_if_existing_thread" SET DEFAULT true;
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "outreach_skip_if_existing_thread" SET DEFAULT true;
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "max_welcoming_skips" SET DEFAULT 6;
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "random_delay_min_seconds" SET DEFAULT 3;
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "random_delay_max_seconds" SET DEFAULT 12;
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_account_dm_settings" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."ig_interaction_events" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."ig_interaction_events" ALTER COLUMN "event_status" SET DEFAULT 'success'::text;
ALTER TABLE "public"."ig_interaction_events" ALTER COLUMN "event_at" SET DEFAULT now();
ALTER TABLE "public"."ig_interaction_events" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_interaction_events" ALTER COLUMN "payload" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."commercial_plan_change_quotes" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."commercial_plan_change_quotes" ALTER COLUMN "currency" SET DEFAULT 'EUR'::text;
ALTER TABLE "public"."commercial_plan_change_quotes" ALTER COLUMN "payment_status" SET DEFAULT 'pending'::text;
ALTER TABLE "public"."commercial_plan_change_quotes" ALTER COLUMN "status" SET DEFAULT 'quote_pending'::text;
ALTER TABLE "public"."commercial_plan_change_quotes" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."commercial_plan_change_quotes" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."commercial_plan_change_quotes" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."commercial_plan_change_quotes" ALTER COLUMN "change_scope" SET DEFAULT 'workspace'::text;
ALTER TABLE "public"."commercial_plan_change_quotes" ALTER COLUMN "actual_stripe_object_ids" SET DEFAULT '[]'::jsonb;
ALTER TABLE "public"."client_users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."client_users" ALTER COLUMN "role" SET DEFAULT 'owner'::text;
ALTER TABLE "public"."client_users" ALTER COLUMN "status" SET DEFAULT 'active'::text;
ALTER TABLE "public"."client_users" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."client_users" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."client_entitlements" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."client_entitlements" ALTER COLUMN "entitlement_type" SET DEFAULT 'standalone'::text;
ALTER TABLE "public"."client_entitlements" ALTER COLUMN "active" SET DEFAULT true;
ALTER TABLE "public"."client_entitlements" ALTER COLUMN "valid_from" SET DEFAULT now();
ALTER TABLE "public"."client_entitlements" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."client_entitlements" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."client_entitlements" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."client_subscriptions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."client_subscriptions" ALTER COLUMN "status" SET DEFAULT 'active'::text;
ALTER TABLE "public"."client_subscriptions" ALTER COLUMN "starts_at" SET DEFAULT now();
ALTER TABLE "public"."client_subscriptions" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."client_subscriptions" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."client_subscriptions" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."client_subscription_accounts" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."client_subscription_accounts" ALTER COLUMN "status" SET DEFAULT 'active'::text;
ALTER TABLE "public"."client_subscription_accounts" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."client_subscription_accounts" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."phone_clones" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."phone_clones" ALTER COLUMN "status" SET DEFAULT 'available'::text;
ALTER TABLE "public"."phone_clones" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."phone_clones" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."phone_clones" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."phone_devices" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."phone_devices" ALTER COLUMN "max_clones" SET DEFAULT 4;
ALTER TABLE "public"."phone_devices" ALTER COLUMN "status" SET DEFAULT 'available'::text;
ALTER TABLE "public"."phone_devices" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."phone_devices" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."phone_devices" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."phone_devices" ALTER COLUMN "timezone" SET DEFAULT 'Africa/Johannesburg'::text;
ALTER TABLE "public"."phone_app_instances" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."phone_app_instances" ALTER COLUMN "is_launchable" SET DEFAULT true;
ALTER TABLE "public"."phone_app_instances" ALTER COLUMN "status" SET DEFAULT 'unknown'::text;
ALTER TABLE "public"."phone_app_instances" ALTER COLUMN "usable_for_auto_login" SET DEFAULT true;
ALTER TABLE "public"."phone_app_instances" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."phone_app_instances" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."phone_app_instances" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."runtime_events" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."runtime_events" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."runtime_events" ALTER COLUMN "severity" SET DEFAULT 'info'::text;
ALTER TABLE "public"."runtime_events" ALTER COLUMN "visibility" SET DEFAULT 'admin_only'::text;
ALTER TABLE "public"."runtime_events" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."account_commercial_addons" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."account_commercial_addons" ALTER COLUMN "status" SET DEFAULT 'active'::text;
ALTER TABLE "public"."account_commercial_addons" ALTER COLUMN "starts_at" SET DEFAULT now();
ALTER TABLE "public"."account_commercial_addons" ALTER COLUMN "source" SET DEFAULT 'operator'::text;
ALTER TABLE "public"."account_commercial_addons" ALTER COLUMN "metadata_safe" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."account_commercial_addons" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."account_commercial_addons" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."commercial_account_lifecycle_operations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."commercial_account_lifecycle_operations" ALTER COLUMN "state" SET DEFAULT 'pending'::text;
ALTER TABLE "public"."commercial_account_lifecycle_operations" ALTER COLUMN "metadata_safe" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."commercial_account_lifecycle_operations" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."commercial_account_lifecycle_operations" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."client_instagram_accounts" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."client_instagram_accounts" ALTER COLUMN "onboarding_status" SET DEFAULT 'pending'::text;
ALTER TABLE "public"."client_instagram_accounts" ALTER COLUMN "provisioning_status" SET DEFAULT 'not_started'::text;
ALTER TABLE "public"."client_instagram_accounts" ALTER COLUMN "login_status" SET DEFAULT 'unknown'::text;
ALTER TABLE "public"."client_instagram_accounts" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."client_instagram_accounts" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."client_instagram_accounts" ALTER COLUMN "active" SET DEFAULT true;
ALTER TABLE "public"."client_instagram_accounts" ALTER COLUMN "login_identity_proof_status" SET DEFAULT 'required_unverified'::text;
ALTER TABLE "public"."client_instagram_accounts" ALTER COLUMN "login_identity_proof_version" SET DEFAULT 1;
ALTER TABLE "public"."client_instagram_accounts" ALTER COLUMN "login_state_source_at" SET DEFAULT now();
ALTER TABLE "public"."client_instagram_accounts" ALTER COLUMN "login_state_version" SET DEFAULT 1;
ALTER TABLE "public"."client_instagram_accounts" ALTER COLUMN "login_identity_login_lineage" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."client_instagram_accounts" ALTER COLUMN "capacity_status" SET DEFAULT 'occupied'::text;
ALTER TABLE "auth"."users" ALTER COLUMN "phone" SET DEFAULT NULL::character varying;
ALTER TABLE "auth"."users" ALTER COLUMN "phone_change" SET DEFAULT ''::character varying;
ALTER TABLE "auth"."users" ALTER COLUMN "phone_change_token" SET DEFAULT ''::character varying;
ALTER TABLE "auth"."users" ALTER COLUMN "email_change_token_current" SET DEFAULT ''::character varying;
ALTER TABLE "auth"."users" ALTER COLUMN "email_change_confirm_status" SET DEFAULT 0;
ALTER TABLE "auth"."users" ALTER COLUMN "reauthentication_token" SET DEFAULT ''::character varying;
ALTER TABLE "auth"."users" ALTER COLUMN "is_sso_user" SET DEFAULT false;
ALTER TABLE "auth"."users" ALTER COLUMN "is_anonymous" SET DEFAULT false;
ALTER TABLE "public"."ig_dm_templates" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."ig_dm_templates" ALTER COLUMN "name" SET DEFAULT 'default'::text;
ALTER TABLE "public"."ig_dm_templates" ALTER COLUMN "is_default" SET DEFAULT false;
ALTER TABLE "public"."ig_dm_templates" ALTER COLUMN "active" SET DEFAULT true;
ALTER TABLE "public"."ig_dm_templates" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_dm_templates" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."ig_targets" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."ig_targets" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
ALTER TABLE "public"."ig_targets" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_targets" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."ig_targets" ALTER COLUMN "retry_count" SET DEFAULT 0;
ALTER TABLE "public"."ig_targets" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."ig_targets" ALTER COLUMN "verification_status" SET DEFAULT 'pending'::text;
ALTER TABLE "public"."ig_targets" ALTER COLUMN "quality_status" SET DEFAULT 'unknown'::text;
ALTER TABLE "public"."ig_targets" ALTER COLUMN "metadata_safe" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."ig_targets" ALTER COLUMN "follows_sent_count" SET DEFAULT 0;
ALTER TABLE "public"."ig_targets" ALTER COLUMN "followbacks_count" SET DEFAULT 0;
ALTER TABLE "public"."ig_targets" ALTER COLUMN "readd_blocked_permanently" SET DEFAULT false;
ALTER TABLE "public"."client_subscription_modules" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."client_subscription_modules" ALTER COLUMN "enabled" SET DEFAULT true;
ALTER TABLE "public"."client_subscription_modules" ALTER COLUMN "entitlement_type" SET DEFAULT 'included'::text;
ALTER TABLE "public"."client_subscription_modules" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."client_subscription_modules" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."account_follow_source_settings" ALTER COLUMN "max_follows_per_target_per_run" SET DEFAULT 2;
ALTER TABLE "public"."account_follow_source_settings" ALTER COLUMN "max_targets_per_run" SET DEFAULT 3;
ALTER TABLE "public"."account_follow_source_settings" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."account_follow_source_settings" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."account_dashboard_actions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."account_dashboard_actions" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."account_dashboard_actions" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."account_dashboard_actions" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
ALTER TABLE "public"."account_dashboard_actions" ALTER COLUMN "severity" SET DEFAULT 'warning'::text;
ALTER TABLE "public"."account_dashboard_actions" ALTER COLUMN "audience" SET DEFAULT 'client'::text;
ALTER TABLE "public"."account_dashboard_actions" ALTER COLUMN "requires_client_action" SET DEFAULT true;
ALTER TABLE "public"."account_dashboard_actions" ALTER COLUMN "blocking_campaign" SET DEFAULT false;
ALTER TABLE "public"."account_dashboard_actions" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."account_dashboard_actions" ALTER COLUMN "metadata_safe" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."commercial_package_runtime_settings" ALTER COLUMN "warmup_enabled" SET DEFAULT true;
ALTER TABLE "public"."commercial_package_runtime_settings" ALTER COLUMN "warmup_profile_code" SET DEFAULT 'follow_default_v1'::text;
ALTER TABLE "public"."commercial_package_runtime_settings" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."commercial_package_runtime_settings" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."ig_runs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."ig_runs" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
ALTER TABLE "public"."ig_runs" ALTER COLUMN "total_targets" SET DEFAULT 0;
ALTER TABLE "public"."ig_runs" ALTER COLUMN "total_dm" SET DEFAULT 0;
ALTER TABLE "public"."ig_runs" ALTER COLUMN "total_follow" SET DEFAULT 0;
ALTER TABLE "public"."ig_runs" ALTER COLUMN "total_like" SET DEFAULT 0;
ALTER TABLE "public"."ig_runs" ALTER COLUMN "total_story" SET DEFAULT 0;
ALTER TABLE "public"."ig_runs" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_runs" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."ig_runs" ALTER COLUMN "live_counter_revision" SET DEFAULT 0;
ALTER TABLE "public"."incident_resume_authorizations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."incident_resume_authorizations" ALTER COLUMN "status" SET DEFAULT 'armed'::text;
ALTER TABLE "public"."incident_resume_authorizations" ALTER COLUMN "armed_source" SET DEFAULT 'botapp_relay'::text;
ALTER TABLE "public"."incident_resume_authorizations" ALTER COLUMN "armed_at" SET DEFAULT now();
ALTER TABLE "public"."incident_resume_authorizations" ALTER COLUMN "metadata_safe" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."incident_resume_authorizations" ALTER COLUMN "test" SET DEFAULT false;
ALTER TABLE "public"."incident_resume_authorizations" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."incident_resume_authorizations" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."incident_resume_authorizations" ALTER COLUMN "retry_generation" SET DEFAULT 0;
ALTER TABLE "public"."ig_account_unfollow_limit_overrides" ALTER COLUMN "classification" SET DEFAULT 'explicit'::text;
ALTER TABLE "public"."ig_account_unfollow_limit_overrides" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_account_unfollow_limit_overrides" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."phonefarm_runtime_barriers" ALTER COLUMN "active" SET DEFAULT false;
ALTER TABLE "public"."phonefarm_runtime_barriers" ALTER COLUMN "metadata_safe" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."phonefarm_runtime_barriers" ALTER COLUMN "generation" SET DEFAULT 0;
ALTER TABLE "public"."phonefarm_runtime_barriers" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."account_session_resume_plans" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."account_session_resume_plans" ALTER COLUMN "resume_stage" SET DEFAULT 'preflight'::text;
ALTER TABLE "public"."account_session_resume_plans" ALTER COLUMN "resume_state" SET DEFAULT 'run_active'::text;
ALTER TABLE "public"."account_session_resume_plans" ALTER COLUMN "restart_allowed" SET DEFAULT false;
ALTER TABLE "public"."account_session_resume_plans" ALTER COLUMN "restart_block_reason" SET DEFAULT 'run_in_progress'::text;
ALTER TABLE "public"."account_session_resume_plans" ALTER COLUMN "attempts_in_window" SET DEFAULT 0;
ALTER TABLE "public"."account_session_resume_plans" ALTER COLUMN "plan" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."account_session_resume_plans" ALTER COLUMN "test" SET DEFAULT false;
ALTER TABLE "public"."account_session_resume_plans" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."account_session_resume_plans" ALTER COLUMN "last_updated_at" SET DEFAULT now();
ALTER TABLE "public"."ig_action_logs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."ig_action_logs" ALTER COLUMN "status" SET DEFAULT 'success'::text;
ALTER TABLE "public"."ig_action_logs" ALTER COLUMN "payload" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."ig_action_logs" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_action_logs" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "was_successful" SET DEFAULT false;
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "last_interaction_at" SET DEFAULT now();
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "payload" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "muted_posts" SET DEFAULT false;
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "muted_stories" SET DEFAULT false;
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "posts_liked_count" SET DEFAULT 0;
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "stories_liked_count" SET DEFAULT 0;
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "stories_watched_count" SET DEFAULT 0;
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "dm_sent" SET DEFAULT false;
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "welcome_dm_sent" SET DEFAULT false;
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "unfollow_attempts" SET DEFAULT 0;
ALTER TABLE "public"."ig_interacted_users" ALTER COLUMN "whitelist_protected" SET DEFAULT false;
ALTER TABLE "public"."auto_restart_device_locks" ALTER COLUMN "reason" SET DEFAULT 'auto_restart'::text;
ALTER TABLE "public"."auto_restart_device_locks" ALTER COLUMN "metadata_safe" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."auto_restart_device_locks" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."auto_restart_device_locks" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."auto_restart_device_locks" ALTER COLUMN "lease_id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."auto_restart_device_locks" ALTER COLUMN "owner_kind" SET DEFAULT 'worker'::text;
ALTER TABLE "public"."auto_restart_device_locks" ALTER COLUMN "operation_phase" SET DEFAULT 'executing'::text;
ALTER TABLE "public"."auto_restart_device_locks" ALTER COLUMN "heartbeat_at" SET DEFAULT now();
ALTER TABLE "public"."account_incidents" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."account_incidents" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."account_incidents" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."account_incidents" ALTER COLUMN "first_seen_at" SET DEFAULT now();
ALTER TABLE "public"."account_incidents" ALTER COLUMN "last_seen_at" SET DEFAULT now();
ALTER TABLE "public"."account_incidents" ALTER COLUMN "status" SET DEFAULT 'open'::text;
ALTER TABLE "public"."account_incidents" ALTER COLUMN "severity" SET DEFAULT 'warning'::text;
ALTER TABLE "public"."account_incidents" ALTER COLUMN "occurrence_count" SET DEFAULT 1;
ALTER TABLE "public"."account_incidents" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."account_incidents" ALTER COLUMN "legal_hold" SET DEFAULT false;
ALTER TABLE "public"."account_incidents" ALTER COLUMN "retention_class" SET DEFAULT 'normal'::text;
ALTER TABLE "public"."account_incidents" ALTER COLUMN "lifecycle_version" SET DEFAULT 1;
ALTER TABLE "public"."account_credentials" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."account_credentials" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."account_credentials" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."account_credentials" ALTER COLUMN "provider" SET DEFAULT 'instagram'::text;
ALTER TABLE "public"."account_credentials" ALTER COLUMN "credentials_version" SET DEFAULT 1;
ALTER TABLE "public"."account_credentials" ALTER COLUMN "status" SET DEFAULT 'active'::text;
ALTER TABLE "public"."account_credentials" ALTER COLUMN "last_submitted_at" SET DEFAULT now();
ALTER TABLE "public"."account_credentials" ALTER COLUMN "reauth_required" SET DEFAULT false;
ALTER TABLE "public"."account_credentials" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."account_credentials" ALTER COLUMN "last_updated_at" SET DEFAULT now();
ALTER TABLE "public"."account_credentials" ALTER COLUMN "metadata_safe" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."commercial_stripe_subscriptions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."commercial_stripe_subscriptions" ALTER COLUMN "livemode" SET DEFAULT false;
ALTER TABLE "public"."commercial_stripe_subscriptions" ALTER COLUMN "cancel_at_period_end" SET DEFAULT false;
ALTER TABLE "public"."commercial_stripe_subscriptions" ALTER COLUMN "metadata_safe" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."commercial_stripe_subscriptions" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."commercial_stripe_subscriptions" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."commercial_stripe_subscriptions" ALTER COLUMN "billing_paused" SET DEFAULT false;
ALTER TABLE "public"."instagram_account_restriction_holds" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."instagram_account_restriction_holds" ALTER COLUMN "generation_id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."instagram_account_restriction_holds" ALTER COLUMN "stable_reason" SET DEFAULT 'instagram_action_rate_limit'::text;
ALTER TABLE "public"."instagram_account_restriction_holds" ALTER COLUMN "status" SET DEFAULT 'active'::text;
ALTER TABLE "public"."instagram_account_restriction_holds" ALTER COLUMN "detected_at" SET DEFAULT now();
ALTER TABLE "public"."instagram_account_restriction_holds" ALTER COLUMN "last_seen_at" SET DEFAULT now();
ALTER TABLE "public"."instagram_account_restriction_holds" ALTER COLUMN "occurrence_count" SET DEFAULT 1;
ALTER TABLE "public"."instagram_account_restriction_holds" ALTER COLUMN "metadata_safe" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."instagram_account_restriction_holds" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."instagram_account_restriction_holds" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."profiles" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."account_session_transitions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."account_session_transitions" ALTER COLUMN "schema_version" SET DEFAULT 'account_session_transition_v1'::text;
ALTER TABLE "public"."account_session_transitions" ALTER COLUMN "unfollow_started" SET DEFAULT false;
ALTER TABLE "public"."account_session_transitions" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."account_session_transitions" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."notification_business_events" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."notification_business_events" ALTER COLUMN "business_payload" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."notification_business_events" ALTER COLUMN "technical_diagnostics" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."notification_business_events" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."incident_retention_policies" ALTER COLUMN "enabled" SET DEFAULT true;
ALTER TABLE "public"."incident_retention_policies" ALTER COLUMN "normal_resolved_days" SET DEFAULT 180;
ALTER TABLE "public"."incident_retention_policies" ALTER COLUMN "critical_resolved_days" SET DEFAULT 365;
ALTER TABLE "public"."incident_retention_policies" ALTER COLUMN "technical_nonblocking_days" SET DEFAULT 90;
ALTER TABLE "public"."incident_retention_policies" ALTER COLUMN "delivery_log_days" SET DEFAULT 90;
ALTER TABLE "public"."incident_retention_policies" ALTER COLUMN "physical_delete_grace_days" SET DEFAULT 30;
ALTER TABLE "public"."incident_retention_policies" ALTER COLUMN "cleanup_batch_size" SET DEFAULT 250;
ALTER TABLE "public"."incident_retention_policies" ALTER COLUMN "legal_audit_logical_archive_only" SET DEFAULT true;
ALTER TABLE "public"."incident_retention_policies" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."incident_retention_policies" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."notification_destination_settings" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."notification_destination_settings" ALTER COLUMN "enabled" SET DEFAULT false;
ALTER TABLE "public"."notification_destination_settings" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."notification_destination_settings" ALTER COLUMN "retry_state" SET DEFAULT '{}'::jsonb;
ALTER TABLE "public"."notification_deliveries" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "public"."notification_deliveries" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
ALTER TABLE "public"."notification_deliveries" ALTER COLUMN "attempt_count" SET DEFAULT 0;
ALTER TABLE "public"."notification_deliveries" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "public"."notification_deliveries" ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "public"."account_warmup_settings" ADD CONSTRAINT "account_warmup_settings_pkey" PRIMARY KEY (account_id);
ALTER TABLE "public"."commercial_packages" ADD CONSTRAINT "commercial_packages_pkey" PRIMARY KEY (code);
ALTER TABLE "public"."account_commercial_packages" ADD CONSTRAINT "account_commercial_packages_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."ig_account_social_profile_snapshots" ADD CONSTRAINT "ig_account_social_profile_snapshots_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."ig_account_follow_limit_overrides" ADD CONSTRAINT "ig_account_follow_limit_overrides_pkey" PRIMARY KEY (account_id);
ALTER TABLE "public"."ig_accounts" ADD CONSTRAINT "ig_accounts_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."ig_devices" ADD CONSTRAINT "ig_devices_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."account_package_runtime_contract_events" ADD CONSTRAINT "account_package_runtime_contract_events_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."ig_account_unfollow_settings" ADD CONSTRAINT "ig_account_unfollow_settings_pkey" PRIMARY KEY (account_id);
ALTER TABLE "public"."clients" ADD CONSTRAINT "clients_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."ig_account_settings" ADD CONSTRAINT "ig_account_settings_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."ig_account_unfollow_enablement_overrides" ADD CONSTRAINT "ig_account_unfollow_enablement_overrides_pkey" PRIMARY KEY (account_id);
ALTER TABLE "public"."commercial_account_lifecycle_states" ADD CONSTRAINT "commercial_account_lifecycle_states_pkey" PRIMARY KEY (account_id);
ALTER TABLE "public"."ig_account_dm_settings" ADD CONSTRAINT "ig_account_dm_settings_pkey" PRIMARY KEY (account_id);
ALTER TABLE "public"."ig_interaction_events" ADD CONSTRAINT "ig_interaction_events_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."client_users" ADD CONSTRAINT "client_users_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."client_entitlements" ADD CONSTRAINT "client_entitlements_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."client_subscriptions" ADD CONSTRAINT "client_subscriptions_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."client_subscription_accounts" ADD CONSTRAINT "client_subscription_accounts_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."phone_clones" ADD CONSTRAINT "phone_clones_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."phone_devices" ADD CONSTRAINT "phone_devices_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."phone_app_instances" ADD CONSTRAINT "phone_app_instances_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."runtime_events" ADD CONSTRAINT "runtime_events_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."account_commercial_addons" ADD CONSTRAINT "account_commercial_addons_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."commercial_account_lifecycle_operations" ADD CONSTRAINT "commercial_account_lifecycle_operations_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_pkey" PRIMARY KEY (id);
ALTER TABLE "auth"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."ig_dm_templates" ADD CONSTRAINT "ig_dm_templates_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."client_subscription_modules" ADD CONSTRAINT "client_subscription_modules_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."account_follow_source_settings" ADD CONSTRAINT "account_follow_source_settings_pkey" PRIMARY KEY (account_id);
ALTER TABLE "public"."account_dashboard_actions" ADD CONSTRAINT "account_dashboard_actions_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_settings_pkey" PRIMARY KEY (package_code);
ALTER TABLE "public"."ig_runs" ADD CONSTRAINT "ig_runs_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."incident_resume_authorizations" ADD CONSTRAINT "incident_resume_authorizations_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."ig_account_unfollow_limit_overrides" ADD CONSTRAINT "ig_account_unfollow_limit_overrides_pkey" PRIMARY KEY (account_id);
ALTER TABLE "public"."phonefarm_runtime_barriers" ADD CONSTRAINT "phonefarm_runtime_barriers_pkey" PRIMARY KEY (barrier_name);
ALTER TABLE "public"."account_session_resume_plans" ADD CONSTRAINT "account_session_resume_plans_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."ig_action_logs" ADD CONSTRAINT "ig_action_logs_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."ig_interacted_users" ADD CONSTRAINT "ig_interacted_users_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."auto_restart_device_locks" ADD CONSTRAINT "auto_restart_device_locks_pkey" PRIMARY KEY (device_id);
ALTER TABLE "public"."account_incidents" ADD CONSTRAINT "account_incidents_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."commercial_stripe_subscriptions" ADD CONSTRAINT "commercial_stripe_subscriptions_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."instagram_account_restriction_holds" ADD CONSTRAINT "instagram_account_restriction_holds_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."account_session_transitions" ADD CONSTRAINT "account_session_transitions_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."notification_business_events" ADD CONSTRAINT "notification_business_events_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."incident_retention_policies" ADD CONSTRAINT "incident_retention_policies_pkey" PRIMARY KEY (policy_key);
ALTER TABLE "public"."notification_destination_settings" ADD CONSTRAINT "notification_destination_settings_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."ig_account_social_profile_snapshots" ADD CONSTRAINT "ig_account_social_profile_snapshots_unique_key" UNIQUE (account_id, idempotency_key);
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_idempotency_key_key" UNIQUE (idempotency_key);
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_idempotency_key_key" UNIQUE (idempotency_key);
ALTER TABLE "public"."client_users" ADD CONSTRAINT "client_users_client_auth_user_key" UNIQUE (client_id, auth_user_id);
ALTER TABLE "public"."client_subscription_accounts" ADD CONSTRAINT "client_subscription_accounts_subscription_account_key" UNIQUE (subscription_id, account_id);
ALTER TABLE "public"."phone_clones" ADD CONSTRAINT "phone_clones_device_clone_key" UNIQUE (device_id, clone_index);
ALTER TABLE "public"."commercial_account_lifecycle_operations" ADD CONSTRAINT "commercial_account_lifecycle_operations_idempotency_key" UNIQUE (idempotency_key);
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_account_id_key" UNIQUE (account_id);
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_client_account_key" UNIQUE (client_id, account_id);
ALTER TABLE "auth"."users" ADD CONSTRAINT "users_phone_key" UNIQUE (phone);
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_account_id_id_ct_unique" UNIQUE (account_id, id);
ALTER TABLE "public"."client_subscription_modules" ADD CONSTRAINT "client_subscription_modules_subscription_feature_key" UNIQUE (subscription_id, feature_code);
ALTER TABLE "public"."account_session_resume_plans" ADD CONSTRAINT "account_session_resume_plans_run_id_key" UNIQUE (run_id);
ALTER TABLE "public"."commercial_stripe_subscriptions" ADD CONSTRAINT "commercial_stripe_subscriptions_stripe_sub_unique" UNIQUE (stripe_subscription_id);
ALTER TABLE "public"."instagram_account_restriction_holds" ADD CONSTRAINT "instagram_account_restriction_hold_account_id_generation_id_key" UNIQUE (account_id, generation_id);
ALTER TABLE "public"."instagram_account_restriction_holds" ADD CONSTRAINT "instagram_account_restriction_holds_incident_id_key" UNIQUE (incident_id);
ALTER TABLE "public"."account_session_transitions" ADD CONSTRAINT "account_session_transitions_transition_key_key" UNIQUE (transition_key);
ALTER TABLE "public"."notification_business_events" ADD CONSTRAINT "notification_business_events_idempotency_key_key" UNIQUE (idempotency_key);
ALTER TABLE "public"."notification_destination_settings" ADD CONSTRAINT "notification_destination_settings_unique" UNIQUE (category, environment, channel);
ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_event_destination_unique" UNIQUE (event_id, destination_id);
ALTER TABLE "public"."account_warmup_settings" ADD CONSTRAINT "account_warmup_settings_day_1_cap_check" CHECK ((day_1_follow_cap > 0));
ALTER TABLE "public"."account_warmup_settings" ADD CONSTRAINT "account_warmup_settings_day_2_cap_check" CHECK ((day_2_follow_cap > 0));
ALTER TABLE "public"."account_warmup_settings" ADD CONSTRAINT "account_warmup_settings_day_3_cap_check" CHECK ((day_3_follow_cap > 0));
ALTER TABLE "public"."account_warmup_settings" ADD CONSTRAINT "account_warmup_settings_day_4_plus_cap_check" CHECK (((day_4_plus_follow_cap IS NULL) OR (day_4_plus_follow_cap > 0)));
ALTER TABLE "public"."account_warmup_settings" ADD CONSTRAINT "account_warmup_settings_progression_check" CHECK (((day_1_follow_cap <= day_2_follow_cap) AND (day_2_follow_cap <= day_3_follow_cap) AND ((day_4_plus_follow_cap IS NULL) OR (day_3_follow_cap <= day_4_plus_follow_cap))));
ALTER TABLE "public"."commercial_packages" ADD CONSTRAINT "commercial_packages_follow_day_policy_check" CHECK ((((default_follow_day_cap IS NULL) AND (max_follow_day_cap IS NULL)) OR ((default_follow_day_cap > 0) AND (max_follow_day_cap > 0) AND (default_follow_day_cap <= max_follow_day_cap))));
ALTER TABLE "public"."commercial_packages" ADD CONSTRAINT "commercial_packages_follow_session_policy_check" CHECK ((((default_follow_session_cap IS NULL) AND (max_follow_session_cap IS NULL)) OR ((default_follow_session_cap > 0) AND (max_follow_session_cap > 0) AND (default_follow_session_cap <= max_follow_session_cap))));
ALTER TABLE "public"."ig_account_social_profile_snapshots" ADD CONSTRAINT "ig_account_social_profile_snapshots_followers_count_check" CHECK (((followers_count IS NULL) OR (followers_count >= 0)));
ALTER TABLE "public"."ig_account_social_profile_snapshots" ADD CONSTRAINT "ig_account_social_profile_snapshots_following_count_check" CHECK (((following_count IS NULL) OR (following_count >= 0)));
ALTER TABLE "public"."ig_account_social_profile_snapshots" ADD CONSTRAINT "ig_account_social_profile_snapshots_freshness_status_check" CHECK ((freshness_status = ANY (ARRAY['fresh'::text, 'stale'::text, 'partial'::text])));
ALTER TABLE "public"."ig_account_social_profile_snapshots" ADD CONSTRAINT "ig_account_social_profile_snapshots_has_metric" CHECK (((followers_count IS NOT NULL) OR (following_count IS NOT NULL) OR (posts_count IS NOT NULL)));
ALTER TABLE "public"."ig_account_social_profile_snapshots" ADD CONSTRAINT "ig_account_social_profile_snapshots_lookup_status_check" CHECK ((lookup_status = 'found'::text));
ALTER TABLE "public"."ig_account_social_profile_snapshots" ADD CONSTRAINT "ig_account_social_profile_snapshots_posts_count_check" CHECK (((posts_count IS NULL) OR (posts_count >= 0)));
ALTER TABLE "public"."ig_account_social_profile_snapshots" ADD CONSTRAINT "ig_account_social_profile_snapshots_source_provider_check" CHECK ((source_provider = ANY (ARRAY['searchapi'::text, 'http'::text, 'device_profile_read'::text, 'legacy_follower_snapshot'::text])));
ALTER TABLE "public"."ig_account_social_profile_snapshots" ADD CONSTRAINT "ig_account_social_profile_snapshots_source_trigger_check" CHECK ((source_trigger = ANY (ARRAY['onboarding_lookup'::text, 'explicit_reanalysis'::text, 'session_end'::text, 'daily_fallback'::text, 'admin_manual_refresh'::text, 'legacy_import'::text, 'baseline_one_shot'::text])));
ALTER TABLE "public"."ig_account_social_profile_snapshots" ADD CONSTRAINT "ig_account_social_profile_snapshots_timezone_source_check" CHECK ((timezone_source = ANY (ARRAY['device_assignment'::text, 'schedule'::text, 'platform_default'::text])));
ALTER TABLE "public"."ig_account_social_profile_snapshots" ADD CONSTRAINT "ig_account_social_profile_snapshots_username_normalized_check" CHECK (((username_normalized = lower(TRIM(BOTH FROM username_normalized))) AND (username_normalized ~ '^[a-z0-9._]{1,30}$'::text)));
ALTER TABLE "public"."ig_account_follow_limit_overrides" ADD CONSTRAINT "ig_account_follow_limit_overrides_cap_present" CHECK (((follow_day_cap_override IS NOT NULL) OR (follow_session_cap_override IS NOT NULL) OR (max_follow_per_run_legacy IS NOT NULL)));
ALTER TABLE "public"."ig_account_follow_limit_overrides" ADD CONSTRAINT "ig_account_follow_limit_overrides_classification_bounded" CHECK ((classification = ANY (ARRAY['explicit'::text, 'legacy_unclassified'::text])));
ALTER TABLE "public"."ig_account_follow_limit_overrides" ADD CONSTRAINT "ig_account_follow_limit_overrides_day_positive" CHECK (((follow_day_cap_override IS NULL) OR (follow_day_cap_override > 0)));
ALTER TABLE "public"."ig_account_follow_limit_overrides" ADD CONSTRAINT "ig_account_follow_limit_overrides_run_positive" CHECK (((max_follow_per_run_legacy IS NULL) OR (max_follow_per_run_legacy > 0)));
ALTER TABLE "public"."ig_account_follow_limit_overrides" ADD CONSTRAINT "ig_account_follow_limit_overrides_session_positive" CHECK (((follow_session_cap_override IS NULL) OR (follow_session_cap_override > 0)));
ALTER TABLE "public"."ig_account_follow_limit_overrides" ADD CONSTRAINT "ig_account_follow_limit_overrides_source_bounded" CHECK ((source = ANY (ARRAY['admin'::text, 'support'::text, 'migration_confirmed'::text, 'migration_unclassified'::text])));
ALTER TABLE "public"."ig_accounts" ADD CONSTRAINT "ig_accounts_admin_lifecycle_status_check" CHECK ((admin_lifecycle_status = ANY (ARRAY['active'::text, 'paused'::text, 'cancelled'::text, 'needs_assistance'::text, 'pending_cancellation'::text])));
ALTER TABLE "public"."ig_accounts" ADD CONSTRAINT "ig_accounts_avatar_url_safe_check" CHECK (((avatar_url IS NULL) OR ((avatar_url ~* '^https?://'::text) AND (char_length(avatar_url) <= 2048) AND (lower(avatar_url) !~~ '%token%'::text) AND (lower(avatar_url) !~~ '%secret%'::text) AND (lower(avatar_url) !~~ '%signature%'::text) AND (lower(avatar_url) !~~ '%authorization%'::text) AND (lower(avatar_url) !~~ '%service_role%'::text) AND (lower(avatar_url) !~~ '%supabase_vault://%'::text))));
ALTER TABLE "public"."ig_accounts" ADD CONSTRAINT "ig_accounts_followers_count_nonnegative" CHECK (((followers_count IS NULL) OR (followers_count >= 0)));
ALTER TABLE "public"."ig_accounts" ADD CONSTRAINT "ig_accounts_public_profile_metadata_safe_check" CHECK (((jsonb_typeof(public_profile_metadata) = 'object'::text) AND (NOT jsonb_has_forbidden_safe_metadata_key(public_profile_metadata))));
ALTER TABLE "public"."ig_accounts" ADD CONSTRAINT "ig_accounts_username_verification_status_check" CHECK ((username_verification_status = ANY (ARRAY['pending'::text, 'verified'::text, 'not_found'::text, 'username_changed'::text, 'private_or_limited'::text, 'inaccessible'::text, 'verification_unavailable'::text, 'provider_error'::text, 'invalid_format'::text, 'unknown'::text])));
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_applied_discount_type_check" CHECK ((applied_discount_type = ANY (ARRAY['none'::text, 'term'::text, 'agency'::text])));
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_billing_interval_months_check" CHECK ((billing_interval_months = ANY (ARRAY[1, 3, 6, 12])));
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_commercial_mode_shape_check" CHECK ((((((metadata ->> 'commercial_mode'::text) IS NULL) OR ((metadata ->> 'commercial_mode'::text) = 'full_cycle'::text)) AND (plan_key IS NOT NULL) AND (plan_key = ANY (ARRAY['growth'::text, 'pro'::text, 'premium'::text])) AND (commercial_package_code IS NOT NULL) AND (commercial_package_code = ANY (ARRAY['growth'::text, 'pro'::text, 'premium'::text])) AND (pack_monthly_discounted_cents IS NOT NULL) AND (pack_period_total_cents IS NOT NULL)) OR (((metadata ->> 'commercial_mode'::text) = 'outreach_only'::text) AND (plan_key IS NULL) AND (commercial_package_code IS NULL) AND (outreach_addon_key IS NOT NULL) AND (outreach_addon_key = ANY (ARRAY['outreach_standard'::text, 'outreach_ai'::text])) AND (COALESCE(pack_monthly_discounted_cents, 0) = 0) AND (COALESCE(pack_period_total_cents, 0) = 0))));
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_commercial_package_code_check" CHECK ((commercial_package_code = ANY (ARRAY['growth'::text, 'pro'::text, 'premium'::text])));
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_outreach_addon_key_check" CHECK ((outreach_addon_key = ANY (ARRAY['outreach_standard'::text, 'outreach_ai'::text])));
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_outreach_variant_check" CHECK ((outreach_variant = ANY (ARRAY['client_list'::text, 'ai_list'::text])));
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_pack_monthly_discounted_cents_check" CHECK ((pack_monthly_discounted_cents >= 0));
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_pack_period_total_cents_check" CHECK ((pack_period_total_cents >= 0));
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_plan_key_check" CHECK ((plan_key = ANY (ARRAY['growth'::text, 'pro'::text, 'premium'::text])));
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_status_check" CHECK ((status = ANY (ARRAY['entitlement_reserved'::text, 'entitlement_consumed'::text, 'entitlement_cancelled'::text])));
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_total_period_cents_check" CHECK ((total_period_cents >= 0));
ALTER TABLE "public"."account_package_runtime_contract_events" ADD CONSTRAINT "account_package_runtime_contract_events_details_safe_check" CHECK (((jsonb_typeof(details_safe) = 'object'::text) AND (pg_column_size(details_safe) <= 8192)));
ALTER TABLE "public"."account_package_runtime_contract_events" ADD CONSTRAINT "account_package_runtime_contract_events_event_type_check" CHECK ((event_type = ANY (ARRAY['package_runtime_contract_blocked'::text, 'package_runtime_contract_reconciled'::text, 'retryable_pre_run_block'::text, 'scheduled_retry_created'::text, 'scheduled_retry_not_needed'::text, 'scheduled_retry_window_closed'::text, 'scheduled_retry_limit_reached'::text])));
ALTER TABLE "public"."account_package_runtime_contract_events" ADD CONSTRAINT "account_package_runtime_contract_events_idempotency_key_check" CHECK (((idempotency_key IS NULL) OR ((char_length(idempotency_key) >= 1) AND (char_length(idempotency_key) <= 240))));
ALTER TABLE "public"."ig_account_unfollow_settings" ADD CONSTRAINT "ig_account_unfollow_settings_after_days_nonnegative" CHECK ((unfollow_after_days >= 0));
ALTER TABLE "public"."ig_account_unfollow_settings" ADD CONSTRAINT "ig_account_unfollow_settings_day_limit_positive" CHECK ((unfollow_per_day_limit >= 0));
ALTER TABLE "public"."ig_account_unfollow_settings" ADD CONSTRAINT "ig_account_unfollow_settings_mode_valid" CHECK ((unfollow_mode = ANY (ARRAY['unfollow'::text, 'unfollow-non-followers'::text, 'unfollow-any'::text, 'unfollow-any-non-followers'::text, 'unfollow-any-followers'::text])));
ALTER TABLE "public"."ig_account_unfollow_settings" ADD CONSTRAINT "ig_account_unfollow_settings_runtime_cap_mode_check" CHECK ((runtime_cap_mode = ANY (ARRAY['mini_run'::text, 'prod_normal'::text, 'incident_safety'::text])));
ALTER TABLE "public"."ig_account_unfollow_settings" ADD CONSTRAINT "ig_account_unfollow_settings_runtime_safety_cap_check" CHECK (((runtime_safety_cap IS NULL) OR (runtime_safety_cap >= 0)));
ALTER TABLE "public"."ig_account_unfollow_settings" ADD CONSTRAINT "ig_account_unfollow_settings_session_limit_positive" CHECK ((unfollow_per_session_limit >= 0));
ALTER TABLE "public"."ig_account_unfollow_settings" ADD CONSTRAINT "ig_account_unfollow_settings_sort_mode_valid" CHECK ((unfollow_sort_mode = ANY (ARRAY['default'::text, 'newest-to-oldest'::text, 'oldest-to-newest'::text])));
ALTER TABLE "public"."clients" ADD CONSTRAINT "clients_name_nonempty" CHECK ((char_length(TRIM(BOTH FROM name)) > 0));
ALTER TABLE "public"."clients" ADD CONSTRAINT "clients_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'archived'::text])));
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_assignment_source_check" CHECK ((assignment_source = ANY (ARRAY['manual_dashboard'::text, 'onboarding_auto'::text, 'ops'::text, 'legacy_unknown'::text, 'auto_assign_rpc'::text])));
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_release_check" CHECK (((released_at IS NULL) OR (released_at >= assigned_at) OR (assigned_at IS NULL)));
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_schedule_mode_check" CHECK ((schedule_mode = ANY (ARRAY['scheduled'::text, 'manual_only'::text])));
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_schedule_shape_check" CHECK ((((schedule_mode = 'scheduled'::text) AND (starts_at IS NOT NULL) AND (ends_at IS NOT NULL) AND (ends_at > starts_at) AND (slot_kind <> 'manual_only'::text)) OR ((schedule_mode = 'manual_only'::text) AND (starts_at IS NULL) AND (ends_at IS NULL) AND (app_instance_id IS NOT NULL) AND (slot_kind = 'manual_only'::text))));
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_slot_kind_check" CHECK ((slot_kind = ANY (ARRAY['full_cycle_6h'::text, 'outreach_short'::text, 'outreach_40m'::text, 'manual_only'::text])));
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'reserved'::text, 'active'::text, 'paused'::text, 'failed'::text, 'released'::text, 'canceled'::text, 'expired'::text, 'archived'::text])));
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_type_check" CHECK ((assignment_type = ANY (ARRAY['full_cycle'::text, 'outreach_only'::text])));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_applied_discount_type_check" CHECK ((applied_discount_type = ANY (ARRAY['none'::text, 'term'::text, 'agency'::text])));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_billable_account_count_check" CHECK ((billable_account_count >= 1));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_billing_interval_months_check" CHECK ((billing_interval_months = ANY (ARRAY[1, 3, 6, 12])));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_commercial_mode_check" CHECK (((commercial_mode IS NULL) OR (commercial_mode = ANY (ARRAY['full_cycle'::text, 'outreach_only'::text]))));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_commercial_mode_shape_check" CHECK (((((commercial_mode IS NULL) OR (commercial_mode = 'full_cycle'::text)) AND (plan_key IS NOT NULL) AND (plan_key = ANY (ARRAY['growth'::text, 'pro'::text, 'premium'::text])) AND (pack_base_monthly_cents IS NOT NULL) AND (pack_monthly_discounted_cents IS NOT NULL) AND (pack_period_total_cents IS NOT NULL)) OR ((commercial_mode = 'outreach_only'::text) AND (plan_key IS NULL) AND (outreach_addon_key IS NOT NULL) AND (outreach_addon_key = ANY (ARRAY['outreach_standard'::text, 'outreach_ai'::text])) AND (COALESCE(pack_base_monthly_cents, 0) = 0) AND (COALESCE(pack_monthly_discounted_cents, 0) = 0) AND (COALESCE(pack_period_total_cents, 0) = 0))));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_commercial_test_mode_check" CHECK (((commercial_test_mode IS NULL) OR (commercial_test_mode = ANY (ARRAY['simulated'::text, 'stripe_test'::text]))));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_flow_type_check" CHECK ((flow_type = ANY (ARRAY['first_purchase'::text, 'additional_account'::text, 'plan_change'::text])));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_outreach_addon_key_check" CHECK ((outreach_addon_key = ANY (ARRAY['outreach_standard'::text, 'outreach_ai'::text])));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_outreach_base_monthly_cents_check" CHECK (((outreach_base_monthly_cents IS NULL) OR (outreach_base_monthly_cents >= 0)));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_pack_base_monthly_cents_check" CHECK ((pack_base_monthly_cents >= 0));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_pack_monthly_discounted_cent_check" CHECK ((pack_monthly_discounted_cents >= 0));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_pack_period_total_cents_check" CHECK ((pack_period_total_cents >= 0));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_plan_key_check" CHECK ((plan_key = ANY (ARRAY['growth'::text, 'pro'::text, 'premium'::text])));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_status_check" CHECK ((status = ANY (ARRAY['checkout_pending'::text, 'checkout_activated_test'::text, 'checkout_cancelled'::text, 'checkout_pending_payment'::text, 'checkout_paid'::text, 'checkout_expired'::text, 'checkout_failed'::text, 'checkout_refunded'::text])));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_stripe_pricing_mode_check" CHECK (((stripe_pricing_mode IS NULL) OR (stripe_pricing_mode = ANY (ARRAY['public_catalog'::text, 'immutable_snapshot'::text]))));
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_total_period_cents_check" CHECK ((total_period_cents >= 0));
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_actor_type_check" CHECK ((actor_type = ANY (ARRAY['admin'::text, 'assistant'::text, 'ops'::text, 'system'::text, 'internal'::text, 'client'::text])));
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_attempt_retry_v1_check" CHECK ((execution_attempt_no = (retry_index + 1)));
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_cancel_reason_safe" CHECK (((cancel_reason IS NULL) OR ((char_length(TRIM(BOTH FROM cancel_reason)) > 0) AND (char_length(TRIM(BOTH FROM cancel_reason)) <= 500) AND (cancel_reason !~* '(token|secret|authorization|cookie|service_role|vault|password)'::text))));
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_claimed_by_safe" CHECK (((claimed_by IS NULL) OR ((char_length(TRIM(BOTH FROM claimed_by)) > 0) AND (char_length(TRIM(BOTH FROM claimed_by)) <= 160) AND (claimed_by !~* '(token|secret|authorization|cookie|service_role|vault|password)'::text))));
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_error_code_safe" CHECK (((error_code IS NULL) OR ((char_length(TRIM(BOTH FROM error_code)) > 0) AND (char_length(TRIM(BOTH FROM error_code)) <= 120) AND (error_code !~* '(token|secret|authorization|cookie|service_role|vault|password)'::text))));
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_error_message_safe_check" CHECK (((error_message_safe IS NULL) OR ((char_length(TRIM(BOTH FROM error_message_safe)) > 0) AND (char_length(TRIM(BOTH FROM error_message_safe)) <= 500) AND (error_message_safe !~* '(token|secret|authorization|cookie|service_role|vault|password)'::text))));
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_execution_attempt_v1_check" CHECK (((execution_attempt_no >= 1) AND (execution_attempt_no <= 3)));
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_idempotency_key_nonempty" CHECK ((char_length(TRIM(BOTH FROM idempotency_key)) > 0));
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_metadata_safe_guard_check" CHECK (run_control_metadata_is_safe(metadata_safe));
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_metadata_safe_object_check" CHECK ((jsonb_typeof(metadata_safe) = 'object'::text));
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_requested_run_type_nonempty" CHECK ((char_length(TRIM(BOTH FROM requested_run_type)) > 0));
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_retry_index_v1_check" CHECK (((retry_index >= 0) AND (retry_index <= 2)));
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_source_surface_safe" CHECK (((char_length(TRIM(BOTH FROM source_surface)) > 0) AND (source_surface !~* '(token|secret|authorization|cookie|service_role|vault|password)'::text)));
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'claimed'::text, 'starting'::text, 'running'::text, 'completed'::text, 'failed'::text, 'canceled'::text, 'blocked'::text])));
ALTER TABLE "public"."ig_account_unfollow_enablement_overrides" ADD CONSTRAINT "ig_account_unfollow_enablement_overrides_source_bounded" CHECK ((source = ANY (ARRAY['admin'::text, 'support'::text, 'migration_confirmed'::text])));
ALTER TABLE "public"."commercial_account_lifecycle_states" ADD CONSTRAINT "commercial_account_lifecycle_states_state_check" CHECK ((commercial_state = ANY (ARRAY['active'::text, 'pause_requested'::text, 'paused'::text, 'resume_requested'::text, 'cancel_requested'::text, 'cancelled'::text, 'action_required'::text])));
ALTER TABLE "public"."commercial_account_lifecycle_states" ADD CONSTRAINT "commercial_account_lifecycle_states_terminal_cancel_complete_ch" CHECK ((((terminal_cancel_operation_id IS NULL) AND (terminal_cancelled_at IS NULL) AND (terminal_cancel_entitlement_id IS NULL) AND (terminal_cancel_stripe_subscription_id IS NULL)) OR ((terminal_cancel_operation_id IS NOT NULL) AND (terminal_cancelled_at IS NOT NULL) AND (terminal_cancel_entitlement_id IS NOT NULL) AND (NULLIF(btrim(terminal_cancel_stripe_subscription_id), ''::text) IS NOT NULL) AND (commercial_state = 'cancelled'::text) AND (action_required_reason IS NULL) AND (entitlement_id = terminal_cancel_entitlement_id) AND (stripe_subscription_id = terminal_cancel_stripe_subscription_id))));
ALTER TABLE "public"."ig_account_dm_settings" ADD CONSTRAINT "ig_account_dm_settings_max_welcoming_skips_positive" CHECK ((max_welcoming_skips >= 0));
ALTER TABLE "public"."ig_account_dm_settings" ADD CONSTRAINT "ig_account_dm_settings_outreach_day_limit_positive" CHECK ((outreach_per_day_limit >= 0));
ALTER TABLE "public"."ig_account_dm_settings" ADD CONSTRAINT "ig_account_dm_settings_outreach_session_limit_positive" CHECK ((outreach_per_session_limit >= 0));
ALTER TABLE "public"."ig_account_dm_settings" ADD CONSTRAINT "ig_account_dm_settings_random_delay_order" CHECK ((random_delay_max_seconds >= random_delay_min_seconds));
ALTER TABLE "public"."ig_account_dm_settings" ADD CONSTRAINT "ig_account_dm_settings_total_dm_day_limit_positive" CHECK ((total_dm_per_day_limit >= 0));
ALTER TABLE "public"."ig_account_dm_settings" ADD CONSTRAINT "ig_account_dm_settings_welcome_day_limit_positive" CHECK ((welcome_per_day_limit >= 0));
ALTER TABLE "public"."ig_account_dm_settings" ADD CONSTRAINT "ig_account_dm_settings_welcome_session_limit_positive" CHECK ((welcome_per_session_limit >= 0));
ALTER TABLE "public"."ig_interaction_events" ADD CONSTRAINT "ig_interaction_events_evidence_confidence_check" CHECK (((evidence_confidence IS NULL) OR (evidence_confidence = ANY (ARRAY['high'::text, 'medium'::text, 'best_effort'::text, 'unknown'::text])))) NOT VALID;
ALTER TABLE "public"."ig_interaction_events" ADD CONSTRAINT "ig_interaction_events_metadata_safe_object_check" CHECK (((metadata_safe IS NULL) OR (jsonb_typeof(metadata_safe) = 'object'::text))) NOT VALID;
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quote_active_commercial_period_val_check" CHECK ((active_commercial_period_value_cents >= 0));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quote_actual_stripe_amount_due_cen_check" CHECK (((actual_stripe_amount_due_cents IS NULL) OR (actual_stripe_amount_due_cents >= 0)));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quote_actual_stripe_plan_period_to_check" CHECK (((actual_stripe_plan_period_total_cents IS NULL) OR (actual_stripe_plan_period_total_cents >= 0)));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quote_actual_stripe_remaining_cred_check" CHECK (((actual_stripe_remaining_credit_cents IS NULL) OR (actual_stripe_remaining_credit_cents >= 0)));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quote_existing_customer_credit_cen_check" CHECK ((existing_customer_credit_cents >= 0));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quote_target_full_period_price_cen_check" CHECK ((target_full_period_price_cents >= 0));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_actual_stripe_source_check" CHECK (((actual_stripe_source IS NULL) OR (actual_stripe_source = ANY (ARRAY['pending_invoice_items'::text, 'finalized_invoice'::text, 'customer_balance'::text]))));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_amount_due_cents_check" CHECK ((amount_due_cents >= 0));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_available_credit_cents_check" CHECK ((available_credit_cents >= 0));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_billing_interval_months_check" CHECK ((billing_interval_months = ANY (ARRAY[1, 3, 6, 12])));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_change_scope_check" CHECK ((change_scope = ANY (ARRAY['workspace'::text, 'per_account'::text])));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_credit_applied_cents_check" CHECK ((credit_applied_cents >= 0));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_currency_check" CHECK ((currency = 'EUR'::text));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_current_unused_credit_cents_check" CHECK ((current_unused_credit_cents >= 0));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_payment_status_check" CHECK ((payment_status = ANY (ARRAY['not_required'::text, 'pending'::text, 'simulated_confirmed'::text, 'confirmed'::text, 'failed'::text])));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_remaining_credit_cents_check" CHECK ((remaining_credit_cents >= 0));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_remaining_ratio_bps_check" CHECK (((remaining_ratio_bps >= 0) AND (remaining_ratio_bps <= 10000)));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_source_plan_key_check" CHECK ((source_plan_key = ANY (ARRAY['growth'::text, 'pro'::text, 'premium'::text])));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_status_check" CHECK ((status = ANY (ARRAY['quote_pending'::text, 'quote_activated'::text, 'quote_expired'::text, 'quote_stale'::text, 'quote_cancelled'::text])));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_target_outreach_addon_key_check" CHECK (((target_outreach_addon_key IS NULL) OR (target_outreach_addon_key = ANY (ARRAY['outreach_standard'::text, 'outreach_ai'::text]))));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_target_plan_key_check" CHECK ((target_plan_key = ANY (ARRAY['growth'::text, 'pro'::text, 'premium'::text])));
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_target_remaining_cost_cents_check" CHECK ((target_remaining_cost_cents >= 0));
ALTER TABLE "public"."client_users" ADD CONSTRAINT "client_users_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'assistant'::text, 'viewer'::text])));
ALTER TABLE "public"."client_users" ADD CONSTRAINT "client_users_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])));
ALTER TABLE "public"."client_entitlements" ADD CONSTRAINT "client_entitlements_feature_code_check" CHECK ((feature_code = ANY (ARRAY['outreach'::text, 'welcome'::text, 'follow'::text, 'unfollow'::text])));
ALTER TABLE "public"."client_entitlements" ADD CONSTRAINT "client_entitlements_type_check" CHECK ((entitlement_type = ANY (ARRAY['standalone'::text, 'addon'::text, 'bundle'::text])));
ALTER TABLE "public"."client_entitlements" ADD CONSTRAINT "client_entitlements_valid_window_check" CHECK (((valid_until IS NULL) OR (valid_from IS NULL) OR (valid_until > valid_from)));
ALTER TABLE "public"."client_subscriptions" ADD CONSTRAINT "client_subscriptions_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'cancelled'::text, 'expired'::text])));
ALTER TABLE "public"."client_subscriptions" ADD CONSTRAINT "client_subscriptions_type_check" CHECK ((subscription_type = ANY (ARRAY['full_cycle'::text, 'outreach_only'::text])));
ALTER TABLE "public"."client_subscriptions" ADD CONSTRAINT "client_subscriptions_valid_window_check" CHECK (((ends_at IS NULL) OR (ends_at > starts_at)));
ALTER TABLE "public"."client_subscription_accounts" ADD CONSTRAINT "client_subscription_accounts_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'removed'::text])));
ALTER TABLE "public"."phone_clones" ADD CONSTRAINT "phone_clones_clone_index_positive" CHECK ((clone_index >= 1));
ALTER TABLE "public"."phone_clones" ADD CONSTRAINT "phone_clones_status_check" CHECK ((status = ANY (ARRAY['available'::text, 'reserved'::text, 'active'::text, 'maintenance'::text, 'disabled'::text])));
ALTER TABLE "public"."phone_devices" ADD CONSTRAINT "phone_devices_adb_serial_nonempty" CHECK (((adb_serial IS NULL) OR (char_length(TRIM(BOTH FROM adb_serial)) > 0)));
ALTER TABLE "public"."phone_devices" ADD CONSTRAINT "phone_devices_device_udid_nonempty" CHECK (((device_udid IS NULL) OR (char_length(TRIM(BOTH FROM device_udid)) > 0)));
ALTER TABLE "public"."phone_devices" ADD CONSTRAINT "phone_devices_kind_check" CHECK ((device_kind = ANY (ARRAY['emulator'::text, 'physical_phone'::text])));
ALTER TABLE "public"."phone_devices" ADD CONSTRAINT "phone_devices_max_clones_positive" CHECK ((max_clones >= 1));
ALTER TABLE "public"."phone_devices" ADD CONSTRAINT "phone_devices_name_nonempty" CHECK ((char_length(TRIM(BOTH FROM name)) > 0));
ALTER TABLE "public"."phone_devices" ADD CONSTRAINT "phone_devices_pool_type_check" CHECK ((pool_type = ANY (ARRAY['full_cycle'::text, 'outreach_only'::text, 'shared'::text])));
ALTER TABLE "public"."phone_devices" ADD CONSTRAINT "phone_devices_status_check" CHECK ((status = ANY (ARRAY['available'::text, 'reserved'::text, 'active'::text, 'maintenance'::text, 'offline'::text, 'unauthorized'::text, 'disabled'::text, 'retired'::text])));
ALTER TABLE "public"."phone_devices" ADD CONSTRAINT "phone_devices_timezone_check" CHECK ((char_length(TRIM(BOTH FROM timezone)) > 0));
ALTER TABLE "public"."phone_app_instances" ADD CONSTRAINT "phone_app_instances_business_gate_launchability_v1" CHECK (((NOT is_login_provisioning_business_gate_v1((metadata ->> 'runtime_block_reason'::text))) OR (lower(COALESCE((metadata ->> 'generation'::text), ''::text)) = 'legacy_pre_reprovision'::text) OR (NULLIF(TRIM(BOTH FROM COALESCE((metadata ->> 'replaced_by_app_instance_id'::text), ''::text)), ''::text) IS NOT NULL) OR (COALESCE(((metadata ->> 'maintenance'::text))::boolean, false) = true) OR (COALESCE(((metadata ->> 'corrupt'::text))::boolean, false) = true) OR (COALESCE(((metadata ->> 'removed'::text))::boolean, false) = true) OR (COALESCE(((metadata ->> 'version_prohibited'::text))::boolean, false) = true) OR (lower(COALESCE((metadata ->> 'technical_state'::text), 'healthy'::text)) = ANY (ARRAY['maintenance'::text, 'corrupt'::text, 'removed'::text, 'package_missing'::text, 'version_prohibited'::text])) OR ((status = ANY (ARRAY['available'::text, 'occupied'::text])) AND (is_launchable = true) AND (usable_for_auto_login = true) AND (NULLIF(TRIM(BOTH FROM COALESCE(package_name, ''::text)), ''::text) IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM COALESCE(launch_activity, ''::text)), ''::text) IS NOT NULL) AND (current_account_id IS NOT NULL))));
ALTER TABLE "public"."phone_app_instances" ADD CONSTRAINT "phone_app_instances_index_check" CHECK ((((instance_type = 'primary_app'::text) AND (instance_index = 0)) OR ((instance_type = 'clone'::text) AND (instance_index >= 1))));
ALTER TABLE "public"."phone_app_instances" ADD CONSTRAINT "phone_app_instances_metadata_object_check" CHECK ((jsonb_typeof(metadata) = 'object'::text));
ALTER TABLE "public"."phone_app_instances" ADD CONSTRAINT "phone_app_instances_status_check" CHECK ((status = ANY (ARRAY['available'::text, 'occupied'::text, 'disabled'::text, 'unknown'::text])));
ALTER TABLE "public"."phone_app_instances" ADD CONSTRAINT "phone_app_instances_type_check" CHECK ((instance_type = ANY (ARRAY['primary_app'::text, 'clone'::text])));
ALTER TABLE "public"."phone_app_instances" ADD CONSTRAINT "phone_app_instances_visible_label_nonempty" CHECK ((char_length(TRIM(BOTH FROM visible_label)) > 0));
ALTER TABLE "public"."runtime_events" ADD CONSTRAINT "runtime_events_event_type_nonempty" CHECK ((char_length(TRIM(BOTH FROM event_type)) > 0));
ALTER TABLE "public"."runtime_events" ADD CONSTRAINT "runtime_events_metadata_object_check" CHECK ((jsonb_typeof(metadata) = 'object'::text));
ALTER TABLE "public"."runtime_events" ADD CONSTRAINT "runtime_events_severity_check" CHECK ((severity = ANY (ARRAY['debug'::text, 'info'::text, 'warning'::text, 'error'::text, 'critical'::text])));
ALTER TABLE "public"."runtime_events" ADD CONSTRAINT "runtime_events_visibility_check" CHECK ((visibility = ANY (ARRAY['admin_only'::text, 'assistant_safe'::text, 'client_safe'::text])));
ALTER TABLE "public"."commercial_account_lifecycle_operations" ADD CONSTRAINT "commercial_account_lifecycle_operations_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'failed'::text])));
ALTER TABLE "public"."commercial_account_lifecycle_operations" ADD CONSTRAINT "commercial_account_lifecycle_operations_type_check" CHECK ((operation_type = ANY (ARRAY['pause'::text, 'resume'::text, 'cancel'::text])));
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "cia_login_identity_lineage_object_check" CHECK ((jsonb_typeof(login_identity_login_lineage) = 'object'::text));
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "cia_login_identity_source_check" CHECK (((login_identity_verification_source IS NULL) OR (login_identity_verification_source = ANY (ARRAY['worker'::text, 'operator'::text]))));
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_capacity_metadata_check" CHECK ((((capacity_status = 'occupied'::text) AND (capacity_released_at IS NULL) AND (capacity_release_reason IS NULL) AND (capacity_release_operation_id IS NULL)) OR ((capacity_status = 'released_terminal'::text) AND (capacity_released_at IS NOT NULL) AND (NULLIF(btrim(capacity_release_reason), ''::text) IS NOT NULL) AND (capacity_release_operation_id IS NOT NULL))));
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_capacity_status_check" CHECK ((capacity_status = ANY (ARRAY['occupied'::text, 'released_terminal'::text])));
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_login_identity_proof_status_check" CHECK ((login_identity_proof_status = ANY (ARRAY['required_unverified'::text, 'historical_model_missing'::text, 'verified'::text, 'failed'::text, 'proven_false_ready'::text])));
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_login_identity_proof_version_check" CHECK ((login_identity_proof_version >= 1));
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_login_state_invalidation_reason_check" CHECK (((login_state_invalidation_reason IS NULL) OR (login_state_invalidation_reason = ANY (ARRAY['explicit_logout'::text, 'identity_mismatch'::text, 'auth_session_invalidated'::text, 'instagram_login_screen_confirmed'::text, 'credential_invalidation'::text, 'account_disabled'::text, 'security_challenge_requires_login'::text, 'other_explicit_canonical_invalidation'::text]))));
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_login_state_version_check" CHECK ((login_state_version >= 1));
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_login_status_check" CHECK ((login_status = ANY (ARRAY['unknown'::text, 'pending'::text, 'connected'::text, 'needs_2fa'::text, 'checkpoint'::text, 'failed'::text, 'mismatch'::text, 'logged_out'::text, 'verification_pending'::text])));
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_onboarding_status_check" CHECK ((onboarding_status = ANY (ARRAY['pending'::text, 'incomplete'::text, 'credentials_required'::text, 'configured'::text, 'credentials_submitted'::text, 'verification_pending'::text, 'ready'::text, 'blocked'::text, 'support_required'::text])));
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_provisioning_status_check" CHECK ((provisioning_status = ANY (ARRAY['not_started'::text, 'pending'::text, 'provisioning'::text, 'assigned'::text, 'login_pending'::text, 'login_verification_pending'::text, 'ready'::text, 'failed'::text, 'blocked'::text, 'paused'::text])));
ALTER TABLE "auth"."users" ADD CONSTRAINT "users_email_change_confirm_status_check" CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)));
ALTER TABLE "public"."ig_dm_templates" ADD CONSTRAINT "ig_dm_templates_body_nonempty" CHECK ((char_length(TRIM(BOTH FROM body)) > 0));
ALTER TABLE "public"."ig_dm_templates" ADD CONSTRAINT "ig_dm_templates_name_nonempty" CHECK ((char_length(TRIM(BOTH FROM name)) > 0));
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_actor_type_ct1_check" CHECK (((actor_type IS NULL) OR (actor_type = ANY (ARRAY['admin'::text, 'client'::text, 'system'::text])))) NOT VALID;
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_avatar_url_ct1_safe_check" CHECK (((avatar_url IS NULL) OR ((avatar_url ~* '^https?://'::text) AND (char_length(avatar_url) <= 2048) AND (lower(avatar_url) !~~ '%token%'::text) AND (lower(avatar_url) !~~ '%secret%'::text) AND (lower(avatar_url) !~~ '%signature%'::text) AND (lower(avatar_url) !~~ '%authorization%'::text) AND (lower(avatar_url) !~~ '%service_role%'::text) AND (lower(avatar_url) !~~ '%supabase_vault://%'::text)))) NOT VALID;
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_exhaustion_reason_p1c_check" CHECK (((exhaustion_reason IS NULL) OR (char_length(exhaustion_reason) <= 500))) NOT VALID;
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_followback_ratio_p1c_check" CHECK (((followback_ratio IS NULL) OR (followback_ratio >= (0)::numeric))) NOT VALID;
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_followbacks_count_p1c_check" CHECK ((followbacks_count >= 0)) NOT VALID;
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_followers_count_ct1_check" CHECK (((followers_count IS NULL) OR (followers_count >= 0))) NOT VALID;
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_follows_sent_count_p1c_check" CHECK ((follows_sent_count >= 0)) NOT VALID;
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_metadata_safe_ct1_check" CHECK (((jsonb_typeof(metadata_safe) = 'object'::text) AND (NOT jsonb_has_forbidden_safe_metadata_key(metadata_safe)))) NOT VALID;
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_normalized_username_ct1_check" CHECK (((normalized_username IS NULL) OR ((normalized_username ~ '^[a-z0-9._]{1,30}$'::text) AND (normalized_username !~~ '%.'::text) AND (normalized_username !~~ '.%'::text) AND (normalized_username !~~ '%..%'::text)))) NOT VALID;
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_quality_status_ct1_check" CHECK ((quality_status = ANY (ARRAY['unknown'::text, 'eligible'::text, 'rejected_low_followers'::text, 'rejected_verified'::text, 'rejected_private'::text, 'rejected_not_found'::text, 'review_provider_unavailable'::text, 'review_username_changed'::text]))) NOT VALID;
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_status_ct1_check" CHECK ((status = ANY (ARRAY['pending_verification'::text, 'valid'::text, 'rejected'::text, 'review'::text, 'duplicate'::text, 'archived'::text, 'pending'::text, 'completed'::text, 'failed'::text, 'skipped'::text, 'active'::text, 'paused'::text, 'filtered'::text, 'deleted'::text, 'poor_performance'::text]))) NOT VALID;
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_verification_status_ct1_check" CHECK ((verification_status = ANY (ARRAY['pending'::text, 'found'::text, 'not_found'::text, 'unavailable'::text, 'rate_limited'::text, 'provider_error'::text]))) NOT VALID;
ALTER TABLE "public"."client_subscription_modules" ADD CONSTRAINT "client_subscription_modules_entitlement_type_check" CHECK ((entitlement_type = ANY (ARRAY['included'::text, 'addon'::text])));
ALTER TABLE "public"."client_subscription_modules" ADD CONSTRAINT "client_subscription_modules_feature_code_check" CHECK ((feature_code = ANY (ARRAY['welcome'::text, 'follow'::text, 'unfollow'::text, 'outreach'::text])));
ALTER TABLE "public"."account_follow_source_settings" ADD CONSTRAINT "account_follow_source_settings_max_follows_per_target_per_run_c" CHECK (((max_follows_per_target_per_run >= 1) AND (max_follows_per_target_per_run <= 50)));
ALTER TABLE "public"."account_follow_source_settings" ADD CONSTRAINT "account_follow_source_settings_max_targets_per_run_check" CHECK (((max_targets_per_run >= 1) AND (max_targets_per_run <= 10)));
ALTER TABLE "public"."account_follow_source_settings" ADD CONSTRAINT "account_follow_source_settings_metadata_object_check" CHECK ((jsonb_typeof(metadata) = 'object'::text));
ALTER TABLE "public"."account_dashboard_actions" ADD CONSTRAINT "account_dashboard_actions_action_type_nonempty" CHECK ((char_length(TRIM(BOTH FROM action_type)) > 0));
ALTER TABLE "public"."account_dashboard_actions" ADD CONSTRAINT "account_dashboard_actions_audience_check" CHECK ((audience = ANY (ARRAY['client'::text, 'admin'::text, 'assistant'::text, 'ops'::text])));
ALTER TABLE "public"."account_dashboard_actions" ADD CONSTRAINT "account_dashboard_actions_created_actor_type_check" CHECK (((created_by_actor_type IS NULL) OR (created_by_actor_type = ANY (ARRAY['admin'::text, 'client'::text, 'system'::text, 'migration'::text, 'backend'::text]))));
ALTER TABLE "public"."account_dashboard_actions" ADD CONSTRAINT "account_dashboard_actions_dedupe_key_nonempty" CHECK ((char_length(TRIM(BOTH FROM dedupe_key)) > 0));
ALTER TABLE "public"."account_dashboard_actions" ADD CONSTRAINT "account_dashboard_actions_metadata_object_check" CHECK ((jsonb_typeof(metadata) = 'object'::text));
ALTER TABLE "public"."account_dashboard_actions" ADD CONSTRAINT "account_dashboard_actions_metadata_safe_check" CHECK (((jsonb_typeof(metadata_safe) = 'object'::text) AND (NOT jsonb_has_forbidden_safe_metadata_key(metadata_safe))));
ALTER TABLE "public"."account_dashboard_actions" ADD CONSTRAINT "account_dashboard_actions_severity_check" CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text, 'critical'::text])));
ALTER TABLE "public"."account_dashboard_actions" ADD CONSTRAINT "account_dashboard_actions_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'acknowledged'::text, 'pending_verification'::text, 'code_submitted'::text, 'resolved'::text, 'dismissed'::text, 'ignored'::text])));
ALTER TABLE "public"."account_dashboard_actions" ADD CONSTRAINT "account_dashboard_actions_title_nonempty" CHECK ((char_length(TRIM(BOTH FROM title)) > 0));
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_s_max_follows_per_target_per_r_check" CHECK (((max_follows_per_target_per_run >= 1) AND (max_follows_per_target_per_run <= 50)));
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_set_outreach_per_session_limit_check" CHECK ((outreach_per_session_limit >= 0));
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_sett_welcome_per_session_limit_check" CHECK ((welcome_per_session_limit >= 0));
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_settings_check" CHECK ((likes_per_follow_max >= likes_per_follow_min));
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_settings_likes_per_day_limit_check" CHECK ((likes_per_day_limit >= 0));
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_settings_likes_per_follow_min_check" CHECK ((likes_per_follow_min >= 0));
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_settings_max_targets_per_run_check" CHECK (((max_targets_per_run >= 1) AND (max_targets_per_run <= 10)));
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_settings_runtime_profile_check" CHECK ((runtime_profile = ANY (ARRAY['full_cycle'::text, 'outreach_only'::text])));
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_settings_schedule_mode_check" CHECK ((schedule_mode = ANY (ARRAY['scheduled'::text, 'manual_only'::text])));
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_settings_slot_kind_check" CHECK ((slot_kind = ANY (ARRAY['full_cycle_6h'::text, 'outreach_short'::text, 'outreach_40m'::text, 'manual_only'::text])));
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_settings_unfollow_after_days_check" CHECK ((unfollow_after_days >= 0));
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_settings_warmup_day_1_cap_check" CHECK ((warmup_day_1_cap > 0));
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_settings_warmup_day_2_cap_check" CHECK ((warmup_day_2_cap > 0));
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_settings_warmup_day_3_cap_check" CHECK ((warmup_day_3_cap > 0));
ALTER TABLE "public"."ig_runs" ADD CONSTRAINT "ig_runs_live_counter_revision_nonnegative" CHECK ((live_counter_revision >= 0));
ALTER TABLE "public"."incident_resume_authorizations" ADD CONSTRAINT "incident_resume_authorizations_expected_worker_sha_check" CHECK (((expected_worker_sha IS NULL) OR (expected_worker_sha ~ '^[0-9a-f]{40}$'::text)));
ALTER TABLE "public"."incident_resume_authorizations" ADD CONSTRAINT "incident_resume_authorizations_status_check" CHECK ((status = ANY (ARRAY['armed'::text, 'consumed'::text, 'expired'::text, 'revoked'::text])));
ALTER TABLE "public"."ig_account_unfollow_limit_overrides" ADD CONSTRAINT "ig_account_unfollow_limit_overrides_cap_present" CHECK (((unfollow_day_cap_override IS NOT NULL) OR (unfollow_session_cap_override IS NOT NULL)));
ALTER TABLE "public"."ig_account_unfollow_limit_overrides" ADD CONSTRAINT "ig_account_unfollow_limit_overrides_classification_bounded" CHECK ((classification = ANY (ARRAY['explicit'::text, 'legacy_unclassified'::text])));
ALTER TABLE "public"."ig_account_unfollow_limit_overrides" ADD CONSTRAINT "ig_account_unfollow_limit_overrides_day_positive" CHECK (((unfollow_day_cap_override IS NULL) OR (unfollow_day_cap_override > 0)));
ALTER TABLE "public"."ig_account_unfollow_limit_overrides" ADD CONSTRAINT "ig_account_unfollow_limit_overrides_session_positive" CHECK (((unfollow_session_cap_override IS NULL) OR (unfollow_session_cap_override > 0)));
ALTER TABLE "public"."ig_account_unfollow_limit_overrides" ADD CONSTRAINT "ig_account_unfollow_limit_overrides_source_bounded" CHECK ((source = ANY (ARRAY['admin'::text, 'support'::text, 'migration_confirmed'::text, 'migration_unclassified'::text])));
ALTER TABLE "public"."phonefarm_runtime_barriers" ADD CONSTRAINT "phonefarm_runtime_barriers_metadata_object" CHECK ((jsonb_typeof(metadata_safe) = 'object'::text));
ALTER TABLE "public"."phonefarm_runtime_barriers" ADD CONSTRAINT "phonefarm_runtime_barriers_owner_safe" CHECK (((owner_token IS NULL) OR (owner_token ~ '^[A-Za-z0-9._:-]{8,160}$'::text)));
ALTER TABLE "public"."phonefarm_runtime_barriers" ADD CONSTRAINT "phonefarm_runtime_barriers_release_reason_safe" CHECK (((release_reason IS NULL) OR (((char_length(release_reason) >= 1) AND (char_length(release_reason) <= 160)) AND (release_reason !~* '(token|secret|authorization|cookie|service_role|vault|password)'::text))));
ALTER TABLE "public"."account_session_resume_plans" ADD CONSTRAINT "account_session_resume_plans_irreversible_state_v1_check" CHECK (((irreversible_work_state IS NULL) OR (irreversible_work_state = ANY (ARRAY['PRE_DEVICE'::text, 'STARTED_OR_AMBIGUOUS'::text]))));
ALTER TABLE "public"."account_session_resume_plans" ADD CONSTRAINT "account_session_resume_plans_resume_stage_check" CHECK ((resume_stage = ANY (ARRAY['preflight'::text, 'phases'::text, 'completed'::text])));
ALTER TABLE "public"."account_session_resume_plans" ADD CONSTRAINT "account_session_resume_plans_resume_state_check" CHECK ((resume_state = ANY (ARRAY['run_active'::text, 'pre_device_stopped'::text, 'recovery_enqueued'::text, 'awaiting_human_resume_authorization'::text, 'resume_requested'::text, 'resume_succeeded'::text, 'not_recoverable'::text, 'completed'::text])));
ALTER TABLE "public"."account_session_resume_plans" ADD CONSTRAINT "account_session_resume_plans_startup_order_v1_check" CHECK ((((runner_started_at IS NULL) OR (worker_spawned_at IS NULL) OR (runner_started_at >= worker_spawned_at)) AND ((device_activity_started_at IS NULL) OR (runner_started_at IS NULL) OR (device_activity_started_at >= runner_started_at)) AND ((device_connected_at IS NULL) OR (device_activity_started_at IS NULL) OR (device_connected_at >= device_activity_started_at)) AND ((instagram_launch_requested_at IS NULL) OR (device_connected_at IS NULL) OR (instagram_launch_requested_at >= device_connected_at)) AND ((instagram_foreground_verified_at IS NULL) OR (device_connected_at IS NULL) OR (instagram_foreground_verified_at >= device_connected_at))));
ALTER TABLE "public"."account_session_resume_plans" ADD CONSTRAINT "account_session_resume_plans_zero_work_shape_v1_check" CHECK ((((zero_work_contract_version IS NULL) AND (irreversible_work_state IS NULL)) OR ((zero_work_contract_version = 1) AND (irreversible_work_state IS NOT NULL))));
ALTER TABLE "public"."account_session_resume_plans" ADD CONSTRAINT "account_session_resume_plans_zero_work_version_v1_check" CHECK (((zero_work_contract_version IS NULL) OR (zero_work_contract_version = 1)));
ALTER TABLE "public"."ig_interacted_users" ADD CONSTRAINT "ig_interacted_users_evidence_confidence_check" CHECK (((evidence_confidence IS NULL) OR (evidence_confidence = ANY (ARRAY['high'::text, 'medium'::text, 'best_effort'::text, 'unknown'::text])))) NOT VALID;
ALTER TABLE "public"."ig_interacted_users" ADD CONSTRAINT "ig_interacted_users_metadata_safe_object_check" CHECK (((metadata_safe IS NULL) OR (jsonb_typeof(metadata_safe) = 'object'::text))) NOT VALID;
ALTER TABLE "public"."account_incidents" ADD CONSTRAINT "account_incidents_dedupe_key_nonempty" CHECK ((char_length(TRIM(BOTH FROM dedupe_key)) > 0));
ALTER TABLE "public"."account_incidents" ADD CONSTRAINT "account_incidents_incident_type_nonempty" CHECK ((char_length(TRIM(BOTH FROM incident_type)) > 0));
ALTER TABLE "public"."account_incidents" ADD CONSTRAINT "account_incidents_metadata_object_check" CHECK ((jsonb_typeof(metadata) = 'object'::text));
ALTER TABLE "public"."account_incidents" ADD CONSTRAINT "account_incidents_occurrence_count_positive" CHECK ((occurrence_count >= 1));
ALTER TABLE "public"."account_incidents" ADD CONSTRAINT "account_incidents_retention_class_check" CHECK ((retention_class = ANY (ARRAY['normal'::text, 'critical'::text, 'technical_nonblocking'::text, 'legal_audit'::text])));
ALTER TABLE "public"."account_incidents" ADD CONSTRAINT "account_incidents_severity_check" CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text, 'critical'::text])));
ALTER TABLE "public"."account_incidents" ADD CONSTRAINT "account_incidents_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'resolved'::text, 'ignored'::text])));
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_actor_type_check" CHECK (((updated_by_actor_type IS NULL) OR (updated_by_actor_type = ANY (ARRAY['admin'::text, 'client'::text, 'system'::text, 'migration'::text, 'backend'::text]))));
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_credentials_version_positive" CHECK ((credentials_version >= 1));
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_metadata_object_check" CHECK ((jsonb_typeof(metadata) = 'object'::text));
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_metadata_safe_check" CHECK (((jsonb_typeof(metadata_safe) = 'object'::text) AND (NOT jsonb_has_forbidden_safe_metadata_key(metadata_safe))));
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_provider_check" CHECK ((provider = 'instagram'::text));
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_reauth_reason_nonempty" CHECK (((reauth_reason IS NULL) OR (char_length(TRIM(BOTH FROM reauth_reason)) > 0)));
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_secret_provider_nonempty" CHECK ((char_length(TRIM(BOTH FROM secret_provider)) > 0));
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_secret_ref_nonempty" CHECK ((char_length(TRIM(BOTH FROM secret_ref)) > 0));
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_source_check" CHECK (((source IS NULL) OR (source = ANY (ARRAY['add_profile'::text, 'secure_update_link'::text, 'admin_backend'::text, 'migration'::text, 'unknown'::text]))));
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'superseded'::text, 'revoked'::text, 'missing'::text, 'configured'::text, 'reauth_required'::text, 'update_needed'::text, 'unknown'::text])));
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_submitted_via_check" CHECK (((submitted_via IS NULL) OR (submitted_via = ANY (ARRAY['client_dashboard'::text, 'admin_dashboard'::text, 'api'::text, 'system'::text, 'migration'::text, 'add_profile'::text, 'secure_update_link'::text, 'admin_backend'::text, 'unknown'::text]))));
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_username_nonempty" CHECK (((username_at_submission IS NULL) OR (char_length(TRIM(BOTH FROM username_at_submission)) > 0)));
ALTER TABLE "public"."commercial_stripe_subscriptions" ADD CONSTRAINT "commercial_stripe_subscriptions_commercial_mode_check" CHECK (((commercial_mode IS NULL) OR (commercial_mode = ANY (ARRAY['full_cycle'::text, 'outreach_only'::text]))));
ALTER TABLE "public"."commercial_stripe_subscriptions" ADD CONSTRAINT "commercial_stripe_subscriptions_pricing_mode_check" CHECK (((pricing_mode IS NULL) OR (pricing_mode = ANY (ARRAY['public_catalog'::text, 'immutable_snapshot'::text]))));
ALTER TABLE "public"."instagram_account_restriction_holds" ADD CONSTRAINT "instagram_account_restriction_holds_occurrence_count_check" CHECK ((occurrence_count > 0));
ALTER TABLE "public"."instagram_account_restriction_holds" ADD CONSTRAINT "instagram_account_restriction_holds_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'verification_required'::text, 'cleared'::text, 'superseded'::text])));
ALTER TABLE "public"."account_session_transitions" ADD CONSTRAINT "account_session_transitions_transition_context_check" CHECK ((transition_context = 'business_deadline'::text));
ALTER TABLE "public"."account_session_transitions" ADD CONSTRAINT "account_session_transitions_transition_state_check" CHECK ((transition_state = ANY (ARRAY['initiated'::text, 'no_work'::text, 'blocked'::text, 'partial'::text, 'completed'::text])));
ALTER TABLE "public"."account_session_transitions" ADD CONSTRAINT "account_session_transitions_transition_type_check" CHECK ((transition_type = 'follow_to_unfollow'::text));
ALTER TABLE "public"."notification_business_events" ADD CONSTRAINT "notification_business_events_business_payload_check" CHECK ((jsonb_typeof(business_payload) = 'object'::text));
ALTER TABLE "public"."notification_business_events" ADD CONSTRAINT "notification_business_events_category_check" CHECK ((category = ANY (ARRAY['incident'::text, 'new_client'::text, 'plan_change'::text, 'auto_login'::text, 'ct_lifecycle'::text])));
ALTER TABLE "public"."notification_business_events" ADD CONSTRAINT "notification_business_events_environment_check" CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text])));
ALTER TABLE "public"."notification_business_events" ADD CONSTRAINT "notification_business_events_event_type_check" CHECK ((length(TRIM(BOTH FROM event_type)) > 0));
ALTER TABLE "public"."notification_business_events" ADD CONSTRAINT "notification_business_events_idempotency_key_check" CHECK ((length(TRIM(BOTH FROM idempotency_key)) > 0));
ALTER TABLE "public"."notification_business_events" ADD CONSTRAINT "notification_business_events_technical_diagnostics_check" CHECK ((jsonb_typeof(technical_diagnostics) = 'object'::text));
ALTER TABLE "public"."incident_retention_policies" ADD CONSTRAINT "incident_retention_policies_cleanup_batch_size_check" CHECK (((cleanup_batch_size >= 1) AND (cleanup_batch_size <= 1000)));
ALTER TABLE "public"."incident_retention_policies" ADD CONSTRAINT "incident_retention_policies_critical_resolved_days_check" CHECK (((critical_resolved_days >= 1) AND (critical_resolved_days <= 3650)));
ALTER TABLE "public"."incident_retention_policies" ADD CONSTRAINT "incident_retention_policies_delivery_log_days_check" CHECK (((delivery_log_days >= 1) AND (delivery_log_days <= 3650)));
ALTER TABLE "public"."incident_retention_policies" ADD CONSTRAINT "incident_retention_policies_normal_resolved_days_check" CHECK (((normal_resolved_days >= 1) AND (normal_resolved_days <= 3650)));
ALTER TABLE "public"."incident_retention_policies" ADD CONSTRAINT "incident_retention_policies_physical_delete_grace_days_check" CHECK (((physical_delete_grace_days >= 1) AND (physical_delete_grace_days <= 3650)));
ALTER TABLE "public"."incident_retention_policies" ADD CONSTRAINT "incident_retention_policies_technical_nonblocking_days_check" CHECK (((technical_nonblocking_days >= 1) AND (technical_nonblocking_days <= 3650)));
ALTER TABLE "public"."notification_destination_settings" ADD CONSTRAINT "notification_destination_cipher_contract" CHECK ((((webhook_ciphertext IS NULL) AND (webhook_key_version IS NULL)) OR ((webhook_ciphertext IS NOT NULL) AND (webhook_key_version IS NOT NULL))));
ALTER TABLE "public"."notification_destination_settings" ADD CONSTRAINT "notification_destination_settings_category_check" CHECK ((category = ANY (ARRAY['incident'::text, 'new_client'::text, 'plan_change'::text, 'auto_login'::text, 'ct_lifecycle'::text])));
ALTER TABLE "public"."notification_destination_settings" ADD CONSTRAINT "notification_destination_settings_channel_check" CHECK ((channel = ANY (ARRAY['slack'::text, 'discord'::text])));
ALTER TABLE "public"."notification_destination_settings" ADD CONSTRAINT "notification_destination_settings_environment_check" CHECK ((environment = ANY (ARRAY['test'::text, 'live'::text])));
ALTER TABLE "public"."notification_destination_settings" ADD CONSTRAINT "notification_destination_settings_retry_state_check" CHECK ((jsonb_typeof(retry_state) = 'object'::text));
ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_attempt_count_check" CHECK (((attempt_count >= 0) AND (attempt_count <= 4)));
ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'retry'::text, 'sent'::text, 'skipped'::text, 'dead_letter'::text])));
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_device_open_no_overlap" EXCLUDE USING gist (device_id WITH =, tstzrange(starts_at, ends_at, '[)'::text) WITH &&) WHERE (((schedule_mode = 'scheduled'::text) AND (status = ANY (ARRAY['pending'::text, 'reserved'::text, 'active'::text]))));
ALTER TABLE "public"."account_warmup_settings" ADD CONSTRAINT "account_warmup_settings_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."account_commercial_packages" ADD CONSTRAINT "account_commercial_packages_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."account_commercial_packages" ADD CONSTRAINT "account_commercial_packages_package_code_fkey" FOREIGN KEY (package_code) REFERENCES commercial_packages(code);
ALTER TABLE "public"."ig_account_social_profile_snapshots" ADD CONSTRAINT "ig_account_social_profile_snapshots_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."ig_account_follow_limit_overrides" ADD CONSTRAINT "ig_account_follow_limit_overrides_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."ig_accounts" ADD CONSTRAINT "ig_accounts_device_id_fkey" FOREIGN KEY (device_id) REFERENCES ig_devices(id);
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE SET NULL;
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_checkout_session_id_fkey" FOREIGN KEY (checkout_session_id) REFERENCES commercial_checkout_sessions(id) ON DELETE RESTRICT;
ALTER TABLE "public"."client_account_entitlements" ADD CONSTRAINT "client_account_entitlements_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE "public"."account_package_runtime_contract_events" ADD CONSTRAINT "account_package_runtime_contract_events_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE SET NULL;
ALTER TABLE "public"."account_package_runtime_contract_events" ADD CONSTRAINT "account_package_runtime_contract_events_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES account_assignments(id) ON DELETE SET NULL;
ALTER TABLE "public"."account_package_runtime_contract_events" ADD CONSTRAINT "account_package_runtime_contract_events_request_id_fkey" FOREIGN KEY (request_id) REFERENCES account_run_requests(id) ON DELETE SET NULL;
ALTER TABLE "public"."ig_account_unfollow_settings" ADD CONSTRAINT "ig_account_unfollow_settings_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE RESTRICT;
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_app_instance_id_fkey" FOREIGN KEY (app_instance_id) REFERENCES phone_app_instances(id) ON DELETE RESTRICT;
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_clone_id_fkey" FOREIGN KEY (clone_id) REFERENCES phone_clones(id) ON DELETE RESTRICT;
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_device_id_fkey" FOREIGN KEY (device_id) REFERENCES phone_devices(id) ON DELETE RESTRICT;
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_subscription_account_id_fkey" FOREIGN KEY (subscription_account_id) REFERENCES client_subscription_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."account_assignments" ADD CONSTRAINT "account_assignments_subscription_id_fkey" FOREIGN KEY (subscription_id) REFERENCES client_subscriptions(id) ON DELETE CASCADE;
ALTER TABLE "public"."commercial_checkout_sessions" ADD CONSTRAINT "commercial_checkout_sessions_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE "public"."account_run_requests" ADD CONSTRAINT "account_run_requests_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."ig_account_settings" ADD CONSTRAINT "ig_account_settings_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."ig_account_unfollow_enablement_overrides" ADD CONSTRAINT "ig_account_unfollow_enablement_overrides_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."commercial_account_lifecycle_states" ADD CONSTRAINT "commercial_account_lifecycle__terminal_cancel_entitlement__fkey" FOREIGN KEY (terminal_cancel_entitlement_id) REFERENCES client_account_entitlements(id) ON DELETE RESTRICT;
ALTER TABLE "public"."commercial_account_lifecycle_states" ADD CONSTRAINT "commercial_account_lifecycle__terminal_cancel_operation_id_fkey" FOREIGN KEY (terminal_cancel_operation_id) REFERENCES commercial_account_lifecycle_operations(id) ON DELETE RESTRICT;
ALTER TABLE "public"."commercial_account_lifecycle_states" ADD CONSTRAINT "commercial_account_lifecycle_states_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."commercial_account_lifecycle_states" ADD CONSTRAINT "commercial_account_lifecycle_states_entitlement_id_fkey" FOREIGN KEY (entitlement_id) REFERENCES client_account_entitlements(id) ON DELETE SET NULL;
ALTER TABLE "public"."ig_account_dm_settings" ADD CONSTRAINT "ig_account_dm_settings_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."ig_account_dm_settings" ADD CONSTRAINT "ig_account_dm_settings_baseline_scan_run_id_fkey" FOREIGN KEY (welcome_baseline_scan_run_id) REFERENCES ig_runs(id) ON DELETE SET NULL;
ALTER TABLE "public"."ig_account_dm_settings" ADD CONSTRAINT "ig_account_dm_settings_default_outreach_template_id_fkey" FOREIGN KEY (default_outreach_template_id) REFERENCES ig_dm_templates(id) ON DELETE SET NULL;
ALTER TABLE "public"."ig_account_dm_settings" ADD CONSTRAINT "ig_account_dm_settings_welcome_template_id_fkey" FOREIGN KEY (welcome_template_id) REFERENCES ig_dm_templates(id) ON DELETE SET NULL;
ALTER TABLE "public"."ig_interaction_events" ADD CONSTRAINT "ig_interaction_events_ct_id_fkey" FOREIGN KEY (ct_id) REFERENCES ig_targets(id) ON DELETE SET NULL;
ALTER TABLE "public"."ig_interaction_events" ADD CONSTRAINT "ig_interaction_events_device_id_fkey" FOREIGN KEY (device_id) REFERENCES phone_devices(id) ON DELETE SET NULL;
ALTER TABLE "public"."ig_interaction_events" ADD CONSTRAINT "ig_interaction_events_request_id_fkey" FOREIGN KEY (request_id) REFERENCES account_run_requests(id) ON DELETE SET NULL;
ALTER TABLE "public"."ig_interaction_events" ADD CONSTRAINT "ig_interaction_events_source_target_id_fkey" FOREIGN KEY (source_target_id) REFERENCES ig_targets(id) ON DELETE SET NULL;
ALTER TABLE "public"."ig_interaction_events" ADD CONSTRAINT "ig_interaction_events_target_id_fkey" FOREIGN KEY (target_id) REFERENCES ig_targets(id) ON DELETE SET NULL;
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE RESTRICT;
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_activated_checkout_session_i_fkey" FOREIGN KEY (activated_checkout_session_id) REFERENCES commercial_checkout_sessions(id) ON DELETE SET NULL;
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_source_checkout_session_id_fkey" FOREIGN KEY (source_checkout_session_id) REFERENCES commercial_checkout_sessions(id) ON DELETE RESTRICT;
ALTER TABLE "public"."commercial_plan_change_quotes" ADD CONSTRAINT "commercial_plan_change_quotes_source_entitlement_id_fkey" FOREIGN KEY (source_entitlement_id) REFERENCES client_account_entitlements(id) ON DELETE RESTRICT;
ALTER TABLE "public"."client_users" ADD CONSTRAINT "client_users_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."client_users" ADD CONSTRAINT "client_users_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE "public"."client_entitlements" ADD CONSTRAINT "client_entitlements_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."client_entitlements" ADD CONSTRAINT "client_entitlements_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE "public"."client_entitlements" ADD CONSTRAINT "client_entitlements_source_subscription_account_id_fkey" FOREIGN KEY (source_subscription_account_id) REFERENCES client_subscription_accounts(id) ON DELETE SET NULL;
ALTER TABLE "public"."client_entitlements" ADD CONSTRAINT "client_entitlements_source_subscription_id_fkey" FOREIGN KEY (source_subscription_id) REFERENCES client_subscriptions(id) ON DELETE SET NULL;
ALTER TABLE "public"."client_entitlements" ADD CONSTRAINT "client_entitlements_source_subscription_module_id_fkey" FOREIGN KEY (source_subscription_module_id) REFERENCES client_subscription_modules(id) ON DELETE SET NULL;
ALTER TABLE "public"."client_subscriptions" ADD CONSTRAINT "client_subscriptions_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE "public"."client_subscription_accounts" ADD CONSTRAINT "client_subscription_accounts_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE RESTRICT;
ALTER TABLE "public"."client_subscription_accounts" ADD CONSTRAINT "client_subscription_accounts_client_instagram_account_id_fkey" FOREIGN KEY (client_instagram_account_id) REFERENCES client_instagram_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."client_subscription_accounts" ADD CONSTRAINT "client_subscription_accounts_subscription_id_fkey" FOREIGN KEY (subscription_id) REFERENCES client_subscriptions(id) ON DELETE CASCADE;
ALTER TABLE "public"."phone_clones" ADD CONSTRAINT "phone_clones_current_account_id_fkey" FOREIGN KEY (current_account_id) REFERENCES ig_accounts(id) ON DELETE SET NULL;
ALTER TABLE "public"."phone_clones" ADD CONSTRAINT "phone_clones_device_id_fkey" FOREIGN KEY (device_id) REFERENCES phone_devices(id) ON DELETE CASCADE;
ALTER TABLE "public"."phone_app_instances" ADD CONSTRAINT "phone_app_instances_current_account_id_fkey" FOREIGN KEY (current_account_id) REFERENCES ig_accounts(id) ON DELETE SET NULL;
ALTER TABLE "public"."phone_app_instances" ADD CONSTRAINT "phone_app_instances_device_id_fkey" FOREIGN KEY (device_id) REFERENCES phone_devices(id) ON DELETE CASCADE;
ALTER TABLE "public"."account_commercial_addons" ADD CONSTRAINT "account_commercial_addons_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."commercial_account_lifecycle_operations" ADD CONSTRAINT "commercial_account_lifecycle_operations_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."commercial_account_lifecycle_operations" ADD CONSTRAINT "commercial_account_lifecycle_operations_entitlement_id_fkey" FOREIGN KEY (entitlement_id) REFERENCES client_account_entitlements(id) ON DELETE SET NULL;
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE RESTRICT;
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_capacity_release_operation_id_fkey" FOREIGN KEY (capacity_release_operation_id) REFERENCES commercial_account_lifecycle_operations(id) ON DELETE RESTRICT;
ALTER TABLE "public"."client_instagram_accounts" ADD CONSTRAINT "client_instagram_accounts_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE "public"."ig_dm_templates" ADD CONSTRAINT "ig_dm_templates_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."ig_targets" ADD CONSTRAINT "ig_targets_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."client_subscription_modules" ADD CONSTRAINT "client_subscription_modules_subscription_id_fkey" FOREIGN KEY (subscription_id) REFERENCES client_subscriptions(id) ON DELETE CASCADE;
ALTER TABLE "public"."account_follow_source_settings" ADD CONSTRAINT "account_follow_source_settings_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."account_dashboard_actions" ADD CONSTRAINT "account_dashboard_actions_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."account_dashboard_actions" ADD CONSTRAINT "account_dashboard_actions_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE "public"."account_dashboard_actions" ADD CONSTRAINT "account_dashboard_actions_incident_id_fkey" FOREIGN KEY (incident_id) REFERENCES account_incidents(id) ON DELETE SET NULL;
ALTER TABLE "public"."commercial_package_runtime_settings" ADD CONSTRAINT "commercial_package_runtime_settings_package_code_fkey" FOREIGN KEY (package_code) REFERENCES commercial_packages(code) ON DELETE RESTRICT;
ALTER TABLE "public"."ig_runs" ADD CONSTRAINT "ig_runs_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."ig_account_unfollow_limit_overrides" ADD CONSTRAINT "ig_account_unfollow_limit_overrides_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."account_session_resume_plans" ADD CONSTRAINT "account_session_resume_plans_run_request_v1_fk" FOREIGN KEY (run_request_id) REFERENCES account_run_requests(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE "public"."ig_action_logs" ADD CONSTRAINT "ig_action_logs_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."ig_action_logs" ADD CONSTRAINT "ig_action_logs_run_id_fkey" FOREIGN KEY (run_id) REFERENCES ig_runs(id) ON DELETE SET NULL;
ALTER TABLE "public"."ig_interacted_users" ADD CONSTRAINT "ig_interacted_users_ct_id_fkey" FOREIGN KEY (ct_id) REFERENCES ig_targets(id) ON DELETE SET NULL;
ALTER TABLE "public"."ig_interacted_users" ADD CONSTRAINT "ig_interacted_users_device_id_fkey" FOREIGN KEY (device_id) REFERENCES phone_devices(id) ON DELETE SET NULL;
ALTER TABLE "public"."ig_interacted_users" ADD CONSTRAINT "ig_interacted_users_request_id_fkey" FOREIGN KEY (request_id) REFERENCES account_run_requests(id) ON DELETE SET NULL;
ALTER TABLE "public"."ig_interacted_users" ADD CONSTRAINT "ig_interacted_users_source_target_id_fkey" FOREIGN KEY (source_target_id) REFERENCES ig_targets(id) ON DELETE SET NULL;
ALTER TABLE "public"."account_incidents" ADD CONSTRAINT "account_incidents_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE SET NULL;
ALTER TABLE "public"."account_incidents" ADD CONSTRAINT "account_incidents_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES account_assignments(id) ON DELETE SET NULL;
ALTER TABLE "public"."account_incidents" ADD CONSTRAINT "account_incidents_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE "public"."account_incidents" ADD CONSTRAINT "account_incidents_clone_id_fkey" FOREIGN KEY (clone_id) REFERENCES phone_clones(id) ON DELETE SET NULL;
ALTER TABLE "public"."account_incidents" ADD CONSTRAINT "account_incidents_device_id_fkey" FOREIGN KEY (device_id) REFERENCES phone_devices(id) ON DELETE SET NULL;
ALTER TABLE "public"."account_incidents" ADD CONSTRAINT "account_incidents_source_event_id_fkey" FOREIGN KEY (source_event_id) REFERENCES runtime_events(id) ON DELETE SET NULL;
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."account_credentials" ADD CONSTRAINT "account_credentials_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE "public"."commercial_stripe_subscriptions" ADD CONSTRAINT "commercial_stripe_subscriptio_client_account_entitlement_i_fkey" FOREIGN KEY (client_account_entitlement_id) REFERENCES client_account_entitlements(id) ON DELETE SET NULL;
ALTER TABLE "public"."commercial_stripe_subscriptions" ADD CONSTRAINT "commercial_stripe_subscriptio_commercial_checkout_session__fkey" FOREIGN KEY (commercial_checkout_session_id) REFERENCES commercial_checkout_sessions(id) ON DELETE SET NULL;
ALTER TABLE "public"."commercial_stripe_subscriptions" ADD CONSTRAINT "commercial_stripe_subscriptio_rebound_from_subscription_id_fkey" FOREIGN KEY (rebound_from_subscription_id) REFERENCES commercial_stripe_subscriptions(id) ON DELETE SET NULL;
ALTER TABLE "public"."commercial_stripe_subscriptions" ADD CONSTRAINT "commercial_stripe_subscriptions_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE SET NULL;
ALTER TABLE "public"."commercial_stripe_subscriptions" ADD CONSTRAINT "commercial_stripe_subscriptions_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE "public"."commercial_stripe_subscriptions" ADD CONSTRAINT "commercial_stripe_subscriptions_plan_change_quote_id_fkey" FOREIGN KEY (plan_change_quote_id) REFERENCES commercial_plan_change_quotes(id) ON DELETE SET NULL;
ALTER TABLE "public"."instagram_account_restriction_holds" ADD CONSTRAINT "instagram_account_restriction_holds_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."instagram_account_restriction_holds" ADD CONSTRAINT "instagram_account_restriction_holds_incident_id_fkey" FOREIGN KEY (incident_id) REFERENCES account_incidents(id) ON DELETE CASCADE;
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."account_session_transitions" ADD CONSTRAINT "account_session_transitions_account_id_fkey" FOREIGN KEY (account_id) REFERENCES ig_accounts(id) ON DELETE CASCADE;
ALTER TABLE "public"."account_session_transitions" ADD CONSTRAINT "account_session_transitions_run_id_fkey" FOREIGN KEY (run_id) REFERENCES ig_runs(id) ON DELETE CASCADE;
ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_destination_id_fkey" FOREIGN KEY (destination_id) REFERENCES notification_destination_settings(id) ON DELETE RESTRICT;
ALTER TABLE "public"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_event_id_fkey" FOREIGN KEY (event_id) REFERENCES notification_business_events(id) ON DELETE RESTRICT;
CREATE INDEX account_warmup_settings_status_idx ON public.account_warmup_settings USING btree (status, updated_at DESC);
CREATE INDEX account_commercial_packages_account_status_idx ON public.account_commercial_packages USING btree (account_id, status, starts_at DESC);
CREATE UNIQUE INDEX account_commercial_packages_one_active_idx ON public.account_commercial_packages USING btree (account_id) WHERE ((status = 'active'::text) AND (ends_at IS NULL));
CREATE INDEX ig_account_social_profile_snapshots_account_observed_idx ON public.ig_account_social_profile_snapshots USING btree (account_id, observed_at DESC);
CREATE UNIQUE INDEX ig_account_social_profile_snapshots_daily_success_idx ON public.ig_account_social_profile_snapshots USING btree (account_id, snapshot_local_date, source_trigger) WHERE ((source_trigger = 'daily_fallback'::text) AND (lookup_status = 'found'::text));
CREATE INDEX ig_account_social_profile_snapshots_account_local_day_idx ON public.ig_account_social_profile_snapshots USING btree (account_id, snapshot_local_date DESC, observed_at DESC);
CREATE INDEX ig_accounts_avatar_checked_at_idx ON public.ig_accounts USING btree (avatar_checked_at DESC) WHERE (avatar_checked_at IS NOT NULL);
CREATE INDEX ig_accounts_username_verification_status_idx ON public.ig_accounts USING btree (username_verification_status);
CREATE UNIQUE INDEX ig_accounts_username_lower_unique ON public.ig_accounts USING btree (lower(btrim(username))) WHERE (btrim(username) <> ''::text);
CREATE INDEX ig_accounts_updated_at_idx ON public.ig_accounts USING btree (updated_at DESC);
CREATE INDEX ig_accounts_status_idx ON public.ig_accounts USING btree (status);
CREATE INDEX ig_accounts_admin_lifecycle_status_idx ON public.ig_accounts USING btree (admin_lifecycle_status);
CREATE INDEX ig_devices_updated_at_idx ON public.ig_devices USING btree (updated_at DESC);
CREATE INDEX client_account_entitlements_client_status_idx ON public.client_account_entitlements USING btree (client_id, status);
CREATE INDEX client_account_entitlements_account_id_idx ON public.client_account_entitlements USING btree (account_id) WHERE (account_id IS NOT NULL);
CREATE UNIQUE INDEX client_account_entitlements_one_reserved_per_client_idx ON public.client_account_entitlements USING btree (client_id) WHERE (status = 'entitlement_reserved'::text);
CREATE INDEX account_package_runtime_contract_events_account_created_idx ON public.account_package_runtime_contract_events USING btree (account_id, created_at DESC);
CREATE UNIQUE INDEX account_package_runtime_contract_events_idempotency_uidx ON public.account_package_runtime_contract_events USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX ig_account_unfollow_settings_enabled_idx ON public.ig_account_unfollow_settings USING btree (unfollow_enabled) WHERE (unfollow_enabled = true);
CREATE INDEX account_assignments_subscription_account_idx ON public.account_assignments USING btree (subscription_account_id, status);
CREATE INDEX account_assignments_app_instance_open_idx ON public.account_assignments USING btree (app_instance_id, starts_at, ends_at) WHERE (status = ANY (ARRAY['pending'::text, 'reserved'::text, 'active'::text]));
CREATE INDEX account_assignments_clone_window_idx ON public.account_assignments USING btree (clone_id, starts_at, ends_at) WHERE (status = ANY (ARRAY['pending'::text, 'reserved'::text, 'active'::text]));
CREATE INDEX account_assignments_client_status_idx ON public.account_assignments USING btree (client_id, status, starts_at DESC);
CREATE INDEX account_assignments_device_status_idx ON public.account_assignments USING btree (device_id, status);
CREATE UNIQUE INDEX account_assignments_one_open_assignment_per_account_key ON public.account_assignments USING btree (account_id) WHERE (status = ANY (ARRAY['pending'::text, 'reserved'::text, 'active'::text]));
CREATE INDEX commercial_checkout_sessions_client_id_idx ON public.commercial_checkout_sessions USING btree (client_id);
CREATE INDEX commercial_checkout_sessions_email_idx ON public.commercial_checkout_sessions USING btree (lower(purchaser_email));
CREATE INDEX account_run_requests_claim_idx ON public.account_run_requests USING btree (status, priority DESC, created_at) WHERE (status = ANY (ARRAY['queued'::text, 'claimed'::text]));
CREATE INDEX account_run_requests_account_status_created_idx ON public.account_run_requests USING btree (account_id, status, created_at DESC);
CREATE INDEX account_run_requests_root_created_v1_idx ON public.account_run_requests USING btree (root_business_session_id, created_at DESC);
CREATE INDEX account_run_requests_run_id_idx ON public.account_run_requests USING btree (run_id) WHERE (run_id IS NOT NULL);
CREATE UNIQUE INDEX account_run_requests_one_active_per_account_key ON public.account_run_requests USING btree (account_id) WHERE (status = ANY (ARRAY['queued'::text, 'claimed'::text, 'starting'::text, 'running'::text]));
CREATE UNIQUE INDEX account_run_requests_idempotency_key_key ON public.account_run_requests USING btree (idempotency_key);
CREATE UNIQUE INDEX account_run_requests_root_attempt_v1_uidx ON public.account_run_requests USING btree (root_business_session_id, execution_attempt_no);
CREATE INDEX commercial_account_lifecycle_states_action_required_idx ON public.commercial_account_lifecycle_states USING btree (updated_at) WHERE (commercial_state = ANY (ARRAY['pause_requested'::text, 'resume_requested'::text, 'cancel_requested'::text, 'action_required'::text]));
CREATE INDEX commercial_account_lifecycle_states_pause_expiry_idx ON public.commercial_account_lifecycle_states USING btree (pause_expires_at) WHERE (commercial_state = 'paused'::text);
CREATE INDEX ig_account_dm_settings_welcome_enabled_idx ON public.ig_account_dm_settings USING btree (welcome_enabled) WHERE (welcome_enabled = true);
CREATE INDEX ig_account_dm_settings_outreach_enabled_idx ON public.ig_account_dm_settings USING btree (outreach_enabled) WHERE (outreach_enabled = true);
CREATE INDEX ig_interaction_events_event_type_event_at_idx ON public.ig_interaction_events USING btree (event_type, event_at DESC);
CREATE INDEX ig_interaction_events_account_target_event_at_p1c_idx ON public.ig_interaction_events USING btree (account_id, target_id, event_at DESC) WHERE (target_id IS NOT NULL);
CREATE INDEX ig_interaction_events_account_source_username_at_idx ON public.ig_interaction_events USING btree (account_id, source_target_username, event_at DESC) WHERE (source_target_username IS NOT NULL);
CREATE INDEX ig_interaction_events_follow_verified_activity_idx ON public.ig_interaction_events USING btree (account_id, event_at) WHERE ((interaction_type = 'follow'::text) AND (interaction_status = 'success'::text) AND (event_type = 'follow_verified'::text));
CREATE INDEX ig_interaction_events_account_interaction_type_at_idx ON public.ig_interaction_events USING btree (account_id, interaction_type, event_at DESC) WHERE (interaction_type IS NOT NULL);
CREATE INDEX ig_interaction_events_target_id_p1c_idx ON public.ig_interaction_events USING btree (target_id);
CREATE INDEX ig_interaction_events_request_id_idx ON public.ig_interaction_events USING btree (request_id) WHERE (request_id IS NOT NULL);
CREATE INDEX ig_interaction_events_run_id_idx ON public.ig_interaction_events USING btree (run_id);
CREATE INDEX ig_interaction_events_follow_verified_activity_v2_idx ON public.ig_interaction_events USING btree (account_id, event_at) WHERE ((interaction_type = 'follow'::text) AND (interaction_status = 'success'::text) AND (event_type = ANY (ARRAY['follow_verified'::text, 'follow_verified_persisted_v1'::text])) AND (run_id IS NOT NULL));
CREATE UNIQUE INDEX ig_interaction_events_stage_idempotency_uidx ON public.ig_interaction_events USING btree (account_id, run_id, stage_idempotency_key) WHERE (stage_idempotency_key IS NOT NULL);
CREATE INDEX ig_interaction_events_account_source_target_at_idx ON public.ig_interaction_events USING btree (account_id, source_target_id, event_at DESC) WHERE (source_target_id IS NOT NULL);
CREATE INDEX ig_interaction_events_account_source_event_at_idx ON public.ig_interaction_events USING btree (account_id, source_profile, event_at DESC);
CREATE INDEX ig_interaction_events_account_username_event_at_idx ON public.ig_interaction_events USING btree (account_id, username, event_at DESC);
CREATE INDEX commercial_plan_change_quotes_account_status_idx ON public.commercial_plan_change_quotes USING btree (client_id, account_id, status) WHERE (account_id IS NOT NULL);
CREATE INDEX commercial_plan_change_quotes_client_status_idx ON public.commercial_plan_change_quotes USING btree (client_id, status);
CREATE INDEX client_users_auth_user_id_idx ON public.client_users USING btree (auth_user_id);
CREATE INDEX client_users_client_id_idx ON public.client_users USING btree (client_id);
CREATE INDEX client_entitlements_source_subscription_idx ON public.client_entitlements USING btree (source_subscription_id, source_subscription_module_id);
CREATE UNIQUE INDEX client_entitlements_one_active_client_feature_key ON public.client_entitlements USING btree (client_id, feature_code) WHERE ((active = true) AND (account_id IS NULL));
CREATE INDEX client_entitlements_client_feature_idx ON public.client_entitlements USING btree (client_id, feature_code, active);
CREATE UNIQUE INDEX client_entitlements_one_active_account_feature_key ON public.client_entitlements USING btree (client_id, account_id, feature_code) WHERE ((active = true) AND (account_id IS NOT NULL));
CREATE INDEX client_entitlements_account_feature_idx ON public.client_entitlements USING btree (account_id, feature_code, active) WHERE (account_id IS NOT NULL);
CREATE INDEX client_subscriptions_type_idx ON public.client_subscriptions USING btree (subscription_type);
CREATE INDEX client_subscriptions_client_status_idx ON public.client_subscriptions USING btree (client_id, status, starts_at DESC);
CREATE INDEX client_subscription_accounts_subscription_idx ON public.client_subscription_accounts USING btree (subscription_id, status);
CREATE INDEX client_subscription_accounts_account_idx ON public.client_subscription_accounts USING btree (account_id, status);
CREATE INDEX phone_clones_current_account_idx ON public.phone_clones USING btree (current_account_id) WHERE (current_account_id IS NOT NULL);
CREATE INDEX phone_clones_device_status_idx ON public.phone_clones USING btree (device_id, status);
CREATE INDEX phone_devices_kind_status_idx ON public.phone_devices USING btree (device_kind, status);
CREATE INDEX phone_devices_host_hub_port_idx ON public.phone_devices USING btree (host_machine, hub_label, hub_port);
CREATE INDEX phone_devices_pool_status_idx ON public.phone_devices USING btree (pool_type, status);
CREATE UNIQUE INDEX phone_devices_adb_serial_key ON public.phone_devices USING btree (adb_serial) WHERE (adb_serial IS NOT NULL);
CREATE INDEX phone_devices_operational_status_idx ON public.phone_devices USING btree (device_kind, status) WHERE (status <> 'retired'::text);
CREATE UNIQUE INDEX phone_devices_device_udid_key ON public.phone_devices USING btree (device_udid) WHERE (device_udid IS NOT NULL);
CREATE UNIQUE INDEX phone_app_instances_device_package_key ON public.phone_app_instances USING btree (device_id, package_name) WHERE ((package_name IS NOT NULL) AND (TRIM(BOTH FROM package_name) <> ''::text));
CREATE UNIQUE INDEX phone_app_instances_device_index_key ON public.phone_app_instances USING btree (device_id, instance_index);
CREATE INDEX phone_app_instances_current_account_idx ON public.phone_app_instances USING btree (current_account_id) WHERE (current_account_id IS NOT NULL);
CREATE INDEX phone_app_instances_device_status_idx ON public.phone_app_instances USING btree (device_id, status, usable_for_auto_login, is_launchable);
CREATE INDEX runtime_events_account_created_at_idx ON public.runtime_events USING btree (account_id, created_at DESC) WHERE (account_id IS NOT NULL);
CREATE INDEX runtime_events_device_created_at_idx ON public.runtime_events USING btree (device_id, created_at DESC) WHERE (device_id IS NOT NULL);
CREATE INDEX runtime_events_created_at_idx ON public.runtime_events USING btree (created_at DESC);
CREATE INDEX runtime_events_severity_created_at_idx ON public.runtime_events USING btree (severity, created_at DESC);
CREATE INDEX runtime_events_run_created_at_idx ON public.runtime_events USING btree (run_id, created_at DESC) WHERE (run_id IS NOT NULL);
CREATE INDEX runtime_events_job_created_at_idx ON public.runtime_events USING btree (job_id, created_at DESC) WHERE (job_id IS NOT NULL);
CREATE INDEX runtime_events_visibility_created_at_idx ON public.runtime_events USING btree (visibility, created_at DESC);
CREATE INDEX runtime_events_event_type_created_at_idx ON public.runtime_events USING btree (event_type, created_at DESC);
CREATE INDEX runtime_events_assignment_created_at_idx ON public.runtime_events USING btree (assignment_id, created_at DESC) WHERE (assignment_id IS NOT NULL);
CREATE UNIQUE INDEX account_commercial_addons_one_active_idx ON public.account_commercial_addons USING btree (account_id, addon_code, COALESCE(addon_variant, ''::text)) WHERE ((status = 'active'::text) AND (ends_at IS NULL));
CREATE INDEX account_commercial_addons_account_status_idx ON public.account_commercial_addons USING btree (account_id, status, addon_code, starts_at DESC);
CREATE INDEX commercial_account_lifecycle_operations_account_idx ON public.commercial_account_lifecycle_operations USING btree (account_id, created_at DESC);
CREATE UNIQUE INDEX commercial_account_lifecycle_operations_one_open_idx ON public.commercial_account_lifecycle_operations USING btree (account_id) WHERE (state = ANY (ARRAY['pending'::text, 'in_progress'::text]));
CREATE INDEX client_instagram_accounts_client_id_idx ON public.client_instagram_accounts USING btree (client_id);
CREATE INDEX client_instagram_accounts_client_active_idx ON public.client_instagram_accounts USING btree (client_id, account_id) WHERE (active = true);
CREATE INDEX client_instagram_accounts_client_capacity_idx ON public.client_instagram_accounts USING btree (client_id, capacity_status) WHERE (active = true);
CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);
CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);
CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);
CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);
CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);
CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);
CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);
CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));
CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);
CREATE UNIQUE INDEX ig_dm_templates_account_type_name_key ON public.ig_dm_templates USING btree (account_id, template_type, lower(TRIM(BOTH FROM name)));
CREATE INDEX ig_dm_templates_account_id_idx ON public.ig_dm_templates USING btree (account_id);
CREATE INDEX ig_dm_templates_account_type_active_idx ON public.ig_dm_templates USING btree (account_id, template_type, active);
CREATE UNIQUE INDEX ig_dm_templates_one_default_per_type_key ON public.ig_dm_templates USING btree (account_id, template_type) WHERE ((is_default = true) AND (active = true));
CREATE INDEX ig_targets_account_last_exhausted_p1c_idx ON public.ig_targets USING btree (account_id, last_exhausted_at DESC) WHERE (last_exhausted_at IS NOT NULL);
CREATE INDEX ig_targets_batch_id_idx ON public.ig_targets USING btree (batch_id) WHERE (batch_id IS NOT NULL);
CREATE INDEX ig_targets_account_cooldown_until_p1c_idx ON public.ig_targets USING btree (account_id, cooldown_until) WHERE (cooldown_until IS NOT NULL);
CREATE INDEX ig_targets_quality_status_idx ON public.ig_targets USING btree (quality_status);
CREATE INDEX ig_targets_account_id_status_idx ON public.ig_targets USING btree (account_id, status);
CREATE INDEX ig_targets_created_at_idx ON public.ig_targets USING btree (created_at DESC);
CREATE INDEX ig_targets_updated_at_idx ON public.ig_targets USING btree (updated_at DESC);
CREATE INDEX ig_targets_permanent_readd_block_lookup_idx ON public.ig_targets USING btree (account_id, normalized_username, archive_reason, readd_blocked_permanently) WHERE (status = 'archived'::text);
CREATE INDEX ig_targets_readd_block_lookup_idx ON public.ig_targets USING btree (account_id, normalized_username, archive_reason, readd_blocked_until DESC) WHERE (status = 'archived'::text);
CREATE INDEX ig_targets_account_username_idx ON public.ig_targets USING btree (account_id, target_username);
CREATE INDEX ig_targets_periodic_revalidation_due_idx ON public.ig_targets USING btree (periodic_revalidation_next_due_at) WHERE ((status = ANY (ARRAY['valid'::text, 'active'::text])) AND (archived_at IS NULL) AND (deleted_at IS NULL));
CREATE INDEX ig_targets_account_id_idx ON public.ig_targets USING btree (account_id);
CREATE UNIQUE INDEX ig_targets_account_normalized_active_ct_unique ON public.ig_targets USING btree (account_id, normalized_username) WHERE ((archived_at IS NULL) AND (deleted_at IS NULL) AND (normalized_username IS NOT NULL));
CREATE INDEX ig_targets_account_last_used_p1c_idx ON public.ig_targets USING btree (account_id, last_used_at DESC);
CREATE INDEX ig_targets_account_normalized_idx ON public.ig_targets USING btree (account_id, normalized_username) WHERE ((archived_at IS NULL) AND (deleted_at IS NULL));
CREATE INDEX ig_targets_verification_status_idx ON public.ig_targets USING btree (verification_status, provider_checked_at DESC);
CREATE INDEX ig_targets_status_idx ON public.ig_targets USING btree (status);
CREATE INDEX client_subscription_modules_subscription_idx ON public.client_subscription_modules USING btree (subscription_id, enabled);
CREATE INDEX account_follow_source_settings_updated_at_idx ON public.account_follow_source_settings USING btree (updated_at DESC);
CREATE INDEX account_dashboard_actions_account_status_idx ON public.account_dashboard_actions USING btree (account_id, status);
CREATE INDEX account_dashboard_actions_requires_client_action_idx ON public.account_dashboard_actions USING btree (requires_client_action) WHERE (requires_client_action = true);
CREATE INDEX account_dashboard_actions_blocking_campaign_idx ON public.account_dashboard_actions USING btree (blocking_campaign) WHERE (blocking_campaign = true);
CREATE INDEX account_dashboard_actions_action_type_status_idx ON public.account_dashboard_actions USING btree (action_type, status);
CREATE INDEX account_dashboard_actions_created_at_idx ON public.account_dashboard_actions USING btree (created_at DESC);
CREATE INDEX account_dashboard_actions_incident_id_idx ON public.account_dashboard_actions USING btree (incident_id) WHERE (incident_id IS NOT NULL);
CREATE UNIQUE INDEX account_dashboard_actions_active_dedupe_key ON public.account_dashboard_actions USING btree (dedupe_key) WHERE (status = ANY (ARRAY['pending'::text, 'acknowledged'::text, 'pending_verification'::text, 'code_submitted'::text]));
CREATE INDEX account_dashboard_actions_client_status_audience_idx ON public.account_dashboard_actions USING btree (client_id, status, audience) WHERE (client_id IS NOT NULL);
CREATE INDEX ig_runs_account_status_idx ON public.ig_runs USING btree (account_id, status);
CREATE INDEX ig_runs_account_created_idx ON public.ig_runs USING btree (account_id, created_at DESC);
CREATE INDEX ig_runs_worker_type_idx ON public.ig_runs USING btree (worker_type);
CREATE UNIQUE INDEX incident_resume_authorizations_one_per_incident_window ON public.incident_resume_authorizations USING btree (incident_id, resume_window_key) WHERE (status = ANY (ARRAY['armed'::text, 'consumed'::text]));
CREATE UNIQUE INDEX incident_resume_authorizations_one_armed_per_incident ON public.incident_resume_authorizations USING btree (incident_id) WHERE (status = 'armed'::text);
CREATE UNIQUE INDEX incident_resume_authorizations_one_armed_per_account ON public.incident_resume_authorizations USING btree (account_id) WHERE (status = 'armed'::text);
CREATE INDEX incident_resume_authorizations_armed_idx ON public.incident_resume_authorizations USING btree (status, armed_at) WHERE (status = 'armed'::text);
CREATE UNIQUE INDEX incident_resume_authorizations_v2_idempotency_idx ON public.incident_resume_authorizations USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX account_session_resume_plans_account_idx ON public.account_session_resume_plans USING btree (account_id, last_updated_at DESC);
CREATE INDEX account_session_resume_plans_active_projection_v1_idx ON public.account_session_resume_plans USING btree (account_id, last_updated_at DESC) INCLUDE (run_id, run_request_id, resume_state, irreversible_work_state, device_connected_at, instagram_foreground_verified_at);
CREATE UNIQUE INDEX account_session_resume_plans_run_request_v1_uidx ON public.account_session_resume_plans USING btree (run_request_id) WHERE (run_request_id IS NOT NULL);
CREATE INDEX account_session_resume_plans_window_idx ON public.account_session_resume_plans USING btree (resume_window_key) WHERE (resume_window_key IS NOT NULL);
CREATE INDEX ig_action_logs_action_type_idx ON public.ig_action_logs USING btree (action_type);
CREATE INDEX ig_action_logs_payload_gin_idx ON public.ig_action_logs USING gin (payload);
CREATE INDEX ig_action_logs_account_created_idx ON public.ig_action_logs USING btree (account_id, created_at DESC);
CREATE INDEX ig_action_logs_run_created_idx ON public.ig_action_logs USING btree (run_id, created_at DESC);
CREATE INDEX ig_action_logs_metadata_gin_idx ON public.ig_action_logs USING gin (metadata);
CREATE UNIQUE INDEX ig_action_logs_commercial_lifecycle_operation_evidence_uidx ON public.ig_action_logs USING btree (((payload ->> 'commercial_lifecycle_operation_id'::text))) WHERE ((action_type = 'account_admin_status_changed'::text) AND (payload ? 'commercial_lifecycle_operation_id'::text));
CREATE INDEX ig_interacted_users_username_idx ON public.ig_interacted_users USING btree (username);
CREATE UNIQUE INDEX ig_interacted_users_account_username_uidx ON public.ig_interacted_users USING btree (account_id, username);
CREATE INDEX ig_interacted_users_account_status_last_idx ON public.ig_interacted_users USING btree (account_id, interaction_status, last_interaction_at DESC) WHERE (interaction_status IS NOT NULL);
CREATE INDEX ig_interacted_users_last_source_profile_idx ON public.ig_interacted_users USING btree (last_source_profile);
CREATE INDEX ig_interacted_users_first_source_profile_idx ON public.ig_interacted_users USING btree (first_source_profile);
CREATE INDEX ig_interacted_users_last_interaction_at_idx ON public.ig_interacted_users USING btree (last_interaction_at);
CREATE INDEX ig_interacted_users_account_source_target_last_idx ON public.ig_interacted_users USING btree (account_id, source_target_id, last_interaction_at DESC) WHERE (source_target_id IS NOT NULL);
CREATE INDEX ig_interacted_users_account_source_username_last_idx ON public.ig_interacted_users USING btree (account_id, source_target_username, last_interaction_at DESC) WHERE (source_target_username IS NOT NULL);
CREATE INDEX ig_interacted_users_source_profile_idx ON public.ig_interacted_users USING btree (source_profile);
CREATE INDEX ig_interacted_users_interaction_type_idx ON public.ig_interacted_users USING btree (interaction_type);
CREATE INDEX ig_interacted_users_account_id_idx ON public.ig_interacted_users USING btree (account_id);
CREATE INDEX ig_interacted_users_followback_idx ON public.ig_interacted_users USING btree (is_following_back);
CREATE INDEX ig_interacted_users_unfollow_strict_eligible_idx ON public.ig_interacted_users USING btree (account_id, interaction_lifecycle_state, eligible_unfollow_at) WHERE ((unfollowed_at IS NULL) AND (followed_by_bot = true) AND (whitelist_protected = false) AND (followed_at IS NOT NULL));
CREATE INDEX ig_interacted_users_request_id_idx ON public.ig_interacted_users USING btree (request_id) WHERE (request_id IS NOT NULL);
CREATE UNIQUE INDEX ig_interacted_users_account_id_username_key ON public.ig_interacted_users USING btree (account_id, username);
CREATE INDEX auto_restart_device_locks_request_id_idx ON public.auto_restart_device_locks USING btree (request_id) WHERE (request_id IS NOT NULL);
CREATE UNIQUE INDEX auto_restart_device_locks_lease_id_uidx ON public.auto_restart_device_locks USING btree (lease_id);
CREATE INDEX auto_restart_device_locks_lease_idx ON public.auto_restart_device_locks USING btree (lease_expires_at);
CREATE INDEX account_incidents_client_status_idx ON public.account_incidents USING btree (client_id, status) WHERE (client_id IS NOT NULL);
CREATE INDEX account_incidents_account_status_severity_idx ON public.account_incidents USING btree (account_id, status, severity) WHERE (account_id IS NOT NULL);
CREATE INDEX account_incidents_incident_type_status_idx ON public.account_incidents USING btree (incident_type, status);
CREATE INDEX account_incidents_run_id_idx ON public.account_incidents USING btree (run_id) WHERE (run_id IS NOT NULL);
CREATE INDEX account_incidents_source_event_id_idx ON public.account_incidents USING btree (source_event_id) WHERE (source_event_id IS NOT NULL);
CREATE INDEX account_incidents_overview_cursor_idx ON public.account_incidents USING btree (last_seen_at DESC, id DESC) WHERE (archived_at IS NULL);
CREATE INDEX account_incidents_device_id_idx ON public.account_incidents USING btree (device_id) WHERE (device_id IS NOT NULL);
CREATE INDEX account_incidents_last_seen_at_idx ON public.account_incidents USING btree (last_seen_at DESC);
CREATE INDEX account_incidents_retention_due_idx ON public.account_incidents USING btree (purge_after, id) WHERE ((status = ANY (ARRAY['resolved'::text, 'ignored'::text])) AND (archived_at IS NULL) AND (legal_hold = false));
CREATE INDEX account_incidents_assignment_id_idx ON public.account_incidents USING btree (assignment_id) WHERE (assignment_id IS NOT NULL);
CREATE UNIQUE INDEX account_incidents_active_dedupe_key ON public.account_incidents USING btree (dedupe_key) WHERE (status = ANY (ARRAY['open'::text, 'acknowledged'::text]));
CREATE INDEX account_incidents_dedupe_key_idx ON public.account_incidents USING btree (dedupe_key);
CREATE INDEX account_incidents_severity_created_at_idx ON public.account_incidents USING btree (severity, created_at DESC);
CREATE INDEX account_credentials_provider_status_idx ON public.account_credentials USING btree (provider, status);
CREATE UNIQUE INDEX account_credentials_one_active_account_provider_key ON public.account_credentials USING btree (account_id, provider) WHERE (status = 'active'::text);
CREATE INDEX account_credentials_client_id_idx ON public.account_credentials USING btree (client_id) WHERE (client_id IS NOT NULL);
CREATE UNIQUE INDEX account_credentials_current_state_account_provider_key ON public.account_credentials USING btree (account_id, provider) WHERE (status = ANY (ARRAY['missing'::text, 'configured'::text, 'reauth_required'::text, 'update_needed'::text, 'unknown'::text]));
CREATE INDEX account_credentials_account_id_idx ON public.account_credentials USING btree (account_id);
CREATE INDEX account_credentials_reauth_required_idx ON public.account_credentials USING btree (reauth_required) WHERE (reauth_required = true);
CREATE INDEX account_credentials_status_created_at_idx ON public.account_credentials USING btree (status, created_at DESC);
CREATE INDEX commercial_stripe_subscriptions_entitlement_idx ON public.commercial_stripe_subscriptions USING btree (client_account_entitlement_id, account_id);
CREATE UNIQUE INDEX commercial_stripe_subscriptions_one_active_per_entitlement_idx ON public.commercial_stripe_subscriptions USING btree (client_account_entitlement_id, livemode) WHERE ((client_account_entitlement_id IS NOT NULL) AND (status = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'unpaid'::text, 'paused'::text])));
CREATE INDEX commercial_stripe_subscriptions_client_idx ON public.commercial_stripe_subscriptions USING btree (client_id, livemode);
CREATE INDEX instagram_account_restriction_holds_incident_idx ON public.instagram_account_restriction_holds USING btree (incident_id, status);
CREATE UNIQUE INDEX instagram_account_restriction_holds_one_blocker ON public.instagram_account_restriction_holds USING btree (account_id) WHERE (status = ANY (ARRAY['active'::text, 'verification_required'::text]));
CREATE INDEX account_session_transitions_account_updated_idx ON public.account_session_transitions USING btree (account_id, updated_at DESC);
CREATE INDEX notification_business_events_category_created_idx ON public.notification_business_events USING btree (category, environment, created_at DESC);
CREATE INDEX notification_deliveries_claimable_idx ON public.notification_deliveries USING btree (next_retry_at, created_at) WHERE (status = ANY (ARRAY['pending'::text, 'retry'::text]));
CREATE INDEX notification_deliveries_stale_claim_idx ON public.notification_deliveries USING btree (claimed_at) WHERE (status = 'processing'::text);
CREATE INDEX notification_deliveries_destination_history_idx ON public.notification_deliveries USING btree (destination_id, created_at DESC);
CREATE VIEW "public"."account_package_summary" WITH (security_invoker=true) AS  WITH current_package AS (
         SELECT DISTINCT ON (acp.account_id) acp.account_id,
            acp.package_code,
            cp.label AS package_label,
            COALESCE((NULLIF((acp.metadata_safe ->> 'package_started_at'::text), ''::text))::timestamp with time zone, (NULLIF((acp.metadata_safe ->> 'service_started_at'::text), ''::text))::timestamp with time zone, (NULLIF((acp.metadata_safe ->> 'warmup_started_at'::text), ''::text))::timestamp with time zone) AS metadata_package_started_at,
            cp.default_follow_day_cap,
            cp.default_follow_session_cap,
            COALESCE(cp.max_follow_day_cap, cp.default_follow_day_cap) AS max_follow_day_cap,
            COALESCE(cp.max_follow_session_cap, cp.default_follow_session_cap) AS max_follow_session_cap,
            cp.default_unfollow_day_cap,
            cp.default_unfollow_session_cap,
            cp.default_welcome_enabled,
            cp.default_welcome_day_cap,
            cp.default_outreach_enabled,
            cp.default_outreach_day_cap,
            cp.advanced_ct_enabled,
            cp.ai_comment_enabled,
            cp.ai_targeting_enabled
           FROM (account_commercial_packages acp
             JOIN commercial_packages cp ON ((cp.code = acp.package_code)))
          WHERE ((acp.status = 'active'::text) AND (acp.starts_at <= now()) AND ((acp.ends_at IS NULL) OR (acp.ends_at > now())))
          ORDER BY acp.account_id, acp.starts_at DESC, acp.created_at DESC
        ), active_addons AS (
         SELECT account_commercial_addons.account_id,
            array_agg(DISTINCT account_commercial_addons.addon_code ORDER BY account_commercial_addons.addon_code) AS commercial_addons,
            max(account_commercial_addons.addon_variant) FILTER (WHERE (account_commercial_addons.addon_code ~~ 'outreach%'::text)) AS outreach_variant,
            max(account_commercial_addons.source_type) FILTER (WHERE (account_commercial_addons.addon_code ~~ 'outreach%'::text)) AS outreach_job_source
           FROM account_commercial_addons
          WHERE ((account_commercial_addons.status = 'active'::text) AND (account_commercial_addons.starts_at <= now()) AND ((account_commercial_addons.ends_at IS NULL) OR (account_commercial_addons.ends_at > now())))
          GROUP BY account_commercial_addons.account_id
        ), account_clients AS (
         SELECT client_instagram_accounts.account_id,
            client_instagram_accounts.client_id
           FROM client_instagram_accounts
        ), entitlement_summary AS (
         SELECT COALESCE(ce.account_id, ac.account_id) AS account_id,
            array_agg(DISTINCT ce.feature_code ORDER BY ce.feature_code) FILTER (WHERE ce.active) AS entitlements
           FROM (client_entitlements ce
             LEFT JOIN account_clients ac ON ((ac.client_id = ce.client_id)))
          WHERE (ce.active = true)
          GROUP BY COALESCE(ce.account_id, ac.account_id)
        ), runtime_profiles AS (
         SELECT csa.account_id,
            array_agg(DISTINCT cs.subscription_type ORDER BY cs.subscription_type) AS runtime_profiles
           FROM (client_subscription_accounts csa
             JOIN client_subscriptions cs ON ((cs.id = csa.subscription_id)))
          WHERE ((csa.status = 'active'::text) AND (cs.status = 'active'::text))
          GROUP BY csa.account_id
        ), follow_caps AS (
         SELECT ig_account_settings.account_id,
            ig_account_settings.follow_limit AS follow_session_cap,
            ig_account_settings.max_actions_per_day AS follow_day_cap,
            ig_account_settings.warmup_mode
           FROM ig_account_settings
        ), unfollow_caps AS (
         SELECT ig_account_unfollow_settings.account_id,
            ig_account_unfollow_settings.unfollow_per_session_limit,
            ig_account_unfollow_settings.unfollow_per_day_limit
           FROM ig_account_unfollow_settings
        ), dm_caps AS (
         SELECT ig_account_dm_settings.account_id,
            ig_account_dm_settings.welcome_per_session_limit,
            ig_account_dm_settings.welcome_per_day_limit,
            ig_account_dm_settings.outreach_per_session_limit,
            ig_account_dm_settings.outreach_per_day_limit
           FROM ig_account_dm_settings
        ), follow_activity_days AS (
         SELECT ig_interaction_events.account_id,
            (count(DISTINCT ((ig_interaction_events.event_at AT TIME ZONE 'Africa/Johannesburg'::text))::date) FILTER (WHERE (((ig_interaction_events.event_at AT TIME ZONE 'Africa/Johannesburg'::text))::date < ((now() AT TIME ZONE 'Africa/Johannesburg'::text))::date)))::integer AS prior_active_days
           FROM ig_interaction_events
          WHERE ((ig_interaction_events.interaction_type = 'follow'::text) AND (ig_interaction_events.interaction_status = 'success'::text) AND (ig_interaction_events.event_type = ANY (ARRAY['follow_verified'::text, 'follow_verified_persisted_v1'::text])) AND (ig_interaction_events.run_id IS NOT NULL))
          GROUP BY ig_interaction_events.account_id
        ), resolved AS (
         SELECT a.id AS account_id,
            cp.package_code,
            cp.package_label,
            cp.default_follow_day_cap,
            cp.default_follow_session_cap,
            cp.max_follow_day_cap,
            cp.max_follow_session_cap,
            cp.default_unfollow_day_cap,
            cp.default_unfollow_session_cap,
            cp.default_welcome_enabled,
            cp.default_welcome_day_cap,
            cp.default_outreach_enabled,
            cp.default_outreach_day_cap,
            cp.advanced_ct_enabled,
            cp.ai_comment_enabled,
            cp.ai_targeting_enabled,
            COALESCE(aa.commercial_addons, ARRAY[]::text[]) AS commercial_addons,
            COALESCE(aa.outreach_variant, 'pending_source_classification'::text) AS outreach_variant,
            COALESCE(aa.outreach_job_source, 'pending_source_classification'::text) AS outreach_job_source,
            COALESCE(es.entitlements, ARRAY[]::text[]) AS entitlements,
            COALESCE(rp.runtime_profiles, ARRAY[]::text[]) AS runtime_profiles,
            COALESCE(aws.warmup_enabled, COALESCE(fc.warmup_mode, true)) AS warmup_enabled,
            COALESCE(aws.package_started_at, cp.metadata_package_started_at) AS package_started_at,
            LEAST(COALESCE(aws.day_1_follow_cap, 10), cp.max_follow_day_cap, cp.max_follow_session_cap) AS day_1_follow_cap,
            LEAST(COALESCE(aws.day_2_follow_cap, 20), cp.max_follow_day_cap, cp.max_follow_session_cap) AS day_2_follow_cap,
            LEAST(COALESCE(aws.day_3_follow_cap, 40), cp.max_follow_day_cap, cp.max_follow_session_cap) AS day_3_follow_cap,
            LEAST(COALESCE(aws.day_4_plus_follow_cap, cp.max_follow_day_cap), cp.max_follow_day_cap, cp.max_follow_session_cap) AS day_4_plus_follow_cap,
            COALESCE(fad.prior_active_days, 0) AS prior_active_days,
            fc.follow_day_cap,
            fc.follow_session_cap,
            uc.unfollow_per_day_limit,
            uc.unfollow_per_session_limit,
            dc.welcome_per_day_limit,
            dc.welcome_per_session_limit,
            dc.outreach_per_day_limit,
            dc.outreach_per_session_limit
           FROM (((((((((ig_accounts a
             LEFT JOIN current_package cp ON ((cp.account_id = a.id)))
             LEFT JOIN active_addons aa ON ((aa.account_id = a.id)))
             LEFT JOIN entitlement_summary es ON ((es.account_id = a.id)))
             LEFT JOIN runtime_profiles rp ON ((rp.account_id = a.id)))
             LEFT JOIN follow_caps fc ON ((fc.account_id = a.id)))
             LEFT JOIN unfollow_caps uc ON ((uc.account_id = a.id)))
             LEFT JOIN dm_caps dc ON ((dc.account_id = a.id)))
             LEFT JOIN account_warmup_settings aws ON ((aws.account_id = a.id)))
             LEFT JOIN follow_activity_days fad ON ((fad.account_id = a.id)))
        ), with_warmup AS (
         SELECT r.account_id,
            r.package_code,
            r.package_label,
            r.default_follow_day_cap,
            r.default_follow_session_cap,
            r.max_follow_day_cap,
            r.max_follow_session_cap,
            r.default_unfollow_day_cap,
            r.default_unfollow_session_cap,
            r.default_welcome_enabled,
            r.default_welcome_day_cap,
            r.default_outreach_enabled,
            r.default_outreach_day_cap,
            r.advanced_ct_enabled,
            r.ai_comment_enabled,
            r.ai_targeting_enabled,
            r.commercial_addons,
            r.outreach_variant,
            r.outreach_job_source,
            r.entitlements,
            r.runtime_profiles,
            r.warmup_enabled,
            r.package_started_at,
            r.day_1_follow_cap,
            r.day_2_follow_cap,
            r.day_3_follow_cap,
            r.day_4_plus_follow_cap,
            r.prior_active_days,
            r.follow_day_cap,
            r.follow_session_cap,
            r.unfollow_per_day_limit,
            r.unfollow_per_session_limit,
            r.welcome_per_day_limit,
            r.welcome_per_session_limit,
            r.outreach_per_day_limit,
            r.outreach_per_session_limit,
            LEAST(4, (r.prior_active_days + 1)) AS warmup_day
           FROM resolved r
        ), with_warmup_cap AS (
         SELECT w_1.account_id,
            w_1.package_code,
            w_1.package_label,
            w_1.default_follow_day_cap,
            w_1.default_follow_session_cap,
            w_1.max_follow_day_cap,
            w_1.max_follow_session_cap,
            w_1.default_unfollow_day_cap,
            w_1.default_unfollow_session_cap,
            w_1.default_welcome_enabled,
            w_1.default_welcome_day_cap,
            w_1.default_outreach_enabled,
            w_1.default_outreach_day_cap,
            w_1.advanced_ct_enabled,
            w_1.ai_comment_enabled,
            w_1.ai_targeting_enabled,
            w_1.commercial_addons,
            w_1.outreach_variant,
            w_1.outreach_job_source,
            w_1.entitlements,
            w_1.runtime_profiles,
            w_1.warmup_enabled,
            w_1.package_started_at,
            w_1.day_1_follow_cap,
            w_1.day_2_follow_cap,
            w_1.day_3_follow_cap,
            w_1.day_4_plus_follow_cap,
            w_1.prior_active_days,
            w_1.follow_day_cap,
            w_1.follow_session_cap,
            w_1.unfollow_per_day_limit,
            w_1.unfollow_per_session_limit,
            w_1.welcome_per_day_limit,
            w_1.welcome_per_session_limit,
            w_1.outreach_per_day_limit,
            w_1.outreach_per_session_limit,
            w_1.warmup_day,
                CASE
                    WHEN (NOT COALESCE(w_1.warmup_enabled, true)) THEN LEAST(w_1.max_follow_day_cap, w_1.max_follow_session_cap)
                    WHEN (w_1.warmup_day <= 1) THEN w_1.day_1_follow_cap
                    WHEN (w_1.warmup_day = 2) THEN w_1.day_2_follow_cap
                    WHEN (w_1.warmup_day = 3) THEN w_1.day_3_follow_cap
                    ELSE w_1.day_4_plus_follow_cap
                END AS warmup_follow_cap
           FROM with_warmup w_1
        )
 SELECT account_id,
    package_code AS commercial_package_code,
    package_label AS commercial_package_label,
    commercial_addons,
    outreach_variant,
    outreach_job_source,
    entitlements,
    runtime_profiles,
    NULL::text AS assignment_profile,
        CASE
            WHEN (NOT COALESCE(warmup_enabled, true)) THEN 'disabled'::text
            WHEN (warmup_day >= 4) THEN 'warmed_up'::text
            ELSE 'warming_up'::text
        END AS warmup_status,
    warmup_day,
    package_started_at,
    jsonb_build_object('follow_day', max_follow_day_cap, 'follow_session', max_follow_session_cap, 'unfollow_day', default_unfollow_day_cap, 'unfollow_session', default_unfollow_session_cap, 'welcome_enabled', default_welcome_enabled, 'welcome_day', default_welcome_day_cap, 'outreach_enabled', default_outreach_enabled, 'outreach_day', default_outreach_day_cap, 'advanced_ct_enabled', advanced_ct_enabled, 'ai_comment_enabled', ai_comment_enabled, 'ai_targeting_enabled', ai_targeting_enabled) AS package_caps,
    jsonb_build_object('warmup_enabled', warmup_enabled, 'day_1_follow_cap', day_1_follow_cap, 'day_2_follow_cap', day_2_follow_cap, 'day_3_follow_cap', day_3_follow_cap, 'day_4_plus_follow_cap', day_4_plus_follow_cap, 'warmup_follow_day_cap', warmup_follow_cap, 'follow_day', LEAST(COALESCE(follow_day_cap, default_follow_day_cap), COALESCE(max_follow_day_cap, follow_day_cap), warmup_follow_cap), 'follow_session', LEAST(COALESCE(follow_session_cap, default_follow_session_cap), COALESCE(max_follow_session_cap, follow_session_cap), warmup_follow_cap), 'unfollow_day', LEAST(COALESCE(unfollow_per_day_limit, default_unfollow_day_cap), default_unfollow_day_cap), 'unfollow_session', LEAST(COALESCE(unfollow_per_session_limit, default_unfollow_session_cap), default_unfollow_session_cap), 'welcome_day', LEAST(COALESCE(welcome_per_day_limit, default_welcome_day_cap), default_welcome_day_cap), 'welcome_session', LEAST(COALESCE(welcome_per_session_limit, default_welcome_day_cap), default_welcome_day_cap), 'outreach_day', LEAST(COALESCE(outreach_per_day_limit, default_outreach_day_cap), default_outreach_day_cap), 'outreach_session', outreach_per_session_limit, 'warmup_applied', COALESCE(warmup_enabled, true)) AS effective_caps_preview,
    jsonb_build_object('follow_day', default_follow_day_cap, 'follow_session', default_follow_session_cap) AS package_defaults
   FROM with_warmup_cap w;;
ALTER FUNCTION "public"."reject_social_profile_snapshot_mutation"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."reject_social_profile_snapshot_mutation"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."reject_social_profile_snapshot_mutation"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."reject_social_profile_snapshot_mutation"() TO "service_role";
ALTER FUNCTION "public"."initialize_account_warmup_on_package_activation"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."initialize_account_warmup_on_package_activation"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."initialize_account_warmup_on_package_activation"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."initialize_account_warmup_on_package_activation"() TO "service_role";
ALTER FUNCTION "private"."preserve_warmup_started_at_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "private"."preserve_warmup_started_at_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "private"."preserve_warmup_started_at_v1"() TO "postgres";
ALTER FUNCTION "public"."reconcile_account_package_runtime_contract_change"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."reconcile_account_package_runtime_contract_change"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."reconcile_account_package_runtime_contract_change"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."reconcile_account_package_runtime_contract_change"() TO "service_role";
ALTER FUNCTION "auth"."email"() OWNER TO "supabase_auth_admin";
REVOKE ALL ON FUNCTION "auth"."email"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth"."email"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "auth"."email"() TO "supabase_auth_admin";
GRANT EXECUTE ON FUNCTION "auth"."email"() TO "dashboard_user";
ALTER FUNCTION "public"."release_schedule_capacity_on_account_admin_lifecycle"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."release_schedule_capacity_on_account_admin_lifecycle"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."release_schedule_capacity_on_account_admin_lifecycle"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."release_schedule_capacity_on_account_admin_lifecycle"() TO "service_role";
ALTER FUNCTION "public"."jsonb_has_forbidden_safe_metadata_key"(p_metadata jsonb) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."jsonb_has_forbidden_safe_metadata_key"(p_metadata jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."jsonb_has_forbidden_safe_metadata_key"(p_metadata jsonb) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."jsonb_has_forbidden_safe_metadata_key"(p_metadata jsonb) TO "service_role";
ALTER FUNCTION "public"."apply_account_unfollow_enablement_provenance_v1"(p_account_id uuid) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."apply_account_unfollow_enablement_provenance_v1"(p_account_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."apply_account_unfollow_enablement_provenance_v1"(p_account_id uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."apply_account_unfollow_enablement_provenance_v1"(p_account_id uuid) TO "service_role";
ALTER FUNCTION "public"."reconcile_account_package_runtime_contract"(p_account_id uuid, p_source text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."reconcile_account_package_runtime_contract"(p_account_id uuid, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."reconcile_account_package_runtime_contract"(p_account_id uuid, p_source text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."reconcile_account_package_runtime_contract"(p_account_id uuid, p_source text) TO "service_role";
ALTER FUNCTION "public"."enforce_terminal_cancel_admin_monotonicity_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."enforce_terminal_cancel_admin_monotonicity_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_admin_monotonicity_v1"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_admin_monotonicity_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_admin_monotonicity_v1"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_admin_monotonicity_v1"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_admin_monotonicity_v1"() TO "service_role";
ALTER FUNCTION "auth"."jwt"() OWNER TO "supabase_auth_admin";
REVOKE ALL ON FUNCTION "auth"."jwt"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth"."jwt"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "auth"."jwt"() TO "postgres";
GRANT EXECUTE ON FUNCTION "auth"."jwt"() TO "supabase_auth_admin";
GRANT EXECUTE ON FUNCTION "auth"."jwt"() TO "dashboard_user";
ALTER FUNCTION "public"."audit_schedule_capacity_event"(p_event_type text, p_account_id uuid, p_assignment_id uuid, p_app_instance_id uuid, p_reason text, p_metadata jsonb) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."audit_schedule_capacity_event"(p_event_type text, p_account_id uuid, p_assignment_id uuid, p_app_instance_id uuid, p_reason text, p_metadata jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."audit_schedule_capacity_event"(p_event_type text, p_account_id uuid, p_assignment_id uuid, p_app_instance_id uuid, p_reason text, p_metadata jsonb) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."audit_schedule_capacity_event"(p_event_type text, p_account_id uuid, p_assignment_id uuid, p_app_instance_id uuid, p_reason text, p_metadata jsonb) TO "service_role";
ALTER FUNCTION "public"."release_account_schedule_capacity"(p_account_id uuid, p_reason text, p_source text, p_actor_id uuid) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."release_account_schedule_capacity"(p_account_id uuid, p_reason text, p_source text, p_actor_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."release_account_schedule_capacity"(p_account_id uuid, p_reason text, p_source text, p_actor_id uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."release_account_schedule_capacity"(p_account_id uuid, p_reason text, p_source text, p_actor_id uuid) TO "service_role";
ALTER FUNCTION "public"."reconcile_package_runtime_before_unfollow_enablement_v1"(p_account_id uuid, p_source text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."reconcile_package_runtime_before_unfollow_enablement_v1"(p_account_id uuid, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."reconcile_package_runtime_before_unfollow_enablement_v1"(p_account_id uuid, p_source text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."reconcile_package_runtime_before_unfollow_enablement_v1"(p_account_id uuid, p_source text) TO "service_role";
ALTER FUNCTION "public"."enforce_terminal_cancel_entitlement_monotonicity_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."enforce_terminal_cancel_entitlement_monotonicity_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_entitlement_monotonicity_v1"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_entitlement_monotonicity_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_entitlement_monotonicity_v1"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_entitlement_monotonicity_v1"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_entitlement_monotonicity_v1"() TO "service_role";
ALTER FUNCTION "public"."normalize_plan_change_target_pricing_snapshot"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."normalize_plan_change_target_pricing_snapshot"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."normalize_plan_change_target_pricing_snapshot"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."normalize_plan_change_target_pricing_snapshot"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."normalize_plan_change_target_pricing_snapshot"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."normalize_plan_change_target_pricing_snapshot"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."normalize_plan_change_target_pricing_snapshot"() TO "service_role";
ALTER FUNCTION "auth"."uid"() OWNER TO "supabase_auth_admin";
REVOKE ALL ON FUNCTION "auth"."uid"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth"."uid"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "auth"."uid"() TO "supabase_auth_admin";
GRANT EXECUTE ON FUNCTION "auth"."uid"() TO "dashboard_user";
ALTER FUNCTION "auth"."role"() OWNER TO "supabase_auth_admin";
REVOKE ALL ON FUNCTION "auth"."role"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth"."role"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "auth"."role"() TO "supabase_auth_admin";
GRANT EXECUTE ON FUNCTION "auth"."role"() TO "dashboard_user";
ALTER FUNCTION "public"."block_invalid_login_package_runtime_contract"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."block_invalid_login_package_runtime_contract"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."block_invalid_login_package_runtime_contract"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."block_invalid_login_package_runtime_contract"() TO "service_role";
ALTER FUNCTION "public"."enforce_assignment_package_runtime_contract"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."enforce_assignment_package_runtime_contract"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_assignment_package_runtime_contract"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."enforce_assignment_package_runtime_contract"() TO "service_role";
ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO "service_role";
ALTER FUNCTION "public"."account_has_active_runtime_session"(p_account_id uuid) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."account_has_active_runtime_session"(p_account_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."account_has_active_runtime_session"(p_account_id uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."account_has_active_runtime_session"(p_account_id uuid) TO "service_role";
ALTER FUNCTION "public"."sync_app_instance_after_assignment_change"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."sync_app_instance_after_assignment_change"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."sync_app_instance_after_assignment_change"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."sync_app_instance_after_assignment_change"() TO "service_role";
ALTER FUNCTION "public"."stamp_assignment_release_metadata"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."stamp_assignment_release_metadata"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."stamp_assignment_release_metadata"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."stamp_assignment_release_metadata"() TO "service_role";
ALTER FUNCTION "public"."validate_account_assignment"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."validate_account_assignment"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."validate_account_assignment"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."validate_account_assignment"() TO "service_role";
ALTER FUNCTION "public"."run_control_metadata_is_safe"(p_metadata jsonb) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."run_control_metadata_is_safe"(p_metadata jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."run_control_metadata_is_safe"(p_metadata jsonb) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."run_control_metadata_is_safe"(p_metadata jsonb) TO "anon";
GRANT EXECUTE ON FUNCTION "public"."run_control_metadata_is_safe"(p_metadata jsonb) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."run_control_metadata_is_safe"(p_metadata jsonb) TO "service_role";
ALTER FUNCTION "public"."enforce_auto_restart_phase_plan_v2"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."enforce_auto_restart_phase_plan_v2"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_auto_restart_phase_plan_v2"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."enforce_auto_restart_phase_plan_v2"() TO "service_role";
ALTER FUNCTION "public"."apply_account_unfollow_limit_provenance_v1"(p_account_id uuid) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."apply_account_unfollow_limit_provenance_v1"(p_account_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."apply_account_unfollow_limit_provenance_v1"(p_account_id uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."apply_account_unfollow_limit_provenance_v1"(p_account_id uuid) TO "service_role";
ALTER FUNCTION "public"."reconcile_account_package_runtime_contract_follow_provenance_v1"(p_account_id uuid, p_source text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."reconcile_account_package_runtime_contract_follow_provenance_v1"(p_account_id uuid, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."reconcile_account_package_runtime_contract_follow_provenance_v1"(p_account_id uuid, p_source text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."reconcile_account_package_runtime_contract_follow_provenance_v1"(p_account_id uuid, p_source text) TO "service_role";
ALTER FUNCTION "public"."enforce_device_recurring_assignment_exclusivity_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."enforce_device_recurring_assignment_exclusivity_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_device_recurring_assignment_exclusivity_v1"() TO "postgres";
ALTER FUNCTION "public"."phonefarm_storage_admission_guard_v2"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."phonefarm_storage_admission_guard_v2"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."phonefarm_storage_admission_guard_v2"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."phonefarm_storage_admission_guard_v2"() TO "service_role";
ALTER FUNCTION "public"."enforce_commercial_cancel_terminal_monotonicity_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."enforce_commercial_cancel_terminal_monotonicity_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_commercial_cancel_terminal_monotonicity_v1"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_commercial_cancel_terminal_monotonicity_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."enforce_commercial_cancel_terminal_monotonicity_v1"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."enforce_commercial_cancel_terminal_monotonicity_v1"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."enforce_commercial_cancel_terminal_monotonicity_v1"() TO "service_role";
ALTER FUNCTION "public"."account_run_request_lineage_v1_guard"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."account_run_request_lineage_v1_guard"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."account_run_request_lineage_v1_guard"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."account_run_request_lineage_v1_guard"() TO "service_role";
ALTER FUNCTION "public"."trigger_connected_instagram_growth_readiness_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."trigger_connected_instagram_growth_readiness_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."trigger_connected_instagram_growth_readiness_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."trigger_connected_instagram_growth_readiness_v1"() TO "service_role";
ALTER FUNCTION "public"."apply_authorized_resume_request_lineage_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."apply_authorized_resume_request_lineage_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."apply_authorized_resume_request_lineage_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."apply_authorized_resume_request_lineage_v1"() TO "service_role";
ALTER FUNCTION "public"."validate_assignment_slot_window"(p_assignment_type text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_timezone text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."validate_assignment_slot_window"(p_assignment_type text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_timezone text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."validate_assignment_slot_window"(p_assignment_type text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_timezone text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."validate_assignment_slot_window"(p_assignment_type text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_timezone text) TO "service_role";
ALTER FUNCTION "public"."account_package_runtime_contract_status"(p_account_id uuid) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."account_package_runtime_contract_status"(p_account_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."account_package_runtime_contract_status"(p_account_id uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."account_package_runtime_contract_status"(p_account_id uuid) TO "service_role";
ALTER FUNCTION "public"."validate_phone_clone_capacity"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."validate_phone_clone_capacity"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."validate_phone_clone_capacity"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."validate_phone_clone_capacity"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."validate_phone_clone_capacity"() TO "service_role";
ALTER FUNCTION "public"."is_open_assignment_status"(p_status text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."is_open_assignment_status"(p_status text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."is_open_assignment_status"(p_status text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."is_open_assignment_status"(p_status text) TO "service_role";
ALTER FUNCTION "public"."is_terminal_assignment_status"(p_status text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."is_terminal_assignment_status"(p_status text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."is_terminal_assignment_status"(p_status text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."is_terminal_assignment_status"(p_status text) TO "service_role";
ALTER FUNCTION "public"."release_app_instance_if_unused"(p_app_instance_id uuid, p_account_id uuid, p_reason text, p_source text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."release_app_instance_if_unused"(p_app_instance_id uuid, p_account_id uuid, p_reason text, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."release_app_instance_if_unused"(p_app_instance_id uuid, p_account_id uuid, p_reason text, p_source text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."release_app_instance_if_unused"(p_app_instance_id uuid, p_account_id uuid, p_reason text, p_source text) TO "service_role";
ALTER FUNCTION "public"."validate_client_subscription_account"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."validate_client_subscription_account"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_account"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_account"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_account"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_account"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_account"() TO "service_role";
ALTER FUNCTION "public"."validate_client_subscription_type"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."validate_client_subscription_type"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_type"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_type"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_type"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_type"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_type"() TO "service_role";
ALTER FUNCTION "public"."validate_phone_device_timezone"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."validate_phone_device_timezone"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."validate_phone_device_timezone"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."validate_phone_device_timezone"() TO "service_role";
ALTER FUNCTION "public"."reconcile_package_runtime_contract_pre_source_override_v1"(p_account_id uuid, p_source text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."reconcile_package_runtime_contract_pre_source_override_v1"(p_account_id uuid, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."reconcile_package_runtime_contract_pre_source_override_v1"(p_account_id uuid, p_source text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."reconcile_package_runtime_contract_pre_source_override_v1"(p_account_id uuid, p_source text) TO "service_role";
ALTER FUNCTION "public"."auto_restart_phase_plan_v2_error"(p_plan jsonb) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."auto_restart_phase_plan_v2_error"(p_plan jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."auto_restart_phase_plan_v2_error"(p_plan jsonb) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."auto_restart_phase_plan_v2_error"(p_plan jsonb) TO "service_role";
ALTER FUNCTION "public"."enforce_client_instagram_ready_identity_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."enforce_client_instagram_ready_identity_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_client_instagram_ready_identity_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."enforce_client_instagram_ready_identity_v1"() TO "service_role";
ALTER FUNCTION "public"."is_login_provisioning_business_gate_v1"(p_reason text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."is_login_provisioning_business_gate_v1"(p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."is_login_provisioning_business_gate_v1"(p_reason text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."is_login_provisioning_business_gate_v1"(p_reason text) TO "service_role";
ALTER FUNCTION "public"."reconcile_connected_instagram_growth_readiness_v1"(p_account_id uuid, p_source text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."reconcile_connected_instagram_growth_readiness_v1"(p_account_id uuid, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."reconcile_connected_instagram_growth_readiness_v1"(p_account_id uuid, p_source text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."reconcile_connected_instagram_growth_readiness_v1"(p_account_id uuid, p_source text) TO "service_role";
ALTER FUNCTION "public"."find_device_recurring_assignment_conflict_v1"(p_assignment_id uuid, p_device_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."find_device_recurring_assignment_conflict_v1"(p_assignment_id uuid, p_device_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."find_device_recurring_assignment_conflict_v1"(p_assignment_id uuid, p_device_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."find_device_recurring_assignment_conflict_v1"(p_assignment_id uuid, p_device_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone) TO "service_role";
ALTER FUNCTION "public"."enforce_client_instagram_login_monotonic_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."enforce_client_instagram_login_monotonic_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_client_instagram_login_monotonic_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."enforce_client_instagram_login_monotonic_v1"() TO "service_role";
ALTER FUNCTION "public"."stamp_worker_login_identity_provenance_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."stamp_worker_login_identity_provenance_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."stamp_worker_login_identity_provenance_v1"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."stamp_worker_login_identity_provenance_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."stamp_worker_login_identity_provenance_v1"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."stamp_worker_login_identity_provenance_v1"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."stamp_worker_login_identity_provenance_v1"() TO "service_role";
ALTER FUNCTION "public"."project_commercial_lifecycle_email_transition_evidence_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."project_commercial_lifecycle_email_transition_evidence_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."project_commercial_lifecycle_email_transition_evidence_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."project_commercial_lifecycle_email_transition_evidence_v1"() TO "service_role";
ALTER FUNCTION "public"."enforce_client_instagram_account_capacity_monotonicity_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."enforce_client_instagram_account_capacity_monotonicity_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_client_instagram_account_capacity_monotonicity_v1"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_client_instagram_account_capacity_monotonicity_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."enforce_client_instagram_account_capacity_monotonicity_v1"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."enforce_client_instagram_account_capacity_monotonicity_v1"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."enforce_client_instagram_account_capacity_monotonicity_v1"() TO "service_role";
ALTER FUNCTION "public"."guard_never_follow_twice_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."guard_never_follow_twice_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."guard_never_follow_twice_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."guard_never_follow_twice_v1"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."guard_never_follow_twice_v1"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."guard_never_follow_twice_v1"() TO "service_role";
ALTER FUNCTION "public"."project_ever_followed_canonical_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."project_ever_followed_canonical_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."project_ever_followed_canonical_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."project_ever_followed_canonical_v1"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."project_ever_followed_canonical_v1"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."project_ever_followed_canonical_v1"() TO "service_role";
ALTER FUNCTION "public"."trigger_instagram_password_remediation_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."trigger_instagram_password_remediation_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."trigger_instagram_password_remediation_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."trigger_instagram_password_remediation_v1"() TO "service_role";
ALTER FUNCTION "public"."notification_router_auto_login_success_v2"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."notification_router_auto_login_success_v2"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."notification_router_auto_login_success_v2"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."notification_router_auto_login_success_v2"() TO "service_role";
ALTER FUNCTION "public"."bump_ig_run_live_counter_revision_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."bump_ig_run_live_counter_revision_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."bump_ig_run_live_counter_revision_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."bump_ig_run_live_counter_revision_v1"() TO "service_role";
ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "service_role";
ALTER FUNCTION "public"."normalize_instagram_identity_username_v1"(p_username text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."normalize_instagram_identity_username_v1"(p_username text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."normalize_instagram_identity_username_v1"(p_username text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."normalize_instagram_identity_username_v1"(p_username text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."normalize_instagram_identity_username_v1"(p_username text) TO "anon";
GRANT EXECUTE ON FUNCTION "public"."normalize_instagram_identity_username_v1"(p_username text) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."normalize_instagram_identity_username_v1"(p_username text) TO "service_role";
ALTER FUNCTION "public"."validate_client_subscription_module"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."validate_client_subscription_module"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_module"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_module"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_module"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_module"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."validate_client_subscription_module"() TO "service_role";
ALTER FUNCTION "public"."set_ig_target_followback_ratio_p1c"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."set_ig_target_followback_ratio_p1c"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."set_ig_target_followback_ratio_p1c"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."set_ig_target_followback_ratio_p1c"() TO "service_role";
ALTER FUNCTION "public"."set_ig_targets_updated_at"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."set_ig_targets_updated_at"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."set_ig_targets_updated_at"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."set_ig_targets_updated_at"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."set_ig_targets_updated_at"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."set_ig_targets_updated_at"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."set_ig_targets_updated_at"() TO "service_role";
ALTER FUNCTION "public"."is_valid_schedule_timezone"(p_timezone text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."is_valid_schedule_timezone"(p_timezone text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."is_valid_schedule_timezone"(p_timezone text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."is_valid_schedule_timezone"(p_timezone text) TO "service_role";
ALTER FUNCTION "public"."reconcile_account_package_runtime_contract_legacy_limit_restore"(p_account_id uuid, p_source text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."reconcile_account_package_runtime_contract_legacy_limit_restore"(p_account_id uuid, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."reconcile_account_package_runtime_contract_legacy_limit_restore"(p_account_id uuid, p_source text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."reconcile_account_package_runtime_contract_legacy_limit_restore"(p_account_id uuid, p_source text) TO "service_role";
ALTER FUNCTION "public"."resolve_linked_incident_from_dashboard_action_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."resolve_linked_incident_from_dashboard_action_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."resolve_linked_incident_from_dashboard_action_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."resolve_linked_incident_from_dashboard_action_v1"() TO "service_role";
ALTER FUNCTION "public"."apply_account_follow_limit_provenance_v1"(p_account_id uuid) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."apply_account_follow_limit_provenance_v1"(p_account_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."apply_account_follow_limit_provenance_v1"(p_account_id uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."apply_account_follow_limit_provenance_v1"(p_account_id uuid) TO "service_role";
ALTER FUNCTION "public"."recurring_daily_windows_overlap_v1"(p_left_starts_at timestamp with time zone, p_left_ends_at timestamp with time zone, p_right_starts_at timestamp with time zone, p_right_ends_at timestamp with time zone, p_timezone text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."recurring_daily_windows_overlap_v1"(p_left_starts_at timestamp with time zone, p_left_ends_at timestamp with time zone, p_right_starts_at timestamp with time zone, p_right_ends_at timestamp with time zone, p_timezone text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."recurring_daily_windows_overlap_v1"(p_left_starts_at timestamp with time zone, p_left_ends_at timestamp with time zone, p_right_starts_at timestamp with time zone, p_right_ends_at timestamp with time zone, p_timezone text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."recurring_daily_windows_overlap_v1"(p_left_starts_at timestamp with time zone, p_left_ends_at timestamp with time zone, p_right_starts_at timestamp with time zone, p_right_ends_at timestamp with time zone, p_timezone text) TO "service_role";
ALTER FUNCTION "public"."normalize_instagram_login_invalidation_reason_v1"(p_reason text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."normalize_instagram_login_invalidation_reason_v1"(p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."normalize_instagram_login_invalidation_reason_v1"(p_reason text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."normalize_instagram_login_invalidation_reason_v1"(p_reason text) TO "service_role";
ALTER FUNCTION "public"."project_resolved_operator_review_runtime_v3"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."project_resolved_operator_review_runtime_v3"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."project_resolved_operator_review_runtime_v3"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."project_resolved_operator_review_runtime_v3"() TO "service_role";
ALTER FUNCTION "public"."project_operator_review_runtime_pause_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."project_operator_review_runtime_pause_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."project_operator_review_runtime_pause_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."project_operator_review_runtime_pause_v1"() TO "service_role";
ALTER FUNCTION "public"."capture_account_session_transition_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."capture_account_session_transition_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."capture_account_session_transition_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."capture_account_session_transition_v1"() TO "service_role";
ALTER FUNCTION "public"."reconcile_instagram_password_remediation_v1"(p_account_id uuid, p_source text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."reconcile_instagram_password_remediation_v1"(p_account_id uuid, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."reconcile_instagram_password_remediation_v1"(p_account_id uuid, p_source text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."reconcile_instagram_password_remediation_v1"(p_account_id uuid, p_source text) TO "service_role";
ALTER FUNCTION "public"."emit_notification_business_event_v2"(p_idempotency_key text, p_category text, p_environment text, p_event_type text, p_account_id uuid, p_client_id uuid, p_tenant_id uuid, p_business_payload jsonb, p_technical_diagnostics jsonb, p_occurred_at timestamp with time zone) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."emit_notification_business_event_v2"(p_idempotency_key text, p_category text, p_environment text, p_event_type text, p_account_id uuid, p_client_id uuid, p_tenant_id uuid, p_business_payload jsonb, p_technical_diagnostics jsonb, p_occurred_at timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."emit_notification_business_event_v2"(p_idempotency_key text, p_category text, p_environment text, p_event_type text, p_account_id uuid, p_client_id uuid, p_tenant_id uuid, p_business_payload jsonb, p_technical_diagnostics jsonb, p_occurred_at timestamp with time zone) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."emit_notification_business_event_v2"(p_idempotency_key text, p_category text, p_environment text, p_event_type text, p_account_id uuid, p_client_id uuid, p_tenant_id uuid, p_business_payload jsonb, p_technical_diagnostics jsonb, p_occurred_at timestamp with time zone) TO "service_role";
ALTER FUNCTION "public"."reconcile_account_package_runtime_contract_exact_v1"(p_account_id uuid, p_source text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."reconcile_account_package_runtime_contract_exact_v1"(p_account_id uuid, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."reconcile_account_package_runtime_contract_exact_v1"(p_account_id uuid, p_source text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."reconcile_account_package_runtime_contract_exact_v1"(p_account_id uuid, p_source text) TO "service_role";
ALTER FUNCTION "public"."set_account_incident_retention_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."set_account_incident_retention_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."set_account_incident_retention_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."set_account_incident_retention_v1"() TO "service_role";
ALTER FUNCTION "public"."reconcile_legacy_account_assignment_binding_v1"(p_account_id uuid, p_source text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."reconcile_legacy_account_assignment_binding_v1"(p_account_id uuid, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."reconcile_legacy_account_assignment_binding_v1"(p_account_id uuid, p_source text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."reconcile_legacy_account_assignment_binding_v1"(p_account_id uuid, p_source text) TO "service_role";
ALTER FUNCTION "public"."mark_instagram_restriction_preflight_required_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."mark_instagram_restriction_preflight_required_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."mark_instagram_restriction_preflight_required_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."mark_instagram_restriction_preflight_required_v1"() TO "service_role";
ALTER FUNCTION "public"."reconcile_operator_actions_from_resolved_incident_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."reconcile_operator_actions_from_resolved_incident_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."reconcile_operator_actions_from_resolved_incident_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."reconcile_operator_actions_from_resolved_incident_v1"() TO "service_role";
ALTER FUNCTION "public"."restore_resolved_operator_review_runtime_v3"(p_account_id uuid, p_incident_id uuid, p_source text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."restore_resolved_operator_review_runtime_v3"(p_account_id uuid, p_incident_id uuid, p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."restore_resolved_operator_review_runtime_v3"(p_account_id uuid, p_incident_id uuid, p_source text) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."restore_resolved_operator_review_runtime_v3"(p_account_id uuid, p_incident_id uuid, p_source text) TO "service_role";
ALTER FUNCTION "private"."enforce_stripe_subscription_account_binding_v1"() OWNER TO "postgres";
ALTER FUNCTION "public"."project_account_session_transition_v1"(p_account_id uuid, p_run_id uuid, p_performance_summary jsonb, p_source_updated_at timestamp with time zone) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."project_account_session_transition_v1"(p_account_id uuid, p_run_id uuid, p_performance_summary jsonb, p_source_updated_at timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."project_account_session_transition_v1"(p_account_id uuid, p_run_id uuid, p_performance_summary jsonb, p_source_updated_at timestamp with time zone) TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."project_account_session_transition_v1"(p_account_id uuid, p_run_id uuid, p_performance_summary jsonb, p_source_updated_at timestamp with time zone) TO "service_role";
ALTER FUNCTION "public"."guard_ever_followed_row_delete_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."guard_ever_followed_row_delete_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."guard_ever_followed_row_delete_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."guard_ever_followed_row_delete_v1"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."guard_ever_followed_row_delete_v1"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."guard_ever_followed_row_delete_v1"() TO "service_role";
ALTER FUNCTION "public"."guard_ever_followed_projection_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."guard_ever_followed_projection_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."guard_ever_followed_projection_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."guard_ever_followed_projection_v1"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."guard_ever_followed_projection_v1"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."guard_ever_followed_projection_v1"() TO "service_role";
ALTER FUNCTION "public"."enforce_terminal_cancel_subscription_monotonicity_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."enforce_terminal_cancel_subscription_monotonicity_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_subscription_monotonicity_v1"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_subscription_monotonicity_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_subscription_monotonicity_v1"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_subscription_monotonicity_v1"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."enforce_terminal_cancel_subscription_monotonicity_v1"() TO "service_role";
ALTER FUNCTION "public"."notification_router_general_incident_v2"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."notification_router_general_incident_v2"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."notification_router_general_incident_v2"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."notification_router_general_incident_v2"() TO "service_role";
ALTER FUNCTION "public"."arm_incident_resolution_auto_resume_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."arm_incident_resolution_auto_resume_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."arm_incident_resolution_auto_resume_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."arm_incident_resolution_auto_resume_v1"() TO "service_role";
ALTER FUNCTION "public"."notification_router_auto_login_failure_v2"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."notification_router_auto_login_failure_v2"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."notification_router_auto_login_failure_v2"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."notification_router_auto_login_failure_v2"() TO "service_role";
ALTER FUNCTION "public"."notification_router_plan_change_v2"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."notification_router_plan_change_v2"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."notification_router_plan_change_v2"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."notification_router_plan_change_v2"() TO "service_role";
ALTER FUNCTION "public"."sync_terminal_incident_dashboard_actions_v1"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."sync_terminal_incident_dashboard_actions_v1"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."sync_terminal_incident_dashboard_actions_v1"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."sync_terminal_incident_dashboard_actions_v1"() TO "service_role";
ALTER FUNCTION "public"."notification_router_materialize_deliveries_v2"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."notification_router_materialize_deliveries_v2"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."notification_router_materialize_deliveries_v2"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."notification_router_materialize_deliveries_v2"() TO "service_role";
ALTER FUNCTION "public"."notification_business_events_immutable_v2"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."notification_business_events_immutable_v2"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."notification_business_events_immutable_v2"() TO "postgres";
GRANT EXECUTE ON FUNCTION "public"."notification_business_events_immutable_v2"() TO "service_role";
ALTER TABLE "public"."account_warmup_settings" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."account_warmup_settings" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."account_warmup_settings" TO "postgres";
GRANT SELECT ON TABLE "public"."account_warmup_settings" TO "postgres";
GRANT UPDATE ON TABLE "public"."account_warmup_settings" TO "postgres";
GRANT DELETE ON TABLE "public"."account_warmup_settings" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."account_warmup_settings" TO "postgres";
GRANT REFERENCES ON TABLE "public"."account_warmup_settings" TO "postgres";
GRANT TRIGGER ON TABLE "public"."account_warmup_settings" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."account_warmup_settings" TO "postgres";
GRANT INSERT ON TABLE "public"."account_warmup_settings" TO "anon";
GRANT SELECT ON TABLE "public"."account_warmup_settings" TO "anon";
GRANT UPDATE ON TABLE "public"."account_warmup_settings" TO "anon";
GRANT DELETE ON TABLE "public"."account_warmup_settings" TO "anon";
GRANT TRUNCATE ON TABLE "public"."account_warmup_settings" TO "anon";
GRANT REFERENCES ON TABLE "public"."account_warmup_settings" TO "anon";
GRANT TRIGGER ON TABLE "public"."account_warmup_settings" TO "anon";
GRANT MAINTAIN ON TABLE "public"."account_warmup_settings" TO "anon";
GRANT INSERT ON TABLE "public"."account_warmup_settings" TO "authenticated";
GRANT SELECT ON TABLE "public"."account_warmup_settings" TO "authenticated";
GRANT UPDATE ON TABLE "public"."account_warmup_settings" TO "authenticated";
GRANT DELETE ON TABLE "public"."account_warmup_settings" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."account_warmup_settings" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."account_warmup_settings" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."account_warmup_settings" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."account_warmup_settings" TO "authenticated";
GRANT INSERT ON TABLE "public"."account_warmup_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."account_warmup_settings" TO "service_role";
GRANT UPDATE ON TABLE "public"."account_warmup_settings" TO "service_role";
GRANT DELETE ON TABLE "public"."account_warmup_settings" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."account_warmup_settings" TO "service_role";
GRANT REFERENCES ON TABLE "public"."account_warmup_settings" TO "service_role";
GRANT TRIGGER ON TABLE "public"."account_warmup_settings" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."account_warmup_settings" TO "service_role";
ALTER TABLE "public"."commercial_packages" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."commercial_packages" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."commercial_packages" TO "postgres";
GRANT SELECT ON TABLE "public"."commercial_packages" TO "postgres";
GRANT UPDATE ON TABLE "public"."commercial_packages" TO "postgres";
GRANT DELETE ON TABLE "public"."commercial_packages" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."commercial_packages" TO "postgres";
GRANT REFERENCES ON TABLE "public"."commercial_packages" TO "postgres";
GRANT TRIGGER ON TABLE "public"."commercial_packages" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."commercial_packages" TO "postgres";
GRANT INSERT ON TABLE "public"."commercial_packages" TO "anon";
GRANT SELECT ON TABLE "public"."commercial_packages" TO "anon";
GRANT UPDATE ON TABLE "public"."commercial_packages" TO "anon";
GRANT DELETE ON TABLE "public"."commercial_packages" TO "anon";
GRANT TRUNCATE ON TABLE "public"."commercial_packages" TO "anon";
GRANT REFERENCES ON TABLE "public"."commercial_packages" TO "anon";
GRANT TRIGGER ON TABLE "public"."commercial_packages" TO "anon";
GRANT MAINTAIN ON TABLE "public"."commercial_packages" TO "anon";
GRANT INSERT ON TABLE "public"."commercial_packages" TO "authenticated";
GRANT SELECT ON TABLE "public"."commercial_packages" TO "authenticated";
GRANT UPDATE ON TABLE "public"."commercial_packages" TO "authenticated";
GRANT DELETE ON TABLE "public"."commercial_packages" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."commercial_packages" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."commercial_packages" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."commercial_packages" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."commercial_packages" TO "authenticated";
GRANT INSERT ON TABLE "public"."commercial_packages" TO "service_role";
GRANT SELECT ON TABLE "public"."commercial_packages" TO "service_role";
GRANT UPDATE ON TABLE "public"."commercial_packages" TO "service_role";
GRANT DELETE ON TABLE "public"."commercial_packages" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."commercial_packages" TO "service_role";
GRANT REFERENCES ON TABLE "public"."commercial_packages" TO "service_role";
GRANT TRIGGER ON TABLE "public"."commercial_packages" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."commercial_packages" TO "service_role";
ALTER TABLE "public"."account_commercial_packages" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."account_commercial_packages" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."account_commercial_packages" TO "postgres";
GRANT SELECT ON TABLE "public"."account_commercial_packages" TO "postgres";
GRANT UPDATE ON TABLE "public"."account_commercial_packages" TO "postgres";
GRANT DELETE ON TABLE "public"."account_commercial_packages" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."account_commercial_packages" TO "postgres";
GRANT REFERENCES ON TABLE "public"."account_commercial_packages" TO "postgres";
GRANT TRIGGER ON TABLE "public"."account_commercial_packages" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."account_commercial_packages" TO "postgres";
GRANT INSERT ON TABLE "public"."account_commercial_packages" TO "anon";
GRANT SELECT ON TABLE "public"."account_commercial_packages" TO "anon";
GRANT UPDATE ON TABLE "public"."account_commercial_packages" TO "anon";
GRANT DELETE ON TABLE "public"."account_commercial_packages" TO "anon";
GRANT TRUNCATE ON TABLE "public"."account_commercial_packages" TO "anon";
GRANT REFERENCES ON TABLE "public"."account_commercial_packages" TO "anon";
GRANT TRIGGER ON TABLE "public"."account_commercial_packages" TO "anon";
GRANT MAINTAIN ON TABLE "public"."account_commercial_packages" TO "anon";
GRANT INSERT ON TABLE "public"."account_commercial_packages" TO "authenticated";
GRANT SELECT ON TABLE "public"."account_commercial_packages" TO "authenticated";
GRANT UPDATE ON TABLE "public"."account_commercial_packages" TO "authenticated";
GRANT DELETE ON TABLE "public"."account_commercial_packages" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."account_commercial_packages" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."account_commercial_packages" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."account_commercial_packages" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."account_commercial_packages" TO "authenticated";
GRANT INSERT ON TABLE "public"."account_commercial_packages" TO "service_role";
GRANT SELECT ON TABLE "public"."account_commercial_packages" TO "service_role";
GRANT UPDATE ON TABLE "public"."account_commercial_packages" TO "service_role";
GRANT DELETE ON TABLE "public"."account_commercial_packages" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."account_commercial_packages" TO "service_role";
GRANT REFERENCES ON TABLE "public"."account_commercial_packages" TO "service_role";
GRANT TRIGGER ON TABLE "public"."account_commercial_packages" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."account_commercial_packages" TO "service_role";
ALTER TABLE "public"."ig_account_social_profile_snapshots" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_account_social_profile_snapshots" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_account_social_profile_snapshots" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_account_social_profile_snapshots" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_account_social_profile_snapshots" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_account_social_profile_snapshots" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_account_social_profile_snapshots" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_account_social_profile_snapshots" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_account_social_profile_snapshots" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_account_social_profile_snapshots" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_account_social_profile_snapshots" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_account_social_profile_snapshots" TO "service_role";
ALTER TABLE "public"."ig_account_follow_limit_overrides" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_account_follow_limit_overrides" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_account_follow_limit_overrides" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_account_follow_limit_overrides" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_account_follow_limit_overrides" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_account_follow_limit_overrides" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_account_follow_limit_overrides" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_account_follow_limit_overrides" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_account_follow_limit_overrides" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_account_follow_limit_overrides" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_account_follow_limit_overrides" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_account_follow_limit_overrides" TO "service_role";
GRANT UPDATE ON TABLE "public"."ig_account_follow_limit_overrides" TO "service_role";
GRANT DELETE ON TABLE "public"."ig_account_follow_limit_overrides" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."ig_account_follow_limit_overrides" TO "service_role";
GRANT REFERENCES ON TABLE "public"."ig_account_follow_limit_overrides" TO "service_role";
GRANT TRIGGER ON TABLE "public"."ig_account_follow_limit_overrides" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."ig_account_follow_limit_overrides" TO "service_role";
ALTER TABLE "public"."ig_accounts" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_accounts" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_accounts" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_accounts" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_accounts" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_accounts" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_accounts" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_accounts" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_accounts" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_accounts" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_accounts" TO "anon";
GRANT SELECT ON TABLE "public"."ig_accounts" TO "anon";
GRANT UPDATE ON TABLE "public"."ig_accounts" TO "anon";
GRANT DELETE ON TABLE "public"."ig_accounts" TO "anon";
GRANT TRUNCATE ON TABLE "public"."ig_accounts" TO "anon";
GRANT REFERENCES ON TABLE "public"."ig_accounts" TO "anon";
GRANT TRIGGER ON TABLE "public"."ig_accounts" TO "anon";
GRANT MAINTAIN ON TABLE "public"."ig_accounts" TO "anon";
GRANT INSERT ON TABLE "public"."ig_accounts" TO "authenticated";
GRANT SELECT ON TABLE "public"."ig_accounts" TO "authenticated";
GRANT UPDATE ON TABLE "public"."ig_accounts" TO "authenticated";
GRANT DELETE ON TABLE "public"."ig_accounts" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."ig_accounts" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."ig_accounts" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."ig_accounts" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."ig_accounts" TO "authenticated";
GRANT INSERT ON TABLE "public"."ig_accounts" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_accounts" TO "service_role";
GRANT UPDATE ON TABLE "public"."ig_accounts" TO "service_role";
GRANT DELETE ON TABLE "public"."ig_accounts" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."ig_accounts" TO "service_role";
GRANT REFERENCES ON TABLE "public"."ig_accounts" TO "service_role";
GRANT TRIGGER ON TABLE "public"."ig_accounts" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."ig_accounts" TO "service_role";
ALTER TABLE "public"."ig_devices" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_devices" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_devices" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_devices" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_devices" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_devices" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_devices" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_devices" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_devices" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_devices" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_devices" TO "anon";
GRANT SELECT ON TABLE "public"."ig_devices" TO "anon";
GRANT UPDATE ON TABLE "public"."ig_devices" TO "anon";
GRANT DELETE ON TABLE "public"."ig_devices" TO "anon";
GRANT TRUNCATE ON TABLE "public"."ig_devices" TO "anon";
GRANT REFERENCES ON TABLE "public"."ig_devices" TO "anon";
GRANT TRIGGER ON TABLE "public"."ig_devices" TO "anon";
GRANT MAINTAIN ON TABLE "public"."ig_devices" TO "anon";
GRANT INSERT ON TABLE "public"."ig_devices" TO "authenticated";
GRANT SELECT ON TABLE "public"."ig_devices" TO "authenticated";
GRANT UPDATE ON TABLE "public"."ig_devices" TO "authenticated";
GRANT DELETE ON TABLE "public"."ig_devices" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."ig_devices" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."ig_devices" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."ig_devices" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."ig_devices" TO "authenticated";
GRANT INSERT ON TABLE "public"."ig_devices" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_devices" TO "service_role";
GRANT UPDATE ON TABLE "public"."ig_devices" TO "service_role";
GRANT DELETE ON TABLE "public"."ig_devices" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."ig_devices" TO "service_role";
GRANT REFERENCES ON TABLE "public"."ig_devices" TO "service_role";
GRANT TRIGGER ON TABLE "public"."ig_devices" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."ig_devices" TO "service_role";
ALTER TABLE "public"."client_account_entitlements" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."client_account_entitlements" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."client_account_entitlements" TO "postgres";
GRANT SELECT ON TABLE "public"."client_account_entitlements" TO "postgres";
GRANT UPDATE ON TABLE "public"."client_account_entitlements" TO "postgres";
GRANT DELETE ON TABLE "public"."client_account_entitlements" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."client_account_entitlements" TO "postgres";
GRANT REFERENCES ON TABLE "public"."client_account_entitlements" TO "postgres";
GRANT TRIGGER ON TABLE "public"."client_account_entitlements" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."client_account_entitlements" TO "postgres";
GRANT INSERT ON TABLE "public"."client_account_entitlements" TO "anon";
GRANT SELECT ON TABLE "public"."client_account_entitlements" TO "anon";
GRANT UPDATE ON TABLE "public"."client_account_entitlements" TO "anon";
GRANT DELETE ON TABLE "public"."client_account_entitlements" TO "anon";
GRANT TRUNCATE ON TABLE "public"."client_account_entitlements" TO "anon";
GRANT REFERENCES ON TABLE "public"."client_account_entitlements" TO "anon";
GRANT TRIGGER ON TABLE "public"."client_account_entitlements" TO "anon";
GRANT MAINTAIN ON TABLE "public"."client_account_entitlements" TO "anon";
GRANT INSERT ON TABLE "public"."client_account_entitlements" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_account_entitlements" TO "authenticated";
GRANT UPDATE ON TABLE "public"."client_account_entitlements" TO "authenticated";
GRANT DELETE ON TABLE "public"."client_account_entitlements" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."client_account_entitlements" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."client_account_entitlements" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."client_account_entitlements" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."client_account_entitlements" TO "authenticated";
GRANT INSERT ON TABLE "public"."client_account_entitlements" TO "service_role";
GRANT SELECT ON TABLE "public"."client_account_entitlements" TO "service_role";
GRANT UPDATE ON TABLE "public"."client_account_entitlements" TO "service_role";
GRANT DELETE ON TABLE "public"."client_account_entitlements" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."client_account_entitlements" TO "service_role";
GRANT REFERENCES ON TABLE "public"."client_account_entitlements" TO "service_role";
GRANT TRIGGER ON TABLE "public"."client_account_entitlements" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."client_account_entitlements" TO "service_role";
ALTER TABLE "public"."account_package_runtime_contract_events" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."account_package_runtime_contract_events" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."account_package_runtime_contract_events" TO "postgres";
GRANT SELECT ON TABLE "public"."account_package_runtime_contract_events" TO "postgres";
GRANT UPDATE ON TABLE "public"."account_package_runtime_contract_events" TO "postgres";
GRANT DELETE ON TABLE "public"."account_package_runtime_contract_events" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."account_package_runtime_contract_events" TO "postgres";
GRANT REFERENCES ON TABLE "public"."account_package_runtime_contract_events" TO "postgres";
GRANT TRIGGER ON TABLE "public"."account_package_runtime_contract_events" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."account_package_runtime_contract_events" TO "postgres";
GRANT INSERT ON TABLE "public"."account_package_runtime_contract_events" TO "service_role";
GRANT SELECT ON TABLE "public"."account_package_runtime_contract_events" TO "service_role";
GRANT UPDATE ON TABLE "public"."account_package_runtime_contract_events" TO "service_role";
GRANT DELETE ON TABLE "public"."account_package_runtime_contract_events" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."account_package_runtime_contract_events" TO "service_role";
GRANT REFERENCES ON TABLE "public"."account_package_runtime_contract_events" TO "service_role";
GRANT TRIGGER ON TABLE "public"."account_package_runtime_contract_events" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."account_package_runtime_contract_events" TO "service_role";
ALTER TABLE "public"."ig_account_unfollow_settings" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_account_unfollow_settings" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_account_unfollow_settings" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_account_unfollow_settings" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_account_unfollow_settings" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_account_unfollow_settings" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_account_unfollow_settings" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_account_unfollow_settings" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_account_unfollow_settings" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_account_unfollow_settings" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_account_unfollow_settings" TO "anon";
GRANT SELECT ON TABLE "public"."ig_account_unfollow_settings" TO "anon";
GRANT UPDATE ON TABLE "public"."ig_account_unfollow_settings" TO "anon";
GRANT DELETE ON TABLE "public"."ig_account_unfollow_settings" TO "anon";
GRANT TRUNCATE ON TABLE "public"."ig_account_unfollow_settings" TO "anon";
GRANT REFERENCES ON TABLE "public"."ig_account_unfollow_settings" TO "anon";
GRANT TRIGGER ON TABLE "public"."ig_account_unfollow_settings" TO "anon";
GRANT MAINTAIN ON TABLE "public"."ig_account_unfollow_settings" TO "anon";
GRANT INSERT ON TABLE "public"."ig_account_unfollow_settings" TO "authenticated";
GRANT SELECT ON TABLE "public"."ig_account_unfollow_settings" TO "authenticated";
GRANT UPDATE ON TABLE "public"."ig_account_unfollow_settings" TO "authenticated";
GRANT DELETE ON TABLE "public"."ig_account_unfollow_settings" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."ig_account_unfollow_settings" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."ig_account_unfollow_settings" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."ig_account_unfollow_settings" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."ig_account_unfollow_settings" TO "authenticated";
GRANT INSERT ON TABLE "public"."ig_account_unfollow_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_account_unfollow_settings" TO "service_role";
GRANT UPDATE ON TABLE "public"."ig_account_unfollow_settings" TO "service_role";
GRANT DELETE ON TABLE "public"."ig_account_unfollow_settings" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."ig_account_unfollow_settings" TO "service_role";
GRANT REFERENCES ON TABLE "public"."ig_account_unfollow_settings" TO "service_role";
GRANT TRIGGER ON TABLE "public"."ig_account_unfollow_settings" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."ig_account_unfollow_settings" TO "service_role";
ALTER TABLE "public"."clients" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."clients" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."clients" TO "postgres";
GRANT SELECT ON TABLE "public"."clients" TO "postgres";
GRANT UPDATE ON TABLE "public"."clients" TO "postgres";
GRANT DELETE ON TABLE "public"."clients" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."clients" TO "postgres";
GRANT REFERENCES ON TABLE "public"."clients" TO "postgres";
GRANT TRIGGER ON TABLE "public"."clients" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."clients" TO "postgres";
GRANT INSERT ON TABLE "public"."clients" TO "anon";
GRANT SELECT ON TABLE "public"."clients" TO "anon";
GRANT UPDATE ON TABLE "public"."clients" TO "anon";
GRANT DELETE ON TABLE "public"."clients" TO "anon";
GRANT TRUNCATE ON TABLE "public"."clients" TO "anon";
GRANT REFERENCES ON TABLE "public"."clients" TO "anon";
GRANT TRIGGER ON TABLE "public"."clients" TO "anon";
GRANT MAINTAIN ON TABLE "public"."clients" TO "anon";
GRANT INSERT ON TABLE "public"."clients" TO "authenticated";
GRANT SELECT ON TABLE "public"."clients" TO "authenticated";
GRANT UPDATE ON TABLE "public"."clients" TO "authenticated";
GRANT DELETE ON TABLE "public"."clients" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."clients" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."clients" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."clients" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."clients" TO "authenticated";
GRANT INSERT ON TABLE "public"."clients" TO "service_role";
GRANT SELECT ON TABLE "public"."clients" TO "service_role";
GRANT UPDATE ON TABLE "public"."clients" TO "service_role";
GRANT DELETE ON TABLE "public"."clients" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."clients" TO "service_role";
GRANT REFERENCES ON TABLE "public"."clients" TO "service_role";
GRANT TRIGGER ON TABLE "public"."clients" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."clients" TO "service_role";
ALTER TABLE "public"."account_assignments" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."account_assignments" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."account_assignments" TO "postgres";
GRANT SELECT ON TABLE "public"."account_assignments" TO "postgres";
GRANT UPDATE ON TABLE "public"."account_assignments" TO "postgres";
GRANT DELETE ON TABLE "public"."account_assignments" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."account_assignments" TO "postgres";
GRANT REFERENCES ON TABLE "public"."account_assignments" TO "postgres";
GRANT TRIGGER ON TABLE "public"."account_assignments" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."account_assignments" TO "postgres";
GRANT INSERT ON TABLE "public"."account_assignments" TO "anon";
GRANT SELECT ON TABLE "public"."account_assignments" TO "anon";
GRANT UPDATE ON TABLE "public"."account_assignments" TO "anon";
GRANT DELETE ON TABLE "public"."account_assignments" TO "anon";
GRANT TRUNCATE ON TABLE "public"."account_assignments" TO "anon";
GRANT REFERENCES ON TABLE "public"."account_assignments" TO "anon";
GRANT TRIGGER ON TABLE "public"."account_assignments" TO "anon";
GRANT MAINTAIN ON TABLE "public"."account_assignments" TO "anon";
GRANT INSERT ON TABLE "public"."account_assignments" TO "authenticated";
GRANT SELECT ON TABLE "public"."account_assignments" TO "authenticated";
GRANT UPDATE ON TABLE "public"."account_assignments" TO "authenticated";
GRANT DELETE ON TABLE "public"."account_assignments" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."account_assignments" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."account_assignments" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."account_assignments" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."account_assignments" TO "authenticated";
GRANT INSERT ON TABLE "public"."account_assignments" TO "service_role";
GRANT SELECT ON TABLE "public"."account_assignments" TO "service_role";
GRANT UPDATE ON TABLE "public"."account_assignments" TO "service_role";
GRANT DELETE ON TABLE "public"."account_assignments" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."account_assignments" TO "service_role";
GRANT REFERENCES ON TABLE "public"."account_assignments" TO "service_role";
GRANT TRIGGER ON TABLE "public"."account_assignments" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."account_assignments" TO "service_role";
ALTER TABLE "public"."commercial_checkout_sessions" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."commercial_checkout_sessions" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."commercial_checkout_sessions" TO "postgres";
GRANT SELECT ON TABLE "public"."commercial_checkout_sessions" TO "postgres";
GRANT UPDATE ON TABLE "public"."commercial_checkout_sessions" TO "postgres";
GRANT DELETE ON TABLE "public"."commercial_checkout_sessions" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."commercial_checkout_sessions" TO "postgres";
GRANT REFERENCES ON TABLE "public"."commercial_checkout_sessions" TO "postgres";
GRANT TRIGGER ON TABLE "public"."commercial_checkout_sessions" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."commercial_checkout_sessions" TO "postgres";
GRANT INSERT ON TABLE "public"."commercial_checkout_sessions" TO "anon";
GRANT SELECT ON TABLE "public"."commercial_checkout_sessions" TO "anon";
GRANT UPDATE ON TABLE "public"."commercial_checkout_sessions" TO "anon";
GRANT DELETE ON TABLE "public"."commercial_checkout_sessions" TO "anon";
GRANT TRUNCATE ON TABLE "public"."commercial_checkout_sessions" TO "anon";
GRANT REFERENCES ON TABLE "public"."commercial_checkout_sessions" TO "anon";
GRANT TRIGGER ON TABLE "public"."commercial_checkout_sessions" TO "anon";
GRANT MAINTAIN ON TABLE "public"."commercial_checkout_sessions" TO "anon";
GRANT INSERT ON TABLE "public"."commercial_checkout_sessions" TO "authenticated";
GRANT SELECT ON TABLE "public"."commercial_checkout_sessions" TO "authenticated";
GRANT UPDATE ON TABLE "public"."commercial_checkout_sessions" TO "authenticated";
GRANT DELETE ON TABLE "public"."commercial_checkout_sessions" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."commercial_checkout_sessions" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."commercial_checkout_sessions" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."commercial_checkout_sessions" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."commercial_checkout_sessions" TO "authenticated";
GRANT INSERT ON TABLE "public"."commercial_checkout_sessions" TO "service_role";
GRANT SELECT ON TABLE "public"."commercial_checkout_sessions" TO "service_role";
GRANT UPDATE ON TABLE "public"."commercial_checkout_sessions" TO "service_role";
GRANT DELETE ON TABLE "public"."commercial_checkout_sessions" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."commercial_checkout_sessions" TO "service_role";
GRANT REFERENCES ON TABLE "public"."commercial_checkout_sessions" TO "service_role";
GRANT TRIGGER ON TABLE "public"."commercial_checkout_sessions" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."commercial_checkout_sessions" TO "service_role";
ALTER TABLE "public"."account_run_requests" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."account_run_requests" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."account_run_requests" TO "postgres";
GRANT SELECT ON TABLE "public"."account_run_requests" TO "postgres";
GRANT UPDATE ON TABLE "public"."account_run_requests" TO "postgres";
GRANT DELETE ON TABLE "public"."account_run_requests" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."account_run_requests" TO "postgres";
GRANT REFERENCES ON TABLE "public"."account_run_requests" TO "postgres";
GRANT TRIGGER ON TABLE "public"."account_run_requests" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."account_run_requests" TO "postgres";
GRANT INSERT ON TABLE "public"."account_run_requests" TO "service_role";
GRANT SELECT ON TABLE "public"."account_run_requests" TO "service_role";
GRANT UPDATE ON TABLE "public"."account_run_requests" TO "service_role";
GRANT DELETE ON TABLE "public"."account_run_requests" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."account_run_requests" TO "service_role";
GRANT REFERENCES ON TABLE "public"."account_run_requests" TO "service_role";
GRANT TRIGGER ON TABLE "public"."account_run_requests" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."account_run_requests" TO "service_role";
ALTER TABLE "public"."ig_account_settings" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_account_settings" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_account_settings" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_account_settings" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_account_settings" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_account_settings" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_account_settings" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_account_settings" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_account_settings" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_account_settings" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_account_settings" TO "anon";
GRANT SELECT ON TABLE "public"."ig_account_settings" TO "anon";
GRANT UPDATE ON TABLE "public"."ig_account_settings" TO "anon";
GRANT DELETE ON TABLE "public"."ig_account_settings" TO "anon";
GRANT TRUNCATE ON TABLE "public"."ig_account_settings" TO "anon";
GRANT REFERENCES ON TABLE "public"."ig_account_settings" TO "anon";
GRANT TRIGGER ON TABLE "public"."ig_account_settings" TO "anon";
GRANT MAINTAIN ON TABLE "public"."ig_account_settings" TO "anon";
GRANT INSERT ON TABLE "public"."ig_account_settings" TO "authenticated";
GRANT SELECT ON TABLE "public"."ig_account_settings" TO "authenticated";
GRANT UPDATE ON TABLE "public"."ig_account_settings" TO "authenticated";
GRANT DELETE ON TABLE "public"."ig_account_settings" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."ig_account_settings" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."ig_account_settings" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."ig_account_settings" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."ig_account_settings" TO "authenticated";
GRANT INSERT ON TABLE "public"."ig_account_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_account_settings" TO "service_role";
GRANT UPDATE ON TABLE "public"."ig_account_settings" TO "service_role";
GRANT DELETE ON TABLE "public"."ig_account_settings" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."ig_account_settings" TO "service_role";
GRANT REFERENCES ON TABLE "public"."ig_account_settings" TO "service_role";
GRANT TRIGGER ON TABLE "public"."ig_account_settings" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."ig_account_settings" TO "service_role";
ALTER TABLE "public"."ig_account_unfollow_enablement_overrides" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_account_unfollow_enablement_overrides" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "service_role";
GRANT UPDATE ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "service_role";
GRANT DELETE ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "service_role";
GRANT REFERENCES ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "service_role";
GRANT TRIGGER ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."ig_account_unfollow_enablement_overrides" TO "service_role";
ALTER TABLE "public"."commercial_account_lifecycle_states" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."commercial_account_lifecycle_states" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."commercial_account_lifecycle_states" TO "postgres";
GRANT SELECT ON TABLE "public"."commercial_account_lifecycle_states" TO "postgres";
GRANT UPDATE ON TABLE "public"."commercial_account_lifecycle_states" TO "postgres";
GRANT DELETE ON TABLE "public"."commercial_account_lifecycle_states" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."commercial_account_lifecycle_states" TO "postgres";
GRANT REFERENCES ON TABLE "public"."commercial_account_lifecycle_states" TO "postgres";
GRANT TRIGGER ON TABLE "public"."commercial_account_lifecycle_states" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."commercial_account_lifecycle_states" TO "postgres";
GRANT INSERT ON TABLE "public"."commercial_account_lifecycle_states" TO "service_role";
GRANT SELECT ON TABLE "public"."commercial_account_lifecycle_states" TO "service_role";
GRANT UPDATE ON TABLE "public"."commercial_account_lifecycle_states" TO "service_role";
GRANT DELETE ON TABLE "public"."commercial_account_lifecycle_states" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."commercial_account_lifecycle_states" TO "service_role";
GRANT REFERENCES ON TABLE "public"."commercial_account_lifecycle_states" TO "service_role";
GRANT TRIGGER ON TABLE "public"."commercial_account_lifecycle_states" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."commercial_account_lifecycle_states" TO "service_role";
ALTER TABLE "public"."ig_account_dm_settings" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_account_dm_settings" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_account_dm_settings" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_account_dm_settings" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_account_dm_settings" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_account_dm_settings" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_account_dm_settings" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_account_dm_settings" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_account_dm_settings" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_account_dm_settings" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_account_dm_settings" TO "anon";
GRANT SELECT ON TABLE "public"."ig_account_dm_settings" TO "anon";
GRANT UPDATE ON TABLE "public"."ig_account_dm_settings" TO "anon";
GRANT DELETE ON TABLE "public"."ig_account_dm_settings" TO "anon";
GRANT TRUNCATE ON TABLE "public"."ig_account_dm_settings" TO "anon";
GRANT REFERENCES ON TABLE "public"."ig_account_dm_settings" TO "anon";
GRANT TRIGGER ON TABLE "public"."ig_account_dm_settings" TO "anon";
GRANT MAINTAIN ON TABLE "public"."ig_account_dm_settings" TO "anon";
GRANT INSERT ON TABLE "public"."ig_account_dm_settings" TO "authenticated";
GRANT SELECT ON TABLE "public"."ig_account_dm_settings" TO "authenticated";
GRANT UPDATE ON TABLE "public"."ig_account_dm_settings" TO "authenticated";
GRANT DELETE ON TABLE "public"."ig_account_dm_settings" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."ig_account_dm_settings" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."ig_account_dm_settings" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."ig_account_dm_settings" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."ig_account_dm_settings" TO "authenticated";
GRANT INSERT ON TABLE "public"."ig_account_dm_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_account_dm_settings" TO "service_role";
GRANT UPDATE ON TABLE "public"."ig_account_dm_settings" TO "service_role";
GRANT DELETE ON TABLE "public"."ig_account_dm_settings" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."ig_account_dm_settings" TO "service_role";
GRANT REFERENCES ON TABLE "public"."ig_account_dm_settings" TO "service_role";
GRANT TRIGGER ON TABLE "public"."ig_account_dm_settings" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."ig_account_dm_settings" TO "service_role";
ALTER TABLE "public"."ig_interaction_events" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_interaction_events" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_interaction_events" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_interaction_events" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_interaction_events" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_interaction_events" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_interaction_events" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_interaction_events" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_interaction_events" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_interaction_events" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_interaction_events" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_interaction_events" TO "service_role";
GRANT UPDATE ON TABLE "public"."ig_interaction_events" TO "service_role";
GRANT DELETE ON TABLE "public"."ig_interaction_events" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."ig_interaction_events" TO "service_role";
GRANT REFERENCES ON TABLE "public"."ig_interaction_events" TO "service_role";
GRANT TRIGGER ON TABLE "public"."ig_interaction_events" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."ig_interaction_events" TO "service_role";
ALTER TABLE "public"."commercial_plan_change_quotes" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."commercial_plan_change_quotes" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."commercial_plan_change_quotes" TO "postgres";
GRANT SELECT ON TABLE "public"."commercial_plan_change_quotes" TO "postgres";
GRANT UPDATE ON TABLE "public"."commercial_plan_change_quotes" TO "postgres";
GRANT DELETE ON TABLE "public"."commercial_plan_change_quotes" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."commercial_plan_change_quotes" TO "postgres";
GRANT REFERENCES ON TABLE "public"."commercial_plan_change_quotes" TO "postgres";
GRANT TRIGGER ON TABLE "public"."commercial_plan_change_quotes" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."commercial_plan_change_quotes" TO "postgres";
GRANT INSERT ON TABLE "public"."commercial_plan_change_quotes" TO "service_role";
GRANT SELECT ON TABLE "public"."commercial_plan_change_quotes" TO "service_role";
GRANT UPDATE ON TABLE "public"."commercial_plan_change_quotes" TO "service_role";
GRANT DELETE ON TABLE "public"."commercial_plan_change_quotes" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."commercial_plan_change_quotes" TO "service_role";
GRANT REFERENCES ON TABLE "public"."commercial_plan_change_quotes" TO "service_role";
GRANT TRIGGER ON TABLE "public"."commercial_plan_change_quotes" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."commercial_plan_change_quotes" TO "service_role";
ALTER TABLE "public"."client_users" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."client_users" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."client_users" TO "postgres";
GRANT SELECT ON TABLE "public"."client_users" TO "postgres";
GRANT UPDATE ON TABLE "public"."client_users" TO "postgres";
GRANT DELETE ON TABLE "public"."client_users" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."client_users" TO "postgres";
GRANT REFERENCES ON TABLE "public"."client_users" TO "postgres";
GRANT TRIGGER ON TABLE "public"."client_users" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."client_users" TO "postgres";
GRANT INSERT ON TABLE "public"."client_users" TO "anon";
GRANT SELECT ON TABLE "public"."client_users" TO "anon";
GRANT UPDATE ON TABLE "public"."client_users" TO "anon";
GRANT DELETE ON TABLE "public"."client_users" TO "anon";
GRANT TRUNCATE ON TABLE "public"."client_users" TO "anon";
GRANT REFERENCES ON TABLE "public"."client_users" TO "anon";
GRANT TRIGGER ON TABLE "public"."client_users" TO "anon";
GRANT MAINTAIN ON TABLE "public"."client_users" TO "anon";
GRANT INSERT ON TABLE "public"."client_users" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_users" TO "authenticated";
GRANT UPDATE ON TABLE "public"."client_users" TO "authenticated";
GRANT DELETE ON TABLE "public"."client_users" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."client_users" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."client_users" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."client_users" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."client_users" TO "authenticated";
GRANT INSERT ON TABLE "public"."client_users" TO "service_role";
GRANT SELECT ON TABLE "public"."client_users" TO "service_role";
GRANT UPDATE ON TABLE "public"."client_users" TO "service_role";
GRANT DELETE ON TABLE "public"."client_users" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."client_users" TO "service_role";
GRANT REFERENCES ON TABLE "public"."client_users" TO "service_role";
GRANT TRIGGER ON TABLE "public"."client_users" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."client_users" TO "service_role";
ALTER TABLE "public"."client_entitlements" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."client_entitlements" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."client_entitlements" TO "postgres";
GRANT SELECT ON TABLE "public"."client_entitlements" TO "postgres";
GRANT UPDATE ON TABLE "public"."client_entitlements" TO "postgres";
GRANT DELETE ON TABLE "public"."client_entitlements" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."client_entitlements" TO "postgres";
GRANT REFERENCES ON TABLE "public"."client_entitlements" TO "postgres";
GRANT TRIGGER ON TABLE "public"."client_entitlements" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."client_entitlements" TO "postgres";
GRANT INSERT ON TABLE "public"."client_entitlements" TO "anon";
GRANT SELECT ON TABLE "public"."client_entitlements" TO "anon";
GRANT UPDATE ON TABLE "public"."client_entitlements" TO "anon";
GRANT DELETE ON TABLE "public"."client_entitlements" TO "anon";
GRANT TRUNCATE ON TABLE "public"."client_entitlements" TO "anon";
GRANT REFERENCES ON TABLE "public"."client_entitlements" TO "anon";
GRANT TRIGGER ON TABLE "public"."client_entitlements" TO "anon";
GRANT MAINTAIN ON TABLE "public"."client_entitlements" TO "anon";
GRANT INSERT ON TABLE "public"."client_entitlements" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_entitlements" TO "authenticated";
GRANT UPDATE ON TABLE "public"."client_entitlements" TO "authenticated";
GRANT DELETE ON TABLE "public"."client_entitlements" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."client_entitlements" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."client_entitlements" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."client_entitlements" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."client_entitlements" TO "authenticated";
GRANT INSERT ON TABLE "public"."client_entitlements" TO "service_role";
GRANT SELECT ON TABLE "public"."client_entitlements" TO "service_role";
GRANT UPDATE ON TABLE "public"."client_entitlements" TO "service_role";
GRANT DELETE ON TABLE "public"."client_entitlements" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."client_entitlements" TO "service_role";
GRANT REFERENCES ON TABLE "public"."client_entitlements" TO "service_role";
GRANT TRIGGER ON TABLE "public"."client_entitlements" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."client_entitlements" TO "service_role";
ALTER TABLE "public"."client_subscriptions" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."client_subscriptions" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."client_subscriptions" TO "postgres";
GRANT SELECT ON TABLE "public"."client_subscriptions" TO "postgres";
GRANT UPDATE ON TABLE "public"."client_subscriptions" TO "postgres";
GRANT DELETE ON TABLE "public"."client_subscriptions" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."client_subscriptions" TO "postgres";
GRANT REFERENCES ON TABLE "public"."client_subscriptions" TO "postgres";
GRANT TRIGGER ON TABLE "public"."client_subscriptions" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."client_subscriptions" TO "postgres";
GRANT INSERT ON TABLE "public"."client_subscriptions" TO "anon";
GRANT SELECT ON TABLE "public"."client_subscriptions" TO "anon";
GRANT UPDATE ON TABLE "public"."client_subscriptions" TO "anon";
GRANT DELETE ON TABLE "public"."client_subscriptions" TO "anon";
GRANT TRUNCATE ON TABLE "public"."client_subscriptions" TO "anon";
GRANT REFERENCES ON TABLE "public"."client_subscriptions" TO "anon";
GRANT TRIGGER ON TABLE "public"."client_subscriptions" TO "anon";
GRANT MAINTAIN ON TABLE "public"."client_subscriptions" TO "anon";
GRANT INSERT ON TABLE "public"."client_subscriptions" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_subscriptions" TO "authenticated";
GRANT UPDATE ON TABLE "public"."client_subscriptions" TO "authenticated";
GRANT DELETE ON TABLE "public"."client_subscriptions" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."client_subscriptions" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."client_subscriptions" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."client_subscriptions" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."client_subscriptions" TO "authenticated";
GRANT INSERT ON TABLE "public"."client_subscriptions" TO "service_role";
GRANT SELECT ON TABLE "public"."client_subscriptions" TO "service_role";
GRANT UPDATE ON TABLE "public"."client_subscriptions" TO "service_role";
GRANT DELETE ON TABLE "public"."client_subscriptions" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."client_subscriptions" TO "service_role";
GRANT REFERENCES ON TABLE "public"."client_subscriptions" TO "service_role";
GRANT TRIGGER ON TABLE "public"."client_subscriptions" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."client_subscriptions" TO "service_role";
ALTER TABLE "public"."client_subscription_accounts" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."client_subscription_accounts" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."client_subscription_accounts" TO "postgres";
GRANT SELECT ON TABLE "public"."client_subscription_accounts" TO "postgres";
GRANT UPDATE ON TABLE "public"."client_subscription_accounts" TO "postgres";
GRANT DELETE ON TABLE "public"."client_subscription_accounts" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."client_subscription_accounts" TO "postgres";
GRANT REFERENCES ON TABLE "public"."client_subscription_accounts" TO "postgres";
GRANT TRIGGER ON TABLE "public"."client_subscription_accounts" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."client_subscription_accounts" TO "postgres";
GRANT INSERT ON TABLE "public"."client_subscription_accounts" TO "anon";
GRANT SELECT ON TABLE "public"."client_subscription_accounts" TO "anon";
GRANT UPDATE ON TABLE "public"."client_subscription_accounts" TO "anon";
GRANT DELETE ON TABLE "public"."client_subscription_accounts" TO "anon";
GRANT TRUNCATE ON TABLE "public"."client_subscription_accounts" TO "anon";
GRANT REFERENCES ON TABLE "public"."client_subscription_accounts" TO "anon";
GRANT TRIGGER ON TABLE "public"."client_subscription_accounts" TO "anon";
GRANT MAINTAIN ON TABLE "public"."client_subscription_accounts" TO "anon";
GRANT INSERT ON TABLE "public"."client_subscription_accounts" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_subscription_accounts" TO "authenticated";
GRANT UPDATE ON TABLE "public"."client_subscription_accounts" TO "authenticated";
GRANT DELETE ON TABLE "public"."client_subscription_accounts" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."client_subscription_accounts" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."client_subscription_accounts" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."client_subscription_accounts" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."client_subscription_accounts" TO "authenticated";
GRANT INSERT ON TABLE "public"."client_subscription_accounts" TO "service_role";
GRANT SELECT ON TABLE "public"."client_subscription_accounts" TO "service_role";
GRANT UPDATE ON TABLE "public"."client_subscription_accounts" TO "service_role";
GRANT DELETE ON TABLE "public"."client_subscription_accounts" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."client_subscription_accounts" TO "service_role";
GRANT REFERENCES ON TABLE "public"."client_subscription_accounts" TO "service_role";
GRANT TRIGGER ON TABLE "public"."client_subscription_accounts" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."client_subscription_accounts" TO "service_role";
ALTER TABLE "public"."phone_clones" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."phone_clones" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."phone_clones" TO "postgres";
GRANT SELECT ON TABLE "public"."phone_clones" TO "postgres";
GRANT UPDATE ON TABLE "public"."phone_clones" TO "postgres";
GRANT DELETE ON TABLE "public"."phone_clones" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."phone_clones" TO "postgres";
GRANT REFERENCES ON TABLE "public"."phone_clones" TO "postgres";
GRANT TRIGGER ON TABLE "public"."phone_clones" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."phone_clones" TO "postgres";
GRANT INSERT ON TABLE "public"."phone_clones" TO "anon";
GRANT SELECT ON TABLE "public"."phone_clones" TO "anon";
GRANT UPDATE ON TABLE "public"."phone_clones" TO "anon";
GRANT DELETE ON TABLE "public"."phone_clones" TO "anon";
GRANT TRUNCATE ON TABLE "public"."phone_clones" TO "anon";
GRANT REFERENCES ON TABLE "public"."phone_clones" TO "anon";
GRANT TRIGGER ON TABLE "public"."phone_clones" TO "anon";
GRANT MAINTAIN ON TABLE "public"."phone_clones" TO "anon";
GRANT INSERT ON TABLE "public"."phone_clones" TO "service_role";
GRANT SELECT ON TABLE "public"."phone_clones" TO "service_role";
GRANT UPDATE ON TABLE "public"."phone_clones" TO "service_role";
GRANT DELETE ON TABLE "public"."phone_clones" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."phone_clones" TO "service_role";
GRANT REFERENCES ON TABLE "public"."phone_clones" TO "service_role";
GRANT TRIGGER ON TABLE "public"."phone_clones" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."phone_clones" TO "service_role";
ALTER TABLE "public"."phone_devices" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."phone_devices" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."phone_devices" TO "postgres";
GRANT SELECT ON TABLE "public"."phone_devices" TO "postgres";
GRANT UPDATE ON TABLE "public"."phone_devices" TO "postgres";
GRANT DELETE ON TABLE "public"."phone_devices" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."phone_devices" TO "postgres";
GRANT REFERENCES ON TABLE "public"."phone_devices" TO "postgres";
GRANT TRIGGER ON TABLE "public"."phone_devices" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."phone_devices" TO "postgres";
GRANT INSERT ON TABLE "public"."phone_devices" TO "anon";
GRANT SELECT ON TABLE "public"."phone_devices" TO "anon";
GRANT UPDATE ON TABLE "public"."phone_devices" TO "anon";
GRANT DELETE ON TABLE "public"."phone_devices" TO "anon";
GRANT TRUNCATE ON TABLE "public"."phone_devices" TO "anon";
GRANT REFERENCES ON TABLE "public"."phone_devices" TO "anon";
GRANT TRIGGER ON TABLE "public"."phone_devices" TO "anon";
GRANT MAINTAIN ON TABLE "public"."phone_devices" TO "anon";
GRANT INSERT ON TABLE "public"."phone_devices" TO "service_role";
GRANT SELECT ON TABLE "public"."phone_devices" TO "service_role";
GRANT UPDATE ON TABLE "public"."phone_devices" TO "service_role";
GRANT DELETE ON TABLE "public"."phone_devices" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."phone_devices" TO "service_role";
GRANT REFERENCES ON TABLE "public"."phone_devices" TO "service_role";
GRANT TRIGGER ON TABLE "public"."phone_devices" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."phone_devices" TO "service_role";
ALTER TABLE "public"."phone_app_instances" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."phone_app_instances" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."phone_app_instances" TO "postgres";
GRANT SELECT ON TABLE "public"."phone_app_instances" TO "postgres";
GRANT UPDATE ON TABLE "public"."phone_app_instances" TO "postgres";
GRANT DELETE ON TABLE "public"."phone_app_instances" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."phone_app_instances" TO "postgres";
GRANT REFERENCES ON TABLE "public"."phone_app_instances" TO "postgres";
GRANT TRIGGER ON TABLE "public"."phone_app_instances" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."phone_app_instances" TO "postgres";
GRANT INSERT ON TABLE "public"."phone_app_instances" TO "service_role";
GRANT SELECT ON TABLE "public"."phone_app_instances" TO "service_role";
GRANT UPDATE ON TABLE "public"."phone_app_instances" TO "service_role";
GRANT DELETE ON TABLE "public"."phone_app_instances" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."phone_app_instances" TO "service_role";
GRANT REFERENCES ON TABLE "public"."phone_app_instances" TO "service_role";
GRANT TRIGGER ON TABLE "public"."phone_app_instances" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."phone_app_instances" TO "service_role";
ALTER TABLE "public"."runtime_events" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."runtime_events" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."runtime_events" TO "postgres";
GRANT SELECT ON TABLE "public"."runtime_events" TO "postgres";
GRANT UPDATE ON TABLE "public"."runtime_events" TO "postgres";
GRANT DELETE ON TABLE "public"."runtime_events" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."runtime_events" TO "postgres";
GRANT REFERENCES ON TABLE "public"."runtime_events" TO "postgres";
GRANT TRIGGER ON TABLE "public"."runtime_events" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."runtime_events" TO "postgres";
GRANT INSERT ON TABLE "public"."runtime_events" TO "service_role";
GRANT SELECT ON TABLE "public"."runtime_events" TO "service_role";
GRANT UPDATE ON TABLE "public"."runtime_events" TO "service_role";
GRANT DELETE ON TABLE "public"."runtime_events" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."runtime_events" TO "service_role";
GRANT REFERENCES ON TABLE "public"."runtime_events" TO "service_role";
GRANT TRIGGER ON TABLE "public"."runtime_events" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."runtime_events" TO "service_role";
ALTER TABLE "public"."account_commercial_addons" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."account_commercial_addons" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."account_commercial_addons" TO "postgres";
GRANT SELECT ON TABLE "public"."account_commercial_addons" TO "postgres";
GRANT UPDATE ON TABLE "public"."account_commercial_addons" TO "postgres";
GRANT DELETE ON TABLE "public"."account_commercial_addons" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."account_commercial_addons" TO "postgres";
GRANT REFERENCES ON TABLE "public"."account_commercial_addons" TO "postgres";
GRANT TRIGGER ON TABLE "public"."account_commercial_addons" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."account_commercial_addons" TO "postgres";
GRANT INSERT ON TABLE "public"."account_commercial_addons" TO "anon";
GRANT SELECT ON TABLE "public"."account_commercial_addons" TO "anon";
GRANT UPDATE ON TABLE "public"."account_commercial_addons" TO "anon";
GRANT DELETE ON TABLE "public"."account_commercial_addons" TO "anon";
GRANT TRUNCATE ON TABLE "public"."account_commercial_addons" TO "anon";
GRANT REFERENCES ON TABLE "public"."account_commercial_addons" TO "anon";
GRANT TRIGGER ON TABLE "public"."account_commercial_addons" TO "anon";
GRANT MAINTAIN ON TABLE "public"."account_commercial_addons" TO "anon";
GRANT INSERT ON TABLE "public"."account_commercial_addons" TO "authenticated";
GRANT SELECT ON TABLE "public"."account_commercial_addons" TO "authenticated";
GRANT UPDATE ON TABLE "public"."account_commercial_addons" TO "authenticated";
GRANT DELETE ON TABLE "public"."account_commercial_addons" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."account_commercial_addons" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."account_commercial_addons" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."account_commercial_addons" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."account_commercial_addons" TO "authenticated";
GRANT INSERT ON TABLE "public"."account_commercial_addons" TO "service_role";
GRANT SELECT ON TABLE "public"."account_commercial_addons" TO "service_role";
GRANT UPDATE ON TABLE "public"."account_commercial_addons" TO "service_role";
GRANT DELETE ON TABLE "public"."account_commercial_addons" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."account_commercial_addons" TO "service_role";
GRANT REFERENCES ON TABLE "public"."account_commercial_addons" TO "service_role";
GRANT TRIGGER ON TABLE "public"."account_commercial_addons" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."account_commercial_addons" TO "service_role";
ALTER TABLE "public"."commercial_account_lifecycle_operations" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."commercial_account_lifecycle_operations" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."commercial_account_lifecycle_operations" TO "postgres";
GRANT SELECT ON TABLE "public"."commercial_account_lifecycle_operations" TO "postgres";
GRANT UPDATE ON TABLE "public"."commercial_account_lifecycle_operations" TO "postgres";
GRANT DELETE ON TABLE "public"."commercial_account_lifecycle_operations" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."commercial_account_lifecycle_operations" TO "postgres";
GRANT REFERENCES ON TABLE "public"."commercial_account_lifecycle_operations" TO "postgres";
GRANT TRIGGER ON TABLE "public"."commercial_account_lifecycle_operations" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."commercial_account_lifecycle_operations" TO "postgres";
GRANT INSERT ON TABLE "public"."commercial_account_lifecycle_operations" TO "service_role";
GRANT SELECT ON TABLE "public"."commercial_account_lifecycle_operations" TO "service_role";
GRANT UPDATE ON TABLE "public"."commercial_account_lifecycle_operations" TO "service_role";
GRANT DELETE ON TABLE "public"."commercial_account_lifecycle_operations" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."commercial_account_lifecycle_operations" TO "service_role";
GRANT REFERENCES ON TABLE "public"."commercial_account_lifecycle_operations" TO "service_role";
GRANT TRIGGER ON TABLE "public"."commercial_account_lifecycle_operations" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."commercial_account_lifecycle_operations" TO "service_role";
ALTER TABLE "public"."client_instagram_accounts" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."client_instagram_accounts" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."client_instagram_accounts" TO "postgres";
GRANT SELECT ON TABLE "public"."client_instagram_accounts" TO "postgres";
GRANT UPDATE ON TABLE "public"."client_instagram_accounts" TO "postgres";
GRANT DELETE ON TABLE "public"."client_instagram_accounts" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."client_instagram_accounts" TO "postgres";
GRANT REFERENCES ON TABLE "public"."client_instagram_accounts" TO "postgres";
GRANT TRIGGER ON TABLE "public"."client_instagram_accounts" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."client_instagram_accounts" TO "postgres";
GRANT INSERT ON TABLE "public"."client_instagram_accounts" TO "anon";
GRANT SELECT ON TABLE "public"."client_instagram_accounts" TO "anon";
GRANT UPDATE ON TABLE "public"."client_instagram_accounts" TO "anon";
GRANT DELETE ON TABLE "public"."client_instagram_accounts" TO "anon";
GRANT TRUNCATE ON TABLE "public"."client_instagram_accounts" TO "anon";
GRANT REFERENCES ON TABLE "public"."client_instagram_accounts" TO "anon";
GRANT TRIGGER ON TABLE "public"."client_instagram_accounts" TO "anon";
GRANT MAINTAIN ON TABLE "public"."client_instagram_accounts" TO "anon";
GRANT INSERT ON TABLE "public"."client_instagram_accounts" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_instagram_accounts" TO "authenticated";
GRANT UPDATE ON TABLE "public"."client_instagram_accounts" TO "authenticated";
GRANT DELETE ON TABLE "public"."client_instagram_accounts" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."client_instagram_accounts" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."client_instagram_accounts" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."client_instagram_accounts" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."client_instagram_accounts" TO "authenticated";
GRANT INSERT ON TABLE "public"."client_instagram_accounts" TO "service_role";
GRANT SELECT ON TABLE "public"."client_instagram_accounts" TO "service_role";
GRANT UPDATE ON TABLE "public"."client_instagram_accounts" TO "service_role";
GRANT DELETE ON TABLE "public"."client_instagram_accounts" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."client_instagram_accounts" TO "service_role";
GRANT REFERENCES ON TABLE "public"."client_instagram_accounts" TO "service_role";
GRANT TRIGGER ON TABLE "public"."client_instagram_accounts" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."client_instagram_accounts" TO "service_role";
ALTER TABLE "auth"."users" OWNER TO "supabase_auth_admin";
REVOKE ALL ON TABLE "auth"."users" FROM PUBLIC;
GRANT INSERT ON TABLE "auth"."users" TO "supabase_auth_admin";
GRANT SELECT ON TABLE "auth"."users" TO "supabase_auth_admin";
GRANT UPDATE ON TABLE "auth"."users" TO "supabase_auth_admin";
GRANT DELETE ON TABLE "auth"."users" TO "supabase_auth_admin";
GRANT TRUNCATE ON TABLE "auth"."users" TO "supabase_auth_admin";
GRANT REFERENCES ON TABLE "auth"."users" TO "supabase_auth_admin";
GRANT TRIGGER ON TABLE "auth"."users" TO "supabase_auth_admin";
GRANT MAINTAIN ON TABLE "auth"."users" TO "supabase_auth_admin";
GRANT INSERT ON TABLE "auth"."users" TO "dashboard_user";
GRANT SELECT ON TABLE "auth"."users" TO "dashboard_user";
GRANT UPDATE ON TABLE "auth"."users" TO "dashboard_user";
GRANT DELETE ON TABLE "auth"."users" TO "dashboard_user";
GRANT TRUNCATE ON TABLE "auth"."users" TO "dashboard_user";
GRANT REFERENCES ON TABLE "auth"."users" TO "dashboard_user";
GRANT TRIGGER ON TABLE "auth"."users" TO "dashboard_user";
GRANT MAINTAIN ON TABLE "auth"."users" TO "dashboard_user";
GRANT INSERT ON TABLE "auth"."users" TO "postgres";
GRANT SELECT ON TABLE "auth"."users" TO "postgres" WITH GRANT OPTION;
GRANT UPDATE ON TABLE "auth"."users" TO "postgres";
GRANT DELETE ON TABLE "auth"."users" TO "postgres";
GRANT TRUNCATE ON TABLE "auth"."users" TO "postgres";
GRANT REFERENCES ON TABLE "auth"."users" TO "postgres";
GRANT TRIGGER ON TABLE "auth"."users" TO "postgres";
GRANT MAINTAIN ON TABLE "auth"."users" TO "postgres";
ALTER TABLE "public"."ig_dm_templates" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_dm_templates" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_dm_templates" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_dm_templates" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_dm_templates" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_dm_templates" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_dm_templates" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_dm_templates" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_dm_templates" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_dm_templates" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_dm_templates" TO "anon";
GRANT SELECT ON TABLE "public"."ig_dm_templates" TO "anon";
GRANT UPDATE ON TABLE "public"."ig_dm_templates" TO "anon";
GRANT DELETE ON TABLE "public"."ig_dm_templates" TO "anon";
GRANT TRUNCATE ON TABLE "public"."ig_dm_templates" TO "anon";
GRANT REFERENCES ON TABLE "public"."ig_dm_templates" TO "anon";
GRANT TRIGGER ON TABLE "public"."ig_dm_templates" TO "anon";
GRANT MAINTAIN ON TABLE "public"."ig_dm_templates" TO "anon";
GRANT INSERT ON TABLE "public"."ig_dm_templates" TO "authenticated";
GRANT SELECT ON TABLE "public"."ig_dm_templates" TO "authenticated";
GRANT UPDATE ON TABLE "public"."ig_dm_templates" TO "authenticated";
GRANT DELETE ON TABLE "public"."ig_dm_templates" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."ig_dm_templates" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."ig_dm_templates" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."ig_dm_templates" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."ig_dm_templates" TO "authenticated";
GRANT INSERT ON TABLE "public"."ig_dm_templates" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_dm_templates" TO "service_role";
GRANT UPDATE ON TABLE "public"."ig_dm_templates" TO "service_role";
GRANT DELETE ON TABLE "public"."ig_dm_templates" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."ig_dm_templates" TO "service_role";
GRANT REFERENCES ON TABLE "public"."ig_dm_templates" TO "service_role";
GRANT TRIGGER ON TABLE "public"."ig_dm_templates" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."ig_dm_templates" TO "service_role";
ALTER TABLE "public"."ig_targets" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_targets" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_targets" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_targets" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_targets" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_targets" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_targets" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_targets" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_targets" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_targets" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_targets" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_targets" TO "service_role";
GRANT UPDATE ON TABLE "public"."ig_targets" TO "service_role";
GRANT DELETE ON TABLE "public"."ig_targets" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."ig_targets" TO "service_role";
GRANT REFERENCES ON TABLE "public"."ig_targets" TO "service_role";
GRANT TRIGGER ON TABLE "public"."ig_targets" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."ig_targets" TO "service_role";
ALTER TABLE "public"."client_subscription_modules" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."client_subscription_modules" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."client_subscription_modules" TO "postgres";
GRANT SELECT ON TABLE "public"."client_subscription_modules" TO "postgres";
GRANT UPDATE ON TABLE "public"."client_subscription_modules" TO "postgres";
GRANT DELETE ON TABLE "public"."client_subscription_modules" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."client_subscription_modules" TO "postgres";
GRANT REFERENCES ON TABLE "public"."client_subscription_modules" TO "postgres";
GRANT TRIGGER ON TABLE "public"."client_subscription_modules" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."client_subscription_modules" TO "postgres";
GRANT INSERT ON TABLE "public"."client_subscription_modules" TO "anon";
GRANT SELECT ON TABLE "public"."client_subscription_modules" TO "anon";
GRANT UPDATE ON TABLE "public"."client_subscription_modules" TO "anon";
GRANT DELETE ON TABLE "public"."client_subscription_modules" TO "anon";
GRANT TRUNCATE ON TABLE "public"."client_subscription_modules" TO "anon";
GRANT REFERENCES ON TABLE "public"."client_subscription_modules" TO "anon";
GRANT TRIGGER ON TABLE "public"."client_subscription_modules" TO "anon";
GRANT MAINTAIN ON TABLE "public"."client_subscription_modules" TO "anon";
GRANT INSERT ON TABLE "public"."client_subscription_modules" TO "authenticated";
GRANT SELECT ON TABLE "public"."client_subscription_modules" TO "authenticated";
GRANT UPDATE ON TABLE "public"."client_subscription_modules" TO "authenticated";
GRANT DELETE ON TABLE "public"."client_subscription_modules" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."client_subscription_modules" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."client_subscription_modules" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."client_subscription_modules" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."client_subscription_modules" TO "authenticated";
GRANT INSERT ON TABLE "public"."client_subscription_modules" TO "service_role";
GRANT SELECT ON TABLE "public"."client_subscription_modules" TO "service_role";
GRANT UPDATE ON TABLE "public"."client_subscription_modules" TO "service_role";
GRANT DELETE ON TABLE "public"."client_subscription_modules" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."client_subscription_modules" TO "service_role";
GRANT REFERENCES ON TABLE "public"."client_subscription_modules" TO "service_role";
GRANT TRIGGER ON TABLE "public"."client_subscription_modules" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."client_subscription_modules" TO "service_role";
ALTER TABLE "public"."account_follow_source_settings" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."account_follow_source_settings" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."account_follow_source_settings" TO "postgres";
GRANT SELECT ON TABLE "public"."account_follow_source_settings" TO "postgres";
GRANT UPDATE ON TABLE "public"."account_follow_source_settings" TO "postgres";
GRANT DELETE ON TABLE "public"."account_follow_source_settings" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."account_follow_source_settings" TO "postgres";
GRANT REFERENCES ON TABLE "public"."account_follow_source_settings" TO "postgres";
GRANT TRIGGER ON TABLE "public"."account_follow_source_settings" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."account_follow_source_settings" TO "postgres";
GRANT INSERT ON TABLE "public"."account_follow_source_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."account_follow_source_settings" TO "service_role";
GRANT UPDATE ON TABLE "public"."account_follow_source_settings" TO "service_role";
GRANT DELETE ON TABLE "public"."account_follow_source_settings" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."account_follow_source_settings" TO "service_role";
GRANT REFERENCES ON TABLE "public"."account_follow_source_settings" TO "service_role";
GRANT TRIGGER ON TABLE "public"."account_follow_source_settings" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."account_follow_source_settings" TO "service_role";
ALTER TABLE "public"."account_dashboard_actions" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."account_dashboard_actions" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."account_dashboard_actions" TO "postgres";
GRANT SELECT ON TABLE "public"."account_dashboard_actions" TO "postgres";
GRANT UPDATE ON TABLE "public"."account_dashboard_actions" TO "postgres";
GRANT DELETE ON TABLE "public"."account_dashboard_actions" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."account_dashboard_actions" TO "postgres";
GRANT REFERENCES ON TABLE "public"."account_dashboard_actions" TO "postgres";
GRANT TRIGGER ON TABLE "public"."account_dashboard_actions" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."account_dashboard_actions" TO "postgres";
GRANT INSERT ON TABLE "public"."account_dashboard_actions" TO "service_role";
GRANT SELECT ON TABLE "public"."account_dashboard_actions" TO "service_role";
GRANT UPDATE ON TABLE "public"."account_dashboard_actions" TO "service_role";
GRANT DELETE ON TABLE "public"."account_dashboard_actions" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."account_dashboard_actions" TO "service_role";
GRANT REFERENCES ON TABLE "public"."account_dashboard_actions" TO "service_role";
GRANT TRIGGER ON TABLE "public"."account_dashboard_actions" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."account_dashboard_actions" TO "service_role";
ALTER TABLE "public"."commercial_package_runtime_settings" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."commercial_package_runtime_settings" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."commercial_package_runtime_settings" TO "postgres";
GRANT SELECT ON TABLE "public"."commercial_package_runtime_settings" TO "postgres";
GRANT UPDATE ON TABLE "public"."commercial_package_runtime_settings" TO "postgres";
GRANT DELETE ON TABLE "public"."commercial_package_runtime_settings" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."commercial_package_runtime_settings" TO "postgres";
GRANT REFERENCES ON TABLE "public"."commercial_package_runtime_settings" TO "postgres";
GRANT TRIGGER ON TABLE "public"."commercial_package_runtime_settings" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."commercial_package_runtime_settings" TO "postgres";
GRANT INSERT ON TABLE "public"."commercial_package_runtime_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."commercial_package_runtime_settings" TO "service_role";
GRANT UPDATE ON TABLE "public"."commercial_package_runtime_settings" TO "service_role";
GRANT DELETE ON TABLE "public"."commercial_package_runtime_settings" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."commercial_package_runtime_settings" TO "service_role";
GRANT REFERENCES ON TABLE "public"."commercial_package_runtime_settings" TO "service_role";
GRANT TRIGGER ON TABLE "public"."commercial_package_runtime_settings" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."commercial_package_runtime_settings" TO "service_role";
ALTER TABLE "public"."ig_runs" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_runs" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_runs" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_runs" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_runs" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_runs" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_runs" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_runs" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_runs" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_runs" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_runs" TO "anon";
GRANT SELECT ON TABLE "public"."ig_runs" TO "anon";
GRANT UPDATE ON TABLE "public"."ig_runs" TO "anon";
GRANT DELETE ON TABLE "public"."ig_runs" TO "anon";
GRANT TRUNCATE ON TABLE "public"."ig_runs" TO "anon";
GRANT REFERENCES ON TABLE "public"."ig_runs" TO "anon";
GRANT TRIGGER ON TABLE "public"."ig_runs" TO "anon";
GRANT MAINTAIN ON TABLE "public"."ig_runs" TO "anon";
GRANT INSERT ON TABLE "public"."ig_runs" TO "authenticated";
GRANT SELECT ON TABLE "public"."ig_runs" TO "authenticated";
GRANT UPDATE ON TABLE "public"."ig_runs" TO "authenticated";
GRANT DELETE ON TABLE "public"."ig_runs" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."ig_runs" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."ig_runs" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."ig_runs" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."ig_runs" TO "authenticated";
GRANT INSERT ON TABLE "public"."ig_runs" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_runs" TO "service_role";
GRANT UPDATE ON TABLE "public"."ig_runs" TO "service_role";
GRANT DELETE ON TABLE "public"."ig_runs" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."ig_runs" TO "service_role";
GRANT REFERENCES ON TABLE "public"."ig_runs" TO "service_role";
GRANT TRIGGER ON TABLE "public"."ig_runs" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."ig_runs" TO "service_role";
ALTER TABLE "public"."incident_resume_authorizations" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."incident_resume_authorizations" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."incident_resume_authorizations" TO "postgres";
GRANT SELECT ON TABLE "public"."incident_resume_authorizations" TO "postgres";
GRANT UPDATE ON TABLE "public"."incident_resume_authorizations" TO "postgres";
GRANT DELETE ON TABLE "public"."incident_resume_authorizations" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."incident_resume_authorizations" TO "postgres";
GRANT REFERENCES ON TABLE "public"."incident_resume_authorizations" TO "postgres";
GRANT TRIGGER ON TABLE "public"."incident_resume_authorizations" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."incident_resume_authorizations" TO "postgres";
GRANT INSERT ON TABLE "public"."incident_resume_authorizations" TO "service_role";
GRANT SELECT ON TABLE "public"."incident_resume_authorizations" TO "service_role";
GRANT UPDATE ON TABLE "public"."incident_resume_authorizations" TO "service_role";
GRANT DELETE ON TABLE "public"."incident_resume_authorizations" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."incident_resume_authorizations" TO "service_role";
GRANT REFERENCES ON TABLE "public"."incident_resume_authorizations" TO "service_role";
GRANT TRIGGER ON TABLE "public"."incident_resume_authorizations" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."incident_resume_authorizations" TO "service_role";
ALTER TABLE "public"."ig_account_unfollow_limit_overrides" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_account_unfollow_limit_overrides" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "service_role";
GRANT UPDATE ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "service_role";
GRANT DELETE ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "service_role";
GRANT REFERENCES ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "service_role";
GRANT TRIGGER ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."ig_account_unfollow_limit_overrides" TO "service_role";
ALTER TABLE "public"."phonefarm_runtime_barriers" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."phonefarm_runtime_barriers" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."phonefarm_runtime_barriers" TO "postgres";
GRANT SELECT ON TABLE "public"."phonefarm_runtime_barriers" TO "postgres";
GRANT UPDATE ON TABLE "public"."phonefarm_runtime_barriers" TO "postgres";
GRANT DELETE ON TABLE "public"."phonefarm_runtime_barriers" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."phonefarm_runtime_barriers" TO "postgres";
GRANT REFERENCES ON TABLE "public"."phonefarm_runtime_barriers" TO "postgres";
GRANT TRIGGER ON TABLE "public"."phonefarm_runtime_barriers" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."phonefarm_runtime_barriers" TO "postgres";
GRANT INSERT ON TABLE "public"."phonefarm_runtime_barriers" TO "service_role";
GRANT SELECT ON TABLE "public"."phonefarm_runtime_barriers" TO "service_role";
GRANT UPDATE ON TABLE "public"."phonefarm_runtime_barriers" TO "service_role";
GRANT DELETE ON TABLE "public"."phonefarm_runtime_barriers" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."phonefarm_runtime_barriers" TO "service_role";
GRANT REFERENCES ON TABLE "public"."phonefarm_runtime_barriers" TO "service_role";
GRANT TRIGGER ON TABLE "public"."phonefarm_runtime_barriers" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."phonefarm_runtime_barriers" TO "service_role";
ALTER TABLE "public"."account_session_resume_plans" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."account_session_resume_plans" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."account_session_resume_plans" TO "postgres";
GRANT SELECT ON TABLE "public"."account_session_resume_plans" TO "postgres";
GRANT UPDATE ON TABLE "public"."account_session_resume_plans" TO "postgres";
GRANT DELETE ON TABLE "public"."account_session_resume_plans" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."account_session_resume_plans" TO "postgres";
GRANT REFERENCES ON TABLE "public"."account_session_resume_plans" TO "postgres";
GRANT TRIGGER ON TABLE "public"."account_session_resume_plans" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."account_session_resume_plans" TO "postgres";
GRANT INSERT ON TABLE "public"."account_session_resume_plans" TO "anon";
GRANT SELECT ON TABLE "public"."account_session_resume_plans" TO "anon";
GRANT UPDATE ON TABLE "public"."account_session_resume_plans" TO "anon";
GRANT DELETE ON TABLE "public"."account_session_resume_plans" TO "anon";
GRANT TRUNCATE ON TABLE "public"."account_session_resume_plans" TO "anon";
GRANT REFERENCES ON TABLE "public"."account_session_resume_plans" TO "anon";
GRANT TRIGGER ON TABLE "public"."account_session_resume_plans" TO "anon";
GRANT MAINTAIN ON TABLE "public"."account_session_resume_plans" TO "anon";
GRANT INSERT ON TABLE "public"."account_session_resume_plans" TO "authenticated";
GRANT SELECT ON TABLE "public"."account_session_resume_plans" TO "authenticated";
GRANT UPDATE ON TABLE "public"."account_session_resume_plans" TO "authenticated";
GRANT DELETE ON TABLE "public"."account_session_resume_plans" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."account_session_resume_plans" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."account_session_resume_plans" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."account_session_resume_plans" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."account_session_resume_plans" TO "authenticated";
GRANT INSERT ON TABLE "public"."account_session_resume_plans" TO "service_role";
GRANT SELECT ON TABLE "public"."account_session_resume_plans" TO "service_role";
GRANT UPDATE ON TABLE "public"."account_session_resume_plans" TO "service_role";
GRANT DELETE ON TABLE "public"."account_session_resume_plans" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."account_session_resume_plans" TO "service_role";
GRANT REFERENCES ON TABLE "public"."account_session_resume_plans" TO "service_role";
GRANT TRIGGER ON TABLE "public"."account_session_resume_plans" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."account_session_resume_plans" TO "service_role";
ALTER TABLE "public"."ig_action_logs" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_action_logs" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_action_logs" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_action_logs" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_action_logs" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_action_logs" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_action_logs" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_action_logs" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_action_logs" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_action_logs" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_action_logs" TO "anon";
GRANT SELECT ON TABLE "public"."ig_action_logs" TO "anon";
GRANT UPDATE ON TABLE "public"."ig_action_logs" TO "anon";
GRANT DELETE ON TABLE "public"."ig_action_logs" TO "anon";
GRANT TRUNCATE ON TABLE "public"."ig_action_logs" TO "anon";
GRANT REFERENCES ON TABLE "public"."ig_action_logs" TO "anon";
GRANT TRIGGER ON TABLE "public"."ig_action_logs" TO "anon";
GRANT MAINTAIN ON TABLE "public"."ig_action_logs" TO "anon";
GRANT INSERT ON TABLE "public"."ig_action_logs" TO "authenticated";
GRANT SELECT ON TABLE "public"."ig_action_logs" TO "authenticated";
GRANT UPDATE ON TABLE "public"."ig_action_logs" TO "authenticated";
GRANT DELETE ON TABLE "public"."ig_action_logs" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."ig_action_logs" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."ig_action_logs" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."ig_action_logs" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."ig_action_logs" TO "authenticated";
GRANT INSERT ON TABLE "public"."ig_action_logs" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_action_logs" TO "service_role";
GRANT UPDATE ON TABLE "public"."ig_action_logs" TO "service_role";
GRANT DELETE ON TABLE "public"."ig_action_logs" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."ig_action_logs" TO "service_role";
GRANT REFERENCES ON TABLE "public"."ig_action_logs" TO "service_role";
GRANT TRIGGER ON TABLE "public"."ig_action_logs" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."ig_action_logs" TO "service_role";
ALTER TABLE "public"."ig_interacted_users" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."ig_interacted_users" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."ig_interacted_users" TO "postgres";
GRANT SELECT ON TABLE "public"."ig_interacted_users" TO "postgres";
GRANT UPDATE ON TABLE "public"."ig_interacted_users" TO "postgres";
GRANT DELETE ON TABLE "public"."ig_interacted_users" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."ig_interacted_users" TO "postgres";
GRANT REFERENCES ON TABLE "public"."ig_interacted_users" TO "postgres";
GRANT TRIGGER ON TABLE "public"."ig_interacted_users" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."ig_interacted_users" TO "postgres";
GRANT INSERT ON TABLE "public"."ig_interacted_users" TO "anon";
GRANT SELECT ON TABLE "public"."ig_interacted_users" TO "anon";
GRANT UPDATE ON TABLE "public"."ig_interacted_users" TO "anon";
GRANT DELETE ON TABLE "public"."ig_interacted_users" TO "anon";
GRANT TRUNCATE ON TABLE "public"."ig_interacted_users" TO "anon";
GRANT REFERENCES ON TABLE "public"."ig_interacted_users" TO "anon";
GRANT TRIGGER ON TABLE "public"."ig_interacted_users" TO "anon";
GRANT MAINTAIN ON TABLE "public"."ig_interacted_users" TO "anon";
GRANT INSERT ON TABLE "public"."ig_interacted_users" TO "authenticated";
GRANT SELECT ON TABLE "public"."ig_interacted_users" TO "authenticated";
GRANT UPDATE ON TABLE "public"."ig_interacted_users" TO "authenticated";
GRANT DELETE ON TABLE "public"."ig_interacted_users" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."ig_interacted_users" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."ig_interacted_users" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."ig_interacted_users" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."ig_interacted_users" TO "authenticated";
GRANT INSERT ON TABLE "public"."ig_interacted_users" TO "service_role";
GRANT SELECT ON TABLE "public"."ig_interacted_users" TO "service_role";
GRANT UPDATE ON TABLE "public"."ig_interacted_users" TO "service_role";
GRANT DELETE ON TABLE "public"."ig_interacted_users" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."ig_interacted_users" TO "service_role";
GRANT REFERENCES ON TABLE "public"."ig_interacted_users" TO "service_role";
GRANT TRIGGER ON TABLE "public"."ig_interacted_users" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."ig_interacted_users" TO "service_role";
ALTER TABLE "public"."auto_restart_device_locks" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."auto_restart_device_locks" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."auto_restart_device_locks" TO "postgres";
GRANT SELECT ON TABLE "public"."auto_restart_device_locks" TO "postgres";
GRANT UPDATE ON TABLE "public"."auto_restart_device_locks" TO "postgres";
GRANT DELETE ON TABLE "public"."auto_restart_device_locks" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."auto_restart_device_locks" TO "postgres";
GRANT REFERENCES ON TABLE "public"."auto_restart_device_locks" TO "postgres";
GRANT TRIGGER ON TABLE "public"."auto_restart_device_locks" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."auto_restart_device_locks" TO "postgres";
GRANT INSERT ON TABLE "public"."auto_restart_device_locks" TO "service_role";
GRANT SELECT ON TABLE "public"."auto_restart_device_locks" TO "service_role";
GRANT UPDATE ON TABLE "public"."auto_restart_device_locks" TO "service_role";
GRANT DELETE ON TABLE "public"."auto_restart_device_locks" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."auto_restart_device_locks" TO "service_role";
GRANT REFERENCES ON TABLE "public"."auto_restart_device_locks" TO "service_role";
GRANT TRIGGER ON TABLE "public"."auto_restart_device_locks" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."auto_restart_device_locks" TO "service_role";
ALTER TABLE "public"."account_incidents" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."account_incidents" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."account_incidents" TO "postgres";
GRANT SELECT ON TABLE "public"."account_incidents" TO "postgres";
GRANT UPDATE ON TABLE "public"."account_incidents" TO "postgres";
GRANT DELETE ON TABLE "public"."account_incidents" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."account_incidents" TO "postgres";
GRANT REFERENCES ON TABLE "public"."account_incidents" TO "postgres";
GRANT TRIGGER ON TABLE "public"."account_incidents" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."account_incidents" TO "postgres";
GRANT INSERT ON TABLE "public"."account_incidents" TO "service_role";
GRANT SELECT ON TABLE "public"."account_incidents" TO "service_role";
GRANT UPDATE ON TABLE "public"."account_incidents" TO "service_role";
GRANT DELETE ON TABLE "public"."account_incidents" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."account_incidents" TO "service_role";
GRANT REFERENCES ON TABLE "public"."account_incidents" TO "service_role";
GRANT TRIGGER ON TABLE "public"."account_incidents" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."account_incidents" TO "service_role";
ALTER TABLE "public"."account_credentials" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."account_credentials" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."account_credentials" TO "postgres";
GRANT SELECT ON TABLE "public"."account_credentials" TO "postgres";
GRANT UPDATE ON TABLE "public"."account_credentials" TO "postgres";
GRANT DELETE ON TABLE "public"."account_credentials" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."account_credentials" TO "postgres";
GRANT REFERENCES ON TABLE "public"."account_credentials" TO "postgres";
GRANT TRIGGER ON TABLE "public"."account_credentials" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."account_credentials" TO "postgres";
GRANT INSERT ON TABLE "public"."account_credentials" TO "service_role";
GRANT SELECT ON TABLE "public"."account_credentials" TO "service_role";
GRANT UPDATE ON TABLE "public"."account_credentials" TO "service_role";
GRANT DELETE ON TABLE "public"."account_credentials" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."account_credentials" TO "service_role";
GRANT REFERENCES ON TABLE "public"."account_credentials" TO "service_role";
GRANT TRIGGER ON TABLE "public"."account_credentials" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."account_credentials" TO "service_role";
ALTER TABLE "public"."commercial_stripe_subscriptions" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."commercial_stripe_subscriptions" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."commercial_stripe_subscriptions" TO "postgres";
GRANT SELECT ON TABLE "public"."commercial_stripe_subscriptions" TO "postgres";
GRANT UPDATE ON TABLE "public"."commercial_stripe_subscriptions" TO "postgres";
GRANT DELETE ON TABLE "public"."commercial_stripe_subscriptions" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."commercial_stripe_subscriptions" TO "postgres";
GRANT REFERENCES ON TABLE "public"."commercial_stripe_subscriptions" TO "postgres";
GRANT TRIGGER ON TABLE "public"."commercial_stripe_subscriptions" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."commercial_stripe_subscriptions" TO "postgres";
GRANT INSERT ON TABLE "public"."commercial_stripe_subscriptions" TO "anon";
GRANT SELECT ON TABLE "public"."commercial_stripe_subscriptions" TO "anon";
GRANT UPDATE ON TABLE "public"."commercial_stripe_subscriptions" TO "anon";
GRANT DELETE ON TABLE "public"."commercial_stripe_subscriptions" TO "anon";
GRANT TRUNCATE ON TABLE "public"."commercial_stripe_subscriptions" TO "anon";
GRANT REFERENCES ON TABLE "public"."commercial_stripe_subscriptions" TO "anon";
GRANT TRIGGER ON TABLE "public"."commercial_stripe_subscriptions" TO "anon";
GRANT MAINTAIN ON TABLE "public"."commercial_stripe_subscriptions" TO "anon";
GRANT INSERT ON TABLE "public"."commercial_stripe_subscriptions" TO "authenticated";
GRANT SELECT ON TABLE "public"."commercial_stripe_subscriptions" TO "authenticated";
GRANT UPDATE ON TABLE "public"."commercial_stripe_subscriptions" TO "authenticated";
GRANT DELETE ON TABLE "public"."commercial_stripe_subscriptions" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."commercial_stripe_subscriptions" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."commercial_stripe_subscriptions" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."commercial_stripe_subscriptions" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."commercial_stripe_subscriptions" TO "authenticated";
GRANT INSERT ON TABLE "public"."commercial_stripe_subscriptions" TO "service_role";
GRANT SELECT ON TABLE "public"."commercial_stripe_subscriptions" TO "service_role";
GRANT UPDATE ON TABLE "public"."commercial_stripe_subscriptions" TO "service_role";
GRANT DELETE ON TABLE "public"."commercial_stripe_subscriptions" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."commercial_stripe_subscriptions" TO "service_role";
GRANT REFERENCES ON TABLE "public"."commercial_stripe_subscriptions" TO "service_role";
GRANT TRIGGER ON TABLE "public"."commercial_stripe_subscriptions" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."commercial_stripe_subscriptions" TO "service_role";
ALTER TABLE "public"."instagram_account_restriction_holds" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."instagram_account_restriction_holds" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."instagram_account_restriction_holds" TO "postgres";
GRANT SELECT ON TABLE "public"."instagram_account_restriction_holds" TO "postgres";
GRANT UPDATE ON TABLE "public"."instagram_account_restriction_holds" TO "postgres";
GRANT DELETE ON TABLE "public"."instagram_account_restriction_holds" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."instagram_account_restriction_holds" TO "postgres";
GRANT REFERENCES ON TABLE "public"."instagram_account_restriction_holds" TO "postgres";
GRANT TRIGGER ON TABLE "public"."instagram_account_restriction_holds" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."instagram_account_restriction_holds" TO "postgres";
GRANT INSERT ON TABLE "public"."instagram_account_restriction_holds" TO "service_role";
GRANT SELECT ON TABLE "public"."instagram_account_restriction_holds" TO "service_role";
GRANT UPDATE ON TABLE "public"."instagram_account_restriction_holds" TO "service_role";
GRANT DELETE ON TABLE "public"."instagram_account_restriction_holds" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."instagram_account_restriction_holds" TO "service_role";
GRANT REFERENCES ON TABLE "public"."instagram_account_restriction_holds" TO "service_role";
GRANT TRIGGER ON TABLE "public"."instagram_account_restriction_holds" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."instagram_account_restriction_holds" TO "service_role";
ALTER TABLE "public"."profiles" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."profiles" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."profiles" TO "postgres";
GRANT SELECT ON TABLE "public"."profiles" TO "postgres";
GRANT UPDATE ON TABLE "public"."profiles" TO "postgres";
GRANT DELETE ON TABLE "public"."profiles" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."profiles" TO "postgres";
GRANT REFERENCES ON TABLE "public"."profiles" TO "postgres";
GRANT TRIGGER ON TABLE "public"."profiles" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."profiles" TO "postgres";
GRANT INSERT ON TABLE "public"."profiles" TO "anon";
GRANT SELECT ON TABLE "public"."profiles" TO "anon";
GRANT UPDATE ON TABLE "public"."profiles" TO "anon";
GRANT DELETE ON TABLE "public"."profiles" TO "anon";
GRANT TRUNCATE ON TABLE "public"."profiles" TO "anon";
GRANT REFERENCES ON TABLE "public"."profiles" TO "anon";
GRANT TRIGGER ON TABLE "public"."profiles" TO "anon";
GRANT MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT INSERT ON TABLE "public"."profiles" TO "authenticated";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";
GRANT UPDATE ON TABLE "public"."profiles" TO "authenticated";
GRANT DELETE ON TABLE "public"."profiles" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."profiles" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."profiles" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."profiles" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT INSERT ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "service_role";
GRANT UPDATE ON TABLE "public"."profiles" TO "service_role";
GRANT DELETE ON TABLE "public"."profiles" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."profiles" TO "service_role";
GRANT REFERENCES ON TABLE "public"."profiles" TO "service_role";
GRANT TRIGGER ON TABLE "public"."profiles" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."profiles" TO "service_role";
ALTER TABLE "public"."account_session_transitions" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."account_session_transitions" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."account_session_transitions" TO "postgres";
GRANT SELECT ON TABLE "public"."account_session_transitions" TO "postgres";
GRANT UPDATE ON TABLE "public"."account_session_transitions" TO "postgres";
GRANT DELETE ON TABLE "public"."account_session_transitions" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."account_session_transitions" TO "postgres";
GRANT REFERENCES ON TABLE "public"."account_session_transitions" TO "postgres";
GRANT TRIGGER ON TABLE "public"."account_session_transitions" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."account_session_transitions" TO "postgres";
GRANT INSERT ON TABLE "public"."account_session_transitions" TO "service_role";
GRANT SELECT ON TABLE "public"."account_session_transitions" TO "service_role";
GRANT UPDATE ON TABLE "public"."account_session_transitions" TO "service_role";
GRANT DELETE ON TABLE "public"."account_session_transitions" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."account_session_transitions" TO "service_role";
GRANT REFERENCES ON TABLE "public"."account_session_transitions" TO "service_role";
GRANT TRIGGER ON TABLE "public"."account_session_transitions" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."account_session_transitions" TO "service_role";
ALTER TABLE "public"."notification_business_events" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."notification_business_events" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."notification_business_events" TO "postgres";
GRANT SELECT ON TABLE "public"."notification_business_events" TO "postgres";
GRANT UPDATE ON TABLE "public"."notification_business_events" TO "postgres";
GRANT DELETE ON TABLE "public"."notification_business_events" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."notification_business_events" TO "postgres";
GRANT REFERENCES ON TABLE "public"."notification_business_events" TO "postgres";
GRANT TRIGGER ON TABLE "public"."notification_business_events" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."notification_business_events" TO "postgres";
GRANT INSERT ON TABLE "public"."notification_business_events" TO "service_role";
GRANT SELECT ON TABLE "public"."notification_business_events" TO "service_role";
GRANT UPDATE ON TABLE "public"."notification_business_events" TO "service_role";
GRANT DELETE ON TABLE "public"."notification_business_events" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."notification_business_events" TO "service_role";
GRANT REFERENCES ON TABLE "public"."notification_business_events" TO "service_role";
GRANT TRIGGER ON TABLE "public"."notification_business_events" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."notification_business_events" TO "service_role";
ALTER TABLE "public"."incident_retention_policies" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."incident_retention_policies" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."incident_retention_policies" TO "postgres";
GRANT SELECT ON TABLE "public"."incident_retention_policies" TO "postgres";
GRANT UPDATE ON TABLE "public"."incident_retention_policies" TO "postgres";
GRANT DELETE ON TABLE "public"."incident_retention_policies" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."incident_retention_policies" TO "postgres";
GRANT REFERENCES ON TABLE "public"."incident_retention_policies" TO "postgres";
GRANT TRIGGER ON TABLE "public"."incident_retention_policies" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."incident_retention_policies" TO "postgres";
GRANT INSERT ON TABLE "public"."incident_retention_policies" TO "service_role";
GRANT SELECT ON TABLE "public"."incident_retention_policies" TO "service_role";
GRANT UPDATE ON TABLE "public"."incident_retention_policies" TO "service_role";
GRANT DELETE ON TABLE "public"."incident_retention_policies" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."incident_retention_policies" TO "service_role";
GRANT REFERENCES ON TABLE "public"."incident_retention_policies" TO "service_role";
GRANT TRIGGER ON TABLE "public"."incident_retention_policies" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."incident_retention_policies" TO "service_role";
ALTER TABLE "public"."notification_destination_settings" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."notification_destination_settings" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."notification_destination_settings" TO "postgres";
GRANT SELECT ON TABLE "public"."notification_destination_settings" TO "postgres";
GRANT UPDATE ON TABLE "public"."notification_destination_settings" TO "postgres";
GRANT DELETE ON TABLE "public"."notification_destination_settings" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."notification_destination_settings" TO "postgres";
GRANT REFERENCES ON TABLE "public"."notification_destination_settings" TO "postgres";
GRANT TRIGGER ON TABLE "public"."notification_destination_settings" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."notification_destination_settings" TO "postgres";
GRANT INSERT ON TABLE "public"."notification_destination_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."notification_destination_settings" TO "service_role";
GRANT UPDATE ON TABLE "public"."notification_destination_settings" TO "service_role";
GRANT DELETE ON TABLE "public"."notification_destination_settings" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."notification_destination_settings" TO "service_role";
GRANT REFERENCES ON TABLE "public"."notification_destination_settings" TO "service_role";
GRANT TRIGGER ON TABLE "public"."notification_destination_settings" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."notification_destination_settings" TO "service_role";
ALTER TABLE "public"."notification_deliveries" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."notification_deliveries" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."notification_deliveries" TO "postgres";
GRANT SELECT ON TABLE "public"."notification_deliveries" TO "postgres";
GRANT UPDATE ON TABLE "public"."notification_deliveries" TO "postgres";
GRANT DELETE ON TABLE "public"."notification_deliveries" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."notification_deliveries" TO "postgres";
GRANT REFERENCES ON TABLE "public"."notification_deliveries" TO "postgres";
GRANT TRIGGER ON TABLE "public"."notification_deliveries" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."notification_deliveries" TO "postgres";
GRANT INSERT ON TABLE "public"."notification_deliveries" TO "service_role";
GRANT SELECT ON TABLE "public"."notification_deliveries" TO "service_role";
GRANT UPDATE ON TABLE "public"."notification_deliveries" TO "service_role";
GRANT DELETE ON TABLE "public"."notification_deliveries" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."notification_deliveries" TO "service_role";
GRANT REFERENCES ON TABLE "public"."notification_deliveries" TO "service_role";
GRANT TRIGGER ON TABLE "public"."notification_deliveries" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."notification_deliveries" TO "service_role";
ALTER TABLE "public"."account_package_summary" OWNER TO "postgres";
REVOKE ALL ON TABLE "public"."account_package_summary" FROM PUBLIC;
GRANT INSERT ON TABLE "public"."account_package_summary" TO "postgres";
GRANT SELECT ON TABLE "public"."account_package_summary" TO "postgres";
GRANT UPDATE ON TABLE "public"."account_package_summary" TO "postgres";
GRANT DELETE ON TABLE "public"."account_package_summary" TO "postgres";
GRANT TRUNCATE ON TABLE "public"."account_package_summary" TO "postgres";
GRANT REFERENCES ON TABLE "public"."account_package_summary" TO "postgres";
GRANT TRIGGER ON TABLE "public"."account_package_summary" TO "postgres";
GRANT MAINTAIN ON TABLE "public"."account_package_summary" TO "postgres";
GRANT INSERT ON TABLE "public"."account_package_summary" TO "anon";
GRANT SELECT ON TABLE "public"."account_package_summary" TO "anon";
GRANT UPDATE ON TABLE "public"."account_package_summary" TO "anon";
GRANT DELETE ON TABLE "public"."account_package_summary" TO "anon";
GRANT TRUNCATE ON TABLE "public"."account_package_summary" TO "anon";
GRANT REFERENCES ON TABLE "public"."account_package_summary" TO "anon";
GRANT TRIGGER ON TABLE "public"."account_package_summary" TO "anon";
GRANT MAINTAIN ON TABLE "public"."account_package_summary" TO "anon";
GRANT INSERT ON TABLE "public"."account_package_summary" TO "authenticated";
GRANT SELECT ON TABLE "public"."account_package_summary" TO "authenticated";
GRANT UPDATE ON TABLE "public"."account_package_summary" TO "authenticated";
GRANT DELETE ON TABLE "public"."account_package_summary" TO "authenticated";
GRANT TRUNCATE ON TABLE "public"."account_package_summary" TO "authenticated";
GRANT REFERENCES ON TABLE "public"."account_package_summary" TO "authenticated";
GRANT TRIGGER ON TABLE "public"."account_package_summary" TO "authenticated";
GRANT MAINTAIN ON TABLE "public"."account_package_summary" TO "authenticated";
GRANT INSERT ON TABLE "public"."account_package_summary" TO "service_role";
GRANT SELECT ON TABLE "public"."account_package_summary" TO "service_role";
GRANT UPDATE ON TABLE "public"."account_package_summary" TO "service_role";
GRANT DELETE ON TABLE "public"."account_package_summary" TO "service_role";
GRANT TRUNCATE ON TABLE "public"."account_package_summary" TO "service_role";
GRANT REFERENCES ON TABLE "public"."account_package_summary" TO "service_role";
GRANT TRIGGER ON TABLE "public"."account_package_summary" TO "service_role";
GRANT MAINTAIN ON TABLE "public"."account_package_summary" TO "service_role";
ALTER TABLE "public"."account_warmup_settings" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER account_warmup_started_at_immutable_v1 BEFORE INSERT OR UPDATE ON public.account_warmup_settings FOR EACH ROW EXECUTE FUNCTION private.preserve_warmup_started_at_v1();
ALTER TABLE "public"."commercial_packages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."account_commercial_packages" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER account_commercial_package_runtime_contract AFTER INSERT OR UPDATE OF package_code, status, starts_at, ends_at ON public.account_commercial_packages FOR EACH ROW EXECUTE FUNCTION reconcile_account_package_runtime_contract_change();
CREATE TRIGGER initialize_account_warmup_on_package_activation AFTER INSERT OR UPDATE OF status, ends_at, starts_at ON public.account_commercial_packages FOR EACH ROW WHEN (((new.status = 'active'::text) AND (new.ends_at IS NULL))) EXECUTE FUNCTION initialize_account_warmup_on_package_activation();
ALTER TABLE "public"."ig_account_social_profile_snapshots" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER reject_social_profile_snapshot_update_delete BEFORE DELETE OR UPDATE ON public.ig_account_social_profile_snapshots FOR EACH ROW EXECUTE FUNCTION reject_social_profile_snapshot_mutation();
ALTER TABLE "public"."ig_account_follow_limit_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ig_accounts" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER ig_accounts_release_schedule_capacity_on_admin_lifecycle AFTER UPDATE OF admin_lifecycle_status ON public.ig_accounts FOR EACH ROW EXECUTE FUNCTION release_schedule_capacity_on_account_admin_lifecycle();
CREATE TRIGGER terminal_cancel_admin_monotonicity_v1 BEFORE UPDATE OF admin_lifecycle_status ON public.ig_accounts FOR EACH ROW EXECUTE FUNCTION enforce_terminal_cancel_admin_monotonicity_v1();
ALTER TABLE "public"."ig_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."client_account_entitlements" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER client_account_entitlements_target_pricing_snapshot BEFORE INSERT OR UPDATE OF plan_key, billing_interval_months, catalog_snapshot ON public.client_account_entitlements FOR EACH ROW EXECUTE FUNCTION normalize_plan_change_target_pricing_snapshot();
CREATE TRIGGER client_entitlement_package_runtime_contract AFTER INSERT OR UPDATE OF account_id, commercial_package_code, status, outreach_addon_key, outreach_variant, backend_addon_code ON public.client_account_entitlements FOR EACH ROW EXECUTE FUNCTION reconcile_account_package_runtime_contract_change();
CREATE TRIGGER terminal_cancel_entitlement_monotonicity_v1 BEFORE INSERT OR UPDATE ON public.client_account_entitlements FOR EACH ROW EXECUTE FUNCTION enforce_terminal_cancel_entitlement_monotonicity_v1();
ALTER TABLE "public"."account_package_runtime_contract_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ig_account_unfollow_settings" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER ig_account_unfollow_settings_set_updated_at BEFORE UPDATE ON public.ig_account_unfollow_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER unfollow_settings_package_runtime_contract AFTER INSERT OR UPDATE OF unfollow_enabled, unfollow_after_days, unfollow_per_session_limit, unfollow_per_day_limit ON public.ig_account_unfollow_settings FOR EACH ROW EXECUTE FUNCTION reconcile_account_package_runtime_contract_change();
ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients_select_own_clients" ON "public"."clients" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM client_users cu
  WHERE ((cu.client_id = clients.id) AND (cu.auth_user_id = auth.uid()) AND (cu.status = 'active'::text))))) ;
CREATE POLICY "clients_service_role_all" ON "public"."clients" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE TRIGGER clients_set_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE "public"."account_assignments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "account_assignments_select_own" ON "public"."account_assignments" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM client_users cu
  WHERE ((cu.client_id = account_assignments.client_id) AND (cu.auth_user_id = auth.uid()) AND (cu.status = 'active'::text))))) ;
CREATE POLICY "account_assignments_service_role_all" ON "public"."account_assignments" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE TRIGGER account_assignment_package_runtime_contract AFTER INSERT OR UPDATE OF device_id, app_instance_id, assignment_type, schedule_mode, starts_at, ends_at, status ON public.account_assignments FOR EACH ROW EXECUTE FUNCTION enforce_assignment_package_runtime_contract();
CREATE TRIGGER account_assignments_device_recurring_exclusivity_v1 BEFORE INSERT OR UPDATE OF device_id, starts_at, ends_at, status, schedule_mode, released_at ON public.account_assignments FOR EACH ROW EXECUTE FUNCTION enforce_device_recurring_assignment_exclusivity_v1();
CREATE TRIGGER account_assignments_set_updated_at BEFORE UPDATE ON public.account_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER account_assignments_stamp_release_metadata BEFORE UPDATE OF status ON public.account_assignments FOR EACH ROW EXECUTE FUNCTION stamp_assignment_release_metadata();
CREATE TRIGGER account_assignments_sync_app_instance AFTER INSERT OR UPDATE OF status, app_instance_id, account_id ON public.account_assignments FOR EACH ROW EXECUTE FUNCTION sync_app_instance_after_assignment_change();
CREATE TRIGGER account_assignments_validate BEFORE INSERT OR UPDATE ON public.account_assignments FOR EACH ROW EXECUTE FUNCTION validate_account_assignment();
ALTER TABLE "public"."commercial_checkout_sessions" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER commercial_checkout_sessions_target_pricing_snapshot BEFORE INSERT OR UPDATE OF plan_key, billing_interval_months, catalog_snapshot ON public.commercial_checkout_sessions FOR EACH ROW EXECUTE FUNCTION normalize_plan_change_target_pricing_snapshot();
ALTER TABLE "public"."account_run_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "account_run_requests_service_role_all" ON "public"."account_run_requests" AS PERMISSIVE FOR ALL TO PUBLIC USING ((( SELECT auth.role() AS role) = 'service_role'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'service_role'::text));
CREATE TRIGGER account_run_request_00_resume_lineage_v1 BEFORE INSERT ON public.account_run_requests FOR EACH ROW EXECUTE FUNCTION apply_authorized_resume_request_lineage_v1();
CREATE TRIGGER account_run_request_lineage_v1_guard BEFORE INSERT OR UPDATE ON public.account_run_requests FOR EACH ROW EXECUTE FUNCTION account_run_request_lineage_v1_guard();
CREATE TRIGGER account_run_request_package_runtime_preflight BEFORE INSERT ON public.account_run_requests FOR EACH ROW EXECUTE FUNCTION block_invalid_login_package_runtime_contract();
CREATE TRIGGER account_run_requests_auto_restart_phase_plan_v2 BEFORE INSERT ON public.account_run_requests FOR EACH ROW EXECUTE FUNCTION enforce_auto_restart_phase_plan_v2();
CREATE TRIGGER account_run_requests_set_updated_at BEFORE UPDATE ON public.account_run_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER login_request_terminal_growth_readiness_v1 AFTER UPDATE OF status ON public.account_run_requests FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION trigger_connected_instagram_growth_readiness_v1();
CREATE TRIGGER phonefarm_storage_guard_account_run_request_v2 BEFORE INSERT ON public.account_run_requests FOR EACH ROW EXECUTE FUNCTION phonefarm_storage_admission_guard_v2();
ALTER TABLE "public"."ig_account_settings" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER ig_settings_package_runtime_contract AFTER INSERT OR UPDATE OF app_package, clone_mode, cloned_app_mode, max_actions_per_day, follow_limit, max_follow_per_run, likes_per_follow_min, likes_per_follow_max, total_likes_limit ON public.ig_account_settings FOR EACH ROW EXECUTE FUNCTION reconcile_account_package_runtime_contract_change();
ALTER TABLE "public"."ig_account_unfollow_enablement_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ig_account_unfollow_enablement_overrides" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."commercial_account_lifecycle_states" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial_account_lifecycle_states_service_role_all" ON "public"."commercial_account_lifecycle_states" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE TRIGGER commercial_cancel_terminal_monotonicity_v1 BEFORE UPDATE ON public.commercial_account_lifecycle_states FOR EACH ROW EXECUTE FUNCTION enforce_commercial_cancel_terminal_monotonicity_v1();
ALTER TABLE "public"."ig_account_dm_settings" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER dm_settings_package_runtime_contract AFTER INSERT OR UPDATE OF welcome_enabled, outreach_enabled, welcome_per_session_limit, welcome_per_day_limit, outreach_per_session_limit, outreach_per_day_limit, total_dm_per_day_limit ON public.ig_account_dm_settings FOR EACH ROW EXECUTE FUNCTION reconcile_account_package_runtime_contract_change();
CREATE TRIGGER ig_account_dm_settings_set_updated_at BEFORE UPDATE ON public.ig_account_dm_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE "public"."ig_interaction_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ig_interaction_events_service_role_all" ON "public"."ig_interaction_events" AS PERMISSIVE FOR ALL TO PUBLIC USING ((( SELECT auth.role() AS role) = 'service_role'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'service_role'::text));
CREATE TRIGGER trg_never_follow_twice_v1 BEFORE INSERT OR UPDATE OF account_id, username, event_type, event_status ON public.ig_interaction_events FOR EACH ROW WHEN ((new.event_type = 'follow_verified_persisted_v1'::text)) EXECUTE FUNCTION guard_never_follow_twice_v1();
CREATE TRIGGER trg_project_ever_followed_canonical_v1 AFTER INSERT OR UPDATE OF event_status ON public.ig_interaction_events FOR EACH ROW WHEN (((new.event_type = 'follow_verified_persisted_v1'::text) AND (new.event_status = 'success'::text))) EXECUTE FUNCTION project_ever_followed_canonical_v1();
ALTER TABLE "public"."commercial_plan_change_quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."client_users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_users_select_own_membership" ON "public"."client_users" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((auth_user_id = auth.uid()) AND (status = 'active'::text))) ;
CREATE POLICY "client_users_service_role_all" ON "public"."client_users" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE TRIGGER client_users_set_updated_at BEFORE UPDATE ON public.client_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE "public"."client_entitlements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_entitlements_select_own_entitlements" ON "public"."client_entitlements" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM client_users cu
  WHERE ((cu.client_id = client_entitlements.client_id) AND (cu.auth_user_id = auth.uid()) AND (cu.status = 'active'::text))))) ;
CREATE POLICY "client_entitlements_service_role_all" ON "public"."client_entitlements" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE TRIGGER client_entitlements_set_updated_at BEFORE UPDATE ON public.client_entitlements FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE "public"."client_subscriptions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_subscriptions_select_own" ON "public"."client_subscriptions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM client_users cu
  WHERE ((cu.client_id = client_subscriptions.client_id) AND (cu.auth_user_id = auth.uid()) AND (cu.status = 'active'::text))))) ;
CREATE POLICY "client_subscriptions_service_role_all" ON "public"."client_subscriptions" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE TRIGGER client_subscriptions_set_updated_at BEFORE UPDATE ON public.client_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER client_subscriptions_validate_type BEFORE UPDATE OF subscription_type ON public.client_subscriptions FOR EACH ROW EXECUTE FUNCTION validate_client_subscription_type();
ALTER TABLE "public"."client_subscription_accounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_subscription_accounts_select_own" ON "public"."client_subscription_accounts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (client_subscriptions cs
     JOIN client_users cu ON (((cu.client_id = cs.client_id) AND (cu.auth_user_id = auth.uid()) AND (cu.status = 'active'::text))))
  WHERE (cs.id = client_subscription_accounts.subscription_id)))) ;
CREATE POLICY "client_subscription_accounts_service_role_all" ON "public"."client_subscription_accounts" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE TRIGGER client_subscription_accounts_set_updated_at BEFORE UPDATE ON public.client_subscription_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER client_subscription_accounts_validate BEFORE INSERT OR UPDATE ON public.client_subscription_accounts FOR EACH ROW EXECUTE FUNCTION validate_client_subscription_account();
ALTER TABLE "public"."phone_clones" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "phone_clones_service_role_all" ON "public"."phone_clones" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE TRIGGER phone_clones_set_updated_at BEFORE UPDATE ON public.phone_clones FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER phone_clones_validate_capacity BEFORE INSERT OR UPDATE OF device_id, clone_index ON public.phone_clones FOR EACH ROW EXECUTE FUNCTION validate_phone_clone_capacity();
ALTER TABLE "public"."phone_devices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "phone_devices_service_role_all" ON "public"."phone_devices" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE TRIGGER phone_devices_set_updated_at BEFORE UPDATE ON public.phone_devices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER phone_devices_validate_timezone BEFORE INSERT OR UPDATE OF timezone ON public.phone_devices FOR EACH ROW EXECUTE FUNCTION validate_phone_device_timezone();
ALTER TABLE "public"."phone_app_instances" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "phone_app_instances_service_role_all" ON "public"."phone_app_instances" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE TRIGGER phone_app_instances_set_updated_at BEFORE UPDATE ON public.phone_app_instances FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE "public"."runtime_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "runtime_events_service_role_all" ON "public"."runtime_events" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
ALTER TABLE "public"."account_commercial_addons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."commercial_account_lifecycle_operations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial_account_lifecycle_operations_service_role_all" ON "public"."commercial_account_lifecycle_operations" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
CREATE TRIGGER commercial_lifecycle_email_transition_evidence_v1 AFTER UPDATE OF state ON public.commercial_account_lifecycle_operations FOR EACH ROW EXECUTE FUNCTION project_commercial_lifecycle_email_transition_evidence_v1();
ALTER TABLE "public"."client_instagram_accounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_instagram_accounts_select_own_accounts" ON "public"."client_instagram_accounts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM client_users cu
  WHERE ((cu.client_id = client_instagram_accounts.client_id) AND (cu.auth_user_id = auth.uid()) AND (cu.status = 'active'::text))))) ;
CREATE POLICY "client_instagram_accounts_service_role_all" ON "public"."client_instagram_accounts" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE TRIGGER a_stamp_worker_login_identity_provenance_v1 BEFORE INSERT OR UPDATE OF login_identity_proof_status, login_identity_verified_at, login_identity_verification_source ON public.client_instagram_accounts FOR EACH ROW EXECUTE FUNCTION stamp_worker_login_identity_provenance_v1();
CREATE TRIGGER client_instagram_account_growth_readiness_v1 AFTER INSERT OR UPDATE OF login_status, provisioning_status, onboarding_status, login_identity_proof_status, login_identity_verified_at, login_identity_profile_opened, login_identity_username_match, login_state_invalidation_reason ON public.client_instagram_accounts FOR EACH ROW WHEN (((new.active IS TRUE) AND (new.login_status = 'connected'::text) AND (new.provisioning_status = 'ready'::text) AND (new.onboarding_status = 'ready'::text) AND (new.login_identity_proof_status = 'verified'::text) AND (new.login_identity_profile_opened IS TRUE) AND (new.login_identity_username_match IS TRUE) AND (new.login_identity_verified_at IS NOT NULL) AND (new.login_state_invalidation_reason IS NULL))) EXECUTE FUNCTION trigger_connected_instagram_growth_readiness_v1();
CREATE TRIGGER client_instagram_accounts_capacity_monotonicity_v1 BEFORE UPDATE OF capacity_status, capacity_released_at, capacity_release_reason, capacity_release_operation_id ON public.client_instagram_accounts FOR EACH ROW EXECUTE FUNCTION enforce_client_instagram_account_capacity_monotonicity_v1();
CREATE TRIGGER client_instagram_accounts_set_updated_at BEFORE UPDATE ON public.client_instagram_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER client_instagram_password_remediation_v1 AFTER INSERT OR UPDATE OF login_status, provisioning_status, onboarding_status, login_identity_proof_status, login_identity_verified_at, login_identity_profile_opened, login_identity_username_match, login_state_invalidation_reason ON public.client_instagram_accounts FOR EACH ROW WHEN (((new.active IS TRUE) AND (new.login_status = 'connected'::text) AND (new.provisioning_status = 'ready'::text) AND (new.onboarding_status = 'ready'::text) AND (new.login_identity_proof_status = 'verified'::text) AND (new.login_identity_profile_opened IS TRUE) AND (new.login_identity_username_match IS TRUE) AND (new.login_identity_verified_at IS NOT NULL) AND (NULLIF(btrim(COALESCE(new.login_state_invalidation_reason, ''::text)), ''::text) IS NULL))) EXECUTE FUNCTION trigger_instagram_password_remediation_v1();
CREATE TRIGGER enforce_client_instagram_login_monotonic_v1 BEFORE UPDATE OF login_status, provisioning_status, onboarding_status, login_identity_proof_status, login_identity_profile_opened, login_identity_username_match, login_identity_verified_at, login_state_source_at, login_state_version, login_state_invalidation_reason ON public.client_instagram_accounts FOR EACH ROW EXECUTE FUNCTION enforce_client_instagram_login_monotonic_v1();
CREATE TRIGGER enforce_client_instagram_ready_identity_v1 BEFORE INSERT OR UPDATE OF login_status, provisioning_status, onboarding_status ON public.client_instagram_accounts FOR EACH ROW EXECUTE FUNCTION enforce_client_instagram_ready_identity_v1();
CREATE TRIGGER notification_router_auto_login_success_v2 AFTER INSERT OR UPDATE OF login_status, provisioning_status, onboarding_status, login_identity_proof_status, login_identity_profile_opened, login_identity_username_match, login_identity_verified_at ON public.client_instagram_accounts FOR EACH ROW EXECUTE FUNCTION notification_router_auto_login_success_v2();
ALTER TABLE "auth"."users" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
ALTER TABLE "public"."ig_dm_templates" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER ig_dm_templates_set_updated_at BEFORE UPDATE ON public.ig_dm_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE "public"."ig_targets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ig_targets_service_role_all" ON "public"."ig_targets" AS PERMISSIVE FOR ALL TO PUBLIC USING ((( SELECT auth.role() AS role) = 'service_role'::text)) WITH CHECK ((( SELECT auth.role() AS role) = 'service_role'::text));
CREATE TRIGGER set_ig_target_followback_ratio_p1c BEFORE INSERT OR UPDATE OF follows_sent_count, followbacks_count ON public.ig_targets FOR EACH ROW EXECUTE FUNCTION set_ig_target_followback_ratio_p1c();
CREATE TRIGGER set_ig_targets_updated_at BEFORE UPDATE ON public.ig_targets FOR EACH ROW EXECUTE FUNCTION set_ig_targets_updated_at();
ALTER TABLE "public"."client_subscription_modules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_subscription_modules_select_own" ON "public"."client_subscription_modules" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (client_subscriptions cs
     JOIN client_users cu ON (((cu.client_id = cs.client_id) AND (cu.auth_user_id = auth.uid()) AND (cu.status = 'active'::text))))
  WHERE (cs.id = client_subscription_modules.subscription_id)))) ;
CREATE POLICY "client_subscription_modules_service_role_all" ON "public"."client_subscription_modules" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE TRIGGER client_subscription_modules_set_updated_at BEFORE UPDATE ON public.client_subscription_modules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER client_subscription_modules_validate BEFORE INSERT OR UPDATE ON public.client_subscription_modules FOR EACH ROW EXECUTE FUNCTION validate_client_subscription_module();
ALTER TABLE "public"."account_follow_source_settings" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER follow_sources_package_runtime_contract AFTER INSERT OR UPDATE OF max_follows_per_target_per_run, max_targets_per_run ON public.account_follow_source_settings FOR EACH ROW EXECUTE FUNCTION reconcile_account_package_runtime_contract_change();
ALTER TABLE "public"."account_dashboard_actions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "account_dashboard_actions_service_role_all" ON "public"."account_dashboard_actions" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE TRIGGER account_dashboard_action_runtime_pause_v1 AFTER INSERT OR UPDATE OF status, blocking_campaign, action_type ON public.account_dashboard_actions FOR EACH ROW EXECUTE FUNCTION project_operator_review_runtime_pause_v1();
CREATE TRIGGER account_dashboard_action_runtime_resume_v3 AFTER INSERT OR UPDATE OF status, blocking_campaign, action_type ON public.account_dashboard_actions FOR EACH ROW EXECUTE FUNCTION project_resolved_operator_review_runtime_v3();
CREATE TRIGGER account_dashboard_actions_set_updated_at BEFORE UPDATE ON public.account_dashboard_actions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER dashboard_action_resolution_sync_incident_v1 BEFORE UPDATE OF status ON public.account_dashboard_actions FOR EACH ROW WHEN (((new.status = 'resolved'::text) AND (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION resolve_linked_incident_from_dashboard_action_v1();
CREATE TRIGGER login_blocker_terminal_growth_readiness_v1 AFTER UPDATE OF status ON public.account_dashboard_actions FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION trigger_connected_instagram_growth_readiness_v1();
ALTER TABLE "public"."commercial_package_runtime_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ig_runs" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER capture_account_session_transition_v1 AFTER INSERT OR UPDATE OF performance_summary ON public.ig_runs FOR EACH ROW WHEN ((new.performance_summary IS NOT NULL)) EXECUTE FUNCTION capture_account_session_transition_v1();
CREATE TRIGGER ig_run_terminal_growth_readiness_v1 AFTER UPDATE OF status ON public.ig_runs FOR EACH ROW WHEN (((old.status IS DISTINCT FROM new.status) AND (lower(COALESCE(old.status, ''::text)) <> ALL (ARRAY['completed'::text, 'failed'::text, 'stopped'::text, 'canceled'::text, 'blocked'::text, 'aborted'::text])) AND (lower(COALESCE(new.status, ''::text)) = ANY (ARRAY['completed'::text, 'failed'::text, 'stopped'::text, 'canceled'::text, 'blocked'::text, 'aborted'::text])))) EXECUTE FUNCTION trigger_connected_instagram_growth_readiness_v1();
CREATE TRIGGER ig_runs_live_counter_revision_v1 BEFORE UPDATE OF total_follow, total_like, total_dm, total_story ON public.ig_runs FOR EACH ROW EXECUTE FUNCTION bump_ig_run_live_counter_revision_v1();
CREATE TRIGGER phonefarm_storage_guard_ig_run_v2 BEFORE INSERT ON public.ig_runs FOR EACH ROW EXECUTE FUNCTION phonefarm_storage_admission_guard_v2();
ALTER TABLE "public"."incident_resume_authorizations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incident_resume_authorizations_service_role_all" ON "public"."incident_resume_authorizations" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
ALTER TABLE "public"."ig_account_unfollow_limit_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ig_account_unfollow_limit_overrides" FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."phonefarm_runtime_barriers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."account_session_resume_plans" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "account_session_resume_plans_service_role_all" ON "public"."account_session_resume_plans" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
ALTER TABLE "public"."ig_action_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ig_interacted_users" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_guard_ever_followed_projection_v1 BEFORE INSERT OR UPDATE OF account_id, username, ever_followed_canonical_at, ever_followed_action_id ON public.ig_interacted_users FOR EACH ROW EXECUTE FUNCTION guard_ever_followed_projection_v1();
CREATE TRIGGER trg_guard_ever_followed_row_delete_v1 BEFORE DELETE ON public.ig_interacted_users FOR EACH ROW EXECUTE FUNCTION guard_ever_followed_row_delete_v1();
ALTER TABLE "public"."auto_restart_device_locks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auto_restart_device_locks_service_role_all" ON "public"."auto_restart_device_locks" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
ALTER TABLE "public"."account_incidents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "account_incidents_service_role_all" ON "public"."account_incidents" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE TRIGGER account_incident_dashboard_action_terminal_sync_v1 AFTER INSERT OR UPDATE OF status, resolved_at, archived_at ON public.account_incidents FOR EACH ROW EXECUTE FUNCTION sync_terminal_incident_dashboard_actions_v1();
CREATE TRIGGER account_incident_resolution_auto_resume_v1 BEFORE UPDATE OF status ON public.account_incidents FOR EACH ROW WHEN (((new.status = 'resolved'::text) AND (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION arm_incident_resolution_auto_resume_v1();
CREATE TRIGGER account_incident_restriction_preflight_required_v1 AFTER UPDATE OF status ON public.account_incidents FOR EACH ROW WHEN (((new.status = 'resolved'::text) AND (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION mark_instagram_restriction_preflight_required_v1();
CREATE TRIGGER account_incidents_retention_v1 BEFORE INSERT OR UPDATE OF status, severity, action_required, resolved_at, legal_hold ON public.account_incidents FOR EACH ROW EXECUTE FUNCTION set_account_incident_retention_v1();
CREATE TRIGGER account_incidents_set_updated_at BEFORE UPDATE ON public.account_incidents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER incident_resolution_sync_operator_actions_v1 AFTER UPDATE OF status ON public.account_incidents FOR EACH ROW WHEN (((new.status = 'resolved'::text) AND (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION reconcile_operator_actions_from_resolved_incident_v1();
CREATE TRIGGER notification_router_auto_login_failure_v2 AFTER INSERT OR UPDATE OF status, lifecycle_version ON public.account_incidents FOR EACH ROW EXECUTE FUNCTION notification_router_auto_login_failure_v2();
CREATE TRIGGER notification_router_general_incident_v2 AFTER INSERT OR UPDATE OF status, lifecycle_version ON public.account_incidents FOR EACH ROW EXECUTE FUNCTION notification_router_general_incident_v2();
ALTER TABLE "public"."account_credentials" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "account_credentials_service_role_all" ON "public"."account_credentials" AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE TRIGGER accepted_instagram_credential_password_remediation_v1 AFTER INSERT OR UPDATE OF status, reauth_required, secret_ref ON public.account_credentials FOR EACH ROW WHEN (((new.provider = 'instagram'::text) AND (new.status = 'active'::text) AND (new.reauth_required IS FALSE) AND (new.secret_ref IS NOT NULL))) EXECUTE FUNCTION trigger_instagram_password_remediation_v1();
CREATE TRIGGER account_credentials_set_updated_at BEFORE UPDATE ON public.account_credentials FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE "public"."commercial_stripe_subscriptions" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER commercial_stripe_subscription_account_binding_v1 BEFORE UPDATE OF account_id ON public.commercial_stripe_subscriptions FOR EACH ROW EXECUTE FUNCTION private.enforce_stripe_subscription_account_binding_v1();
CREATE TRIGGER notification_router_plan_change_v2 AFTER UPDATE OF metadata_safe ON public.commercial_stripe_subscriptions FOR EACH ROW EXECUTE FUNCTION notification_router_plan_change_v2();
CREATE TRIGGER terminal_cancel_subscription_monotonicity_v1 BEFORE INSERT OR UPDATE ON public.commercial_stripe_subscriptions FOR EACH ROW EXECUTE FUNCTION enforce_terminal_cancel_subscription_monotonicity_v1();
ALTER TABLE "public"."instagram_account_restriction_holds" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "instagram_account_restriction_holds_service_role_all" ON "public"."instagram_account_restriction_holds" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);
ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their profile" ON "public"."profiles" AS PERMISSIVE FOR ALL TO "authenticated" USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));
ALTER TABLE "public"."account_session_transitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_business_events" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER notification_business_events_immutable_v2 BEFORE DELETE OR UPDATE ON public.notification_business_events FOR EACH ROW EXECUTE FUNCTION notification_business_events_immutable_v2();
CREATE TRIGGER notification_business_events_materialize_v2 AFTER INSERT ON public.notification_business_events FOR EACH ROW EXECUTE FUNCTION notification_router_materialize_deliveries_v2();
ALTER TABLE "public"."incident_retention_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_destination_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_deliveries" ENABLE ROW LEVEL SECURITY;
