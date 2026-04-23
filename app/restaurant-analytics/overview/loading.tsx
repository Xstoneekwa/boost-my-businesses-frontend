export default function RestaurantAnalyticsOverviewLoading() {
  return (
    <div style={{ maxWidth: 1220, margin: "0 auto" }}>
      <header style={{ marginBottom: 28 }}>
        <div style={{ height: 12, width: 180, borderRadius: 999, background: "rgba(245,158,11,0.14)", marginBottom: 14 }} />
        <div style={{ height: 48, width: "min(100%, 520px)", borderRadius: 14, background: "rgba(255,255,255,0.07)", marginBottom: 14 }} />
        <div style={{ height: 14, width: "min(100%, 680px)", borderRadius: 999, background: "rgba(255,255,255,0.055)" }} />
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            style={{
              minHeight: 150,
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "linear-gradient(110deg, rgba(255,255,255,0.035), rgba(245,158,11,0.08), rgba(255,255,255,0.035))",
              boxShadow: "0 20px 70px rgba(0,0,0,0.18)",
            }}
          />
        ))}
      </section>
    </div>
  );
}
