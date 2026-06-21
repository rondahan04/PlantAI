# PlantAI — TODOs

## Active: Real Nursery Data (replace mock NurseriesScreen with live scrape)

**Spec:** `docs/superpowers/specs/2026-06-21-real-nursery-data-design.md`
Backend API service; keys server-side; real Places identity + scraped price/stock;
10km discovery radius → fallback to `nurseries_scraping_testing`; toggle reframed
(Pick Up = local, Deliver = ship-to-home). Future backend host: AWS.

- [ ] **Plan 1 — Backend Nursery API:** `docs/superpowers/plans/2026-06-21-nursery-backend-api.md`
  - `places.ts` rich field mask + `resolvePhotoUrl`; `scraper/pipeline.ts` `runNurserySearch`
    (DI seam, 10km, empty-discovery + ship-to-home fallbacks); `server/index.ts`
    (`GET /api/nurseries`); refactor dashboard onto the shared pipeline; Dockerfile.
- [ ] **Plan 2 — App Integration:** *(to be written)*
  - `Nursery` type changes; `fetchNearbyNurseries()` HTTP call; `NurseriesScreen`
    self-fetch + loading/empty/error states; `DiagnosisScreen` trim;
    `EXPO_PUBLIC_API_BASE_URL`.

**Root cause this replaces:** app shows static `assets/nurseries.json` via
`loadNearbyNurseries()` — never scrapes (hence the 11889km distances + stock photos).

---

## Phase 2 (after demo validation)

### In-app live nursery discovery (Places → scrape)
**What:** Move the Places `discoverNurseries()` flow into the app so it uses the device's real GPS (`expo-location`, already wired in DiagnosisScreen) to find + show nearby nurseries with live inventory.

**Why:** "Nurseries near the user" is the real product goal. The dashboard test mode (shipped) proves the discover→scrape pipeline works server-side.

**Blocked by — must reduce scrape latency first:** the current pipeline is ~30-60s/site (Firecrawl/Tavily + two-pass GPT-5.5). Live in-app that's unusable. Options to explore: (a) cache discovered+scraped results in a backend/EAS API route the app calls (keeps keys server-side — `EXPO_PUBLIC_*` keys ship in the app bundle otherwise), (b) scrape async + stream/poll, (c) cheaper/faster extraction for the live path.

**How to start:**
1. Decide the backend surface (EAS hosting API route vs. refresh `nurseries.json` on a cron) — keys must NOT ship in the app bundle.
2. Reuse `scraper/places.ts` `discoverNurseries()` server-side.
3. Wire `NurseriesScreen` to the device GPS + the backend endpoint.

**Depends on:** scrape-latency reduction; backend/API-route decision.


### Firecrawl scraping automation
**What:** Scheduled scraper using `@mendable/firecrawl-js` that updates `assets/nurseries.json` weekly from nursery websites.

**Why:** Manual JSON goes stale after ~1 week. Nurseries add/remove plants without notice. Freshness is what makes the marketplace moat real.

**How to start:**
1. `npm install @mendable/firecrawl-js`
2. Get Firecrawl API key at firecrawl.dev (free tier: ~500 pages/month)
3. Write `scripts/scrape-nurseries.ts` — for each nursery URL, extract plant name/price/stock
4. Output to `assets/nurseries.json` format
5. Schedule as GitHub Action: weekly cron → scrape → PR to update JSON

**Depends on:** real user reactions from Expo Go demo (validate demand before building supply infra).

---

### EAS Expo Go publish
**What:** Run `eas update --branch main` to generate a shareable URL + QR code for Expo Go.

**Why:** Zero-install sharing — anyone can scan the QR and run the app. This is the Phase 1 distribution goal from the design doc.

**How to start:**
1. `npm install -g eas-cli`
2. `eas login` (Expo account required)
3. `eas update --branch main`
4. Share the generated URL + QR code

**Blocked by:** Expo account + EAS project setup (`eas init` may be needed first).
