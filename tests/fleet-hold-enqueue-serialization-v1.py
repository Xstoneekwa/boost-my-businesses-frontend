"""Canonical local enqueue / Hold serialization, PostgreSQL 17 only.

Production metadata captured with explicit read-only authorization.
No cloud calls, no claim modification, no production writes.
"""
import concurrent.futures
import json
import pathlib
import runpy
import subprocess
import time
import unittest
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFINITIONS = json.loads("[{\"proname\":\"account_has_active_ig_run\",\"arguments\":\"p_account_id uuid\",\"definition\":\"CREATE OR REPLACE FUNCTION public.account_has_active_ig_run(p_account_id uuid)\\n RETURNS boolean\\n LANGUAGE sql\\n STABLE\\n SET search_path TO 'public'\\nAS $function$\\n  select exists (\\n    select 1\\n    from public.ig_runs r\\n    where r.account_id = p_account_id\\n      and lower(coalesce(r.status, '')) in (\\n        'running',\\n        'queued',\\n        'pending',\\n        'in_progress',\\n        'active',\\n        'starting'\\n      )\\n  );\\n$function$\\n\"},{\"proname\":\"create_account_run_request\",\"arguments\":\"p_account_id uuid, p_requested_by uuid, p_actor_type text, p_source_surface text, p_requested_run_type text, p_idempotency_key text, p_priority integer, p_metadata_safe jsonb\",\"definition\":\"CREATE OR REPLACE FUNCTION public.create_account_run_request(p_account_id uuid, p_requested_by uuid DEFAULT NULL::uuid, p_actor_type text DEFAULT 'admin'::text, p_source_surface text DEFAULT 'instagram_dashboard'::text, p_requested_run_type text DEFAULT 'account_session'::text, p_idempotency_key text DEFAULT NULL::text, p_priority integer DEFAULT 0, p_metadata_safe jsonb DEFAULT '{}'::jsonb)\\n RETURNS account_run_requests\\n LANGUAGE plpgsql\\n SECURITY DEFINER\\n SET search_path TO 'public'\\nAS $function$\\ndeclare\\n  v_actor_type text := lower(coalesce(nullif(trim(p_actor_type), ''), 'admin'));\\n  v_source_surface text := coalesce(nullif(trim(p_source_surface), ''), 'instagram_dashboard');\\n  v_requested_run_type text := lower(coalesce(nullif(trim(p_requested_run_type), ''), 'account_session'));\\n  v_idempotency_key text := coalesce(\\n    nullif(trim(p_idempotency_key), ''),\\n    'dashboard:' || p_account_id::text || ':' || gen_random_uuid()::text\\n  );\\n  v_metadata jsonb := coalesce(p_metadata_safe, '{}'::jsonb);\\n  v_existing public.account_run_requests;\\n  v_row public.account_run_requests;\\n  v_assignment public.account_assignments;\\n  v_app_instance public.phone_app_instances;\\n  v_parent_binding jsonb;\\n  v_resume_action_id text;\\n  v_parent_request_id text;\\n  v_scheduler_enabled boolean;\\nbegin\\n  if p_account_id is null then\\n    raise exception 'account_id_required' using errcode = '22023';\\n  end if;\\n\\n  if v_actor_type not in ('admin', 'assistant', 'ops', 'system', 'internal', 'client') then\\n    raise exception 'invalid_actor_type' using errcode = '22023';\\n  end if;\\n\\n  if not public.run_control_metadata_is_safe(v_metadata) then\\n    raise exception 'metadata_forbidden_key' using errcode = '22023';\\n  end if;\\n\\n  if v_requested_run_type = 'login_email_code_resume' then\\n    v_resume_action_id := coalesce(\\n      nullif(trim(v_metadata ->> 'action_id'), ''),\\n      nullif(trim(v_metadata ->> 'verification_action_id'), '')\\n    );\\n    if v_resume_action_id is null then\\n      raise exception 'login_resume_action_id_required' using errcode = '22023';\\n    end if;\\n  end if;\\n\\n  select *\\n    into v_existing\\n  from public.account_run_requests arr\\n  where arr.idempotency_key = v_idempotency_key\\n  limit 1;\\n\\n  if found then\\n    return v_existing;\\n  end if;\\n\\n  if v_source_surface in ('auto_restart_tick', 'instagram_schedule_session_cron') then\\n    select s.auto_restart_enabled\\n      into v_scheduler_enabled\\n    from public.auto_restart_settings s\\n    where s.id = 'global'\\n    for share;\\n\\n    if not coalesce(v_scheduler_enabled, false) then\\n      raise exception 'scheduler_disabled' using errcode = '22023';\\n    end if;\\n  end if;\\n\\n  if v_requested_run_type in ('login_provisioning', 'login_email_code_resume') then\\n    select aa.*\\n      into v_assignment\\n    from public.account_assignments aa\\n    where aa.account_id = p_account_id\\n      and aa.status in ('reserved', 'active')\\n    order by aa.created_at desc\\n    limit 1\\n    for share;\\n\\n    if v_assignment.id is null then\\n      raise exception 'login_assignment_binding_missing' using errcode = '22023';\\n    end if;\\n    if v_assignment.app_instance_id is null then\\n      raise exception 'login_app_instance_binding_missing' using errcode = '22023';\\n    end if;\\n\\n    select pai.*\\n      into v_app_instance\\n    from public.phone_app_instances pai\\n    where pai.id = v_assignment.app_instance_id\\n    for share;\\n\\n    if v_app_instance.id is null then\\n      raise exception 'login_app_instance_binding_missing' using errcode = '22023';\\n    end if;\\n    if v_app_instance.device_id <> v_assignment.device_id then\\n      raise exception 'login_app_instance_device_mismatch' using errcode = '22023';\\n    end if;\\n    if nullif(trim(v_app_instance.package_name), '') is null\\n       or v_app_instance.package_name !~ '^[A-Za-z0-9_.]+$' then\\n      raise exception 'login_package_binding_missing' using errcode = '22023';\\n    end if;\\n    if not v_app_instance.is_launchable\\n       or not v_app_instance.usable_for_auto_login\\n       or v_app_instance.status not in ('available', 'active', 'occupied', 'reserved') then\\n      raise exception 'login_app_instance_unavailable' using errcode = '22023';\\n    end if;\\n    if v_app_instance.current_account_id is not null\\n       and v_app_instance.current_account_id <> p_account_id then\\n      raise exception 'login_app_instance_account_mismatch' using errcode = '22023';\\n    end if;\\n\\n    -- Reject caller-provided routing that disagrees with the canonical rows.\\n    if nullif(trim(v_metadata ->> 'assignment_id'), '') is not null\\n       and v_metadata ->> 'assignment_id' <> v_assignment.id::text then\\n      raise exception 'login_assignment_binding_mismatch' using errcode = '22023';\\n    end if;\\n    if nullif(trim(v_metadata ->> 'device_id'), '') is not null\\n       and v_metadata ->> 'device_id' <> v_assignment.device_id::text then\\n      raise exception 'login_device_binding_mismatch' using errcode = '22023';\\n    end if;\\n    if nullif(trim(v_metadata ->> 'app_instance_id'), '') is not null\\n       and v_metadata ->> 'app_instance_id' <> v_app_instance.id::text then\\n      raise exception 'login_app_instance_binding_mismatch' using errcode = '22023';\\n    end if;\\n    if nullif(trim(v_metadata ->> 'package_name'), '') is not null\\n       and v_metadata ->> 'package_name' <> v_app_instance.package_name then\\n      raise exception 'login_package_binding_mismatch' using errcode = '22023';\\n    end if;\\n    if v_metadata ? 'clone_index' then\\n      if coalesce(v_metadata ->> 'clone_index', '') !~ '^[0-9]+$'\\n         or (v_metadata ->> 'clone_index')::integer <> v_app_instance.instance_index then\\n        raise exception 'login_clone_index_binding_mismatch' using errcode = '22023';\\n      end if;\\n    end if;\\n\\n    v_metadata := v_metadata || jsonb_build_object(\\n      'binding_version', 'auto_login_app_instance_v1',\\n      'assignment_id', v_assignment.id,\\n      'device_id', v_assignment.device_id,\\n      'app_instance_id', v_app_instance.id,\\n      'package_name', v_app_instance.package_name,\\n      'clone_index', v_app_instance.instance_index\\n    );\\n\\n    -- A verification-code resume must remain on the exact parent binding.\\n    if v_requested_run_type = 'login_email_code_resume' then\\n      v_parent_request_id := nullif(trim(v_metadata ->> 'parent_request_id'), '');\\n      if v_parent_request_id is not null then\\n        select arr.metadata_safe\\n          into v_parent_binding\\n        from public.account_run_requests arr\\n        where arr.id::text = v_parent_request_id\\n          and arr.account_id = p_account_id\\n          and arr.requested_run_type = 'login_provisioning'\\n        limit 1;\\n\\n        if v_parent_binding is null\\n           or v_parent_binding ->> 'binding_version' <> 'auto_login_app_instance_v1'\\n           or nullif(trim(v_parent_binding ->> 'assignment_id'), '') is null\\n           or nullif(trim(v_parent_binding ->> 'device_id'), '') is null\\n           or nullif(trim(v_parent_binding ->> 'app_instance_id'), '') is null\\n           or nullif(trim(v_parent_binding ->> 'package_name'), '') is null\\n           or not (v_parent_binding ? 'clone_index') then\\n          raise exception 'login_parent_binding_missing' using errcode = '22023';\\n        end if;\\n        if v_parent_binding ->> 'assignment_id' <> v_metadata ->> 'assignment_id'\\n           or v_parent_binding ->> 'device_id' <> v_metadata ->> 'device_id'\\n           or v_parent_binding ->> 'app_instance_id' <> v_metadata ->> 'app_instance_id'\\n           or v_parent_binding ->> 'package_name' <> v_metadata ->> 'package_name'\\n           or (v_parent_binding ->> 'clone_index')::integer <> (v_metadata ->> 'clone_index')::integer then\\n          raise exception 'login_parent_binding_changed' using errcode = '22023';\\n        end if;\\n      end if;\\n    end if;\\n  end if;\\n\\n  if v_requested_run_type not in ('login_provisioning', 'login_email_code_resume')\\n     and public.account_has_active_ig_run(p_account_id) then\\n    raise exception 'account_already_running' using errcode = '22023';\\n  end if;\\n\\n  if exists (\\n    select 1\\n    from public.account_run_requests arr\\n    where arr.account_id = p_account_id\\n      and arr.status in ('queued', 'claimed', 'starting', 'running')\\n  ) then\\n    raise exception 'account_run_already_requested' using errcode = '22023';\\n  end if;\\n\\n  insert into public.account_run_requests (\\n    account_id,\\n    requested_by,\\n    actor_type,\\n    source_surface,\\n    requested_run_type,\\n    status,\\n    priority,\\n    idempotency_key,\\n    metadata_safe\\n  )\\n  values (\\n    p_account_id,\\n    p_requested_by,\\n    v_actor_type,\\n    v_source_surface,\\n    v_requested_run_type,\\n    'queued',\\n    coalesce(p_priority, 0),\\n    v_idempotency_key,\\n    v_metadata\\n  )\\n  returning * into v_row;\\n\\n  return v_row;\\nend;\\n$function$\\n\"}]")
FIXTURE_NAMESPACE = runpy.run_path(str(ROOT / "tests/fleet-final-device-integration-v1.py"))
PG = "/opt/homebrew/opt/postgresql@17/bin/psql"


