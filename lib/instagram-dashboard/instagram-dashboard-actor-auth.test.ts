import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveInstagramDashboardActorAuth,
  type InstagramDashboardActorAuthDependencies,
} from "./instagram-dashboard-actor-auth.ts";

type AdminContext = { userId: string; role: "superadmin" | "member" };

const validOperatorId = "00000000-0000-4000-8000-000000000001";

function dependencies(overrides: Partial<InstagramDashboardActorAuthDependencies<AdminContext>> = {}) {
  return {
    readRelayKey: (headers: Headers) => headers.get("x-botapp-relay-key")?.trim() ?? "",
    verifyRelayKey: (headers: Headers) => {
      const supplied = headers.get("x-botapp-relay-key")?.trim() ?? "";
      if (!supplied) return { ok: false as const, reason: "relay_auth_required" as const };
      if (supplied !== "valid-relay") return { ok: false as const, reason: "relay_auth_invalid" as const };
      return { ok: true as const, mode: "relay_key" as const };
    },
    readBotAppOperatorId: () => validOperatorId,
    getAdminContext: async () => ({ userId: "00000000-0000-4000-8000-000000000002", role: "superadmin" as const }),
    readAdminUserId: (context: AdminContext) => context.userId,
    canAccessAdmin: (context: AdminContext) => context.role === "superadmin",
    ...overrides,
  } satisfies InstagramDashboardActorAuthDependencies<AdminContext>;
}

test("valid relay is allowed without consulting the Admin session", async () => {
  let adminLookupCount = 0;
  const result = await resolveInstagramDashboardActorAuth(
    new Headers({ "x-botapp-relay-key": "valid-relay" }),
    dependencies({
      getAdminContext: async () => {
        adminLookupCount += 1;
        return null;
      },
    }),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mode, "relay_key");
    assert.deepEqual(result.actor, { actorType: "botapp_operator", actorId: validOperatorId, source: "botapp" });
  }
  assert.equal(adminLookupCount, 0);
});

test("explicit invalid relay is rejected without falling back to a valid Admin session", async () => {
  let adminLookupCount = 0;
  const result = await resolveInstagramDashboardActorAuth(
    new Headers({ "x-botapp-relay-key": "invalid-relay" }),
    dependencies({
      getAdminContext: async () => {
        adminLookupCount += 1;
        return { userId: "00000000-0000-4000-8000-000000000002", role: "superadmin" };
      },
    }),
  );

  assert.deepEqual(result, { ok: false, status: 403, reason: "relay_auth_invalid" });
  assert.equal(adminLookupCount, 0);
});

test("no relay with a valid Admin session is allowed", async () => {
  const result = await resolveInstagramDashboardActorAuth(new Headers(), dependencies());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mode, "admin_session");
    assert.deepEqual(result.actor, {
      actorType: "admin",
      actorId: "00000000-0000-4000-8000-000000000002",
      source: "admin_dashboard",
    });
  }
});

test("no relay with a non-Admin authenticated session is rejected", async () => {
  const result = await resolveInstagramDashboardActorAuth(
    new Headers(),
    dependencies({
      getAdminContext: async () => ({ userId: "00000000-0000-4000-8000-000000000003", role: "member" }),
    }),
  );

  assert.deepEqual(result, { ok: false, status: 403, reason: "admin_access_denied" });
});

test("no relay with an anonymous session is rejected", async () => {
  const result = await resolveInstagramDashboardActorAuth(
    new Headers(),
    dependencies({ getAdminContext: async () => null }),
  );

  assert.deepEqual(result, { ok: false, status: 401, reason: "authentication_required" });
});

test("valid relay fails closed when the server-controlled operator identity is missing", async () => {
  const result = await resolveInstagramDashboardActorAuth(
    new Headers({ "x-botapp-relay-key": "valid-relay" }),
    dependencies({ readBotAppOperatorId: () => "" }),
  );

  assert.deepEqual(result, { ok: false, status: 503, reason: "botapp_operator_identity_unconfigured" });
});

for (const route of ["DEVICES", "SLOTS", "CREATE"] as const) {
  test(`${route}_VALID_RELAY_ALLOWED`, async () => {
    const result = await resolveInstagramDashboardActorAuth(
      new Headers({ "x-botapp-relay-key": "valid-relay" }),
      dependencies(),
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.mode, "relay_key");
  });

  test(`${route}_INVALID_RELAY_REJECTED`, async () => {
    let adminLookupCount = 0;
    const result = await resolveInstagramDashboardActorAuth(
      new Headers({ "x-botapp-relay-key": "invalid-relay" }),
      dependencies({
        getAdminContext: async () => {
          adminLookupCount += 1;
          return { userId: "00000000-0000-4000-8000-000000000002", role: "superadmin" };
        },
      }),
    );
    assert.deepEqual(result, { ok: false, status: 403, reason: "relay_auth_invalid" });
    assert.equal(adminLookupCount, 0);
  });

  test(`${route}_NO_RELAY_VALID_ADMIN_ALLOWED`, async () => {
    const result = await resolveInstagramDashboardActorAuth(new Headers(), dependencies());
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.mode, "admin_session");
  });

  test(`${route}_NO_RELAY_INVALID_ADMIN_REJECTED`, async () => {
    const result = await resolveInstagramDashboardActorAuth(
      new Headers(),
      dependencies({
        getAdminContext: async () => ({ userId: "00000000-0000-4000-8000-000000000003", role: "member" }),
      }),
    );
    assert.deepEqual(result, { ok: false, status: 403, reason: "admin_access_denied" });
  });

  test(`${route}_NO_RELAY_ANONYMOUS_REJECTED`, async () => {
    const result = await resolveInstagramDashboardActorAuth(
      new Headers(),
      dependencies({ getAdminContext: async () => null }),
    );
    assert.deepEqual(result, { ok: false, status: 401, reason: "authentication_required" });
  });
}
