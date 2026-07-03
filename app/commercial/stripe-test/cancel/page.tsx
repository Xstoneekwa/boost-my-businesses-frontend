export default function StripeTestCancelPage() {
  return (
    <main style={{ minHeight: "100dvh", background: "#09090b", color: "#f5f5f4", padding: 32 }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1>Stripe Test checkout cancelled</h1>
        <p>No payment was completed. You can close this page or return to the admin Stripe Test harness.</p>
      </div>
    </main>
  );
}
