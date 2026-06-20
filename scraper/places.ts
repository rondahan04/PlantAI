/*
 * Google Places API (New) — Text Search nursery discovery.
 *
 * One POST returns name + location + website for nurseries near a point. The
 * websiteUri comes back inline, so there is NO separate Place Details call
 * (cheaper + faster). Requesting websiteUri bills at the Text Search
 * Enterprise SKU, so keep maxResults small while testing.
 *
 *   discoverNurseries(lat, lng, apiKey, opts)
 *     └─ POST places:searchText
 *          body  { textQuery, locationBias.circle{center,radius} }
 *          mask  places.displayName, .location, .websiteUri, .formattedAddress
 *     └─ keep ONLY places that have a website (others are unscrapable)
 *     └─ slice to maxResults  ─▶ DiscoveredNursery[]  (feed website → scraper)
 *
 * `fetchImpl` is injectable so the parser is unit-tested without network,
 * mirroring tavilyExtract in core.ts.
 */

export interface DiscoveredNursery {
  name: string;
  website: string;
  lat: number;
  lng: number;
  address: string;
}

export interface DiscoverOpts {
  textQuery?: string; // search term; default Hebrew 'משתלה' (nursery)
  radiusM?: number; // circle radius in meters (Places allows 0–50000); default 5000
  maxResults?: number; // cap how many sites we scrape downstream; default 10
  languageCode?: string; // default 'he'
  regionCode?: string; // default 'IL'
}

const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

export async function discoverNurseries(
  lat: number,
  lng: number,
  apiKey: string,
  opts: DiscoverOpts = {},
  fetchImpl: typeof fetch = fetch
): Promise<DiscoveredNursery[]> {
  const {
    textQuery = 'משתלה',
    radiusM = 5000,
    maxResults = 10,
    languageCode = 'he',
    regionCode = 'IL',
  } = opts;

  const res = await fetchImpl(PLACES_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.displayName,places.location,places.websiteUri,places.formattedAddress',
    },
    body: JSON.stringify({
      textQuery,
      languageCode,
      regionCode,
      pageSize: Math.min(20, Math.max(1, maxResults)),
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Places ${res.status} ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const places = Array.isArray(data.places) ? data.places : [];

  // Dedup by website host: chains return one place per branch (same site),
  // and scraping the same site N times is wasted Firecrawl/OpenAI cost.
  const seenHosts = new Set<string>();
  const out: DiscoveredNursery[] = [];
  for (const p of places) {
    const website: unknown = p?.websiteUri;
    if (typeof website !== 'string' || !website) continue;
    const host = hostOf(website);
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);
    out.push({
      name: p.displayName?.text ?? '',
      website,
      lat: p.location?.latitude ?? 0,
      lng: p.location?.longitude ?? 0,
      address: p.formattedAddress ?? '',
    });
    if (out.length >= maxResults) break;
  }
  return out;
}

/* Bare hostname (www-stripped, lowercased) for dedup; falls back to the raw
 * string if the URL is unparseable so a weird value still dedups against itself. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
