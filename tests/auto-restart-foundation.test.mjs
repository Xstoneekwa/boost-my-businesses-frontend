import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  autoRestartFoundationBlockReason,
  validateActiveModePrerequisites,
} from "../lib/instagram-dashboard/auto-restart-foundation.ts";

test("active mode requires foundation and tick token", () => {
  const missingFoundation = {
    ready: false,
    missing: ["auto_restart_settings"],
    settingsWritable: false,
  };
  assert.equal(
    validateActiveModePrerequisites({
      patch: { mode: "active", auto_restart_enabled: true },
      foundation: missingFoundation,
      tickTokenConfigured: true,
    }),
    "auto_restart_foundation_not_deployed",
  );
  assert.equal(
    validateActiveModePrerequisites({
      patch: { mode: "active", auto_restart_enabled: true },
      foundation: { ready: true, missing: [], settingsWritable: true },
      tickTokenConfigured: false,
    }),
    "active_mode_tick_token_not_configured",
  );
  assert.equal(
    validateActiveModePrerequisites({
      patch: { mode: "active", auto_restart_enabled: true },
      foundation: { ready: true, missing: [], settingsWritable: true },
      tickTokenConfigured: true,
    }),
    null,
  );
});

test("foundation block reason is stable", () => {
  assert.equal(
    autoRestartFoundationBlockReason({ ready: false, missing: ["auto_restart_decisions"], settingsWritable: true }),
    "auto_restart_foundation_not_deployed",
  );
  assert.equal(
    autoRestartFoundationBlockReason({ ready: true, missing: [], settingsWritable: true }),
    null,
  );
});

test("settings route probes foundation", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/auto-restart/settings/route.ts", import.meta.url), "utf8");
  assert.match(source, /probeAutoRestartFoundation/);
  assert.match(source, /validateActiveModePrerequisites/);
});

test("action preview gates mutations on foundation", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/auto-restart/action-preview/route.ts", import.meta.url), "utf8");
  assert.match(source, /gateMutationExecutable/);
  assert.match(source, /block_reason/);
});
