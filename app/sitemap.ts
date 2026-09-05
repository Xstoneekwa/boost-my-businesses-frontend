import type { MetadataRoute } from "next";
import { marketingPaths, PUBLIC_ORIGIN } from "@/lib/marketing/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return marketingPaths.map((path) => ({ url: PUBLIC_ORIGIN + path }));
}
