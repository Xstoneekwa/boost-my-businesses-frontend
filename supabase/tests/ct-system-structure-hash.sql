with objects as (
  select 'column|'||n.nspname||'.'||c.relname||'|'||a.attname||'|'||
    pg_catalog.format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_get_expr(ad.adbin,ad.adrelid),'') v
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum
  where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped
  union all
  select 'constraint|'||c.relname||'|'||co.conname||'|'||pg_get_constraintdef(co.oid,true)
  from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
  union all
  select 'index|'||c.relname||'|'||i.relname||'|'||pg_get_indexdef(i.oid)
  from pg_index x join pg_class i on i.oid=x.indexrelid join pg_class c on c.oid=x.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
  union all
  select 'view|'||c.relname||'|'||pg_get_viewdef(c.oid,true)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m')
  union all
  select 'function|'||p.oid::regprocedure::text||'|'||pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and not exists (
    select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'
  )
  union all
  select 'policy|'||schemaname||'|'||tablename||'|'||policyname||'|'||permissive||'|'||roles::text||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')
  from pg_policies where schemaname='public'
  union all
  select 'trigger|'||c.relname||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid,true)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and not t.tgisinternal
)
select md5(string_agg(v,E'\n' order by v)) as ct_system_structure_hash from objects;
