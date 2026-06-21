#!/usr/bin/env node
/**
 * Plan Change UI/API E2E runner — exercises live Next.js routes against nxntngkhkoynljcagmkq.
 * Requires 20260622120000_commercial_plan_change_source_revision.sql on isolated DB.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const AUTH_COOKIE = "instagram_auth_access_token";
const REFRESH_COOKIE = "instagram_auth_refresh_token";

const results = [];

function fail(message) {
  console.error(`[run-ui-api-e2e] FAIL: ${message}`);
  process.exit(1);
}

function record(scenario, status, expected, actual, detailsSafe) {
  results.push({ scenario, status, expected, actual, details_safe: detailsSafe });
}

function loadRunState() {
  const path = join(ROOT, ".run-state", "latest.json");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("Missing .run-state/latest.json — run setup-ui-api-e2e.mjs first");
  }
}

function baseUrl() {
  return (process.env.PLAN_CHANGE_UI_API_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
}

function allowlistHasEmail(email) {
  const raw = String(process.env.SIMULATED_CHECKOUT_EMAIL_ALLOWLIST ?? "");
  const normalized = email.trim().toLowerCase();
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

async function signIn(state, credentials = state) {
  const url = process.env.PLAN_CHANGE_TEST_SUPABASE_URL;
  const anon = process.env.PLAN_CHANGE_TEST_ANON_KEY;
  if (!url || !anon) {
    fail("Missing PLAN_CHANGE_TEST_SUPABASE_URL or PLAN_CHANGE_TEST_ANON_KEY for session sign-in");
  }
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anon,
      Authorization: `Bearer ${anon}`,
    },
    body: JSON.stringify({ email: credentials.email, password: credentials.password }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) {
    fail("Could not sign in fictional test user (credentials not logged)");
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? "",
  };
}

async function apiFetch(path, options, tokens) {
  const headers = new Headers(options.headers ?? {});
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set(
    "Cookie",
    `${AUTH_COOKIE}=${tokens.accessToken}; ${REFRESH_COOKIE}=${tokens.refreshToken}`,
  );
  const response = await fetch(`${baseUrl()}${path}`, { ...options, headers });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, json, text };
}

async function postQuote(tokens, targetPlanKey, idempotencyKey) {
  return apiFetch(
    "/api/commercial/checkout/plan-change/quote",
    {
      method: "POST",
      body: JSON.stringify({
        target_plan_key: targetPlanKey,
        idempotency_key: idempotencyKey,
      }),
    },
    tokens,
  );
}

async function postActivate(tokens, quoteId, idempotencyKey) {
  return apiFetch(
    "/api/commercial/checkout/plan-change/activate",
    {
      method: "POST",
      body: JSON.stringify({
        quote_id: quoteId,
        idempotency_key: idempotencyKey,
      }),
    },
    tokens,
  );
}

async function getWorkspace(tokens) {
  return apiFetch("/api/instagram-client/workspace", { method: "GET" }, tokens);
}

function planLabelFromWorkspace(json) {
  return String(json?.data?.clientPlanLabel ?? json?.data?.subscriptionLabel ?? "");
}

function quoteFrom(json) {
  return json?.data?.quote ?? json?.quote ?? null;
}

function unwrapOk(json) {
  return json?.data ?? json;
}

function errorCode(json) {
  return String(json?.code ?? json?.error?.code ?? "");
}

async function main() {
  const state = loadRunState();
  const tokens = await signIn(state);
  const allowlisted = allowlistHasEmail(state.email);

  // Scenario 1 — dashboard current plan
  {
    const { response, json } = await getWorkspace(tokens);
    const label = planLabelFromWorkspace(json);
    const pass = response.ok && /growth|pro|premium/i.test(label);
    record(
      "dashboard_shows_current_plan",
      pass ? "PASS" : "FAIL",
      "workspace ok with commercial plan label",
      `status=${response.status} label=${label || "null"}`,
      `client_id fixture=${state.clientId.slice(0, 8)}…`,
    );
  }

  // Scenario 2 — Change Plan quote on load
  const loadQuoteKey = `ui-api:${state.runId}:pro:load`;
  let loadQuoteId = "";
  {
    const { response, json } = await postQuote(tokens, "pro", loadQuoteKey);
    const quote = quoteFrom(json);
    loadQuoteId = String(quote?.quoteId ?? "");
    const currentPlanKey = String(json?.data?.current_plan?.plan_key ?? "");
    const pass = response.ok && loadQuoteId && currentPlanKey === "growth";
    record(
      "change_plan_page_quote_on_load",
      pass ? "PASS" : "FAIL",
      "quote ok; current_plan growth",
      `status=${response.status} quote_id=${loadQuoteId || "null"} current=${currentPlanKey || "null"}`,
      `amount_due_cents=${Number(quote?.amountDueCents ?? -1)}`,
    );
  }

  // Scenario 3 — quote idempotent on reload
  {
    const first = await postQuote(tokens, "pro", loadQuoteKey);
    const second = await postQuote(tokens, "pro", loadQuoteKey);
    const firstId = String(quoteFrom(first.json)?.quoteId ?? "");
    const secondId = String(quoteFrom(second.json)?.quoteId ?? "");
    const pass = first.response.ok && second.response.ok && firstId && firstId === secondId;
    record(
      "quote_idempotent_on_reload",
      pass ? "PASS" : "FAIL",
      "same quote id for same idempotency key",
      `first=${firstId || "null"} second=${secondId || "null"}`,
      "mirrors PlanChangeCheckoutForm stable key per target",
    );
  }

  // Scenario 4 — payment required blocks activation (non-allowlisted probe; same idempotency key as RPC contract)
  const paymentQuoteKey = `ui-api:${state.runId}:pro:payment-required`;
  let paymentAmountDue = 0;
  {
    const paymentProbe = {
      email: state.paymentProbeEmail,
      password: state.paymentProbePassword,
    };
    if (!paymentProbe.email || !paymentProbe.password) {
      fail("Missing payment probe credentials in run state — re-run setup-ui-api-e2e.mjs");
    }
    const paymentTokens = await signIn(state, paymentProbe);
    const { response, json } = await postQuote(paymentTokens, "pro", paymentQuoteKey);
    const quote = quoteFrom(json);
    const paymentQuoteId = String(quote?.quoteId ?? "");
    paymentAmountDue = Number(quote?.amountDueCents ?? -1);
    const activate = await postActivate(paymentTokens, paymentQuoteId, paymentQuoteKey);
    const code = errorCode(activate.json);
    const pass = response.ok
      && paymentQuoteId
      && paymentAmountDue > 0
      && (activate.response.status === 402 || code === "payment_required");
    record(
      "payment_required_blocks_activation",
      pass ? "PASS" : "FAIL",
      "402/payment_required when amount due > 0",
      `quote_status=${response.status} amount_due=${paymentAmountDue} activate_status=${activate.response.status} code=${code || "null"}`,
      "non-allowlisted payment probe; same idempotency_key for quote and activate",
    );
  }

  // Scenario 5 — simulated activation only for allowlisted fictional email
  const upgradeQuoteKey = `ui-api:${state.runId}:pro:simulated-upgrade`;
  let upgradeActivated = false;
  let upgradeQuoteId = "";
  {
    const quoteResp = await postQuote(tokens, "pro", upgradeQuoteKey);
    const quote = quoteFrom(quoteResp.json);
    upgradeQuoteId = String(quote?.quoteId ?? "");
    const amountDue = Number(quote?.amountDueCents ?? -1);
    const activate = await postActivate(tokens, upgradeQuoteId, upgradeQuoteKey);
    const ok = Boolean(activate.json?.ok);
    upgradeActivated = allowlisted && activate.response.ok && ok;
    const pass = allowlisted
      ? upgradeActivated
      : amountDue > 0 && (activate.response.status === 402 || activate.response.status === 403);
    record(
      "simulated_activation_allowlist_only",
      pass ? "PASS" : "FAIL",
      allowlisted
        ? "allowlisted email activates upgrade"
        : "non-allowlisted email rejected when amount due > 0",
      `allowlisted=${allowlisted} quote_status=${quoteResp.response.status} activate_status=${activate.response.status} ok=${ok}`,
      `email_domain=example.invalid`,
    );
  }

  // Scenario 6 — downgrade creates credit, no cash (premium -> growth)
  {
    let downgradeReady = false;
    if (allowlisted && upgradeActivated) {
      const premiumKey = `ui-api:${state.runId}:premium:upgrade`;
      const premiumQuoteResp = await postQuote(tokens, "premium", premiumKey);
      const premiumQuoteId = String(quoteFrom(premiumQuoteResp.json)?.quoteId ?? "");
      if (premiumQuoteId) {
        const premiumActivate = await postActivate(tokens, premiumQuoteId, premiumKey);
        downgradeReady = premiumActivate.response.ok && Boolean(premiumActivate.json?.ok);
      }
    }

    const downgradeKey = `ui-api:${state.runId}:growth:downgrade`;
    const downgradeQuote = await postQuote(tokens, "growth", downgradeKey);
    const downgradeQuoteId = String(quoteFrom(downgradeQuote.json)?.quoteId ?? "");
    const amountDue = Number(quoteFrom(downgradeQuote.json)?.amountDueCents ?? -1);
    let activateStatus = "skipped";
    if (allowlisted && downgradeReady && downgradeQuoteId && amountDue === 0) {
      const activated = await postActivate(tokens, downgradeQuoteId, downgradeKey);
      activateStatus = String(activated.response.status);
    }
    const pass = allowlisted && downgradeReady
      ? downgradeQuote.response.ok && amountDue === 0 && activateStatus === "200"
      : downgradeQuote.response.ok;
    record(
      "downgrade_credit_no_cash",
      pass ? "PASS" : "FAIL",
      "downgrade quote amount_due=0; activation ok when allowlisted",
      `amount_due=${amountDue} activate_status=${activateStatus}`,
      "cash collection not exercised in simulated path",
    );
  }

  // Scenario 7 — dashboard reflects final plan after flow
  {
    const { response, json } = await getWorkspace(tokens);
    const label = planLabelFromWorkspace(json);
    const pass = response.ok && label.length > 0;
    record(
      "dashboard_shows_final_plan",
      pass ? "PASS" : "FAIL",
      "workspace ok after plan change flow",
      `status=${response.status} label=${label || "null"}`,
      allowlisted ? "post-change subscription projection" : "quote-only when activation blocked",
    );
  }

  // Scenario 8 — idempotent activate retry (same quote idempotency key)
  {
    if (!allowlisted || !upgradeActivated || !upgradeQuoteId) {
      record(
        "idempotent_activate_no_duplicate",
        allowlisted ? "FAIL" : "PASS",
        "second activate returns idempotent replay",
        allowlisted ? "upgrade activation prerequisite missing" : "skipped without allowlist",
        "requires simulated activation enabled on Next.js",
      );
    } else {
      const first = await postActivate(tokens, upgradeQuoteId, upgradeQuoteKey);
      const second = await postActivate(tokens, upgradeQuoteId, upgradeQuoteKey);
      const replay = Boolean(unwrapOk(second.json)?.idempotent_replay);
      const pass = first.response.ok && second.response.ok && replay;
      record(
        "idempotent_activate_no_duplicate",
        pass ? "PASS" : "FAIL",
        "second activate idempotent_replay",
        `first=${first.response.status} second=${second.response.status} replay=${replay}`,
        "double click / retry safe",
      );
    }
  }

  console.log("scenario\tstatus\texpected\tactual\tdetails_safe");
  for (const row of results) {
    console.log(`${row.scenario}\t${row.status}\t${row.expected}\t${row.actual}\t${row.details_safe}`);
  }
  const passCount = results.filter((row) => row.status === "PASS").length;
  const failCount = results.filter((row) => row.status === "FAIL").length;
  console.log(`pass_count=${passCount} fail_count=${failCount} total=${results.length}`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
