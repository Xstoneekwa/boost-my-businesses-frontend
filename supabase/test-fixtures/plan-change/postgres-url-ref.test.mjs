import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  parsePostgresConnectionInput,
  detectConnectionFormat,
  GENERIC_INVALID,
  GENERIC_NON_SUPABASE,
  GENERIC_REF_MISMATCH,
  GENERIC_TRANSACTION_POOLER,
} from "./postgres-url-ref.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const HELPER = join(ROOT, "postgres-url-ref.mjs");

const TEST_REF = "nxntngkhkoynljcagmkq";
const SHARED_REF = "zgafnshkjywfltxgbtzg";
const SECRET_TOKEN = "REDACTED_TEST_SECRET";

function directUri(ref = TEST_REF) {
  return `postgresql://postgres:${SECRET_TOKEN}@db.${ref}.supabase.co:5432/postgres`;
}

function sessionPoolerUri(ref = TEST_REF, port = "5432") {
  return `postgresql://postgres.${ref}:${SECRET_TOKEN}@aws-0-eu-central-1.pooler.supabase.com:${port}/postgres`;
}

function directLibpq(ref = TEST_REF) {
  return `host=db.${ref}.supabase.co port=5432 dbname=postgres user=postgres password=${SECRET_TOKEN}`;
}

function sessionPoolerLibpq(ref = TEST_REF, port = "5432") {
  return `host=aws-0-eu-central-1.pooler.supabase.com port=${port} dbname=postgres user=postgres.${ref} password=${SECRET_TOKEN}`;
}

function extractViaCli(input) {
  try {
    const stdout = execFileSync("node", [HELPER, "--extract-stdin"], {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, ref: stdout.trim(), stderr: "" };
  } catch (error) {
    const err = /** @type {Error & { status?: number, stderr?: string }} */ (error);
    return { code: err.status ?? 1, ref: "", stderr: err.stderr?.toString() ?? "" };
  }
}

function assertNoConnectionMaterial(output, input) {
  assert.ok(!output.includes(input));
  assert.ok(!output.includes(SECRET_TOKEN));
  assert.ok(!output.includes("postgresql://"));
  assert.ok(!output.includes("pooler.supabase.com"));
  assert.ok(!output.includes("supabase.co"));
  assert.ok(!output.includes("@"));
  assert.ok(!output.includes("password="));
}

describe("postgres-url-ref URI format", () => {
  it("1. accepts valid Direct URI", () => {
    const result = parsePostgresConnectionInput(directUri());
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.projectRef, TEST_REF);
      assert.equal(result.format, "uri");
      assert.equal(result.connectionKind, "direct");
    }
  });

  it("2. accepts valid Session Pooler URI on port 5432", () => {
    const result = parsePostgresConnectionInput(sessionPoolerUri());
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.projectRef, TEST_REF);
      assert.equal(result.format, "uri");
      assert.equal(result.connectionKind, "session_pooler");
    }
  });
});

describe("postgres-url-ref libpq format", () => {
  it("3. accepts valid Direct libpq keyword/value string", () => {
    const result = parsePostgresConnectionInput(directLibpq());
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.projectRef, TEST_REF);
      assert.equal(result.format, "libpq");
      assert.equal(result.connectionKind, "direct");
    }
  });

  it("4. accepts valid Session Pooler libpq on port 5432", () => {
    const result = parsePostgresConnectionInput(sessionPoolerLibpq());
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.projectRef, TEST_REF);
      assert.equal(result.format, "libpq");
      assert.equal(result.connectionKind, "session_pooler");
    }
  });

  it("5. accepts libpq with SSL options before host/user", () => {
    const input = `sslmode=verify-full sslrootcert=/tmp/ca.pem ${directLibpq()}`;
    const result = parsePostgresConnectionInput(input);
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.projectRef, TEST_REF);
  });

  it("6. accepts libpq with quoted values", () => {
    const input =
      "sslmode='require' host='db.nxntngkhkoynljcagmkq.supabase.co' port='5432' dbname='postgres' user='postgres'";
    const result = parsePostgresConnectionInput(input);
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.projectRef, TEST_REF);
  });
});

describe("postgres-url-ref rejections", () => {
  it("7. refuses Transaction Pooler port 6543 (URI and libpq)", () => {
    for (const input of [sessionPoolerUri(TEST_REF, "6543"), sessionPoolerLibpq(TEST_REF, "6543")]) {
      const result = parsePostgresConnectionInput(input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "transaction_pooler");
        assert.equal(result.message, GENERIC_TRANSACTION_POOLER);
        assertNoConnectionMaterial(result.message, input);
      }
    }
  });

  it("8. refuses psql command wrapper as connection value", () => {
    const input = `psql "${directUri()}"`;
    assert.equal(detectConnectionFormat(input), "psql_command");
    const result = parsePostgresConnectionInput(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.message, GENERIC_INVALID);
  });

  it("9. refuses divergent host ref and username ref", () => {
    const input = `postgresql://postgres.${SHARED_REF}:${SECRET_TOKEN}@db.${TEST_REF}.supabase.co:5432/postgres`;
    const result = parsePostgresConnectionInput(input);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "ref_mismatch");
      assert.equal(result.message, GENERIC_REF_MISMATCH);
      assertNoConnectionMaterial(result.message, input);
    }
  });

  it("10. refuses invalid DSN without exposing segments", () => {
    const input = "host= port= dbname=";
    const cli = extractViaCli(input);
    assert.notEqual(cli.code, 0);
    assert.match(cli.stderr, /URL not logged/);
    assertNoConnectionMaterial(cli.stderr, input);
  });

  it("refuses non-Supabase URI", () => {
    const input = `postgresql://postgres:${SECRET_TOKEN}@db.example.com:5432/postgres`;
    const result = parsePostgresConnectionInput(input);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.message, GENERIC_NON_SUPABASE);
      assertNoConnectionMaterial(result.message, input);
    }
  });
});

describe("postgres-url-ref shell-level test target guard (parser only)", () => {
  it("11. parser still extracts shared ref; shell scripts refuse it as test target", () => {
    const result = parsePostgresConnectionInput(directLibpq(SHARED_REF));
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.projectRef, SHARED_REF);
  });
});

describe("postgres-url-ref CLI redaction", () => {
  it("12. CLI errors never include connection string or credentials", () => {
    const cli = extractViaCli(sessionPoolerLibpq(TEST_REF, "6543"));
    assert.notEqual(cli.code, 0);
    assert.match(cli.stderr, /Session Pooler on port 5432/);
    assertNoConnectionMaterial(cli.stderr, sessionPoolerLibpq(TEST_REF, "6543"));
  });
});
