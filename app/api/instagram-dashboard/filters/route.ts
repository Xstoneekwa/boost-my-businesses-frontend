import { createSupabaseClient } from "@/lib/supabase";
import {
  getAccountId,
  jsonError,
  jsonOk,
  readBoolean,
  readInteger,
  readJsonBody,
  readNumber,
  readString,
  requireInstagramAdmin,
  validateAccountId,
} from "../_utils";

export const dynamic = "force-dynamic";

type FiltersPayload = {
  account_id: string;
  disable_filters: boolean;
  skip_followers: boolean;
  skip_following: boolean;
  skip_non_business_profiles: boolean;
  skip_business_profiles: boolean;
  follow_private_profiles: boolean;
  follow_only_private_profiles: boolean;
  dm_private_profiles: boolean;
  min_followers: number;
  max_followers: number;
  min_following: number;
  max_following: number;
  min_posts: number;
  blacklisted_words: string;
  mandatory_words: string;
  whitelist_words: string;
  blacklist_accounts: string;
};

type FiltersRecord = Partial<FiltersPayload> & Record<string, unknown>;

const DEFAULT_FILTERS: FiltersPayload = {
  account_id: "",
  disable_filters: false,
  skip_followers: true,
  skip_following: true,
  skip_non_business_profiles: false,
  skip_business_profiles: false,
  follow_private_profiles: false,
  follow_only_private_profiles: false,
  dm_private_profiles: false,
  min_followers: 1,
  max_followers: 1000000000000,
  min_following: 1,
  max_following: 1000000000000,
  min_posts: 1,
  blacklisted_words: "",
  mandatory_words: "",
  whitelist_words: "",
  blacklist_accounts: "",
};

function normalizeFilters(row: FiltersRecord | null | undefined, accountId: string): FiltersPayload {
  return {
    account_id: accountId,
    disable_filters: readBoolean(row?.disable_filters, DEFAULT_FILTERS.disable_filters),
    skip_followers: readBoolean(row?.skip_followers, DEFAULT_FILTERS.skip_followers),
    skip_following: readBoolean(row?.skip_following, DEFAULT_FILTERS.skip_following),
    skip_non_business_profiles: readBoolean(row?.skip_non_business_profiles, DEFAULT_FILTERS.skip_non_business_profiles),
    skip_business_profiles: readBoolean(row?.skip_business_profiles, DEFAULT_FILTERS.skip_business_profiles),
    follow_private_profiles: readBoolean(row?.follow_private_profiles, DEFAULT_FILTERS.follow_private_profiles),
    follow_only_private_profiles: readBoolean(row?.follow_only_private_profiles, DEFAULT_FILTERS.follow_only_private_profiles),
    dm_private_profiles: readBoolean(row?.dm_private_profiles, DEFAULT_FILTERS.dm_private_profiles),
    min_followers: readInteger(row?.min_followers, DEFAULT_FILTERS.min_followers),
    max_followers: readNumber(row?.max_followers, DEFAULT_FILTERS.max_followers),
    min_following: readInteger(row?.min_following, DEFAULT_FILTERS.min_following),
    max_following: readNumber(row?.max_following, DEFAULT_FILTERS.max_following),
    min_posts: readInteger(row?.min_posts, DEFAULT_FILTERS.min_posts),
    blacklisted_words: readString(row?.blacklisted_words, DEFAULT_FILTERS.blacklisted_words),
    mandatory_words: readString(row?.mandatory_words, DEFAULT_FILTERS.mandatory_words),
    whitelist_words: readString(row?.whitelist_words, DEFAULT_FILTERS.whitelist_words),
    blacklist_accounts: readString(row?.blacklist_accounts, DEFAULT_FILTERS.blacklist_accounts),
  };
}

function migrationError(message: string) {
  return jsonError(`${message} Apply lib/instagram-dashboard/ig-account-filters.sql, then retry.`, 500);
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const accountId = getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("ig_account_filters")
      .select("*")
      .eq("account_id", accountId)
      .maybeSingle<FiltersRecord>();

    if (error) {
      return migrationError(error.message);
    }

    if (data) {
      return jsonOk(normalizeFilters(data, accountId));
    }

    const defaultFilters = { ...DEFAULT_FILTERS, account_id: accountId };
    const { data: inserted, error: insertError } = await supabase
      .from("ig_account_filters")
      .insert(defaultFilters)
      .select("*")
      .single<FiltersRecord>();

    if (insertError) {
      return migrationError(insertError.message);
    }

    return jsonOk(normalizeFilters(inserted, accountId), 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load account filters.";
    return jsonError(message, 500);
  }
}

async function saveFilters(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<Partial<FiltersPayload>>(request);
    if (!body) {
      return jsonError("Invalid filters payload.", 400);
    }

    const accountId = typeof body.account_id === "string" ? body.account_id.trim() : "";
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const filters = normalizeFilters(body, accountId);
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("ig_account_filters")
      .update({ ...filters, updated_at: new Date().toISOString() })
      .eq("account_id", accountId)
      .select("*")
      .maybeSingle<FiltersRecord>();

    if (error) {
      return migrationError(error.message);
    }

    if (!data) {
      const { data: inserted, error: insertError } = await supabase
        .from("ig_account_filters")
        .insert(filters)
        .select("*")
        .single<FiltersRecord>();

      if (insertError) {
        return migrationError(insertError.message);
      }

      return jsonOk(normalizeFilters(inserted, accountId), 201);
    }

    return jsonOk(normalizeFilters(data, accountId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save account filters.";
    return jsonError(message, 500);
  }
}

export async function PUT(request: Request) {
  return saveFilters(request);
}

export async function PATCH(request: Request) {
  return saveFilters(request);
}

export async function POST(request: Request) {
  return saveFilters(request);
}
