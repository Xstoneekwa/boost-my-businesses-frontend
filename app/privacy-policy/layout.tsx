import type { ReactNode } from "react";
import { secondaryMetadata } from "@/lib/marketing/secondary-seo";

export const metadata = secondaryMetadata("/privacy-policy");

export default function PublicPageLayout({ children }: { children: ReactNode }) {
  return children;
}
