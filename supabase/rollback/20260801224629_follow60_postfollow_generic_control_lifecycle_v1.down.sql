-- Restore the exact predecessor functions retained by the forward migration.
-- This rollback does not modify controls, runs, requests or stage projections.

drop function if exists public.get_follow_60s_canary_control_v1(uuid);
drop function if exists public.persist_follow_60s_post_follow_v2(
  uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb
);
drop function if exists public.terminalize_follow_60s_canary_control_v1(
  uuid,uuid,uuid,uuid,text,text,jsonb
);

alter function public.get_follow_60s_canary_control_v1_pre_20260801224629(uuid)
  rename to get_follow_60s_canary_control_v1;
alter function public.persist_follow_60s_post_follow_v2_pre_20260801224629(
  uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb
) rename to persist_follow_60s_post_follow_v2;
alter function public.terminalize_follow_60s_canary_control_v1_pre_20260801224629(
  uuid,uuid,uuid,uuid,text,text,jsonb
) rename to terminalize_follow_60s_canary_control_v1;

revoke all on function public.get_follow_60s_canary_control_v1(uuid)
  from public,anon,authenticated;
grant execute on function public.get_follow_60s_canary_control_v1(uuid) to service_role;
revoke all on function public.persist_follow_60s_post_follow_v2(
  uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb
) from public,anon,authenticated;
grant execute on function public.persist_follow_60s_post_follow_v2(
  uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb
) to service_role;
revoke all on function public.terminalize_follow_60s_canary_control_v1(
  uuid,uuid,uuid,uuid,text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.terminalize_follow_60s_canary_control_v1(
  uuid,uuid,uuid,uuid,text,text,jsonb
) to service_role;
