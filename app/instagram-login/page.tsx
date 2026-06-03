import { Archivo, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import InstagramLoginClient from "./InstagramLoginClient";

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

export default function InstagramLoginPage() {
  return (
    <InstagramLoginClient
      fontDisplay={archivo.style.fontFamily}
      fontBody={jakarta.style.fontFamily}
      fontMono={jetbrains.style.fontFamily}
    />
  );
}
