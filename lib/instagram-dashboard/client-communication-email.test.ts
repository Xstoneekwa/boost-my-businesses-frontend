import assert from "node:assert/strict";
import test from "node:test";
import {
  isForbiddenCommunicationEmailSource,
  projectClientContactEmailDisplay,
  resolveClientCommunicationEmail,
} from "./client-communication-email.ts";

test("canonical contact email prefers clients.metadata.contact_email", () => {
  const resolved = resolveClientCommunicationEmail({
    client: {
      metadata: {
        contact_email: "Owner@Example.com",
        notification_email: "notify@example.com",
      },
    },
    workspaceAuthEmail: "auth@example.com",
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.email, "owner@example.com");
  assert.equal(resolved.source, "clients.metadata.contact_email");
});

test("owner auth email is used when canonical client contact email is absent", () => {
  const resolved = resolveClientCommunicationEmail({
    client: { metadata: {} },
    ownerAuthEmail: "OwnerAuth@Example.com",
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.email, "ownerauth@example.com");
  assert.equal(resolved.source, "client_users.owner_auth_email");
});

test("missing canonical contact returns explicit non-sendable state", () => {
  const resolved = resolveClientCommunicationEmail({
    client: { metadata: {} },
    workspaceAuthEmail: "",
  });
  assert.equal(resolved.ok, false);
  if (resolved.ok) return;
  assert.equal(resolved.reason, "missing_canonical_contact");
});

test("instagram and credential sources are forbidden for communication email", () => {
  assert.equal(isForbiddenCommunicationEmailSource("ig_account_settings"), true);
  assert.equal(isForbiddenCommunicationEmailSource("account_credentials_metadata_safe"), true);
  assert.equal(isForbiddenCommunicationEmailSource("clients.metadata.contact_email"), false);
});

test("projectClientContactEmailDisplay surfaces Not provided when canonical is absent", () => {
  const projected = projectClientContactEmailDisplay(
    resolveClientCommunicationEmail({ client: { metadata: {} }, ownerAuthEmail: "" }),
  );
  assert.equal(projected.display, "Not provided");
  assert.equal(projected.source, "missing");
  assert.equal(projected.available, false);
});
