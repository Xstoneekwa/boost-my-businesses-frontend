import { Suspense } from "react";
import CommercialCheckoutForm from "./CommercialCheckoutForm";

export const metadata = {
  title: "Checkout — Instagram Growth",
};

export default function InstagramGrowthCheckoutPage() {
  return (
    <main style={{ minHeight: "100dvh", background: "#09090b" }}>
      <Suspense fallback={<div style={{ color: "#fff", padding: 32 }}>Loading checkout…</div>}>
        <CommercialCheckoutForm flowType="first_purchase" lang="fr" />
      </Suspense>
    </main>
  );
}
