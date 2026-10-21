-- Local candidate only. No production application before Approval 2.
create table public.account_annotations (
 account_id uuid primary key references public.ig_accounts(id),
 client_id uuid not null,
 annotation text check (annotation is null or (length(annotation) between 1 and 1000 and annotation=btrim(annotation))),
 version integer not null check (version > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.account_annotations enable row level security;
revoke all on public.account_annotations from public,anon,authenticated;
grant select,insert,update on public.account_annotations to service_role;

-- Retain an empty versioned row after delete to prevent ABA/lost-update races.
create function public.save_account_annotation_v1(p_account_id uuid,p_client_id uuid,p_expected_version integer,p_annotation text)
returns public.account_annotations language plpgsql security invoker set search_path='' as $$
declare v_row public.account_annotations%rowtype; v_clients uuid[]; v_text text;
begin
 if p_expected_version is null or p_expected_version<0 or p_client_id is null then
  raise exception using errcode='22023',message='invalid_annotation_input';
 end if;
 perform 1 from public.ig_accounts where id=p_account_id for update;
 if not found then raise exception using errcode='PT404',message='account_not_found'; end if;
 -- Serialize against ownership changes until commit, without changing ownership.
 lock table public.client_instagram_accounts in share mode;
 select array_agg(client_id) into v_clients from public.client_instagram_accounts where account_id=p_account_id;
 if cardinality(v_clients) is distinct from 1 or v_clients[1] is distinct from p_client_id then
  raise exception using errcode='PT409',message='account_binding_changed';
 end if;
 v_text:=nullif(btrim(p_annotation),'');
 if length(v_text)>1000 then raise exception using errcode='22023',message='annotation_too_long'; end if;
 select * into v_row from public.account_annotations where account_id=p_account_id for update;
 if v_row.account_id is not null and v_row.client_id is distinct from p_client_id then
  raise exception using errcode='PT409',message='annotation_binding_changed';
 end if;
 if coalesce(v_row.version,0)<>p_expected_version then
  raise exception using errcode='PT409',message='annotation_version_conflict';
 end if;
 insert into public.account_annotations(account_id,client_id,annotation,version)
 values(p_account_id,p_client_id,v_text,1)
 on conflict(account_id) do update set annotation=excluded.annotation,
 version=public.account_annotations.version+1,updated_at=now()
 returning * into v_row;
 return v_row;
end;
$$;
revoke all on function public.save_account_annotation_v1(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.save_account_annotation_v1(uuid,uuid,integer,text) to service_role;

-- Replaces the existing Stats snapshot request, not an additional collector/fetch.
-- Each metric can have a different latest valid observation.
create function public.read_stats_social_observations_v1(p_account_id uuid,p_since timestamptz,p_until timestamptz)
returns setof public.ig_account_social_profile_snapshots
language sql stable security invoker set search_path='' as $$
 with selected as (
 select s.id from public.ig_account_social_profile_snapshots s
 where s.account_id=p_account_id and s.lookup_status='found'
 and s.observed_at between p_since and least(p_until,now())
 union
 (select s.id from public.ig_account_social_profile_snapshots s
 where s.account_id=p_account_id and s.lookup_status='found'
 and s.followers_count>=0 and s.observed_at<=least(p_until,now())
 order by s.observed_at desc,s.id desc limit 1)
 union
 (select s.id from public.ig_account_social_profile_snapshots s
 where s.account_id=p_account_id and s.lookup_status='found'
 and s.following_count>=0 and s.observed_at<=least(p_until,now())
 order by s.observed_at desc,s.id desc limit 1)
 )
 select s.* from public.ig_account_social_profile_snapshots s join selected x using(id)
 order by s.observed_at,s.id;
$$;
revoke all on function public.read_stats_social_observations_v1(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.read_stats_social_observations_v1(uuid,timestamptz,timestamptz) to service_role;
