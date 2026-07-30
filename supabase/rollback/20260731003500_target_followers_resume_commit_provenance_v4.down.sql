-- PREPARED ONLY — NOT APPLIED TO PRODUCTION.
-- Operational prerequisite: activate a Worker that does not call V4 first.
-- V3, checkpoints, events and all committed history are intentionally retained.

begin;

do $rollback_guard$
begin
  if to_regprocedure(
    'public.commit_target_followers_resume_checkpoint_v4(uuid,uuid,text,uuid,text,bigint,integer,jsonb,text,text,jsonb,text,text,boolean,text,integer)'
  ) is not null then
    execute $revoke$
      revoke all on function public.commit_target_followers_resume_checkpoint_v4(
        uuid,uuid,text,uuid,text,bigint,integer,jsonb,
        text,text,jsonb,text,text,boolean,text,integer
      ) from public, anon, authenticated, service_role
    $revoke$;
  end if;
end
$rollback_guard$;

drop function if exists public.commit_target_followers_resume_checkpoint_v4(
  uuid,uuid,text,uuid,text,bigint,integer,jsonb,
  text,text,jsonb,text,text,boolean,text,integer
);

-- Do not restore DEFAULT 2: the validated checkpoint constraint requires 3.
-- Do not delete or rewrite any V4 event already committed.

notify pgrst, 'reload schema';

commit;
