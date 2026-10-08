\set ON_ERROR_STOP on
create function pg_temp.assert_true(p boolean,m text) returns void language plpgsql as $$
begin if not coalesce(p,false) then raise exception 'FAIL: %',m; end if; end $$;
insert into public.commercial_identity_providers values
 ('future_case_sensitive','XX','structured','opaque_exact',true,'fixture','{"discovery_enabled":false}');
set request.jwt.claim.role='service_role';
set role service_role;
select pg_temp.assert_true(public.normalize_structured_external_id_v1('sirene',' 12345678900001 ')='12345678900001','SIRET exact');
select pg_temp.assert_true(public.normalize_structured_external_id_v1('future_case_sensitive','CaseSensitiveID')<>public.normalize_structured_external_id_v1('future_case_sensitive','casesensitiveid'),'opaque case preserved');
select pg_temp.assert_true(public.classify_structured_domain_v1('https://www.planity.com/a')->>'classification'='SHARED_PLATFORM_DOMAIN','Planity shared');
select pg_temp.assert_true(public.classify_structured_domain_v1('https://booking.treatwell.co.uk/a')->>'classification'='SHARED_PLATFORM_DOMAIN','Treatwell subdomain shared');
select pg_temp.assert_true(public.classify_structured_domain_v1('https://salon.example',true)->>'classification'='OWNED_BUSINESS_DOMAIN','verified domain');
select pg_temp.assert_true(public.classify_structured_domain_v1('https://salon.example')->>'classification'='UNKNOWN_DOMAIN','ownership not inferred');
select pg_temp.assert_true(public.classify_structured_domain_v1('https://planity.com@evil.example')->>'domain' is null,'malformed URL fails closed');
select pg_temp.assert_true(public.commercial_crm_identity_domain_v2('https://planity.com/a')='planity.com','legacy normalizer untouched');

