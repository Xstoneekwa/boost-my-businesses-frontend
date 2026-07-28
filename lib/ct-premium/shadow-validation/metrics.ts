import type { CtPlan } from "../types.ts";
import type { CtShadowValidationAggregate, CtShadowValidationRun } from "./types.ts";

export function percentile(sortedValues: readonly number[], percentileValue: number): number | null {
  if (!sortedValues.length) return null;
  const bounded = Math.max(0, Math.min(1, percentileValue));
  const position = (sortedValues.length - 1) * bounded;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  return Number((sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower)).toFixed(2));
}

function increment(target: Record<string, number>, key: string, amount = 1) { target[key] = (target[key] ?? 0) + amount; }
function rate(numerator: number, denominator: number) { return denominator ? Number((numerator / denominator).toFixed(4)) : 0; }

export function aggregateCtShadowValidation(runs: readonly CtShadowValidationRun[]): CtShadowValidationAggregate {
  const findings = runs.flatMap((run) => run.findings);
  const scores = runs.flatMap((run) => run.report.candidateEvaluations.flatMap((candidate) => candidate.score ? [candidate.score.total] : [])).sort((a, b) => a - b);
  const triggerCounts: Record<CtPlan, { total: number; triggered: number }> = { growth: { total: 0, triggered: 0 }, pro: { total: 0, triggered: 0 }, premium: { total: 0, triggered: 0 } };
  const stockCounts: Record<string, { total: number; triggered: number }> = {};
  const snapshotCompatibility: Record<string, number> = {};
  const reasonCodes: Record<string, number> = {};
  const exclusionReasons: Record<string, number> = {};
  let candidates = 0, exclusions = 0, duplicates = 0, blacklisted = 0, invalid = 0, proposals = 0, batchCapacity = 0, warnings = 0, errors = 0;
  const bands = { reject: 0, review: 0, recommended: 0 };

  for (const run of runs) {
    const report = run.report;
    triggerCounts[run.scenario.plan].total += 1;
    if (report.gate.triggered) triggerCounts[run.scenario.plan].triggered += 1;
    const stock = String(run.scenario.stock);
    stockCounts[stock] ??= { total: 0, triggered: 0 };
    stockCounts[stock].total += 1;
    if (report.gate.triggered) stockCounts[stock].triggered += 1;
    candidates += report.candidatesReceived;
    exclusions += report.exclusions.total;
    duplicates += report.exclusions.duplicates;
    blacklisted += report.exclusions.blacklisted;
    invalid += report.exclusions.invalid;
    proposals += report.proposedCount;
    batchCapacity += report.snapshot?.batchSize ?? 10;
    warnings += report.warnings.length;
    errors += report.errors.length;
    increment(snapshotCompatibility, report.snapshotCompatibility);
    increment(reasonCodes, report.gate.reasonCode);
    for (const [reason, count] of Object.entries(report.exclusionCounts)) increment(exclusionReasons, reason, count);
    for (const evaluation of report.candidateEvaluations) if (evaluation.score) bands[evaluation.score.band] += 1;
  }

  const passCount = runs.filter((run) => !run.findings.some((finding) => finding.verdict === "fail")).length;
  return Object.freeze({
    scenarioCount: runs.length,
    passCount,
    warningCount: findings.filter((finding) => finding.verdict === "warning").length,
    failCount: findings.filter((finding) => finding.verdict === "fail").length,
    passRate: rate(passCount, runs.length),
    triggerRateByPlan: Object.fromEntries(Object.entries(triggerCounts).map(([plan, value]) => [plan, rate(value.triggered, value.total)])) as Record<CtPlan, number>,
    triggerRateByStock: Object.fromEntries(Object.entries(stockCounts).map(([stock, value]) => [stock, rate(value.triggered, value.total)])),
    averageCandidates: Number((candidates / Math.max(1, runs.length)).toFixed(2)),
    exclusionRate: rate(exclusions, candidates), duplicateRate: rate(duplicates, candidates), blacklistRate: rate(blacklisted, candidates), invalidRate: rate(invalid, candidates),
    averageProposals: Number((proposals / Math.max(1, runs.length)).toFixed(2)),
    emptyBatchRate: rate(runs.filter((run) => run.report.proposedCount === 0).length, runs.length),
    averageScore: scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)) : null,
    medianScore: percentile(scores, 0.5),
    scorePercentiles: { p10: percentile(scores, 0.1), p25: percentile(scores, 0.25), p75: percentile(scores, 0.75), p90: percentile(scores, 0.9) },
    scoreBands: bands,
    batchFillRate: rate(proposals, batchCapacity), providerWarningRate: rate(warnings, runs.length), errorRate: rate(errors, runs.length),
    idempotenceStabilityRate: rate(runs.filter((run) => run.deterministic).length, runs.length),
    snapshotCompatibility, reasonCodes, exclusionReasons,
  });
}
