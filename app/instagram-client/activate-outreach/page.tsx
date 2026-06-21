import { Suspense } from "react";
import OutreachActivationForm from "./OutreachActivationForm";

export const metadata = {
  title: "Activer la prospection — Espace client Instagram",
};

export default function ClientActivateOutreachPage() {
  return (
    <main style={{ minHeight: "100dvh", background: "#09090b" }}>
      <Suspense fallback={<div style={{ color: "#fff", padding: 32 }}>Chargement…</div>}>
        <OutreachActivationForm lang="fr" />
      </Suspense>
    </main>
  );
}
