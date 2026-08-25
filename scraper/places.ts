/*
 * Google Places API (New) - Text Search nursery discovery.
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

import { hostOf } from './core.ts';

/*
 * Hosts that can never yield a product catalog. Plenty of nurseries list a
 * Facebook or Instagram page as their "website", and Places hands that back in
 * websiteUri exactly like a real storefront. Measured 2026-08-25: 2 of 19
 * site-visits in a tally run were social URLs - each one burned a platform
 * identification, a search scrape and an LLM availability estimate to arrive at
 * "~2% likely", which was never in doubt. Dropping them at discovery is pure
 * saving: no reachable product page is lost.
 */
const NON_STORE_HOSTS = [
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'youtube.com',
  'linkedin.com',
  'pinterest.com',
  'wa.me',
  'api.whatsapp.com',
  'waze.com',
  'google.com',
  'maps.google.com',
  'sites.google.com',
  'linktr.ee',
];

/* True when a discovered "website" is a social/profile page, not a storefront.
 * Subdomain-aware so m.facebook.com and www.instagram.com are both caught. */
export function isNonStoreHost(website: string): boolean {
  const host = hostOf(website);
  return NON_STORE_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`));
}

export interface DiscoveredNursery {
  name: string;
  website: string;
  lat: number;
  lng: number;
  address: string;
  rating?: number;
  reviewCount?: number;
  hours?: string;
  phone?: string;
  photoName?: string;
}

export interface DiscoverOpts {
  textQuery?: string; // search term; default Hebrew 'משתלה' (nursery)
  radiusM?: number; // circle radius in meters (Places allows 0–50000); default 5000
  maxResults?: number; // cap how many sites we scrape downstream; default 10
  languageCode?: string; // default 'he'
  regionCode?: string; // default 'IL'
  richFields?: boolean; // widen field mask: rating, reviews, hours, phone, photo
}

const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_PHOTO_BASE = 'https://places.googleapis.com/v1/';

/* Resolve a Places photo resource name to a keyless googleusercontent CDN URL.
 * Uses skipHttpRedirect=true so the endpoint returns { photoUri } as JSON
 * instead of a 302; that URI needs no API key and is safe to send to clients.
 * Never throws - returns undefined so the card falls back to a placeholder. */
export async function resolvePhotoUrl(
  photoName: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  maxWidthPx = 800
): Promise<string | undefined> {
  try {
    const url =
      `${PLACES_PHOTO_BASE}${photoName}/media` +
      `?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true&key=${encodeURIComponent(apiKey)}`;
    const res = await fetchImpl(url, { method: 'GET' });
    if (!res.ok) return undefined;
    const data: any = await res.json();
    return typeof data.photoUri === 'string' ? data.photoUri : undefined;
  } catch {
    return undefined;
  }
}

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
    richFields = false,
  } = opts;

  const baseMask =
    'places.displayName,places.location,places.websiteUri,places.formattedAddress';
  const richMask =
    ',places.rating,places.userRatingCount,places.regularOpeningHours,places.nationalPhoneNumber,places.photos';
  const fieldMask = richFields ? baseMask + richMask : baseMask;

  const res = await fetchImpl(PLACES_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
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

  const data: any = await res.json();
  const places = Array.isArray(data.places) ? data.places : [];

  // Dedup by website host: chains return one place per branch (same site),
  // and scraping the same site N times is wasted Firecrawl/OpenAI cost.
  const seenHosts = new Set<string>();
  const out: DiscoveredNursery[] = [];
  for (const p of places) {
    const website: unknown = p?.websiteUri;
    if (typeof website !== 'string' || !website) continue;
    if (isNonStoreHost(website)) continue; // social page, not a storefront
    const host = hostOf(website);
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);
    // Only attach rich fields when requested, so the base-mask shape is
    // unchanged for callers that don't opt in.
    const rich = richFields
      ? {
          rating: typeof p.rating === 'number' ? p.rating : undefined,
          reviewCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : undefined,
          hours: p.regularOpeningHours?.weekdayDescriptions?.[0] ?? undefined,
          phone: typeof p.nationalPhoneNumber === 'string' ? p.nationalPhoneNumber : undefined,
          photoName: p.photos?.[0]?.name ?? undefined,
        }
      : {};
    out.push({
      name: p.displayName?.text ?? '',
      website,
      lat: p.location?.latitude ?? 0,
      lng: p.location?.longitude ?? 0,
      address: p.formattedAddress ?? '',
      ...rich,
    });
    if (out.length >= maxResults) break;
  }
  return out;
}
