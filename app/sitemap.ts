import type { MetadataRoute } from "next";
import { marketingPaths, PUBLIC_ORIGIN } from "@/lib/marketing/seo";
import { secondaryPaths } from "@/lib/marketing/secondary-seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return [...marketingPaths, ...secondaryPaths].map((path) => ({ url: PUBLIC_ORIGIN + path }));
}
