begin;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select public.transition_account_incident_human_review_v3(
 '00000000-0000-0000-0000-000000009011','resolve',1,'admin',
 '580d7856-d60f-4838-a5f9-3b405d6ae79b','admin_dashboard','Synthetic resolution','cause_fixed','local-resolve-1',
 '2e0ae3ceaba2890876c5d5dfde9a486d4ac64bd0','local-v2');
commit;
