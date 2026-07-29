import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const autoRestartData = readFileSync(
  new URL("../../app/instagram-dashboard/auto-restart-data.ts", import.meta.url),
  "utf8",
);
const resumeMetadata = readFileSync(
  new URL("./auto-restart-resume-metadata.ts", import.meta.url),
  "utf8",
);

test("Auto Restart reads only the canonical v2 actionable Unfollow backlog", () => {
  assert.match(autoRestartData, /auto_restart_unfollow_backlog_v2/);
  assert.match(autoRestartData, /backlog_actionable_remaining/);
  assert.match(autoRestartData, /backlog_terminal_unavailable/);
  assert.match(autoRestartData, /backlog_technical_hold/);
  assert.match(autoRestartData, /unfollowBacklogResult\.error/);
});

test("temporary holds and the phase circuit remain non-terminal", () => {
  assert.match(
    autoRestartData,
    /temporarilyUnavailableWork: unfollowBacklog\.technicalHold/,
  );
  assert.match(
    autoRestartData,
    /phaseCircuitOpen: unfollowBacklog\.phaseCircuitOpen/,
  );
  assert.match(autoRestartData, /quotaRemaining: unfollow\.remaining/);
});

test("resolved incident plans bound Unfollow to actionable candidates", () => {
  assert.match(resumeMetadata, /eligibleUnfollowCandidateCount/);
  assert.match(resumeMetadata, /Math\.min\(candidate\.quotas\.unfollow\.remaining, actionableUnfollow\)/);
  assert.match(resumeMetadata, /candidate\.unfollowPhaseCircuitOpen !== true/);
});

test("Unfollow circuit code never mutates future Follow settings", () => {
  assert.doesNotMatch(autoRestartData, /follow_enabled\s*=/);
  assert.doesNotMatch(resumeMetadata, /follow_enabled\s*=/);
});
