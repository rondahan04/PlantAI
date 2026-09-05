# PlantAI - TODOs

> Thesis: diagnosis acquire, marketplace transact, **only plant library retain.**
> CEO plan: `~/.gstack/projects/rondahan04-PlantAI/ceo-plans/2026-08-11-retention-spine.md`
> **M1 shipped 2026-08-18** - https://plantai-api-eev0.onrender.com. Diagnosis and nursery
> scrape both verified live against it. 92 tests green.
> **Portfolio tab + Epic 3a shipped 2026-08-29** (PR #5, PR #6). The library is now a portfolio
> of plants you own rather than a list of scans, and it follows the account rather than the
> handset. 519 tests green. ⚠️ Epic 3a's on-device script has not been run against merged main
> (Trello #80).
> **Hebrew shipped 2026-09-01** - UI copy, model output and catalog. The app runs in Hebrew
> from the device locale, switchable in Settings without an account. 564 tests green.
> ⚠️ The scan flow has not been verified on a device (Trello #82).

---

## DO IN THIS ORDER

Ranked most → least important, 2026-08-17. Ranking rule: an unrevoked leaked key beats a broken
product beats a missing feature beats a cleanup. Within a tie, cheap-and-unblocking wins. The
milestone tag on each line preserves the old M1/M2/M3 grouping.

**Already settled:** OpenAI key rotated 2026-08-16 and verified end to end. `fly auth login` done
(`ron.dahan01@post.runi.ac.il`, org `personal`). Maps key restriction ❌ won't do - one key serves
both the Android bundle (`app.config.js:9`) and server-side Places (`server/index.ts:54`), so
restricting it to the app breaks Places, and splitting needs an `android.package` that `app.json`
doesn't have. Cheap partial anytime: API-restrict that key to Maps SDK for Android + Places API.

0. ⏳ **[P0] Restore OpenAI health assessment - blocked on lecturer's OpenAI credits.**
   `server/index.ts` sets `DIAGNOSIS_SKIP_OPENAI=true` (in `.env`, gitignored) so `/api/diagnose`
   serves `stubAssessHealth` (`server/diagnose.ts`) - species ID via PlantNet still runs for real,
   but the health assessment is a labelled placeholder, never a real diagnosis. Root cause: the
   shared OpenAI key returned `429 insufficient_quota / credit_balance_exhausted` (confirmed live
   via `/health?errors=1` on 2026-08-22). **To revert once credits are back:** delete the
   `DIAGNOSIS_SKIP_OPENAI=true` line from `.env` (and any Render env var of the same name) -
   `server/index.ts` falls back to the real `openAiAssessHealth` automatically, no code change
   needed.
1. ✅ **[P0] Old OpenAI key revoked 2026-08-17.** The leak is closed.
2. ✅ **[M1] DEPLOYED - https://plantai-api-eev0.onrender.com (2026-08-18).** The app now talks
   to a backend that exists when the laptop doesn't. Fly was abandoned: it will not provision
   without a credit card (`fly launch` → `requested machine count exceeds organization limit` on
   an org with zero machines). Render's free tier needs no card - 750 instance-hours/month,
   Dockerfile deploys, `render.yaml` Blueprint on `main`. `fly.toml` and `scripts/fly-secrets.sh`
   are kept for the day a card exists.

   **Verified in production, not assumed:** `/health` 200 · `401` without `x-plantai-key` · `415`
   on a non-image past the gate · `422 not_a_plant` on a grey square · real diagnosis
   (`Rhaphidophora tetrasperma`, moderate) · real nursery scrape (Hebrew results, Herzliya, ~50s).
   The iOS bundle was rebuilt with `--clear` and greps clean: the Render URL appears, the tunnel
   and LAN IP do not.

   Live-only notes worth keeping:
   - **Blueprint scans the repo's DEFAULT branch.** A `render.yaml` on a feature branch is
     invisible to it. That is why the first attempt found nothing.
   - **Spin-down after 15 min idle, ~1 min cold start.** Not a job-loss risk - the client polls
     every 1.5-5s for the whole scrape, so the service can only sleep when nothing is in flight.
     Optional: a free pinger (cron-job.org, no card) on `/health` every 10 min keeps it warm;
     `/health` is gate-exempt so it costs nothing against the daily cap. 750h/month ≈ 31 days, so
     one always-warm service fits and a second one would not.
   - **The tunnel and the local server are dead.** `.env` points at Render.

3. ✅ **[M2] Test discovery fixed 2026-08-17.** `"test": "node --test"` - bare recursive
   discovery, so anything matching `*.test.ts` anywhere outside `node_modules` runs. Replaces the
   explicit `scraper/*.test.ts server/*.test.ts` globs that silently skipped every future `src/`
   test. Verified with a throwaway canary under `src/`: 80 → 81 tests, then removed. 80 green.
4. ✅ **[M2] D7 and D8 decided 2026-08-17** - triage grouping, adaptive Home (H2). See OPEN
   DECISIONS for the consequences H2 puts on items 5, 7, and 8.
5. ✅ **[M2] `PlantStore` - done 2026-08-18.** `src/services/plantStore.ts` (pure, testable) +
   `src/services/plantLibrary.ts` (binds `expo-sqlite/kv-store`). Blob
   `{ version: 1, plants: [...] }` under `plantai.library`, `StorageDeps` seam mirroring
   `PipelineDeps`, sync throughout so D8's adaptive Home can read before first paint. 19 tests.
   - quota → every write is read back and compared; throw *and* silent-noop both reported
   - corrupt → quarantined to `plantai.library.corrupt`, never deleted; first quarantine wins
   - broken single records dropped, library survives; future-version blob quarantined not mangled
   - `scientificName` added to `PlantDiagnosis` - the server always sent it, the client dropped it
   - ⚠️ `photoUri` is still the camera cache URI until item 9; the record outlives the image
6. ✅ **[M2] `migrate()` chain - done 2026-08-18.** `runMigrations(lib, steps, target)` in
   `plantStore.ts`; `MIGRATIONS` table empty (v1 is current). Steps keyed by the version they
   upgrade FROM. Walks one version at a time, never jumps. Missing step → throws → quarantine,
   rather than handing later code a shape no migration produced. Migrated result is written back
   so a launch never re-migrates. 8 tests inject fake steps - a no-op chain can't be proven by
   running it.
   - **Adding v2 is two edits in one commit:** `MIGRATIONS[1] = fn` and `LIBRARY_VERSION = 2`.
7. ✅ **[M2] B1.3. Save button - done 2026-08-18.** Header icon opposite Back (the slot was
   already reserved as an empty 60pt spacer), so the "Find a replacement" commerce CTA keeps the
   accent on a screen already carrying 3 actions + 2 URGENT badges. Bookmark icon, toggles to
   un-save.
   - double-tap → `saved` set *before* the write, rolled back on failure
   - killed mid-save → nothing async, so a reported success is already on disk
   - storage-full → specific copy ("free some space and try again"), not a generic error
   - ✅ **Verified on device 2026-08-18** (iPhone 17 Pro sim). A startup harness exercised the
     real `expo-sqlite/kv-store` path: save → synchronous re-read sees the write in the same tick
     (the D8 requirement), `scientificName` round-trips, remove works, and a probe left behind
     **survived a full JS reload** (`count=1`). Harness removed and its rows purged afterwards.
   - ⚠️ The *button itself* is still unverified visually. Synthetic taps (AppleScript and
     cliclick) reach the Simulator window but never register as touches in the RN view, so UI
     automation is not available here - screens need a human or a real test stack (backlog:
     `jest-expo` + RN testing library).
8. ✅ **[M2] B1.4. Home library layout + `PlantDetail` - done 2026-08-18.** Returning-user Home
   (`SectionList`, triage-grouped) + `PlantDetailScreen` + `PlantCard`. `src/lib/triage.ts` is a
   pure tested function, 8 tests.
   - **Load before first paint**: lazy `useState(() => plantLibrary.load())`, not an effect - an
     effect would flash the marketing layout at a returning user. `useFocusEffect` re-reads so a
     plant saved on Diagnosis appears on the way back.
   - First-run branch untouched; the library layout is a second layout holding the same tokens.
   - D7: five conditions → three buckets (attention / watching / healthy). Unknown condition →
     watching, never healthy.
   - Corrupt / future-version library renders a warning, never an empty state.
   - `PlantDetail` re-reads by id, not via nav params - params are a stale snapshot.
   - ✅ **Verified on device** against a real saved plant: listed under WATCHING with photo and
     condition; detail screen renders `scientificName` correctly.
9. ✅ **[M2] Photo persistence - done 2026-08-19.** `src/services/photoStore.ts` (pure, 18 tests) +
   `src/services/photos.ts` (binds `expo-file-system` 56). Photos land in
   `<document>/plant-photos/<id>.<ext>`; the `File`/`Directory` API, not the deprecated
   functional one.
   - **`copy` is async in SDK 56, everything else on `File` is sync.** So the save is NOT
     awaited: `plantLibrary.save()` still runs synchronously with the cache URI, the copy
     follows, and `update(id, {photoUri})` repoints the record. Awaiting first would trade a
     guaranteed record for a nicer photo - killed mid-copy, the plant itself would be gone.
   - `update()` widened to accept `photoUri`, and it refuses to clear it: `photoUri` is
     required, so an explicit `undefined` would write a record that fails validation and
     disappears on the next load.
   - Read-back after the copy, same reason as `persist()` - a `copy` that resolves is not
     evidence the bytes landed, and a record pointing at nothing renders broken forever.
   - Source extension preserved (`.heic` from the picker stays `.heic`), `.jpg` when there
     isn't a trustworthy one; ids sanitised so a filename can't escape the directory.
   - **Home does launch-time housekeeping:** retries any plant still on a cache URI (the file
     often survives long enough for a second attempt), then sweeps files no plant claims.
     Neither runs when the library failed to load - it reports zero plants, so a sweep would
     delete every photo the user has.
   - Unsave and Remove delete the photo *after* the record write, never before.
   - ❌ **Downscale not done** - decided 2026-08-19. It needs `expo-image-manipulator`, a
     native dep and a dev-client rebuild. Camera capture is already `quality: 0.7`; a large
     gallery pick is copied at full size. Revisit if the document directory gets fat.
     **Hit live 2026-08-22:** a full-res gallery photo exceeded `MAX_BODY_BYTES` (12MB,
     `server/index.ts:130`), server returned `payload_too_large`, client surfaced it as a
     generic "network connection was lost." Camera capture worked fine. Not a regression -
     confirms this gap is real, not hypothetical.
   - ⚠️ Unverified on device: needs a real save → force-quit → relaunch to confirm the photo
     survives.
10. ✅ **[P0] Verify item 9 (photo persistence) on a device - done 2026-08-22.** Rebuilt
    (`npx expo run:ios`), verified on the iPhone simulator: diagnose → Save → force-quit →
    relaunch → photo survives. Save a 2nd plant, remove the 1st → confirmed by Ron. Hit and
    fixed a real bug along the way (see SHIPPED: gallery-photo payload size). RTL device
    verification (item 15) deprioritized 2026-08-22 - Ron presents on an English-language
    phone, Hebrew system-language testing is a later-stage concern. Layout code (mirroring,
    directional glyphs, plist/manifest flags) already shipped and confirmed present in the
    prebuilt output; just never exercised under an actual RTL locale. Revisit before RTL is
    user-facing.
11. ✅ **[M2] E10. Storage tests - done 2026-08-22.** `src/services/plantStore.test.ts`, 3 new
    tests (226 total pass):
    - force-quit mid-write (25 saved, 26th's `setItem` throws) → the 25 confirmed saves survive
      a fresh `load()`, the interrupted one is absent, never half-written
    - saving resumes after the crash and reaches the full intended count (50)
    - truncated JSON asserted `ok:false` / `reason:'corrupt'`, explicitly distinguished from a
      real empty library (`ok:true`) so the UI can't confuse "no plants" with "broken library"
12. ✅ **[M2] E9 follow-up. Confidence rendering - already shipped 2026-08-16 (`c7b6986`), marked
    done 2026-08-22.** `src/lib/confidence.ts` + `DiagnosisScreen.tsx` wiring: bar no longer
    tinted with `condition.color` (was conflating species-match confidence with sickness
    severity), `≥70%` renders plain, `40-69%` gets a "Probably" hedge + caveat card, `<40%` gets
    "Possibly" + a stronger caveat and a retake affordance. Confirmed the species/confidence
    number is PlantNet's alone (`server/diagnose.ts` prompts OpenAI to trust it and never
    re-identify) - thresholds are built against that number, not a cross-checked one.
    Added `src/lib/confidence.test.ts` 2026-08-22 (9 tests, 236 total pass): tier boundaries at
    40/70, high tier has no hedge/caveat, moderate/low both hedge and caveat, the real 44-48%
    run that motivated this stays non-plain, label always reflects the raw percent.
13. ❌ **[M2] E1. Plant.id v3 disease classification, server-side - dropped 2026-08-22.** No free
    tier and this project spends no real money, so a second paid provider for a signal PlantNet
    (already free, already wired) covers isn't worth carrying. `EXPO_PUBLIC_PLANTID_API_KEY`
    removed from `.env.example`; the local `.env` entry left empty and gitignored.
14. ✅ **[M3] E5. WhatsApp `wa.me` + `tel:` handoff - done 2026-08-22.** `src/lib/whatsapp.ts`
    (pure, 6 tests) normalizes `nursery.phone` (Google Places' local Israeli format, e.g.
    `"050-123 4567"`) into a `wa.me` link with the leading 0 swapped for `972`, `+972` left
    alone, and numbers too short to be real rejected rather than producing a dead link.
    `NurseriesScreen.tsx` `handleOrder` was website-only and dead-ended nurseries without a
    site in a "no website available" alert - it now falls through website → WhatsApp (prefilled
    "Hi, is {plantName} available?") → `tel:` → alert, so a nursery scraped without a site is no
    longer a transaction dead end. 242 tests pass, `tsc --noEmit` clean.
15. ✅ **[M3] E4. Hebrew - done 2026-09-01 (`df348d1`, Trello #6).** See step 22; the
    layout notes below are the August half and are kept for the record.
    - ✅ **Mirroring.** Every physical edge in `src/` is now logical: `marginLeft/Right`,
      `paddingLeft/Right` and positional `left/right` → `marginStart/End`, `paddingStart/End`,
      `start/end`. Yoga mirrors those and reverses `flexDirection: 'row'` on its own; it does
      **not** mirror `left`/`right`, which is why they had to go. `grep -rn "marginLeft\|
      marginRight\|paddingLeft\|paddingRight" src/` returns nothing - keep it that way.
      Deliberately left physical: the camera viewfinder corners and the two absolute
      `top/left/right/bottom: 0` image fills, all symmetric.
    - ✅ **Directional glyphs.** `src/lib/rtl.ts` exports `directionalIconStyle`, applied to
      every back/forward chevron and the onboarding arrow. Yoga cannot flip an icon, and a
      back chevron pointing left in a mirrored layout points *forward*.
    - ✅ **`writingDirection: 'auto'`** on every style rendering AI or user text - plant and
      species names, care rows, issues, treatments, card names, the onboarding name input,
      the profile-name subtitle. `143e98d` had covered Diagnosis and Nurseries only.
    - ✅ **iOS can actually enter RTL:** `CFBundleLocalizations: ["en","he"]` +
      `CFBundleAllowMixedLocalizations` in `app.json`. Without a declared Hebrew localization
      iOS never reports RTL, so none of the above would ever fire. Set as raw plist keys
      rather than via the `expo-localization` plugin - same result, no native dep.
    - ⚠️ **Needs a rebuild to test** (`app.json` changed) and then a device set to Hebrew.
      Android: Expo's prebuild template already sets `android:supportsRtl="true"`; confirm
      after the next prebuild.
    - ✅ **The Hebrew copy shipped 2026-09-01** - see step 22.
    - ⚠️ **The layout half was less done than this said.** It covered the screens that
      existed in August. Nine back chevrons in the auth/settings cluster were never given
      `directionalIconStyle`, and the camera viewfinder frame - excused above as
      "symmetric" - is not: each bracket drops two of its four borders and rounds one
      corner, so it came apart in RTL. Both fixed in step 22.
16. ✅ **[ops] O2/O3/O4 observability - done 2026-08-22.** `/health?errors=1`'s bounded failure
    ring (2026-08-18) stays as-is. Added: every request/job log line is now one JSON object
    (`{at,rid,event,...}` via `logEvent()`/`fail()` in `server/index.ts`) instead of a
    printf-style `[${rid}] text` string, so a host's log viewer can filter/query a field instead
    of parsing a sentence. `/health` gained `lastSuccess: {plantnet_identify, health_assessment,
    nursery_scrape}` (each `identify`/`assessHealth` call wrapped to stamp it on success) so a
    provider outage is visible without waiting for a user to hit it. `docs/RUNBOOK.md` - one page,
    covers `/health` reading, the errors ring, log format, and a symptom table for the known
    incident classes (provider down, stub mode, hung scrape, secret mismatch, oversized photo).
    Fixed the `jobs` field: `jobs.stats()` in `server/jobs.ts` replaces `jobs.size()`, returning
    `{active, retained}` instead of one number that never hit 0 on a healthy server (5 new tests).
17. ✅ **[M3] H6. Accessibility - done 2026-08-22.** `StarRating` in `NurseriesScreen.tsx` wrapped
    in one `accessible` `View` with `accessibilityLabel="Rated X out of 5 stars"` - five unlabelled
    star glyphs plus a bare number read as nothing to a screen reader; now one readable value.
    Tap targets audited: `backBtn`/`viewToggleBtn` (44×44), `modeBtn`/`retryBtn`/
    `actionSecondary`/`actionPrimary`/`scanMoreBtn` (`minHeight: 44`) were already ≥44pt - no
    change needed there.
18. ✅ **[M3] Cleanups - done 2026-08-22.** **H1** `env()` lifted into `scraper/core.ts`
    (plain-name-first, `EXPO_PUBLIC_` fallback); `dashboard/server.ts`, `scripts/scrape-nurseries.ts`,
    and `server/index.ts`'s own local copy all now import the one implementation instead of each
    redeclaring a narrower, prefix-only version. **H2** `nurseries_scraping_testing` renamed to
    `nurseries-fallback.txt` (`git mv`, plus every reference: `server/index.ts`, `dashboard/server.ts`,
    `scraper/pipeline.ts`, `Dockerfile`). **H5** the route table comment at the top of
    `server/index.ts` was already accurate - confirmed, no change needed.
19. ✅ **[ops] Tavily student plan - done 2026-08-22.** Key swapped in local `.env`
    (`EXPO_PUBLIC_TAVILY_API_KEY`) and in Render's `TAVILY_API_KEY` env var (`sync: false`,
    dashboard-only). No code change.
20. ✅ **[M3] Portfolio tab - done 2026-08-29 (PR #5, Trello #75).** My Plants becomes a
    Portfolio: one list of every plant with All / Diagnosed filters, a "Due this week" strip,
    and a second door in - add a plant you already own, by hand, from a 359-entry species
    catalog. Per-genus care plans cover all eight growing media in one model call, so switching
    a plant from soil to LECA reschedules it instantly and offline. Library v2 makes `diagnosis`
    optional and stamps every existing plant `addedVia: 'scan'`. Verified on device before merge.
    Follow-ups filed: Trello #76 (catalog accuracy), #77 (reminder confirmation), #78 (repot card).
21. ✅ **[M3] Epic 3a - the library follows the account - done 2026-08-29 (PR #6, Trello #79).**
    Logged out, nothing changed and there is still no login wall. Logged in, every mutation
    writes to Supabase first and only then to the local store, which is demoted to a mirror -
    a failed write cannot leave the phone showing a plant the account does not have. Photos go
    to a private bucket read through signed URLs; the mirror is wiped on sign-out and on account
    deletion. `plantRepo` is the facade, `plantCloud` the tested network layer,
    `supabasePlantCloud` the only file that talks to Supabase. New route `POST /api/care-plan`.
    All four migrations applied to the live project and verified.
    ⚠️ **One thing still open** - the 12-step device script (Trello #80).
    🔴 **Trello #81 is ANSWERED, and the answer is no.** `/health` gained
    `cache: {enabled, hits, misses, stores, errors}` on 2026-09-05 (PR #13,
    `cedc432`); read against Render immediately after that deploy it says
    **`"enabled": false`**. The week-long shared scrape cache Epic 3a shipped
    has never actually run in production - every nursery search on the live
    service is a full live scrape, paid to Firecrawl/Tavily/OpenAI, reusing
    nothing between users or between days.
    **Fix is a Render dashboard change and needs a login:** add `SUPABASE_URL`
    and `SUPABASE_SERVICE_ROLE_KEY` (service_role, NOT anon - RLS denies anon
    every row in `nursery_searches`, which would silently cache nothing and
    reproduce this bug exactly). Both are `sync: false` in `render.yaml` on
    purpose: the service-role key bypasses RLS and must never reach the app
    bundle. Confirm with `cache.enabled: true`, then run one search twice and
    watch `hits` move - `enabled` proves the credentials exist, `hits` proves
    the table and its policies work.

22. ✅ **[M3] E4. Hebrew, all three layers - done 2026-09-01 (`df348d1`, Trello #6).**
    The app's own ~320 strings, the model's diagnosis and care plans, and the species
    catalog. Language resolves from the device locale and is overridable in Settings,
    which is now reachable WITHOUT an account - putting it behind a sign-up meant a user
    who could not read the English UI had to create an account to reach the setting that
    would fix it. `he.ts` is declared `typeof en`, so a drifted Hebrew tree cannot compile.
    Six pure modules that held user-facing English now take their wording through an
    injected object with an English default. The server takes `lang` and its prompts name
    the fields that must NOT be translated - `condition`, `scientificName`, `genus`, the
    growing-medium keys - because those are what the client branches on, and translating
    one renders the wrong colour on a call that looked successful. `Treatment` gained
    `product` so the buy button survives Hebrew; the old title parser stays for records
    saved before it. Care-plan cache keys gained the language and bumped to v2.
    ⚠️ **The scan flow has NOT been verified on a device** (Trello #82) - a real Hebrew
    diagnosis with its condition colour and buy button intact.

23. ✅ **[ops] Silent failures made visible - done 2026-09-05, merged `cedc432`, live.** Five items that needed no
    OpenAI credits and no device check, so all five are verified by tests, a local server and
    CI rather than by eye.
    - **Scrape cache visibility (Trello #81).** A missing `SUPABASE_SERVICE_ROLE_KEY` breaks
      nothing and costs money on every search: the cache answers "miss" forever, the scrape
      runs, the logs look normal. `/health` now carries `cache: {enabled, hits, misses,
      stores, errors}`. A disabled cache counts nothing - counting its lookups as misses
      would report a 0% hit rate on a server with no cache, the exact reading being ruled out.
    - **CI.** See BACKLOG. Uncovered that `npm run typecheck` was already red on main.
    - **`payload_too_large` client mapping.** The 2026-08-22 live bug: an oversized photo was
      reported as "the network connection was lost". RN tears the request down mid-body so the
      413 was never read, and nothing mapped the code even when it arrived. Now refused before
      the upload starts (`src/lib/uploadLimit.ts`), which also stops spending a tethered
      hotspot's data to earn an error. Mapping moved to `src/lib/diagnosisFailure.ts` because
      `plantDiagnosis.ts` imports expo-file-system and so was untestable under `node --test`.
    - **E11 scrape freshness.** See BACKLOG.
    - **Stock unknown.** See BACKLOG.
    ⚠️ **Nothing here was verified on a device, by design** - these were chosen as the items
    that do not need one. The camera's too-large copy has never been seen rendered, and being
    client-side it reaches nobody until the next `eas update` or build.
    🔵 **The cache field paid for itself within a minute of deploying**: it reported
    `enabled: false`, which is the finding above. That is the entire argument for this kind of
    work - the failure had been running in production, costing money, since Epic 3a.
    ⚠️ **CI is not a required check yet.** It runs on every PR and every push to main, but
    nothing blocks a merge on it - PR #13 was merged while its own run was still going. Branch
    protection on `main` requiring "typecheck + tests" is what turns the signal into a gate.
    ⚠️ **The API docs site is updated in the repo but not deployed** - needs `vercel --prod`
    from `docs/api-site` (Trello #52).

---

## BACKLOG (unordered)

| # | Item | Size | Note |
|---|------|------|------|
| P2 | In-app live nursery discovery | M | GPS → `scraper/places.ts` `discoverNurseries()` server-side. The real product goal. Gated on scrape speed. |
| - | Scrape speed | S | Quality problem now, not correctness. Best observed 47s (2026-08-17, 7 nurseries); worst seen 480s. **Four serial round trips removed 2026-08-25**, all on the slow path: `identifyPlatform` L2+L3 now fire as one parallel stage instead of three serial scrapes; the homepage read during identification is cached per host and reused by the availability estimate instead of being re-scraped; the auditor pass is skipped when extraction returned 0 rows (the common case in a fan-out). Still open: cheaper model, precomputed index. Needs a fresh timed run to re-measure. |
| - | **Scrape success rate** | M | The real quality metric, now measurable: `PipelineResult.funnel.stage` splits every 0-item site into `no_markdown` / `no_excerpt` / `no_match` / `rejected`, logged per site by the dashboard. Fixed 2026-08-25: Wix `/product-page/` links and Hebrew/Latin ILS forms (`ש"ח`, `שח`, `NIS`, `ILS`) were invisible to `priceFocusedExcerpt` + `scoreMarkdown`, so Wix stores and word-priced sites returned an empty excerpt and the model never saw the page. **Next: run the dashboard, tally stages across ~20 sites, and fix whichever bucket dominates.** Candidates if `no_excerpt` leads: more platform link shapes. If `no_match`: the site's own search is failing (try a sitemap/collection crawl instead of `?s=`). If `rejected`: the auditor is too strict about stock wording. |
| ✅ | ~~Show "stock unknown" instead of dropping the row~~ | S | **Done 2026-09-05.** Auditor prompt now keeps a row whose product and price are supported but whose stock is unstated, as `availability: "unknown"`; it still drops unsupported/invented rows. Pipeline keeps `inStockKnown: false` for those (the flag means "exact listing" and the badge reads it as certainty), carries a `stock_unknown` availability, and the badge reads "Listed · stock not stated", tone `maybe`. Out-of-stock untouched - sold out is knowledge, not absence of it. The auditor half needs OpenAI credits to exercise live; the decision half is tested from injected verdicts. |
| E2 | Photo timeline per plant | M | Nearly free after PlantStore (5). |
| E3 | Shareable diagnosis card | M | Virality after retention. |
| E6 | Light meter | M | Novelty, unclear retention. |
| E7 | Cache nursery results per plant | M | Nothing cached across jobs today. |
| E8 | Inventory index as dataset | L | Platform play, premature. |
| ✅ | ~~E11 Scrape freshness monitoring~~ | M | **Done 2026-09-05.** `server/scrapeHealth.ts` retains per-host `ExtractFunnel.stage` (plus timeout/error), which the pipeline computed and threw away. Draws the one distinction that matters: `no_match`/`rejected` mean we READ the catalogue and the plant was absent (normal), everything else means we never read it (our fault). Stale after 3 consecutive unreadable reads - one timeout is weather - cleared by a single good read. Wired as an optional `onSiteRead` observer on `PipelineDeps`, wrapped so a broken counter cannot fail a paid scrape. `/health` gets counts; per-host detail sits behind `?errors=1` + the secret. |
| - | Firecrawl weekly cron | S | `scripts/scrape-nurseries.ts` as a GitHub Action. |
| ✅ | ~~CI/CD for the container~~ | M | **Done 2026-09-05.** `.github/workflows/ci.yml`: `npm ci` + both tsconfig projects + full suite, and a second job that builds the Dockerfile, runs the container and requires `/health` to answer. No secrets - the smoke test passes four obviously fake provider keys to clear the server's fail-fast guard, so a fork's PR runs it in full. Found and fixed on the way: `npm run typecheck` was red on main (plantRepo tests never typechecked), so CI could never have gone green. |
| - | `jest-expo` + RN testing library | L | 17 untested flows, second test stack. After M2. |
| - | Streaming partial nursery results | M | - |
| - | Per-device quota / App Attest | M/L | Real protection vs a bundled secret. |
| - | Home screen redesign | M | Scope undefined - what's changing and why. Conflicts with existing "do not touch Home" design-review rule; needs a design pass before code. |
| - | Settings tab | M | Superseded by #1 (User Accounts + Settings/Profile) - scoped and filed 2026-08-22, eng-reviewed. Accounts are opt-in, no login wall on Home/diagnosis. |
| - | ~~Epic 3 - sync plant library to Supabase account~~ | L | ✅ **Shipped 2026-08-29 as Epic 3a** - see step 21. Original note kept for the record: deferred from #1 during eng review to keep the auth PR reviewable. Design: on first login on a device with local plants, one-shot opt-in prompt ("Import your N saved plants?") writes them into a `plants` table tagged with `user_id`, then clears local storage; declining leaves local storage untouched. Needs a `plants` table + cascade-delete-on-account-delete. Blocked on #1 shipping first. |

---

## OPEN DECISIONS

- ✅ **D7 - MyPlants list order → triage grouping** (decided 2026-08-17). Group by health:
  critical + severe, then moderate, then healthy. `PlantDiagnosis.condition` already carries the
  five-step scale, so the grouping key is free. Matches why the app gets opened.
- ✅ **D8 - Home vs My Plants nav → H2, adaptive Home** (decided 2026-08-17). Home shows the
  marketing/how-it-works content on first run and a library-first layout once ≥1 plant is saved.
  Chosen over H1 (library row under the CTA) and H3 (tab bar).
  Consequences to build around:
  - **Two Home layouts** to build, test, and keep on-token. The design review's *do not touch
    Home* rule was about not degrading the existing first-run screen - the returning-user layout
    is a new design and must hold the same tokens (`#F0FDF4`, Lora/Raleway, 8pt rhythm) on
    purpose, not by inheritance.
  - The swap fires once, the first time a user saves. Decide whether it animates or is simply
    true on next mount; a screen silently becoming a different screen is disorienting.
  - Empty state is now Home's first-run content, so "real empty state" in item 8 means the
    *transition* is the thing to get right, not an illustration.
  - Home needs the plant list to load before first paint, or it flashes marketing content at a
    returning user. Read `PlantStore` synchronously on mount - `expo-sqlite/kv-store` supports it.
  - No separate MyPlants *screen* in the H2 world; item 8 becomes the Home library layout +
    `PlantDetail`.

---

## ONGOING

- ⚠️ **UPDATED - update the APIs site every time we change something in the architecture.**
  Site: https://plantai-api-docs.vercel.app (source: `docs/api-site/index.html`, deployed via `vercel --prod`).
  Trigger: adding/removing a provider, route, gate rule, or data flow. Mirrored on Trello.

---

## SHIPPED

| Item | What |
|------|------|
| B2.1 Care schedule | `expo-notifications` wired in `src/services/wateringReminder.ts` - 2026-08-19. Water-blue schedule card + watering history calendar on `PlantDetail`. Was still listed as backlog here; found shipped while building the Trello board. |
| Plant library UI | Adaptive Home (D8/H2) + PlantDetail + triage grouping (D7). Library read synchronously during first render so a returning user never sees marketing content flash. Corrupt libraries warn rather than showing an empty state. |
| PlantStore | Saved-plant persistence with read-back-confirmed writes and quarantine-on-corrupt. Plus `tsconfig.node.json`: `server/` and `scraper/` had never been typechecked, which is how a wrong-arity call reached production. `npm run typecheck` now gates both. |
| M1 deploy | **https://plantai-api-eev0.onrender.com** (2026-08-18). Render free tier, no card, `render.yaml` Blueprint on `main`. Fly abandoned - will not provision without a credit card. Verified live: gate 401/415, `422 not_a_plant`, real diagnosis, real nursery scrape. |
| Icons | New leaf mark for iOS + Android. `scripts/make-icons.py` derives the set: fits a plane to the teal pixels to recover the gradient and extends it, killing the baked corners and the alpha (App Store rejects alpha; iOS double-masks pre-rounded art). Android layers rebuilt with the leaf at 60% of the canvas, inside the adaptive safe zone. |
| Shape drift | `normalizeAssessment` - OpenAI periodically returns `issues` as objects rather than strings, which 502'd a live diagnosis (r68) that had worked locally minutes earlier. Prompt now shows an example element; parser repairs the known shapes. Only `issues` is repaired - fabricating a `condition` would invent a diagnosis. |
| Error ring | `/health?errors=1`, secret-gated, bounded at 20. A deployed instance failing on a provider call was opaque without the host's log viewer. |
| P0 funding | OpenAI credits restored; real photo → real diagnosis on device. |
| A1 gate | `server/gate.ts` - `x-plantai-key`, per-IP burst limit, daily cap → 503, `CORS: *` gone. Cap checked *before* secret; `GATE_MODE` fails safe to `log`; polling exempt. ⚠️ The secret is a speed bump, not auth - **the cap bounds the bill.** 14 tests. |
| A2 code | `Dockerfile` (node:26-alpine, non-root, zero deps), `.dockerignore`, `fly.toml`. 90s-timeout requirement retired by E12. |
| A3 | `POST /api/diagnose` - PlantNet + OpenAI server-side, `src/lib/api.ts` the only URL/header holder. **No provider key in app code.** Server sniffs image magic numbers → 415 `unsupported_image` (test photos are WebP named .jpeg). Server is now a single point of failure for diagnosis - accepted. |
| A5 | `getMockDiagnosis` deleted - it rendered fabricated root rot at "87% confidence". Plus named error types + `isHealthAssessment` guard. |
| E9 | `describeFailure` in `CameraScreen` is the single source of failure copy. Killed the three-error-languages problem. Confidence *rendering* still open → step 11. |
| E12 | Async job + poll. `POST /api/nurseries` → 202 `{jobId}`, `GET /api/nurseries/job/:id`. Client polls 1.5s→5s, tolerates 4 misses, 10 min cap. Dedupes in-flight; failed jobs not cached. Live: 8 nurseries in 80,907 ms. ⚠️ Jobs in process memory - see step 2.4. |
| H1 partial | `loadEnv()` overwrote real env vars, so `GATE_MODE=enforce` silently ran as `log`. Now skips already-set keys + comment lines. |
| H3 | One `fail()` helper - stable code to client, provider detail to log with request id. |
| H7 | Nursery cache `Map` capped at 20, oldest-first. |
| O1 | `GET /health` → `{gate: {day, allowed, rejected, wouldReject, cap, remaining}, jobs}`. |
| Portfolio tab | 2026-08-29, PR #5. Portfolio replaces My Plants; hand-added plants; 359-entry species catalog; per-genus care plans across eight growing media in one call; soil picker; water/feed/repot schedules. Library v2 made `diagnosis` optional - and made a previously dead `persist(plants.filter(...))` line live, which would have silently erased damaged records on the first launch after upgrade. Caught in review, fixed, regression-tested. |
| Hebrew (E4) | 2026-09-01, `df348d1`. UI copy, model output and species catalog, selected from the device locale and switchable in Settings without an account. tsc enforces that the Hebrew tree matches the English one. Scan flow not yet verified on a device (Trello #82). |
| Epic 3a | 2026-08-29, PR #6. Plant library syncs to the Supabase account. Cloud-first writes with the local store as a mirror, one-shot import banner, private photo bucket, wipe on sign-out and on account delete. Also here: nursery scrapes cached server-side for a week and shared across users, and urgent treatments prewarmed from the diagnosis screen. |

## REVIEWS

| Run | Skill | Date | Result |
|-----|-------|------|--------|
| 1 | `/plan-ceo-review` | 2026-08-11 | clean - M1/M2/M3 scope |
| 2 | `/plan-eng-review` | 2026-08-11 | clean - 11 issues, D3-D9 |
| 3 | `/plan-design-review` | 2026-08-15..16 | 9 findings; F1-F6 closed, F7→7, F8→8, F9→11 |

Run 3 was screenshot-based (iPhone 17 Pro, iOS 26.1, `main` @ `cc0e5a2`); mockup generation
failed on `OpenAI organization verification required`. Board:
`~/.gstack/projects/rondahan04-PlantAI/designs/myplants-b14-20260815/design-board.html`

**Do not touch:** Home, Camera, Diagnosis layout - on-token (`#F0FDF4`, Lora/Raleway, 8pt
rhythm). The nursery loading copy is the writing standard for the rest of the app.
