-- Disable new Mainline V1 writes without deleting any persisted evidence.
revoke all on function public.persist_follow60_post_follow_v3(
  text,uuid,text,uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.ack_follow60_completed_cycle_v2(
  text,uuid,uuid,uuid,uuid,text,text,integer,text,text,text,text,text,text
) from public,anon,authenticated,service_role;

-- Functions and binding_kind stay readable for forensic and rollback safety.
