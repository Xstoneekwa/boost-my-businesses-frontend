export type GeocodedPlace = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  bbox: [number, number, number, number] | null;
};

const nominatimBaseUrl = (process.env.GEOCODING_NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const nominatimUserAgent = (process.env.GEOCODING_USER_AGENT || "BoostMyBusinesses-ClientDashboard/1.0").trim();

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readBBox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const parts = value.slice(0, 4).map(readNumber);
  if (parts.some((part) => part === null)) return null;
  return parts as [number, number, number, number];
}

export async function searchGeocodedPlaces(query: string, limit = 5): Promise<GeocodedPlace[]> {
  const normalized = query.trim();
  if (normalized.length < 2) return [];

  const url = new URL(`${nominatimBaseUrl}/search`);
  url.searchParams.set("q", normalized);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 8)));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": nominatimUserAgent,
    },
    cache: "no-store",
  });

  if (!response.ok) return [];

  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) return [];

  return payload
    .map((row, index) => {
      if (!row || typeof row !== "object") return null;
      const record = row as Record<string, unknown>;
      const lat = readNumber(record.lat);
      const lon = readNumber(record.lon);
      const label = typeof record.display_name === "string" ? record.display_name.trim() : "";
      if (lat === null || lon === null || !label) return null;
      return {
        id: typeof record.place_id === "string" || typeof record.place_id === "number"
          ? String(record.place_id)
          : `${index}-${label}`,
        label,
        lat,
        lon,
        bbox: readBBox(record.boundingbox),
      } satisfies GeocodedPlace;
    })
    .filter((row): row is GeocodedPlace => Boolean(row));
}
