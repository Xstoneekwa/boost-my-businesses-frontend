import type { MetadataRoute } from "next";
import { PUBLIC_ORIGIN } from "@/lib/marketing/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/instagram-dashboard", "/restaurant-analytics", "/instagram-growth/checkout", "/instagram-login", "/instagram-reset-password", "/restaurant-login", "/restaurant-reset-password", "/auth/"] },
    sitemap: `${PUBLIC_ORIGIN}/sitemap.xml`,
  };
}
