import { replayTargetAvailability, loadReplayFixtures } from "./replay-harness.ts";

const fixturePath = process.argv[2] ?? new URL("./fixtures/rare-signal-fixtures.json", import.meta.url).pathname;
const fixtures = await loadReplayFixtures(fixturePath);
const reports = fixtures.map(replayTargetAvailability);
const failures = reports.filter((report) => report.invariantViolations.length > 0);

process.stdout.write(`${JSON.stringify({
  summary: {
    fixtureCount: reports.length,
    passCount: reports.length - failures.length,
    failCount: failures.length,
    totalInputs: reports.reduce((total, report) => total + report.inputs, 0),
    totalAccepted: reports.reduce((total, report) => total + report.eventsAccepted, 0),
    totalRejected: reports.reduce((total, report) => total + report.eventsRejected, 0),
    totalDeduplicated: reports.reduce((total, report) => total + report.deduplicatedEvents, 0),
    totalTimingMs: reports.reduce((total, report) => total + report.timingMs.total, 0),
  },
  reports,
}, null, 2)}\n`);

if (failures.length) process.exitCode = 1;
