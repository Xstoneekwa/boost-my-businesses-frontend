import type { Metadata } from "next";

export const PUBLIC_ORIGIN = "https://www.boostmybusinesses.com";
export const marketingPages = {
  "/": { title: "Boost My Businesses | AI-Powered Instagram Growth & Automation", description: "Managed Instagram growth powered by AI and real phones, with business automation for calls, leads, support and content.", label: "Home", image: "/homepage/assets/smart-acquisition-refinery-v1.jpg" },
  "/instagram-growth": { title: "Croissance Instagram ciblée | Boost My Businesses", description: "Développez une audience Instagram pertinente avec un ciblage géré, de vrais téléphones et une équipe dédiée. Découvrez la méthode et les offres BMB.", label: "Instagram Growth", image: "/instagram-growth/assets/refinement-v2/smart-targeting.jpg" },
  "/instagram-growth-south-africa": { title: "Instagram Growth South Africa | Boost My Businesses", description: "Managed Instagram growth for South African businesses. Reach relevant audiences through local sources, AI-guided targeting and real-phone infrastructure.", label: "South Africa", image: "/instagram-growth/verticals/south-africa.png" },
  "/instagram-growth/real-estate": { title: "Instagram Growth for Real Estate | Boost My Businesses", description: "Build a relevant Instagram audience for your real-estate business through property communities, local sources and a campaign managed by the BMB team.", label: "Real Estate", image: "/instagram-growth/verticals/real-estate.png" },
  "/instagram-growth/beauty-aesthetics": { title: "Instagram Growth for Beauty & Aesthetics | Boost My Businesses", description: "Managed Instagram audience growth for salons, skincare and aesthetics businesses. Connect your content with relevant beauty and local communities.", label: "Beauty & Aesthetics", image: "/instagram-growth/verticals/beauty-aesthetics.png" },
  "/instagram-growth/restaurants": { title: "Instagram Growth for Restaurants | Boost My Businesses", description: "Help relevant local audiences discover your restaurant on Instagram with managed targeting around food, venues and hospitality communities.", label: "Restaurants", image: "/instagram-growth/verticals/restaurants.png" },
  "/instagram-growth/fitness": { title: "Instagram Growth for Fitness Businesses | Boost My Businesses", description: "Reach relevant fitness and wellness audiences on Instagram. Managed campaigns for gyms, personal trainers, coaches and fitness communities.", label: "Fitness", image: "/instagram-growth/verticals/fitness.png" },
  "/partners": { title: "Instagram Growth for Agencies & Partners | Boost My Businesses", description: "Add managed Instagram Growth to your agency. Keep your client relationship while BMB handles targeting, real-phone infrastructure and campaign operations.", label: "Partners", image: "/partners/assets/agency-operations-v1.jpg" },
  "/ai-automation": { title: "AI Automation for Business | Boost My Businesses", description: "Explore business automation for calls, WhatsApp leads, support and content, with workflows designed around your processes and human oversight.", label: "AI Automation", image: "/homepage/assets/smart-acquisition-refinery-v1.jpg" },
} as const;
export type MarketingPath = keyof typeof marketingPages;
export const marketingPaths = Object.keys(marketingPages) as MarketingPath[];

export function marketingMetadata(path: MarketingPath): Metadata {
  const page = marketingPages[path];
  const url = PUBLIC_ORIGIN + path;
  const image = { url: PUBLIC_ORIGIN + page.image, alt: `Boost My Businesses — ${page.label}` };
  return {
    metadataBase: new URL(PUBLIC_ORIGIN), title: page.title, description: page.description,
    alternates: { canonical: url }, robots: { index: true, follow: true },
    openGraph: { title: page.title, description: page.description, url, type: "website", siteName: "Boost My Businesses", images: [image] },
    twitter: { card: "summary_large_image", title: page.title, description: page.description, images: [image.url] },
  };
}

export function marketingStructuredData(path: MarketingPath) {
  const page = marketingPages[path];
  const organization = { "@type": "Organization", "@id": `${PUBLIC_ORIGIN}/#organization`, name: "Boost My Businesses", url: `${PUBLIC_ORIGIN}/`, logo: `${PUBLIC_ORIGIN}/instagram-growth/assets/icon-square-256.png` };
  const graph: Record<string, unknown>[] = [organization];
  if (path === "/") graph.push({ "@type": "WebSite", "@id": `${PUBLIC_ORIGIN}/#website`, url: `${PUBLIC_ORIGIN}/`, name: "Boost My Businesses", publisher: { "@id": organization["@id"] } });
  else {
    const crumbs = [{ name: "Home", item: `${PUBLIC_ORIGIN}/` }];
    if (path.startsWith("/instagram-growth/") || path === "/instagram-growth-south-africa") crumbs.push({ name: "Instagram Growth", item: `${PUBLIC_ORIGIN}/instagram-growth` });
    crumbs.push({ name: page.label, item: PUBLIC_ORIGIN + path });
    graph.push({ "@type": "BreadcrumbList", itemListElement: crumbs.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, ...crumb })) });
    graph.push({ "@type": "Service", "@id": `${PUBLIC_ORIGIN}${path}#service`, name: page.label === "AI Automation" ? "Business AI Automation" : `Managed Instagram Growth${page.label === "Instagram Growth" ? "" : ` — ${page.label}`}`, url: PUBLIC_ORIGIN + path, description: page.description, provider: { "@id": organization["@id"] }, ...(path === "/instagram-growth-south-africa" ? { areaServed: { "@type": "Country", name: "South Africa" } } : {}) });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}
