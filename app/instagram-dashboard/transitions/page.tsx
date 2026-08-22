import { createSupabaseClient } from "@/lib/supabase";
import { loadAccountSessionTransitions } from "@/lib/account-session-transitions";

export const dynamic = "force-dynamic";

function yesNo(value: boolean | null) {
  return value === null ? "—" : value ? "yes" : "no";
}

export default async function AccountSessionTransitionsPage() {
  const supabase = createSupabaseClient();
  const { data: accounts } = await supabase.from("ig_accounts").select("id,username").limit(500);
  const accountIds = (accounts ?? []).map((row) => String(row.id));
  const transitions = await loadAccountSessionTransitions(supabase, accountIds, 200);
  const usernames = new Map((accounts ?? []).map((row) => [String(row.id), String(row.username ?? "Instagram account")]));

  return (
    <main style={{ padding: 28 }}>
      <header style={{ marginBottom: 24 }}>
        <p style={{ margin: 0, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".08em" }}>Operations</p>
        <h1 style={{ margin: "6px 0" }}>Business deadline transitions</h1>
        <p style={{ color: "#6b7280" }}>Informational projection of the authoritative account-session termination envelope.</p>
      </header>
      <div style={{ display: "grid", gap: 12 }}>
        {transitions.length === 0 ? <p>No projected transitions yet.</p> : transitions.map((row) => (
          <article key={row.id} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, background: "white" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <strong>@{usernames.get(row.accountId) ?? row.accountId}</strong>
              <time>{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—"}</time>
            </div>
            <p><strong>{row.state}</strong> · follow_to_unfollow · business_deadline</p>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, margin: 0 }}>
              <div><dt>Follow completed / remaining</dt><dd>{row.followsCompleted ?? "—"} / {row.followsRemaining ?? "—"}</dd></div>
              <div><dt>Safe boundary</dt><dd>{yesNo(row.safeBoundary)}</dd></div>
              <div><dt>Unfollow eligible / started</dt><dd>{yesNo(row.unfollowEligible)} / {row.unfollowStarted ? "yes" : "no"}</dd></div>
              <div><dt>Unfollow state</dt><dd>{row.unfollowState ?? "—"}</dd></div>
              <div><dt>Next step</dt><dd>{row.nextStep ?? "—"}</dd></div>
              <div><dt>Stable reason</dt><dd><code>{row.exactStableReason}</code></dd></div>
            </dl>
            {row.actionableReason ? <p style={{ color: "#b42318" }}><strong>Actionable blocker:</strong> {row.actionableReason}</p> : null}
          </article>
        ))}
      </div>
    </main>
  );
}