create temporary table created_results(k text,r jsonb);
insert into created_results values
 ('a',public.create_structured_commercial_business_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','sirene','12345678900001','Chain','FR','Paris','1 Rue A','https://example-chain.fr','examplechain')),
 ('b',public.create_structured_commercial_business_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','sirene','12345678900002','Chain','FR','Lyon','2 Rue B','https://example-chain.fr','examplechain')),
 ('retry',public.create_structured_commercial_business_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','sirene','12345678900001','Changed request','FR')),
 ('upper',public.create_structured_commercial_business_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','future_case_sensitive','CaseSensitiveID','Future One','XX')),
 ('lower',public.create_structured_commercial_business_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','future_case_sensitive','casesensitiveid','Future Two','XX'));
select pg_temp.assert_true((select r->>'business_id' from created_results where k='a')<>(select r->>'business_id' from created_results where k='b'),'two SIRETs two businesses');
select pg_temp.assert_true((select r->>'business_id' from created_results where k='a')=(select r->>'business_id' from created_results where k='retry'),'same SIRET idempotency');
select pg_temp.assert_true((select r->>'business_id' from created_results where k='upper')<>(select r->>'business_id' from created_results where k='lower'),'future fixture two businesses');
select pg_temp.assert_true((select count(*)=2 from public.commercial_businesses where identity_mode='structured' and website_domain_normalized='example-chain.fr' and instagram_handle_normalized='examplechain'),'shared domain and IG');
select pg_temp.assert_true(public.create_structured_commercial_business_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','future_case_sensitive','cross','Chain','XX','Paris','1 Rue A','https://example-chain.fr')->>'status'='review_hold','cross provider held');

insert into public.commercial_businesses(business_name,country_code,vertical,website,instagram_handle,source)
 values('Legacy collision','ZA','Beauty/Aesthetics','https://legacy.example','legacyhandle','searchapi');
insert into public.commercial_business_identifiers(business_id,provider,external_id)
 select id,'searchapi','legacylower' from public.commercial_businesses where business_name='Legacy collision';
select pg_temp.assert_true(public.create_structured_commercial_business_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','sirene','12345678900003','Incoming','FR',null,null,'https://legacy.example','legacyhandle')->>'status'='review_hold','legacy collision held');
select pg_temp.assert_true(public.create_structured_commercial_business_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','sirene','12345678900004','Planity A','FR',null,null,'https://planity.com/a')->>'created'='true','Planity first');
select pg_temp.assert_true(public.create_structured_commercial_business_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','sirene','12345678900005','Planity B','FR',null,null,'https://planity.com/b')->>'created'='true','Planity second');
select pg_temp.assert_true((select count(*)=2 from public.commercial_businesses where identity_mode='structured' and website like 'https://planity.com/%' and website_domain_normalized is null),'shared platform not identity domain');

do $$ begin
 begin insert into public.commercial_businesses(business_name,country_code,vertical,website) values('Duplicate domain','ZA','Beauty/Aesthetics','https://legacy.example'); raise exception 'FAIL expected unique domain'; exception when unique_violation then null; end;
 begin insert into public.commercial_businesses(business_name,country_code,vertical,instagram_handle) values('Duplicate handle','ZA','Beauty/Aesthetics','legacyhandle'); raise exception 'FAIL expected unique handle'; exception when unique_violation then null; end;
 begin perform public.normalize_structured_external_id_v1('sirene','abc'); raise exception 'FAIL expected invalid SIRET'; exception when invalid_parameter_value then null; end;
 begin perform public.create_structured_commercial_business_v1('22222222-2222-4222-8222-222222222222','sirene','12345678900009','Denied','FR'); raise exception 'FAIL expected owner denial'; exception when insufficient_privilege then null; end;
 begin perform public.create_structured_commercial_business_v1('44444444-4444-4444-8444-444444444444','sirene','12345678900009','Denied','FR'); raise exception 'FAIL expected admin denial'; exception when insufficient_privilege then null; end;
 begin perform public.create_structured_commercial_business_v1(null,'sirene','12345678900009','Denied','FR'); raise exception 'FAIL expected anonymous denial'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.assert_true(not has_function_privilege('anon','public.create_structured_commercial_business_v1(uuid,text,text,text,text,text,text,text,text)','execute') and not has_function_privilege('authenticated','public.create_structured_commercial_business_v1(uuid,text,text,text,text,text,text,text,text)','execute'),'browser RPC denied');
select pg_temp.assert_true((select count(*)=0 from public.commercial_leads),'no leads created');
set role service_role;
select public.create_commercial_discovery_run_v2('580d7856-d60f-4838-a5f9-3b405d6ae79b','Cape Town','Hair Salon',1,'structured-legacy-regression',false);
select * from public.claim_commercial_discovery_runs_v2(1,'structured-test');
select pg_temp.assert_true(public.preflight_commercial_discovery_candidate_v1(
 (select id from public.commercial_discovery_runs where idempotency_key='structured-legacy-regression'),
 'searchapi','LEGACYLOWER','other',null,'name')->>'business_id'=(select id::text from public.commercial_businesses where business_name='Legacy collision'),'legacy lowercase still resolves');
select pg_temp.assert_true(public.preflight_commercial_discovery_candidate_v1(
 (select id from public.commercial_discovery_runs where idempotency_key='structured-legacy-regression'),
 'searchapi','newid','examplechain','https://example-chain.fr','Chain')->>'business_id' is null,'legacy fallback excludes structured rows');
select pg_temp.assert_true(public.preflight_commercial_discovery_candidate_v1(
 (select id from public.commercial_discovery_runs where idempotency_key='structured-legacy-regression'),
 'searchapi','newid','legacyhandle','https://legacy.example','name')->>'business_id'=(select id::text from public.commercial_businesses where business_name='Legacy collision'),'legacy fallback still resolves legacy rows');
reset role;
select 'STRUCTURED_IDENTITY_SQL_PASS';
