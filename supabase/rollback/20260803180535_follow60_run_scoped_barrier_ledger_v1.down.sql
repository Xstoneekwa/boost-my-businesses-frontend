-- Targeted rollback for the additive Follow60 run-scoped ledger.

revoke all on function public.ack_follow_60s_completed_cycle_v1(
  uuid,uuid,uuid,uuid,text,text,integer,text,text,text,text,text,text
) from public, anon, authenticated, service_role;
drop function if exists public.ack_follow_60s_completed_cycle_v1(
  uuid,uuid,uuid,uuid,text,text,integer,text,text,text,text,text,text
);
drop table if exists public.follow_60s_completed_cycle_ledger;
