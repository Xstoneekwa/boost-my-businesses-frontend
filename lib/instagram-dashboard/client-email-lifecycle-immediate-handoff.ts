import { materializeLifecycleBatch } from "./client-email-lifecycle-cron.ts";
import {
  runLifecycleDispatchBatch,
  type LifecycleEmailDispatchScope,
} from "./client-email-outbox-dispatch.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";

type MaterializeLifecycleBatch = typeof materializeLifecycleBatch;
type DispatchLifecycleBatch = typeof runLifecycleDispatchBatch;

export type ImmediateLifecycleEmailHandoffResult = {
  scope: LifecycleEmailDispatchScope;
  materialize: {
    candidates: number;
    materialized: number;
    skipped: number;
    failed: number;
  };
  dispatch: Awaited<ReturnType<DispatchLifecycleBatch>>;
};

export async function runImmediateLifecycleEmailHandoff(input: {
  supabase: ClientEmailSupabase;
  accountId: string;
  category: LifecycleEmailDispatchScope["category"];
  env?: Record<string, string | undefined>;
  now?: Date;
  fetcher?: typeof fetch;
  materialize?: MaterializeLifecycleBatch;
  dispatch?: DispatchLifecycleBatch;
}): Promise<ImmediateLifecycleEmailHandoffResult> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const scope = { accountId: input.accountId, category: input.category };
  const materialize = input.materialize ?? materializeLifecycleBatch;
  const dispatch = input.dispatch ?? runLifecycleDispatchBatch;

  // The first pass opens the episode. The second pass materializes its initial
  // intent. Both operations are idempotent, and the strict scope prevents this
  // request from dispatching unrelated accounts' queued lifecycle mail.
  const firstPass = await materialize(input.supabase, { env, now, scope });
  const secondPass = await materialize(input.supabase, { env, now, scope });
  const dispatchResult = await dispatch(input.supabase, {
    env,
    now,
    fetcher: input.fetcher,
    scope,
  });

  return {
    scope,
    materialize: {
      candidates: firstPass.candidates + secondPass.candidates,
      materialized: firstPass.materialized + secondPass.materialized,
      skipped: firstPass.skipped + secondPass.skipped,
      failed: firstPass.failed + secondPass.failed,
    },
    dispatch: dispatchResult,
  };
}
