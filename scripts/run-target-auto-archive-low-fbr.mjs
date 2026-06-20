#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyLowFbrPerformance,
  targetAutoArchiveLowFbrFlags,
} from "../lib/instagram-dashboard/target-auto-archive-low-fbr-policy.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = join(
  ROOT,
  "runs",
  `target-auto-archive-low-fbr-${process.env.TARGET_AUTO_ARCHIVE_LOW_FBR_DRY_RUN === "false" ? "live" : "dry-run"}-${new Date().toISOString().replace(/[:.]/g, "")}.json`,
);

function readString(value, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function createSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase env vars are missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function scanBatch(supabase, offset, limit) {
  const { data, error } = await supabase
    .from("ig_targets")
    .select("id,account_id,normalized_username,target_username,status,quality_status,follows_sent_count,followbacks_count,followback_ratio,followbacks_metrics_reliable_at")
    .eq("quality_status", "eligible")
    .neq("status", "archived")
    .neq("status", "deleted")
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function main() {
  const flags = targetAutoArchiveLowFbrFlags();
  const supabase = createSupabaseClient();
  const batchSize = 500;
  let offset = 0;
  const summary = {
    targets_scanned: 0,
    targets_skipped_unreliable: 0,
    targets_skipped_under_minimum: 0,
    targets_qualified: 0,
    targets_archived: 0,
    targets_readd_blocked: 0,
    errors: 0,
  };
  const candidates = [];

  while (true) {
    const rows = await scanBatch(supabase, offset, batchSize);
    for (const row of rows) {
      summary.targets_scanned += 1;
      const evaluation = classifyLowFbrPerformance(row, readString(row.quality_status, "unknown"));
      if (evaluation.blockReason === "insufficient_follow_volume") {
        summary.targets_skipped_under_minimum += 1;
      }
      if (!evaluation.wouldArchive) {
        if (evaluation.reviewCandidate && !evaluation.metricsReliable) {
          summary.targets_skipped_unreliable += 1;
        }
        continue;
      }
      summary.targets_qualified += 1;
      candidates.push({
        account_id: readString(row.account_id),
        target_id: readString(row.id),
        target_username: readString(row.normalized_username, readString(row.target_username)),
        follows_sent_count: evaluation.followsSent,
        followback_ratio: evaluation.followbackRatio,
        metrics_reliable: evaluation.metricsReliable,
      });
    }
    if (rows.length < batchSize) break;
    offset += batchSize;
  }

  const report = {
    generated_at: new Date().toISOString(),
    flags,
    summary,
    candidates,
  };

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.error(`Report written to ${REPORT_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