class HoldEnqueueRace(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = FIXTURE_NAMESPACE["Combined"]
        cls.addClassCleanup(cls.db.doClassCleanups)
        cls.db.setUpClass()
        cls.db.sql("""
          CREATE TABLE IF NOT EXISTS public.phone_app_instances(
            id uuid PRIMARY KEY, device_id uuid, package_name text,
            is_launchable boolean, usable_for_auto_login boolean, status text,
            current_account_id uuid, instance_index integer);
          CREATE TABLE IF NOT EXISTS public.auto_restart_settings(
            id text PRIMARY KEY, auto_restart_enabled boolean);
          INSERT INTO public.auto_restart_settings VALUES('global',true)
            ON CONFLICT(id) DO UPDATE SET auto_restart_enabled=true;
        """)
        # Use the canonical metadata guard from the existing schema fixture,
        # rather than accepting all JSON objects in the test.
        import re
        schema = (ROOT / "tests/fixtures/warmup-real-schema-20260906.sql").read_text()
        guards = list(re.finditer(
            r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?public"?\."?run_control_metadata_is_safe"?\s*\(.*?\bAS\s+\$(\w*)\$.*?\$\1\$\s*;',
            schema, re.S | re.I))
        if len(guards) != 1:
            raise AssertionError("canonical metadata guard missing or ambiguous")
        cls.db.sql(guards[0].group(0))
        for item in DEFINITIONS:
            source = item["definition"]
            if item["proname"] == "create_account_run_request":
                source = source.replace("public.create_account_run_request(", "public.fleet_enqueue_guarded_internal_v1(", 1)
                marker = "  insert into public.account_run_requests ("
                if source.count(marker) != 1:
                    raise AssertionError("canonical insertion anchor changed")
                source = source.replace(marker, "  perform public.assert_fleet_admission_v1(p_account_id);\n\n" + marker, 1)
            cls.db.sql(source)
        # The current candidate includes safe reclaim on top of atomic enqueue.
        cls.db.sql((ROOT / "supabase/migrations/20260907135729_fleet_safe_expired_lease_reclaim_v1.sql").read_text())
        cls.db.sql("""
          CREATE TABLE public.tenant_users(user_id uuid,tenant_id uuid,role text);
          CREATE TABLE public.ig_action_logs(id uuid DEFAULT gen_random_uuid(),account_id uuid,
            run_id uuid,target_username text,action_type text,status text,message text,payload jsonb,
            created_at timestamptz DEFAULT now());
        """)
        cls.db.sql((ROOT / "supabase/migrations/20260907193846_fleet_policy_mutation_caller_v1.sql").read_text())
        cls.races = 0

    def setUp(self):
        self.account, self.tenant, self.device, self.actor = (str(uuid.uuid4()) for _ in range(4))
        self.hold_request_id = str(uuid.uuid4())
        self.db.sql(f"""
          INSERT INTO tenant_users(user_id,tenant_id,role) VALUES('{self.actor}','{self.tenant}','superadmin');
          INSERT INTO ig_accounts(id) VALUES('{self.account}');
          INSERT INTO client_instagram_accounts(account_id,client_id) VALUES('{self.account}','{self.tenant}');
          INSERT INTO account_assignments(account_id,device_id,status)
            VALUES('{self.account}','{self.device}','active');
        """)

    def enqueue_sql(self, key):
        return f"""SELECT to_jsonb(public.create_account_run_request(
          p_account_id=>'{self.account}',p_idempotency_key=>'{key}',
          p_source_surface=>'auto_restart_tick',
          p_metadata_safe=>'{{"device_lock_lease_seconds":600}}'));"""

    def mutation_sql(self, action, revision=None, request_id=None, **extra):
        payload = dict(actor_id=self.actor, account_id=self.account, tenant_id=self.tenant,
                       request_id=request_id or self.hold_request_id, action=action,
                       expected_revision=revision, **extra)
        return "SELECT public.fleet_mutate_policy_v1('" + json.dumps(payload).replace("'", "''") + "'::jsonb);"

    def hold_sql(self, revision=None):
        return self.mutation_sql('hold', revision)

    def mutation(self, sql, role='service_role', check=True):
        if role not in ('service_role', 'anon', 'authenticated'):
            raise AssertionError('unexpected fixture role')
        return self.db.sql('BEGIN; SET LOCAL ROLE ' + role + '; ' + sql + ' COMMIT;', check=check)

    def scalar(self, sql):
        return self.db.sql(sql).stdout.strip().splitlines()[-1]

    def open_transaction(self, sql, name):
        process = subprocess.Popen(
            [PG, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", str(self.db.directory),
             "-p", "55483", "-d", "postgres"], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        process.stdin.write("BEGIN; SET LOCAL ROLE service_role; SET LOCAL statement_timeout='8s'; "
                            + f"SET LOCAL application_name='{name}';\n" + sql + "\n\\echo FIRST_READY\n")
        process.stdin.flush()
        lines = []
        while True:
            line = process.stdout.readline()
            if not line:
                raise AssertionError("first transaction failed: " + process.stderr.read())
            lines.append(line)
            if line.strip() == "FIRST_READY":
                break
        return process

    def wait_for_block(self, name):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if self.scalar(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{name}' AND wait_event_type='Lock');") == "t":
                return
            time.sleep(.01)
        raise AssertionError("second transaction never demonstrably waited on the lock")

    def race(self, hold_first, iteration):
        name = "fleet-race-" + uuid.uuid4().hex
        enqueue = self.enqueue_sql("race-" + name)
        classify = f"""SELECT CASE WHEN EXISTS(SELECT 1 FROM account_run_requests WHERE account_id='{self.account}')
          THEN 'EXECUTION_PARTICIPATED' ELSE 'NO_EXECUTION_PARTICIPATED' END;"""
        first = self.hold_sql() if hold_first else enqueue
        second = enqueue if hold_first else self.hold_sql() + classify
        p = self.open_transaction(first, name + "-first")
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.db.sql, "BEGIN; SET LOCAL ROLE service_role; SET LOCAL statement_timeout='8s'; "
                                 + f"SET LOCAL application_name='{name}'; " + second + " COMMIT;", check=False)
            self.wait_for_block(name)
            p.stdin.write("COMMIT;\n\\q\n"); p.stdin.flush()
            out, err = p.communicate(timeout=10)
            self.assertEqual(p.returncode, 0, err)
            r = future.result(timeout=10)
        self.assertNotIn("deadlock detected", r.stderr)
        self.assertNotIn("40P01", r.stderr)
        if hold_first:
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("fleet_hold_requested", r.stderr)
            self.assertEqual(self.scalar(f"SELECT count(*) FROM account_run_requests WHERE account_id='{self.account}';"), "0")
            self.assertEqual(self.scalar(f"SELECT count(*) FROM auto_restart_device_locks WHERE account_id='{self.account}';"), "0")
        else:
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("EXECUTION_PARTICIPATED", r.stdout.splitlines())
            self.assertNotIn("NO_EXECUTION_PARTICIPATED", r.stdout.splitlines())
            self.assertEqual(self.scalar(f"""SELECT count(*) FROM account_run_requests q JOIN auto_restart_device_locks l
              ON l.request_id=q.id AND l.account_id=q.account_id
              AND l.lease_id::text=q.metadata_safe->'device_lock_binding'->>'lease_id'
              WHERE q.account_id='{self.account}' AND q.status='queued';"""), "1")
        self.assertEqual(self.scalar(f"SELECT count(*) FROM ig_runs WHERE account_id='{self.account}';"), "0")
        type(self).races += 1

    def test_hold_authorized_idempotency_and_noop(self):
        first = json.loads(self.mutation(self.hold_sql()).stdout.strip().splitlines()[-1])
        self.assertEqual(first['current_policy']['hold_state'], 'REQUESTED')
        self.assertEqual(first['current_policy']['revision'], 1)
        retry = json.loads(self.mutation(self.hold_sql()).stdout.strip().splitlines()[-1])
        self.assertTrue(retry['replayed'])
        self.assertEqual(first['receipt'], retry['receipt'])
        noop = json.loads(self.mutation(self.mutation_sql('hold', 1, str(uuid.uuid4()))).stdout.strip().splitlines()[-1])
        self.assertFalse(noop['receipt']['changed'])
        self.assertEqual(noop['current_policy']['revision'], 1)
        conflict = self.mutation(self.mutation_sql('release', 1), check=False)
        self.assertNotEqual(conflict.returncode, 0)
        self.assertIn('fleet_policy_replay_conflict', conflict.stderr)

    def test_hold_authorization_before_replay(self):
        self.mutation(self.hold_sql())
        for role in ('anon', 'authenticated'):
            r = self.mutation(self.hold_sql(), role, check=False)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('permission denied', r.stderr)
            self.assertNotIn(self.hold_request_id, r.stdout)
        self.db.sql(f"UPDATE tenant_users SET role='client' WHERE user_id='{self.actor}';")
        r = self.mutation(self.hold_sql(), check=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('fleet_policy_actor_forbidden', r.stderr)

    def test_hold_audit_failure_rolls_back(self):
        self.db.sql(f"ALTER TABLE ig_action_logs ADD CONSTRAINT hold_audit_failure CHECK(account_id <> '{self.account}'::uuid) NOT VALID;")
        try:
            r = self.mutation(self.hold_sql(), check=False)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('hold_audit_failure', r.stderr)
            self.assertEqual(self.scalar(f"SELECT count(*) FROM fleet_account_policy_v1 WHERE account_id='{self.account}';"), '0')
        finally:
            self.db.sql('ALTER TABLE ig_action_logs DROP CONSTRAINT hold_audit_failure;')

    def test_hold_input_and_revision_guards(self):
        for sql in (self.mutation_sql('hold', cap=60), self.mutation_sql('hold', 4)):
            r = self.mutation(sql, check=False)
            self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.scalar(f"SELECT count(*) FROM fleet_account_policy_v1 WHERE account_id='{self.account}';"), '0')

    def test_hold_preserves_non_fleet_rows(self):
        query = f"SELECT jsonb_build_object('account',(SELECT to_jsonb(a) FROM ig_accounts a WHERE id='{self.account}'),'assignment',(SELECT to_jsonb(a) FROM account_assignments a WHERE account_id='{self.account}'),'scheduler',(SELECT to_jsonb(s) FROM auto_restart_settings s WHERE id='global'));"
        before = self.scalar(query)
        self.mutation(self.hold_sql())
        self.assertEqual(self.scalar(query), before)

    def test_active_run_guard_parity(self):
        for status in ["running","queued","pending","in_progress","active","starting","RUNNING"]:
            with self.subTest(status=status):
                rid = str(uuid.uuid4())
                self.db.sql(f"INSERT INTO ig_runs VALUES('{rid}','{self.account}','{status}');")
                self.assertEqual(self.scalar(f"SELECT account_has_active_ig_run('{self.account}');"), "t")
                r = self.db.sql(self.enqueue_sql("active-" + rid), check=False)
                self.assertNotEqual(r.returncode, 0)
                self.assertIn("account_already_running", r.stderr)
                self.db.sql(f"DELETE FROM ig_runs WHERE id='{rid}';")
        for status in ["completed","failed","stopped","canceled",None]:
            rid = str(uuid.uuid4())
            literal = "NULL" if status is None else "'" + status + "'"
            self.db.sql(f"INSERT INTO ig_runs VALUES('{rid}','{self.account}',{literal});")
            self.assertEqual(self.scalar(f"SELECT account_has_active_ig_run('{self.account}');"), "f")
            self.db.sql(f"DELETE FROM ig_runs WHERE id='{rid}';")

    def test_existing_request_guard(self):
        self.db.sql(f"INSERT INTO account_run_requests(id,account_id,status,idempotency_key) VALUES(gen_random_uuid(),'{self.account}','queued','existing-{self.account}');")
        r = self.db.sql(self.enqueue_sql("second-" + self.account), check=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("account_run_already_requested", r.stderr)

    def test_request_lease_rollback(self):
        self.db.sql(f"ALTER TABLE auto_restart_device_locks ADD CONSTRAINT race_injected_failure CHECK(account_id <> '{self.account}'::uuid) NOT VALID;")
        try:
            r = self.db.sql(self.enqueue_sql("rollback-" + self.account), check=False)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("race_injected_failure", r.stderr)
            self.assertEqual(self.scalar(f"SELECT count(*) FROM account_run_requests WHERE account_id='{self.account}';"), "0")
        finally:
            self.db.sql("ALTER TABLE auto_restart_device_locks DROP CONSTRAINT race_injected_failure;")


for index in range(10):
    for first in [True, False]:
        def test(self, first=first, index=index):
            self.race(first, index)
        setattr(HoldEnqueueRace, "test_race_%02d_%s" % (index, "hold_first" if first else "enqueue_first"), test)

if __name__ == "__main__":
    unittest.main(verbosity=2)
