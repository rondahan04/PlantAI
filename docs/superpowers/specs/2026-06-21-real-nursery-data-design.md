# Real Nursery Data — Backend Pipeline + Live App Integration

**Date:** 2026-06-21
**Status:** Approved (design), pending implementation plan

## Goal

Replace the mock `NurseriesScreen` (static `assets/nurseries.json` via
`loadNearbyNurseries`) with **real, live data**: discover real nurseries near the
user with Google Places, scrape each nursery's site for the diagnosed plant's
price + stock, and render real nursery cards. The heavy/secret work runs on a
backend service so API keys never ship in the app bundle.

## Decisions (locked during brainstorm)

1. **Architecture: backend API service.** The scrape (Firecrawl + OpenAI,
   30–60s/run) and Places discovery run server-side. The app calls one HTTP
   endpoint. Keys stay on the server.
2. **Card data: real Places + drop fabricated fields.** Widen the Places field
   mask to pull real rating, reviews, hours, phone, photo. Show real scraped
   price + in-stock. **Remove `deliveryTime`/`deliveryFee`** — they were
   fabricated in the JSON and have no real source.
3. **Toggle reframed to real signal.** `Pick Up` = local Places-discovered
   nurseries that stock the plant. `Deliver` = national ship-to-home nurseries
   that stock the plant (the existing curated ship-to-home fallback set). Counts
   become real.
4. **Backend portable for AWS.** Vanilla Node `http`, env-based config, no
   host-specific APIs, shipped with a `Dockerfile`. Render (or DigitalOcean via
   GitHub Student Pack) for now; lifts to AWS App Runner / ECS / Lambda-container
   later with no rewrite.

## Data flow

```
DiagnosisScreen → GPS → navigate Nurseries { plantName, lat, lng, mode }
NurseriesScreen → fetch GET {API_BASE}/api/nurseries?plant=&lat=&lng=
        ↓  backend, keys server-side
  runNurserySearch({ plantName, lat, lng })
    1. discoverNurseries() — Places Text Search, WIDE field mask
       (+ rating, userRatingCount, regularOpeningHours, nationalPhoneNumber, photos)
    2. per website → fetchSearchMarkdown (Firecrawl/Tavily) → extractAndVerifyPlants
       → price + in_stock for the queried plant
    3. national ship-to-home fallback when no local stock (existing logic)
    4. assemble Nursery[] = Places identity + scraper price/stock
       + haversine distance + mode (local=pickup, national=deliver)
       + resolved photo URL
        ↓
  Nursery[] JSON → NurseriesScreen renders cards (skeleton while waiting)
```

## Components

### 1. `scraper/pipeline.ts` (new)
Extract the orchestration currently inline in `dashboard/server.ts` into a
reusable `runNurserySearch({ plantName, lat, lng, radius? })` that returns
**nursery-grouped** results (not flat product rows). Both `dashboard/server.ts`
and the new API server import it — no duplicated logic. Encapsulates: Places
discovery, per-site scrape, ship-to-home fallback, dedup, mode classification,
result assembly.

### 2. `server/index.ts` (new)
Minimal Node `http` server (same style as the existing dashboard):
- `GET /api/nurseries?plant=&lat=&lng=&radius=` → `Nursery[]` JSON
- `GET /health` → `200 ok`
- CORS headers for the app origin
- Reads keys from server `.env` with **plain names** (`FIRECRAWL_API_KEY`,
  `OPENAI_API_KEY`, `GOOGLE_MAPS_API_KEY`), falling back to the existing
  `EXPO_PUBLIC_*` names for local dev convenience.
- `PORT` from env (default 4000). No framework — keeps it AWS-portable.
- Ships with a `Dockerfile` (node:22-slim, `CMD node server/index.ts`).

### 3. `scraper/places.ts` (extend)
- Add opt-in `richFields?: boolean` to `DiscoverOpts`; when set, widen the
  `X-Goog-FieldMask` to include `places.rating`, `places.userRatingCount`,
  `places.regularOpeningHours`, `places.nationalPhoneNumber`, `places.photos`.
- Extend `DiscoveredNursery` with optional `rating`, `reviewCount`, `hours`,
  `phone`, `photoName`.
- Add `resolvePhotoUrl(photoName, apiKey)`: server-side fetch of the Places
  media endpoint with redirect disabled, returning the keyless
  `googleusercontent.com` CDN URL from the `Location` header. No key reaches the
  client. Returns `undefined` on failure (card falls back to placeholder).

