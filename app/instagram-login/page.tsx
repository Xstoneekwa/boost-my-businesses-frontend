import { Archivo, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import InstagramLoginClient from "./InstagramLoginClient";
import { redirect } from "next/navigation";
import { getInstagramUserContextReadOnly } from "@/lib/restaurant-analytics/session";
import { instagramPostLoginPath } from "@/lib/instagram-auth/post-login-path";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export default async function InstagramLoginPage() {
  const context = await getInstagramUserContextReadOnly();
  if (context) redirect(instagramPostLoginPath(context.role));
  return (
    <InstagramLoginClient
      fontDisplay={archivo.style.fontFamily}
      fontBody={jakarta.style.fontFamily}
      fontMono={jetbrains.style.fontFamily}
    />
  );
}
