drop function if exists public.mark_follow_60s_canary_evaluation_hold_v1(uuid,uuid,uuid,jsonb);
drop function if exists public.mark_follow_60s_canary_barrier_v1(uuid,uuid,uuid,integer);
drop function if exists public.persist_follow_60s_stage_v1(uuid,uuid,uuid,text,text,text,text,text,timestamptz,jsonb);
drop function if exists public.get_follow_60s_canary_control_v1(uuid);
drop table if exists public.follow_60s_canary_controls;
drop index if exists public.ig_interaction_events_stage_idempotency_uidx;
alter table public.ig_interaction_events drop column if exists stage_idempotency_key;
