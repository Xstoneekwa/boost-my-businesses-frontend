revoke all on function public.persist_follow_60s_post_follow_v2(
  uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb
) from public, anon, authenticated, service_role;
drop function if exists public.persist_follow_60s_post_follow_v2(
  uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb
);
drop function if exists public.bind_follow_60s_canary_runtime_v2(
  uuid,uuid,uuid,integer,text
);
