/**
 * Geocoding Service
 * Universal location search using Nominatim (OpenStreetMap).
 * Supports addresses, places, POIs, hospitals, parks, neighborhoods.
 *
 * Usage policy: https://operations.osmfoundation.org/policies/nominatim/
 * - 1 request per second
 * - Provide User-Agent identifying the application
 * - Cache results when possible (handled by caller/frontend)
 */

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

export interface GeocodingResult {
  displayName: string;
  type: string;
  lat: number;
  lng: number;
  boundingBox: [number, number, number, number]; // [south, north, west, east]
  importance: number;
  placeId: string;
}

interface NominatimItem {
  place_id: string;
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
  class?: string;
  importance?: number;
  boundingbox?: string[];
}

/**
 * Search for any location: addresses, places, hospitals, parks, etc.
 *
 * @param query - Search string (e.g. "Queen Alexandra Hospital", "Portsmouth UK")
 * @param options - Optional limit, country filter, or viewbox bias
 * @returns Array of results (max 5 by default)
 */
export async function searchLocation(
  query: string,
  options?: {
    limit?: number;
    countrycodes?: string;
    viewbox?: [number, number, number, number]; // [south, north, west, east]
  },
): Promise<GeocodingResult[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) {
    return [];
  }

  const limit = Math.min(options?.limit ?? 5, 10);
  const params = new URLSearchParams({
    q: trimmed,
    format: "json",
    limit: String(limit),
    addressdetails: "1",
  });

  if (options?.countrycodes) {
    params.set("countrycodes", options.countrycodes);
  }
  if (options?.viewbox) {
    const [south, north, west, east] = options.viewbox;
    params.set("viewbox", `${west},${south},${east},${north}`);
    params.set("bounded", "1");
  }

  const url = `${NOMINATIM_BASE}/search?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "StreetKeeper/1.0 (https://street-keeper.app; dev@street-keeper.app)",
      Referer: "https://street-keeper.app/",
      Accept: "application/json",
      "Accept-Language": "en",
    },
  });

  if (!response.ok) {
    throw new Error(`Geocoding failed: ${response.status}`);
  }

  const data = (await response.json()) as NominatimItem[];
  return data.map((item) => ({
    displayName: item.display_name,
    type: item.type ?? item.class ?? "place",
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    boundingBox: item.boundingbox
      ? ([
          parseFloat(item.boundingbox[0]),
          parseFloat(item.boundingbox[1]),
          parseFloat(item.boundingbox[2]),
          parseFloat(item.boundingbox[3]),
        ] as [number, number, number, number])
      : ([item.lat, item.lat, item.lon, item.lon].map(parseFloat) as [
          number,
          number,
          number,
          number,
        ]),
    importance: item.importance ?? 0,
    placeId: item.place_id,
  }));
}
