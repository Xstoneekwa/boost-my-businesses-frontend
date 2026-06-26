import assert from "node:assert/strict";
import test from "node:test";
import {
  isClientEmailInfrastructureTableMissingError,
  probeClientEmailInfrastructure,
} from "./client-email-schema-guard.ts";

const MISSING_TABLE_ERROR = {
  message: "Could not find the table 'public.client_email_templates' in the schema cache",
  code: "PGRST205",
};

test("schema guard recognizes postgrest cache miss and postgres undefined table", () => {
  assert.equal(isClientEmailInfrastructureTableMissingError(MISSING_TABLE_ERROR), true);
  assert.equal(
    isClientEmailInfrastructureTableMissingError({
      message: 'relation "public.client_email_send_intents" does not exist',
      code: "42P01",
    }),
    true,
  );
  assert.equal(
    isClientEmailInfrastructureTableMissingError({ message: "permission denied for table clients" }),
    false,
  );
});

test("probe reports unavailable only for missing email tables", async () => {
  const supabase = {
    from(table: string) {
      return {
        select() { return this; },
        limit: async () => (
          table === "client_email_templates"
            ? { error: MISSING_TABLE_ERROR }
            : { error: null }
        ),
      };
    },
  };

  const result = await probeClientEmailInfrastructure(supabase as never);
  assert.deepEqual(result, { available: false });
});

test("unrelated email table errors are not swallowed", async () => {
  const supabase = {
    from() {
      return {
        select() { return this; },
        limit: async () => ({ error: { message: "client_email_templates timeout", code: "57014" } }),
      };
    },
  };

  await assert.rejects(
    () => probeClientEmailInfrastructure(supabase as never),
    /timeout/,
  );
});
