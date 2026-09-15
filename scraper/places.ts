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
 *          body  { textQuery, locationRestriction.rectangle{bounding box} }
 *          mask  places.displayName, .location, .websiteUri, .formattedAddress
 *     └─ scrapable sites (real storefront host), capped at maxResults
 *     └─ PLUS contact-only places - no website, or a social page for one - up
 *        to contactOnlyMax. Nothing to scrape, but a real nursery with a phone
 *        number a kilometre away is a better answer than an unreachable one
 *        with a webshop, and the Pick Up tab is where a user goes to be told
 *        who is nearby.
 *     ─▶ DiscoveredNursery[]  (website '' = contact-only)
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
 * "~2% likely", which was never in doubt. Never scraping them is pure saving:
 * no reachable product page is lost.
 *
 * They are no longer DROPPED, though - they come back as contact-only rows. A
 * nursery whose whole web presence is a Facebook page is still a nursery, and
 * the phone number Places hands us is the thing the user actually needs.
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
  /* '' when the place has no scrapable storefront (no website at all, or only a
   * social page). Such a nursery is reported, never scraped - see scrapeOne. */
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
  /* Cap on contact-only places (no scrapable site) returned alongside them.
   * They cost nothing downstream - no scrape, no LLM call - so this is a
   * screen-space limit, not a budget one. 0 restores the old behaviour of
   * dropping them entirely. */
  contactOnlyMax?: number;
  languageCode?: string; // default 'he'
  regionCode?: string; // default 'IL'
  richFields?: boolean; // widen field mask: rating, reviews, hours, phone, photo
}

/* The most Places returns for one Text Search request. Filtering happens after
 * the response, so asking for fewer only throws away candidates unseen. */
export const PLACES_PAGE_SIZE = 20;

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

/* Degrees of latitude per kilometre is near enough constant; longitude narrows
 * with the cosine of the latitude. */
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG = 111.32;

/*
 * The smallest lat/lng box that CONTAINS the circle of this radius.
 *
 * Circumscribes rather than inscribes on purpose: a box inside the circle would
 * silently crop shops that are genuinely within the radius the user asked for,
 * and cropping is invisible - you cannot miss what you were never shown. The
 * corners it adds are removed by the exact distance check instead.
 */
export function boundingBox(lat: number, lng: number, radiusM: number) {
  const km = radiusM / 1000;
  const dLat = km / KM_PER_DEG_LAT;
  /* Guard the poles, where cos(lat) → 0 and the longitude span explodes. */
  const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const dLng = km / (KM_PER_DEG_LNG * cos);
  return {
    low: { latitude: lat - dLat, longitude: lng - dLng },
    high: { latitude: lat + dLat, longitude: lng + dLng },
  };
}

const R_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

/* Great-circle distance in km. The pipeline has its own copy for sorting whole
 * results; this one decides what is in the answer at all. */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    contactOnlyMax = 10,
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
      /*
       * Ask for the page Places will give us, not for the number we intend to
       * keep. `maxResults` is a cap on shops to SCRAPE, and it was being applied
       * to the request - so Places returned 10 places, six of which had no
       * website or only a Facebook page, and a 10km search around Tel Aviv came
       * back with seven shops instead of the eleven the same single request
       * contains. One Text Search call costs the same at any page size, and the
       * cap still applies below, after the filtering.
       */
      pageSize: PLACES_PAGE_SIZE,
      /*
       * RESTRICT, not bias. `locationBias` only weights ranking, so the radius
       * bounded nothing: measured from Mitzpe Ramon with a 10km radius, Places
       * returned 18 nurseries, the farthest 174.6km away and 15 of the 18
       * outside the radius we claimed to have searched. The app said "nearby".
       *
       * A rectangle, because Text Search rejects a circle here ("Unknown name
       * \"circle\" at 'location_restriction'") - circles are searchNearby's.
       * The box circumscribes the circle and `withinRadius` below removes its
       * corners, so the bound the user is told about is the bound applied.
       *
       * It also finds MORE of what we want: far-away results no longer spend
       * slots out of a 20-result page. Same Tel Aviv search, shops with a
       * website: 9 under the bias, 15 under the restriction.
       */
      locationRestriction: { rectangle: boundingBox(lat, lng, radiusM) },
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
  /* Contact-only places have no host to dedup on. A chain's branches are
   * separate shops at separate addresses, so name+address is the identity that
   * matters: two rows for the same nursery are a bug, two branches are two
   * places the user could drive to. */
  const seenPlaces = new Set<string>();
  const out: DiscoveredNursery[] = [];
  const contactOnly: DiscoveredNursery[] = [];

  for (const p of places) {
    /*
     * Inside the radius, not merely inside the box. The box has corners the
     * circle does not, and a shop in one is further away than we told the user
     * we were looking.
     *
     * A place with no coordinates is dropped rather than defaulted to 0,0:
     * defaulting would place it off the coast of Africa, or - if we defaulted
     * to the user instead - rank an unlocatable shop as the closest one.
     */
    const pLat = p?.location?.latitude;
    const pLng = p?.location?.longitude;
    if (typeof pLat !== 'number' || typeof pLng !== 'number') continue;
    if (haversineKm(lat, lng, pLat, pLng) > radiusM / 1000) continue;

    const website: unknown = p?.websiteUri;
    const url = typeof website === 'string' ? website : '';
    /* No site, or a Facebook page standing in for one. Nothing to scrape - but
     * still a nursery, and the Pick Up tab is a list of places to go. */
    const scrapable = Boolean(url) && !isNonStoreHost(url);

    /* Both lists full - nothing later in the page can change the answer. */
    if (out.length >= maxResults && contactOnly.length >= contactOnlyMax) break;

    if (scrapable) {
      if (out.length >= maxResults) continue;
      const host = hostOf(url);
      if (seenHosts.has(host)) continue;
      seenHosts.add(host);
    } else {
      if (contactOnly.length >= contactOnlyMax) continue;
      const key = `${p.displayName?.text ?? ''}@${p.formattedAddress ?? ''}`;
      if (seenPlaces.has(key)) continue;
      seenPlaces.add(key);
    }

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
    const row: DiscoveredNursery = {
      name: p.displayName?.text ?? '',
      website: scrapable ? url : '',
      lat: pLat,
      lng: pLng,
      address: p.formattedAddress ?? '',
      ...rich,
    };

    /* Hitting the scrapable cap is not the end of the loop any more: the
     * contact-only list may still have room, and those rows cost nothing. */
    if (scrapable) out.push(row);
    else contactOnly.push(row);
  }

  /* Scrapable shops first: the search is about finding the plant, and the rows
   * that can answer that question lead. The pipeline sorts on stock and
   * distance afterwards, so this only decides who survives a cap. */
  return [...out, ...contactOnly];
}
