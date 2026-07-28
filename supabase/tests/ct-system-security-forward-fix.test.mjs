import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const databaseUrl = process.env.CT_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("CT_TEST_DATABASE_URL is required");

async function psql(statement) {
  return runFile(
    "psql",
    ["-X", "-v", "ON_ERROR_STOP=1", "-Atq", databaseUrl, "-c", statement],
    { maxBuffer: 8 * 1024 * 1024 },
  );
}

async function expectDenied(role, statement) {
  await assert.rejects(
    () => psql(`set role ${role}; ${statement}`),
    (error) => {
      const detail = `${error?.stderr ?? ""}\n${error?.stdout ?? ""}`;
      assert.match(detail, /permission denied for table client_account_notifications/i);
      return true;
    },
    `${role} must be denied: ${statement}`,
  );
}

for (const role of ["anon", "authenticated"]) {
  await expectDenied(role, "select * from public.client_account_notifications limit 1");
  await expectDenied(
    role,
    `insert into public.client_account_notifications
      (client_id, account_id, category, notification_key)
     values
      ('30000000-0000-0000-0000-000000000000',
       '30000000-0000-0000-0001-000000000001',
       'needs_assistance',
       'forward-fix-denied-${role}')`,
  );
  await expectDenied(
    role,
    "update public.client_account_notifications set read_at = now() where false",
  );
  await expectDenied(
    role,
    "delete from public.client_account_notifications where false",
  );
}

const serviceRoleProbe = await psql(`
  begin;
  set local role service_role;
  insert into public.client_account_notifications
    (client_id, account_id, category, notification_key)
  values
    ('30000000-0000-0000-0000-000000000000',
     '30000000-0000-0000-0001-000000000001',
     'needs_assistance',
     'forward-fix-service-role-probe');
  update public.client_account_notifications
     set read_at = now()
   where notification_key = 'forward-fix-service-role-probe';
  delete from public.client_account_notifications
   where notification_key = 'forward-fix-service-role-probe';
  rollback;
`);
assert.doesNotMatch(serviceRoleProbe.stderr ?? "", /error/i);

const { stdout: catalogJson } = await psql(`
  select json_build_object(
    'rls_enabled', c.relrowsecurity,
    'policy_count', (
      select count(*)
      from pg_policies
      where schemaname = 'public'
        and tablename = 'client_account_notifications'
    ),
    'public_acl_count', (
      select count(*)
      from aclexplode(c.relacl) acl
      where acl.grantee = 0
    ),
    'anon_update', has_table_privilege(
      'anon', 'public.client_account_notifications', 'UPDATE'
    ),
    'authenticated_update', has_table_privilege(
      'authenticated', 'public.client_account_notifications', 'UPDATE'
    ),
    'service_role_access', has_table_privilege(
      'service_role',
      'public.client_account_notifications',
      'SELECT,INSERT,UPDATE,DELETE'
    )
  )
  from pg_class c
  where c.oid = 'public.client_account_notifications'::regclass;
`);
const catalog = JSON.parse(catalogJson.trim());
assert.equal(catalog.rls_enabled, true);
assert.equal(catalog.policy_count, 0);
assert.equal(catalog.public_acl_count, 0);
assert.equal(catalog.anon_update, false);
assert.equal(catalog.authenticated_update, false);
assert.equal(catalog.service_role_access, true);

console.log("CT_SYSTEM_SECURITY_FORWARD_FIX_CERTIFIED");
