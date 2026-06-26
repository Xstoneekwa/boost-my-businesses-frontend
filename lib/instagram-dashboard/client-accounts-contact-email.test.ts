import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONTACT_EMAIL_MISSING_LABEL,
  projectClientContactEmailDisplay,
  resolveClientCommunicationEmail,
} from "./client-communication-email.ts";

const dataSource = readFileSync(
  new URL("../../app/instagram-dashboard/client-accounts-data.ts", import.meta.url),
  "utf8",
);

test("client accounts contact email uses canonical clients.metadata resolver only", () => {
  assert.match(dataSource, /resolveClientCommunicationEmail/);
  assert.match(dataSource, /from\("clients"\)/);
  assert.match(dataSource, /clientContactEmail:/);
  assert.match(dataSource, /clientContactEmailSource:/);
  assert.doesNotMatch(dataSource, /resolveAccountEmail/);
  assert.doesNotMatch(dataSource, /ig_account_settings/);
  assert.doesNotMatch(dataSource, /account_credentials/);
  assert.doesNotMatch(dataSource, /from\("ig_accounts"\)/);
});

test("canonical contact email is projected for client accounts rows", () => {
  const resolved = resolveClientCommunicationEmail({
    client: { metadata: { contact_email: "liam@example.com" } },
    workspaceAuthEmail: "auth@example.com",
  });
  const projected = projectClientContactEmailDisplay(resolved);
  assert.equal(projected.display, "liam@example.com");
  assert.equal(projected.source, "clients.metadata.contact_email");
  assert.equal(projected.available, true);
});

test("instagram credential email is never used for client accounts contact column", () => {
  const resolved = resolveClientCommunicationEmail({
    client: { metadata: {} },
    workspaceAuthEmail: null,
  });
  const projected = projectClientContactEmailDisplay(resolved);
  assert.equal(projected.display, CONTACT_EMAIL_MISSING_LABEL);
  assert.equal(projected.source, "missing");
  assert.equal(projected.available, false);
});

test("missing canonical contact shows explicit Contact email missing label", () => {
  const projected = projectClientContactEmailDisplay(
    resolveClientCommunicationEmail({ client: { metadata: {} }, workspaceAuthEmail: "" }),
  );
  assert.equal(projected.display, "Contact email missing");
  assert.equal(projected.available, false);
});

test("multi-account client shares the same canonical contact email", () => {
  const client = { metadata: { contact_email: "agency@example.com" } };
  const first = projectClientContactEmailDisplay(resolveClientCommunicationEmail({ client }));
  const second = projectClientContactEmailDisplay(resolveClientCommunicationEmail({ client }));
  assert.equal(first.display, second.display);
  assert.equal(first.source, second.source);
});

test("agency multi-user clients resolve from client metadata without arbitrary user fallback", () => {
  assert.doesNotMatch(dataSource, /client_users/);
  assert.doesNotMatch(dataSource, /auth\.users/);
  const resolved = resolveClientCommunicationEmail({
    client: {
      metadata: {
        primary_contact_email: "primary@agency.example",
      },
    },
  });
  const projected = projectClientContactEmailDisplay(resolved);
  assert.equal(projected.display, "primary@agency.example");
  assert.equal(projected.source, "clients.metadata.primary_contact_email");
});
