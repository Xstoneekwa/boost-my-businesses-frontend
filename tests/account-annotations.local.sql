\set ON_ERROR_STOP on
insert into public.clients(id,name) values ('20000000-0000-4000-8000-000000000001','Annotation client A'),('20000000-0000-4000-8000-000000000002','Annotation client B');
insert into public.ig_accounts(id,username) values ('10000000-0000-4000-8000-000000000001','annotation_fixture_a'),('10000000-0000-4000-8000-000000000002','annotation_fixture_b');
insert into public.client_instagram_accounts(client_id,account_id) values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
set role service_role;
select public.save_account_annotation_v1('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',0,' short ');
do $$
declare r public.account_annotations; begin
 select * into r from public.account_annotations where account_id='10000000-0000-4000-8000-000000000001';
 if r.annotation<>'short' or r.version<>1 then raise exception 'create/read failed'; end if;
 begin
 perform public.save_account_annotation_v1(r.account_id,r.client_id,0,'lost update');
 raise exception 'conflict not detected';
 exception when sqlstate 'PT409' then null; end;
 begin
 perform public.save_account_annotation_v1(r.account_id,'20000000-0000-4000-8000-000000000002',1,'cross client');
 raise exception 'ownership not checked';
 exception when sqlstate 'PT409' then null; end;
 perform public.save_account_annotation_v1(r.account_id,r.client_id,1,repeat('a',1000));
 perform public.save_account_annotation_v1(r.account_id,r.client_id,2,'   ');
 select * into r from public.account_annotations where account_id=r.account_id;
 if r.annotation is not null or r.version<>3 then raise exception 'delete/ABA failed'; end if;
 if exists(select 1 from public.account_annotations where account_id='10000000-0000-4000-8000-000000000002') then raise exception 'cross account leak'; end if;
end $$;
reset role;
set role anon;
do $$ begin
 begin perform * from public.account_annotations; raise exception 'anon read permitted'; exception when insufficient_privilege then null; end;
 begin perform public.save_account_annotation_v1('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',3,'bad'); raise exception 'anon write permitted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
do $$ begin
 begin perform * from public.account_annotations; raise exception 'authenticated direct read permitted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'LOCAL_ANNOTATIONS_SQL=PASS' result;
