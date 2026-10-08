import type { ReactNode } from "react";
import { secondaryMetadata } from "@/lib/marketing/secondary-seo";

export const metadata = secondaryMetadata("/terms-and-conditions");

export default function PublicPageLayout({ children }: { children: ReactNode }) {
  return children;
}
