import type { RunControlHealthProjection } from "@/lib/instagram-dashboard/run-control";

type RunControlStatusBannerProps = {
  health: RunControlHealthProjection;
};

function toneForState(state: RunControlHealthProjection["displayState"]) {
  switch (state) {
    case "ready":
      return { border: "rgba(52,211,153,0.35)", background: "rgba(16,185,129,0.10)", color: "#6EE7B7" };
    case "launch_disabled":
      return { border: "rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.10)", color: "#FBBF24" };
    case "maintenance_disabled":
      return { border: "rgba(248,113,113,0.35)", background: "rgba(248,113,113,0.10)", color: "#FCA5A5" };
    default:
      return { border: "rgba(248,113,113,0.35)", background: "rgba(248,113,113,0.10)", color: "#FCA5A5" };
  }
}

export default function RunControlStatusBanner({ health }: RunControlStatusBannerProps) {
  const tone = toneForState(health.displayState);
  const heartbeatDetail = health.heartbeatAgeSeconds === null
    ? "No recent heartbeat"
    : `Heartbeat age ${health.heartbeatAgeSeconds}s`;

  return (
    <section
      className="ig-dashboard-runcontrol-banner"
      role="status"
      aria-live="polite"
      style={{
        borderColor: tone.border,
        background: tone.background,
      }}
    >
      <strong style={{ color: tone.color }}>{health.label}</strong>
      <span>{health.message}</span>
      <small>
        {heartbeatDetail}
        {health.dispatcherStatus ? ` · dispatcher ${health.dispatcherStatus}` : ""}
        {health.dispatcherLaunchEnabled === false ? " · launch disabled" : ""}
      </small>
    </section>
  );
}
