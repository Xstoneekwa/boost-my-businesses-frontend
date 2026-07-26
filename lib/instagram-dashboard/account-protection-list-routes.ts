import { NextResponse } from "next/server";
import {
  accountProtectionListEtag,
  accountProtectionListsEnabled,
  isAccountProtectionListKind,
  isCanonicalAccountId,
  normalizeProtectionPatch,
  normalizeProtectionUsername,
  normalizeProtectionUsernameEntries,
  readExpectedVersion,
  type AccountProtectionListKind,
} from "./account-protection-list-contract";
import {
  AccountProtectionListServiceError,
  mutateAccountProtectionList,
  readAccountProtectionList,
  type AccountProtectionListSnapshot,
} from "./account-protection-list-service";

type AuthorizedRoute = {
  accountId: string;
  listKind: AccountProtectionListKind;
  actorAuthUserId: string | null;
  sourceSurface: "client_dashboard" | "admin_dashboard" | "botapp";
};

function responseForSnapshot(accountId: string, listKind: AccountProtectionListKind, data: AccountProtectionListSnapshot) {
  return NextResponse.json(
    { ok: true, data },
    {
      status: 200,
      headers: {
        ETag: accountProtectionListEtag(accountId, listKind, data.version),
        "Cache-Control": "private, no-store",
      },
    },
  );
}

function errorResponse(error: unknown) {
  if (error instanceof AccountProtectionListServiceError) {
    return NextResponse.json({ ok: false, error: error.code, ...error.meta }, { status: error.status });
  }
  return NextResponse.json({ ok: false, error: "protection_list_request_failed" }, { status: 500 });
}

export function validateProtectionListRoute(accountId: string, listKind: string) {
  if (!accountProtectionListsEnabled()) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "protection_lists_disabled" }, { status: 503 }) };
  }
  const normalizedAccountId = accountId.trim();
  if (!isCanonicalAccountId(normalizedAccountId)) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "invalid_account_id" }, { status: 400 }) };
  }
  if (!isAccountProtectionListKind(listKind)) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "invalid_list_kind" }, { status: 400 }) };
  }
  return { ok: true as const, accountId: normalizedAccountId, listKind };
}

export async function handleProtectionListGet(route: AuthorizedRoute) {
  try {
    return responseForSnapshot(route.accountId, route.listKind, await readAccountProtectionList(route.accountId, route.listKind));
  } catch (error) {
    return errorResponse(error);
  }
}

function mutationHeaders(request: Request, route: AuthorizedRoute) {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "idempotency_key_required" }, { status: 400 }) };
  }
  const expected = readExpectedVersion(request.headers.get("if-match"), route.accountId, route.listKind);
  if (!expected.ok) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: expected.error }, { status: expected.status }) };
  }
  return { ok: true as const, idempotencyKey, expectedVersion: expected.version };
}

async function readBody(request: Request) {
  try {
    return { ok: true as const, value: await request.json() as Record<string, unknown> };
  } catch {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "invalid_json_body" }, { status: 400 }) };
  }
}

export async function handleProtectionListPut(request: Request, route: AuthorizedRoute) {
  const headers = mutationHeaders(request, route);
  if (!headers.ok) return headers.response;
  const body = await readBody(request);
  if (!body.ok) return body.response;
  const normalized = normalizeProtectionUsernameEntries(body.value.items, "items");
  if (normalized.errors.length) {
    return NextResponse.json({ ok: false, error: "invalid_entries", entryErrors: normalized.errors }, { status: 422 });
  }
  try {
    const data = await mutateAccountProtectionList({
      ...route,
      operation: "replace",
      items: normalized.items,
      idempotencyKey: headers.idempotencyKey,
      expectedVersion: headers.expectedVersion,
    });
    return responseForSnapshot(route.accountId, route.listKind, data);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleProtectionListPatch(request: Request, route: AuthorizedRoute) {
  const headers = mutationHeaders(request, route);
  if (!headers.ok) return headers.response;
  const body = await readBody(request);
  if (!body.ok) return body.response;
  if (body.value.add === undefined && body.value.remove === undefined) {
    return NextResponse.json({ ok: false, error: "nothing_to_update" }, { status: 400 });
  }
  const normalized = normalizeProtectionPatch(body.value.add, body.value.remove);
  if (normalized.errors.length) {
    return NextResponse.json({ ok: false, error: "invalid_entries", entryErrors: normalized.errors }, { status: 422 });
  }
  try {
    const data = await mutateAccountProtectionList({
      ...route,
      operation: "patch",
      add: normalized.add,
      remove: normalized.remove,
      idempotencyKey: headers.idempotencyKey,
      expectedVersion: headers.expectedVersion,
    });
    return responseForSnapshot(route.accountId, route.listKind, data);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleProtectionListDelete(request: Request, route: AuthorizedRoute, username: string) {
  const headers = mutationHeaders(request, route);
  if (!headers.ok) return headers.response;
  const normalized = normalizeProtectionUsername(username);
  if (!normalized.ok) {
    return NextResponse.json({
      ok: false,
      error: "invalid_entries",
      entryErrors: [{ field: "username", index: 0, input: username.slice(0, 80), code: normalized.code }],
    }, { status: 422 });
  }
  try {
    const data = await mutateAccountProtectionList({
      ...route,
      operation: "delete",
      remove: [normalized.normalized],
      idempotencyKey: headers.idempotencyKey,
      expectedVersion: headers.expectedVersion,
    });
    return responseForSnapshot(route.accountId, route.listKind, data);
  } catch (error) {
    return errorResponse(error);
  }
}
