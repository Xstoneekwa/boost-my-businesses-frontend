-- Successor only: transport=dinum, canonical identity provider remains sirene.
-- call_kind=sirene is the existing official-establishment lookup operation unit.
-- DINUM + direct Sirene share budget_limits_safe.sirene (existing default 2).
-- No new unit/budget/table; no runtime trigger, data backfill or provider call.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.reserve_commercial_france_provider_call_v1(uuid,text,text,text)'::regprocedure)
     IS DISTINCT FROM '82129136e9f615eab757cfa72b15e25c'
  THEN RAISE EXCEPTION 'dinum_ledger_baseline_rpc_drift'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='public.commercial_france_provider_calls'::regclass
      AND conname='commercial_france_provider_calls_provider_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%dinum%')
  THEN RAISE EXCEPTION 'dinum_ledger_baseline_constraint_drift'; END IF;
END
$guard$;

ALTER TABLE public.commercial_france_provider_calls
  DROP CONSTRAINT commercial_france_provider_calls_provider_check;
ALTER TABLE public.commercial_france_provider_calls
  ADD CONSTRAINT commercial_france_provider_calls_provider_check CHECK (
    provider IN ('searchapi','sirene','openai','dinum')
    AND (provider <> 'dinum' OR call_kind='sirene')
  );
COMMENT ON CONSTRAINT commercial_france_provider_calls_provider_check
  ON public.commercial_france_provider_calls IS
  'Transport dinum is distinct from sirene; dinum uses only the existing official-establishment call_kind=sirene and shares its bounded budget. Identity provider remains sirene/SIRET.';

CREATE OR REPLACE FUNCTION public.reserve_commercial_france_provider_call_v1(p_run_id uuid, p_provider text, p_call_kind text, p_call_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_control public.commercial_france_run_controls%rowtype;
  v_run public.commercial_discovery_runs%rowtype;
  v_limit integer;
  v_used integer;
  v_existing uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select * into v_control from public.commercial_france_run_controls where run_id = p_run_id for update;
  select * into v_run from public.commercial_discovery_runs where id = p_run_id;
  if v_control.run_id is null or v_run.country_code <> 'FR' then return jsonb_build_object('reserved',false,'reason','france_control_missing'); end if;
  if v_control.state not in ('armed','running') or v_run.status <> 'running' then return jsonb_build_object('reserved',false,'reason','run_not_running'); end if;
  if p_provider not in ('searchapi','sirene','openai','dinum') or p_call_kind not in ('discovery','resolver','site_page','profile','sirene','scoring')
    or (p_provider='dinum' and p_call_kind is distinct from 'sirene') then return jsonb_build_object('reserved',false,'reason','provider_call_kind_invalid'); end if;
  if char_length(btrim(coalesce(p_call_key,''))) not between 1 and 240 then return jsonb_build_object('reserved',false,'reason','call_key_invalid'); end if;
  select id into v_existing from public.commercial_france_provider_calls where run_id=p_run_id and provider=p_provider and call_kind=p_call_kind and call_key=btrim(p_call_key);
  if v_existing is not null then return jsonb_build_object('reserved',false,'reason','idempotent_replay','call_id',v_existing); end if;
  v_limit := coalesce((v_control.budget_limits_safe ->> case p_call_kind
    when 'discovery' then 'searchapi_discovery' when 'resolver' then 'searchapi_resolver'
    when 'site_page' then 'site_pages' when 'profile' then 'public_profiles'
    when 'sirene' then 'sirene' when 'scoring' then 'openai_scoring' end)::integer, 0);
  select count(*)::integer into v_used from public.commercial_france_provider_calls
  where run_id=p_run_id and call_kind=p_call_kind and status <> 'cancelled';
  if v_limit <= v_used then return jsonb_build_object('reserved',false,'reason','budget_exceeded','call_kind',p_call_kind,'used',v_used,'limit',v_limit); end if;
  insert into public.commercial_france_provider_calls(run_id,provider,call_kind,call_key,status)
  values(p_run_id,p_provider,p_call_kind,btrim(p_call_key),'reserved') returning id into v_existing;
  update public.commercial_france_run_controls set state='running' where run_id=p_run_id and state='armed';
  return jsonb_build_object('reserved',true,'call_id',v_existing,'used',v_used+1,'limit',v_limit);
end
$function$;

-- Preserve existing service-only execution and invoker security.
REVOKE ALL ON FUNCTION public.reserve_commercial_france_provider_call_v1(uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_commercial_france_provider_call_v1(uuid,text,text,text)
  TO service_role;
COMMIT;

