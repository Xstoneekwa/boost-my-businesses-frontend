import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveClientAccountState } from "./client-account-state.ts";
import {
  PASSIVE_READINESS_FORBIDDEN_LABELS,
  projectReadinessProcess,
} from "./client-account-process-projection.ts";
import { projectClientReadinessStatus } from "./client-readiness-projection.ts";
import { runReadinessNow } from "../instagram-dashboard/readiness-now.ts";

type Row = Record<string, unknown>;

const accountId = "account-lucie-ux-1";
const assignmentId = "assignment-ux-1";
const deviceId = "device-physical-ux";
const appInstanceId = "clone-ux-1";

function baseRows(overrides: Partial<Record<string, Row[]>> = {}) {
  return {
    ig_accounts: [{ id: accountId, username: "demo", status: "active", admin_lifecycle_status: "active" }],
    account_credentials: [{ account_id: accountId, status: "active", reauth_required: true }],
    client_instagram_accounts: [{ account_id: accountId, login_status: "unknown", provisioning_status: "not_started", onboarding_status: "pending" }],
    account_package_summary: [{ account_id: accountId, runtime_profiles: ["full_cycle"], package_caps: { follow_day: 20, follow_session: 20 }, entitlements: [] }],
    ig_account_settings: [{ account_id: accountId }],
    ig_account_filters: [{ account_id: accountId }],
    ig_account_dm_settings: [{ account_id: accountId }],
    ig_targets: [],
    account_assignments: [{
      id: assignmentId,
      account_id: accountId,
      device_id: deviceId,
      app_instance_id: appInstanceId,
      starts_at: "2026-06-22T07:00:00.000Z",
      ends_at: "2026-06-22T13:00:00.000Z",
      status: "reserved",
    }],
    phone_devices: [{ id: deviceId, status: "available", device_kind: "physical_phone" }],
    phone_app_instances: [{ id: appInstanceId, device_id: deviceId, status: "available", usable_for_auto_login: true, is_launchable: true, current_account_id: null }],
    account_run_requests: [],
    ig_runs: [],
    account_dashboard_actions: [],
    ...overrides,
  };
}

function makeQuery(rows: Row[]) {
  const filters: Array<(row: Row) => boolean> = [];
  let maxRows = rows.length;
  const buildResult = () => ({
    data: rows.filter((row) => filters.every((filter) => filter(row))).slice(0, maxRows),
    error: null,
  });
  const query = {
    select: () => query,
    eq: (field: string, value: unknown) => {
      filters.push((row) => row[field] === value);
      return query;
    },
    in: (field: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[field]));
      return query;
    },
    order: () => query,
    limit: (limit: number) => {
      maxRows = limit;
      return {
        maybeSingle: () => Promise.resolve({ data: buildResult().data[0] ?? null, error: null }),
        then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve(buildResult()).then(resolve),
      };
    },
    maybeSingle: () => Promise.resolve({ data: buildResult().data[0] ?? null, error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve(buildResult()).then(resolve),
  };
  return query;
}

