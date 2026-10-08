begin;
set local lock_timeout='5s';
update public.commercial_identity_providers
set source_policy=source_policy||jsonb_build_object('discovery_enabled',true,'phase','bounded_poc_v1','authorization_key','commercial-france-wide-sirene-poc15-v1','max_candidates',15,'prospecting_eligibility','active_full_diffusion_gate_required')
where provider_key='sirene' and country='FR' and identity_mode='structured';
commit;
