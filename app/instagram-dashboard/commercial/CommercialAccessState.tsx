import Link from "next/link";
import { redirect } from "next/navigation";

/** Presentation only: callers must retain the server-side authorization gate. */
export default function CommercialAccessState({ status, retryPath }: {
  status: 401 | 403 | 503;
  retryPath: "/instagram-dashboard/commercial" | "/instagram-dashboard/commercial/structured";
}) {
  if (status === 401) redirect("/instagram-login");

  const unavailable = status === 503;
  return <main className="commercial-page">
    <h1>{unavailable ? "Vérification d’accès temporairement indisponible" : "Accès réservé au propriétaire"}</h1>
    <p role="status">{unavailable
      ? "Nous ne pouvons pas vérifier vos droits pour le moment. Aucune donnée commerciale n’est affichée. Réessayez dans quelques instants."
      : "Ce compte ne dispose pas de l’autorisation nécessaire pour accéder au Commercial Dashboard."}</p>
    {unavailable && <form action={retryPath} method="get"><button type="submit">Réessayer</button></form>}
    <Link href="/instagram-login" prefetch={false}>Se reconnecter</Link>
  </main>;
}