### 4. App `src/services/nurseryService.ts` (rewrite)
Replace static `loadNearbyNurseries()` with async
`fetchNearbyNurseries(plantName, lat, lng): Promise<Nursery[]>` that HTTP-GETs
`{EXPO_PUBLIC_API_BASE_URL}/api/nurseries`. 90s client timeout via
`AbortController`. Keep the haversine helper only if distance is computed
client-side; otherwise the server returns `distanceKm` and the client formats
the string. **Decision: server computes `distanceKm`; client formats display.**
The static JSON + alias-matching logic is removed (moves server-side into the
real scrape). `assets/nurseries.json` retained only as offline/demo seed, unused
at runtime.

### 5. `src/screens/NurseriesScreen.tsx` (refactor)
- Route params change from `{ plantName, nurseries, mode }` to
  `{ plantName, lat, lng, mode }`.
- Screen self-fetches on mount (`useEffect` → `fetchNearbyNurseries`).
- States: **loading** (skeleton cards + "Searching nearby nurseries… (~30–60s)"),
  **empty** ("No nurseries nearby stock {plant}" + ship-to-home block if any),
  **error** (friendly retry button).
- Remove delivery time/fee UI. Mode toggle counts computed from real
  `shipsToHome` flag (pickup = `!shipsToHome`, deliver = `shipsToHome`).
- `Order` opens the nursery `website`; `Call` uses real `phone` (hidden if
  absent); `Directions` unchanged (lat/lng deep link).

### 6. `src/screens/DiagnosisScreen.tsx` (trim)
`handleFindReplacement` resolves GPS (existing logic) then navigates with
`{ plantName, lat, lng, mode }`. The synchronous static data load is removed —
fetching now lives in `NurseriesScreen`.

## Type changes (`src/types/index.ts` `Nursery`)

- **Remove:** `deliveryTime`, `deliveryFee`.
- **Add:** `website: string`, `shipsToHome: boolean`,
  `availabilityNote?: string` (LLM-estimate text when stock isn't exact),
  `inStockKnown: boolean`.
- **Make optional:** `image?`, `rating?`, `reviewCount?`, `hours?`, `phone?`
  (Places may omit) — UI renders graceful placeholders / hides the row.
- **Remove** `deliveryAvailable` / `pickupAvailable`. Mode is derived solely from
  `shipsToHome`: the Pick Up tab shows `!shipsToHome` nurseries, the Deliver tab
  shows `shipsToHome` nurseries. A single boolean is the only real signal we have.
- Add `distanceKm: number` (server-computed); client formats the display string.
- Update `RootStackParamList.Nurseries` params to `{ plantName, lat, lng, mode }`.

## Cost control

Server-side in-memory cache keyed by `plant|latRound(3dp)|lngRound(3dp)`,
TTL ~15min. Avoids re-running Firecrawl + OpenAI for the same query during
testing/demo. Bounded size (LRU or simple map with periodic prune).

## Security

- Secrets (`FIRECRAWL_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_MAPS_API_KEY`) live in
  the server `.env` only — never in the app bundle.
- App bundle holds only `EXPO_PUBLIC_API_BASE_URL` (a URL, non-secret).
- Google Maps key restricted (HTTP referrer / IP allowlist) on the host.
- Places photo resolved server-side so no key appears in any client-loaded URL.

## Error handling

- Per-site scrape failures are already isolated by try/catch in the pipeline;
  failed sites are **dropped from app cards** (not surfaced as error rows). A
  site with 0 exact items but a positive LLM estimate surfaces as a card with
  `availabilityNote` instead of a price.
- Backend unreachable / timeout → app error state with retry.
- No nurseries with website discovered → empty state, plus ship-to-home block.

## Testing

- `scraper/pipeline.test.ts` (new): `runNurserySearch` with injected `fetch`
  (no network) — asserts nursery assembly, host dedup, mode classification
  (local vs ship-to-home), and ship-to-home fallback trigger.
- `scraper/places.test.ts` (extend): widened field-mask request shape + rich
  field parsing (rating/hours/phone/photo).
- Manual: `curl '{API_BASE}/api/nurseries?plant=monstera&lat=32.08&lng=34.78'`,
  then app end-to-end on the iOS simulator.

## Deployment

- **Dev:** backend on the Mac (`npm run server`); app points at the Mac LAN IP
  or a `cloudflared` tunnel via `EXPO_PUBLIC_API_BASE_URL`.
- **Prod (now):** Render free web service or DigitalOcean (Student Pack $200).
- **Prod (future):** AWS — the `Dockerfile` + vanilla Node mean App Runner / ECS
  Fargate / Lambda-container with no code change; only `EXPO_PUBLIC_API_BASE_URL`
  and the host env vars change.

## Out of scope (YAGNI)

- Real delivery time/fee (no data source; removed).
- Auth / rate limiting on the API (single-tenant demo; add before public).
- Persistent DB / caching beyond in-memory.
- Real ordering/checkout (`Order` just opens the nursery website).