function makeSupabase(rows = baseRows()) {
  return {
    client: {
      from(table: string) {
        return makeQuery((rows as Record<string, Row[]>)[table] ?? []);
      },
      rpc(name: string) {
        if (name === "list_available_assignment_slots") {
          return Promise.resolve({
            data: {
              ok: true,
              slots: [],
              app_instance_availability: { available: 1 },
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
}

test("ready_to_connect dashboard card exposes durable UX labels", () => {
  const ui = resolveClientAccountState({
    loginStatus: "unknown",
    onboardingStatus: "pending",
    provisioningStatus: "not_started",
    assignmentStatus: "assigned",
    connected: false,
    clientReadinessStatus: "ready_to_connect",
  }, "fr");

  assert.equal(ui.badgeLabel, "Prêt à connecter");
  assert.match(ui.subtext || "", /prêt à être connecté/i);
  assert.equal(ui.readinessLabel, "Préparation vérifiée");
  assert.equal(ui.readinessDisabled, true);
  assert.equal(ui.showRecheckReadiness, true);
  assert.equal(ui.connectDisabled, false);
  assert.equal(ui.connectPrimary, true);
});

test("preparation_pending keeps connect disabled with client-safe subtext", () => {
  const ui = resolveClientAccountState({
    loginStatus: "unknown",
    onboardingStatus: "pending",
    provisioningStatus: "not_started",
    assignmentStatus: "pending_assignment",
    connected: false,
    clientReadinessStatus: "preparation_pending",
  }, "fr");

  assert.equal(ui.connectDisabled, true);
  assert.match(ui.readinessLabel, /Vérifier la préparation/i);
  assert.match(ui.subtext || "", /préparation est en cours/i);
});

test("passive readiness modal uses honest steps only", () => {
  const projection = projectReadinessProcess({
    lang: "fr",
    phase: "complete",
    account: {
      loginStatus: "unknown",
      onboardingStatus: "pending",
      provisioningStatus: "not_started",
      assignmentStatus: "assigned",
      connected: false,
      clientReadinessStatus: "ready_to_connect",
    },
  });

  assert.equal(projection.outcome, "success");
  assert.equal(projection.steps.length, 3);
  assert.deepEqual(
    projection.steps.map((step) => step.label),
    ["Compte ajouté", "Configuration vérifiée", "Préparation vérifiée"],
  );
  assert.match(projection.finalMessage || "", /prêt à être connecté/i);

  const blob = [
    projection.title,
    projection.subtitle,
    projection.statusChip,
    projection.finalMessage || "",
    ...projection.steps.map((step) => step.label),
  ].join(" ");

  for (const forbidden of PASSIVE_READINESS_FORBIDDEN_LABELS) {
    assert.equal(blob.includes(forbidden), false, `forbidden label "${forbidden}"`);
  }
});

test("workspace loader projects passive readiness from canonical runReadinessNow", async () => {
  const supabase = makeSupabase();
  const result = await runReadinessNow(supabase.client, {
    accountId,
    audience: "client",
    dryRun: true,
    mode: "readiness_only",
    now: new Date("2026-06-22T03:00:00.000Z"),
  });
  assert.equal(projectClientReadinessStatus(result), "ready_to_connect");

  const loaderSource = readFileSync(
    new URL("./load-client-instagram-accounts.ts", import.meta.url),
    "utf8",
  );
  assert.match(loaderSource, /projectPassiveReadinessByAccountId/);
  assert.match(loaderSource, /readinessStatus:/);
});

test("accounts refresh route rehydrates clientReadinessStatus from server projection", () => {
  const routeSource = readFileSync(
    new URL("../../app/api/instagram-client/accounts/route.ts", import.meta.url),
    "utf8",
  );
  const sectionSource = readFileSync(
    new URL("../../app/instagram-client/ClientAccountsSection.tsx", import.meta.url),
    "utf8",
  );
  assert.match(routeSource, /loadClientInstagramAccounts/);
  assert.match(sectionSource, /showRecheckReadiness/);
  assert.match(sectionSource, /connectPrimary/);
});

test("passive readiness projection helper stays dry-run only", async () => {
  const supabase = makeSupabase(baseRows({ account_assignments: [] }));
  const map = await (async () => {
    const readiness = await runReadinessNow(supabase.client, {
      accountId,
      audience: "client",
      dryRun: true,
      mode: "readiness_only",
      now: new Date("2026-06-22T03:00:00.000Z"),
    });
    return new Map([[accountId, projectClientReadinessStatus(readiness)]]);
  })();
  assert.equal(map.get(accountId), "preparation_pending");
  const loaderSource = readFileSync(
    new URL("./project-client-workspace-readiness.ts", import.meta.url),
    "utf8",
  );
  assert.match(loaderSource, /export async function projectPassiveReadinessByAccountId/);
  assert.match(loaderSource, /dryRun: true/);
  assert.match(loaderSource, /mode: "readiness_only"/);
});
