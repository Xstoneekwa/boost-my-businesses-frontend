import { Suspense } from "react";
import PlanChangeCheckoutForm from "./PlanChangeCheckoutForm";

export const metadata = {
  title: "Changer de formule — Espace client Instagram",
};

export default function ClientChangePlanPage() {
  return (
    <main style={{ minHeight: "100dvh", background: "#09090b" }}>
      <Suspense fallback={<div style={{ color: "#fff", padding: 32 }}>Chargement…</div>}>
        <PlanChangeCheckoutForm lang="fr" />
      </Suspense>
    </main>
  );
}
