# PlantAI — TODOs

## Phase 2 (after demo validation)

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
