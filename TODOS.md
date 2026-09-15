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
> **Ops pass shipped 2026-09-05** (PRs #13, #15). The failures that were invisible now report
> themselves, `main` is gated on CI, and "water all" reaches plants that have never been
> watered. 687 tests green.
> **Perf pass + Inter shipped 2026-09-05** (PRs #12, #18, #19). Photos downscale on entry and
> render through expo-image, photo URLs are signed in one batched request, Portfolio rows stop
> redrawing, "water all" waters everything, and the Home hero is 21% shorter. 712 tests green.
> **Retrieval rebuilt 2026-09-07..08** (PRs #29-#36). Prices come from the page's own markup
> rather than a model re-reading it, each shop is asked a question its own search can answer,
> and a plant is matched by asking rather than by threshold - a hard cut had been reporting
> shops as not stocking plants they had on the shelf.
> **Leaves, Hebrew and structure shipped 2026-09-11** (PRs #37-#40). Leaf tracking from first
> sight to unfurled, the Hebrew app reads as Hebrew rather than mirrored English, the shipper
> list moved to disk, and `src/` is grouped by feature.
> **Nursery honesty pass shipped 2026-09-13..15** (PRs #41-#45). Every "we didn't find it"
> claim now has to earn itself, the search radius actually bounds the search, the explainer
> site matches the API again, and a shop whose catalogue lists products without prices is
> priced from its product pages. 981 tests green.
> 🔴 **The shared scrape cache is OFF in production** - re-read live 2026-09-15, `/health` still
> says `cache.enabled: false`, so every nursery search is a live paid scrape reusing nothing
> between users or between days. Needs two env vars in the Render dashboard; see step 21.
> ⚠️ **Nothing since 2026-09-13 has been looked at on a device.** Ron confirmed the cheapest-first
> Pick Up order, the shipper logos, the mashtela distance badge and the widen button that day;
> everything merged after it is API-verified only.
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

0. ✅ **[P0] Restore OpenAI health assessment - credits back (2026-09-07).**
   `DIAGNOSIS_SKIP_OPENAI=false` in local `.env` and `render.yaml`. Real
   `openAiAssessHealth` path is live again. If diagnosis still 502s, check the
   OpenAI key quota on Render — not the skip flag.
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
    ✅ **CI is now a required check** - see step 25. The caveat this line used to carry
    (merges were not blocked on it) was closed the same day.
    ⚠️ **The API docs site is updated in the repo but not deployed** - needs `vercel --prod`
    from `docs/api-site` (Trello #52).

24. ✅ **[M3] "Water all" reached no new plant - fixed 2026-09-05 (PR #15, `4138136`, Trello #88).**
    Reported by Ron. On a fresh library the button did nothing at all and said nothing was due.
    `waterTargets` read only from `dueSoon`, and `dueSoon` deliberately drops `never_watered`:
    with no first watering there is no anchor, so there is no honest due date to sort or label
    by. Right for a list of dates, wrong for a watering can - **"no anchor yet" is not "recently
    watered"**, and the button treated them the same.
    - `neverWatered()` in `portfolio.ts` selects scheduled-but-never-watered plants.
      `unscheduled` deliberately stays out: with no interval anywhere, marking one logs a
      watering that starts no schedule - a different feature, not one to hide inside this button.
    - `waterTargets` returns `dueCount` / `firstWaterCount` separately so the confirmation names
      both. A plant somehow in both counts once, as due - the date-backed reason wins.
    - The overwatering guard is untouched and now tested *against* the new group. Watering three
      days early resets a real schedule and records water the plant never got.
    - **"Due this week" is unchanged, on purpose.** It stays a list of things with a real due
      date. Accepted consequence: Water all can act on a plant the strip does not list, which is
      why the dialog names that group out loud.
    - 🔵 **Two grammar bugs found by PRINTING the sentences, not by reading the code**: English
      produced "Only those 1 of your 9 plants are marked", and Hebrew agreed a plural verb with 1
      ("1 צריכים") and joined clauses as "ו2" where a numeral needs "ו-2". Both now covered by
      tests in `copy.test.ts`. Worth repeating the technique - the copy tree is logic now, and it
      is the one layer tsc cannot check for sense.
    - 687 tests, both typecheck projects clean.
    ⚠️ **Not seen on a device**, and client-side only, so it reaches nobody until the next
    `eas update` or build.

25. ✅ **[ops] `main` is protected; CI is a required check - 2026-09-05 (Trello #22).**
    The workflow alone was only a signal: PR #13 was merged while its own run was still in
    progress. Both jobs (`typecheck + tests`, `docker build`) are now required.
    - **Enforced for admins too.** Sole admin, so without that flag the rule is decorative - the
      one person who can merge could merge past it.
    - **`strict` (branch must be up to date) is OFF.** On, every PR needs a rebase whenever main
      moves; it would have forced one on #15 the moment #14 landed. CI is 45s, so the staleness
      risk is small and the friction would be daily. Turn on with
      `gh api -X PATCH repos/rondahan04/PlantAI/branches/main/protection/required_status_checks -f strict=true`.
    - **No required reviews** - solo repo; a required reviewer would make merging impossible.
    - Verified rather than assumed: a direct push to main was rejected with
      `GH006 ... 2 of 2 required status checks are expected`.
    ⚠️ **Nobody can push directly to `main` any more, including from the laptop.** Every change
    goes through a PR with green checks. Escape hatch if CI ever breaks and blocks an urgent fix:
    `gh api -X DELETE repos/rondahan04/PlantAI/branches/main/protection`.

26. ✅ **[M3] App performance pass - done 2026-09-05 (PR #18, `62737c7`, Trello #89).**
    Measured before changing anything, and the numbers killed most of the candidates:
    `plantStore.load()` is **0.18ms at 200 plants**, `dueSoon()` 0.14ms, `searchCatalog()`
    0.08ms. **The "one JSON blob re-parsed on every focus" pattern is fine** - no SQLite
    migration, no incremental storage, no memoised schedule maths. Do not spend a day there.
    The real costs were images, round trips and re-renders:
    - **Signed URLs: N requests → 1.** `createSignedUrl` per row meant thirty round trips
      before a photo could paint, on every Portfolio mount, with nothing reusing the hour-long
      URLs. Batched + cached, re-signed 5 min before expiry, cleared on sign-out (a signed URL
      is a live read capability on a private bucket).
    - **expo-image** everywhere a photo renders. A 12MP photo is ~48MB of bitmap and the
      Portfolio was decoding all of it to paint a 56pt thumbnail. `recyclingKey` so a recycled
      row never flashes the previous plant's photo.
    - **Downscale on entry**, 1600px long edge, at the one point camera and gallery both
      funnel through - the August deferral, and the root fix for `payload_too_large`.
    - **Rows stop redrawing.** `React.memo` alone would have done nothing: storage reads go
      through JSON.parse, so every plant object is a new reference and reference equality can
      never hold. Comparator is a pure module, 13 tests.
    - **Catalog index on first use.** 🔵 Honest correction: only **1.45ms** of the ~13ms
      import was the index; the rest is data-literal evaluation, which this does not touch.
    ⚠️ **No speed claim here is measured on a device** - all reasoned from code and bitmap
    arithmetic.

27. ✅ **[M3] Water all waters everything - done 2026-09-05 (PR #19, `5c2c44e`, Trello #90).**
    Twice in one day. First it was widened to reach never-watered plants (Trello #88); then,
    by request, the guard came off entirely and it now marks **every plant in the portfolio**.
    Marking a plant watered yesterday still records water it never got and still pushes its
    reminder a full interval late - that reasoning did not stop being true, it lost to the
    label. The honesty moved into the confirmation: *"including any that were not due yet, and
    restarts their schedules"*, so the reset is agreed to at the tap.
    Acts on the whole library, not the filtered view - the All/Diagnosed chips are a way of
    looking at the portfolio, not a selection. `neverWatered()` stays, tested and unused.

28. ✅ **[design] Home hero is smaller - done 2026-09-05 (PR #18, `82e4620`).**
    184pt → 146pt, the whole block rather than the type alone: padding 24→16, title
    `display`→`title` (32/40 → 23/30), gaps tightened, CTA 48→**44** (the accessibility floor,
    not lower). Touches Home, which the design review marked "do not touch" - that rule was
    about not degrading the first-run screen, and this was a requested change to it.
    ⚠️ Never seen rendered; the 23pt choice is a taste call awaiting Ron's eye.

29. ✅ **[ops] Clean iOS builds link against prebuilt RN again - fixed 2026-09-07 (Trello #91).**
    `expo run:ios` failed at link with missing RN core C++ symbols
    (`facebook::react::Sealable`, `ShadowNode::getDebugName`) referenced from
    **RNGestureHandler** and **RNScreens**.
    **The fix is one command, and it is not "build RN from source":**

    ```
    rm -rf ios/Pods ios/build ios/Podfile.lock && (cd ios && pod install)
    rm -rf ~/Library/Developer/Xcode/DerivedData/PlantAI-*
    ```

    Verified 2026-09-07: clean simulator build, `Build Succeeded`, 0 errors, app installed.
    Prebuilt core stays on, so builds stay fast - no ~1,600-step source compile, no
    `expo-build-properties`, no permanent cost.
    ⚠️ **The 2026-09-05 diagnosis in this entry was wrong on three counts**, recorded so the
    next person does not re-derive it:
    - *"The prebuilt core lacks the symbols / ABI mismatch."* No. `nm -gU` on the cached
      `React.xcframework` exports `Sealable::Sealable` (6) and `ShadowNode::getDebugName` (1)
      in **every** slice, device and simulator.
    - *"RNGestureHandler and RNScreens disagree with the prebuilt core."* No. Zero `Sealable`
      issues are filed on either tracker; any Fabric pod built from source hits this.
    - *"Clearing DerivedData does not help."* Misleading - DerivedData **alone** does not.
      `ios/Pods` is what holds the bad artifact.
    **Actual cause.** The prebuilt core ships two flavors. The **Release** flavor is compiled
    with `NDEBUG`, which strips debug-only C++ symbols (`Sealable`, `DebugStringConvertible`).
    `React-Core-prebuilt` has a `before_compile` script phase (`replace-rncore-version.js`)
    that swaps in the flavor matching the configuration; when that swap is skipped or
    interrupted, a **Debug** build links the **Release** framework and those symbols are gone.
    Upstream: react-native#57293, reproduced on Xcode 26.6 in an Expo SDK 56 project.
    ⚠️ **It can recur.** The hardening (PR #57831, an in-progress marker so an interrupted swap
    is recoverable) shipped in **0.87**; there is no 0.85.x patch, so RN 0.85.3 carries the
    pre-fix script. If it comes back, run the command above - do not go looking for an ABI bug.
    🔵 **Red herring, still worth remembering:** the log also warns `cannot link directly with
    'SwiftUICore'`. That is a WARNING, not the failure. After the fix it disappears entirely
    (0 occurrences), which is its own evidence it was never the cause.

30. ✅ **[design] Inter replaces Nunito - merged 2026-09-05 (PR #12, `9423811`).**
    Opened earlier in the day and merged at the end of it, after `main` was merged in and CI
    verified it against a clean `npm ci`. ⚠️ The device build made on 2026-09-05 predates this
    merge, so **the phone is still running Nunito** until the next build.

---

## BACKLOG (unordered)

| # | Item | Size | Note |
|---|------|------|------|
| ✅ | ~~P2 In-app live nursery discovery~~ | M | **Already shipped, and the radius made real 2026-09-13.** The row was stale: GPS → `discoverNurseries()` has been live for some time (`resolveCoords` reads the device, `useNurserySearch` prefetches, the server discovers per-search), and `assets/nurseries.json` is referenced nowhere in `src/` or `server/`. What was actually broken underneath it: **the radius bounded nothing.** `places.ts` sent `locationBias`, which only weights ranking - measured from Mitzpe Ramon at 10km, Places returned 18 nurseries, the farthest **174.6km** away, 15 of 18 outside the radius, and the app called them "nearby". Now `locationRestriction.rectangle` (Text Search rejects a circle) plus an exact haversine filter for the box corners: 0 outside at every radius and location tested. It also finds MORE - far results no longer spend slots out of a 20-result page, so Tel Aviv scrapable shops went 9 → 10. The client now sends the radius (and it is part of the client cache key, or "search wider" would be handed the 10km promise), the copy derives its km from the radius actually used instead of a hardcoded "10km", and an empty result offers a widen step instead of a retry that could only fail identically. Ladder is 10 → 25 → 50km because the data said so: Mitzpe Ramon yields 3 → 4 → 12, so stopping at 25km would strand exactly the users the button is for. |
| ✅ | ~~Scrape speed~~ | S | **Done 2026-09-05 (PRs #8, #9, Trello #13).** Measured end to end on the production shape (12 nurseries, default 10km radius, same query, LLM stage equally unavailable in both runs): **81.0s → 36.5s**, slowest single site 79.6s → 34.7s. Healthy shops went from 26-41s each to 0.5-1.3s. Readable sites on the 13-site benchmark rose 11/13 → 13/13 and scored results 8 → 10, so success rate went UP. Root cause was never concurrency: the Firecrawl key allows **10 requests/minute** (cached hits count), and a refused homepage read is indistinguishable from "platform unknown", which is the path that spends 3 more requests per site - the limit fed itself. Fixes: Tavily reads pages as served (~700ms, 100/min) and Firecrawl only renders; platform detection stops paying a second provider for a meaningful empty read (35 → 10 requests per search); timeouts are no longer retried 4x at 25s; every nursery gets a 45s deadline so one dead shop cannot set the pace. **Remaining lever: Firecrawl Hobby is 100 req/min - after upgrading set `FIRECRAWL_MAX_PER_MINUTE=100` and the last tail disappears.** |
| - | **Scrape success rate** | M | **Measured and raised 2026-09-13 with `npm run funnel:tally` (new, `scripts/funnel-tally.ts`).** Live fan-out, Tel Aviv 10km + shipper list, 2 plants x 13 scrapable sites. **85% -> 92% of site reads reach the catalogue.** The old note's premise - that an extraction bucket dominates - was wrong; the funnel was never the problem. Three things came out of it. **(1) The metric was lying.** `noteSite` ignored `answered === false` and carried a `!readable(stage)` guard, so a shop that 404s or serves its homepage to every query parsed into `no_match` - which counts as a SUCCESSFUL read. The guard let through exactly the cases it existed to catch. Fixed in `scraper/pipeline.ts` using the same signal the user-facing `readCatalogue` already trusted. The rate read 96% before the fix; that number was false. **(2) VirtueMart is now a modelled platform.** mashtela-urbanit.co.il was silently broken on every search. Two causes, both fixed: `identifyPlatform` L1 read only MARKDOWN, which strips href and asset paths - the only place a platform names itself - so a Joomla shop detected as `woo` and every search went to `?s=`, which it answers with its homepage; L1 now also does a free raw GET and lets it win. And VirtueMart's OWN keyword search is the one that does not work: measured against a control term, `/component/search/?searchword=` filters (27771 vs 25401 chars) while every `com_virtuemart` and `com_finder` shape returns a byte-identical page. So `searchUrlsFor` gives VirtueMart a short Joomla probe, core search first. That shop went from unreadable to a real read. **Closed 2026-09-15: the pipeline follows product pages now** (`scraper/productFollow.ts`). mashtela's Joomla search lists product names and links and states no price, so every row the extractor proposed was dropped for want of one (`coercePlants` requires a price) and the funnel closed at `no_match` - the stage that means "we read the catalogue and the plant was not in it". The shop was hidden under a claim its own page could not support. The follow is keyed on the CONDITION, not on VirtueMart: any catalogue page that yields zero priced rows but links products whose text names the plant gets up to 5 of those pages opened and priced. Measured live: mashtela `no_match` -> `ok`, מונסטרה דליסיוסה at ₪49 with its product URL, and the adjudicator correctly dropped the מאנקי (Monstera adansonii). **The obvious trigger was wrong and the measurement caught it:** gating on "this page states no prices" never fired, because the page carries exactly one ₪ - the free-shipping banner. Banners, cart totals and phone numbers all read as prices; no count separates a priced catalogue from a priceless one, so link relevance is the gate instead. **It also needed its own deadline.** The follow spends inside the 45s per-site budget, and unbounded it took a live fan-out from 1 timeout to 3 while adding one priced shop - a bad trade, and invisible, because a timed-out site reports as unreadable rather than as "the rescue overran". Bounded at 10s: 0 timeouts, read rate 21/28 (75%) vs 21/29 (72%) baseline. Across that fan-out the follow fired on ZERO shops that did not need it - the 11 `no_match` pages link nothing naming the plant, so it costs one HTML parse and no fetches. **(3) The last unreadable host is yahalomr.co.il** (IIS, platform unknown, `/search?q=` is a 404, and it refuses our direct GET so `searchStatus` is undefined). Genuinely unreachable search; correctly reported now instead of silently counted as a read. **Bigger than all of it, and not a scraper problem:** a quarter to a half of discovered nurseries have no website in Places at all - `websiteUri` IS in the field mask, Google simply has no site for them. End to end the user gets an answer for roughly half the shops. **The share moves run to run and the old "43%" here was being quoted as if fixed:** measured 10/19 on 2026-09-13 with the shipper list, 5/15 on 2026-09-15 from Tel Aviv alone, and 10/38 on the same day's full fan-out. Quote the run, not the number. **The user-facing half of this is already handled and needs no work:** contact-only shops survive discovery, carry `nationalPhoneNumber`, get `availability.kind: 'no_website'` so the client never phrases it as a failed search, and render a call button - with WhatsApp preferred over `tel:`, because Israeli nurseries answer WhatsApp. Checked live 2026-09-15: 5 of 5 site-less Tel Aviv shops had a callable number. What is left is a product decision about whether to seek stock for them at all, not a scraper or UI gap. |
| ✅ | ~~Show "stock unknown" instead of dropping the row~~ | S | **Done 2026-09-05.** Auditor prompt now keeps a row whose product and price are supported but whose stock is unstated, as `availability: "unknown"`; it still drops unsupported/invented rows. Pipeline keeps `inStockKnown: false` for those (the flag means "exact listing" and the badge reads it as certainty), carries a `stock_unknown` availability, and the badge reads "Listed · stock not stated", tone `maybe`. Out-of-stock untouched - sold out is knowledge, not absence of it. The auditor half needs OpenAI credits to exercise live; the decision half is tested from injected verdicts. |
| - | **Scraper review: sixteen changes, 2026-09-15** | L | **Shipped on branch `scraper/perf-accuracy-16`. Offline metrics held at 100% throughout (`retrieval:score` 24/24 retrieval, 20/20 precision, 132/132 quiet; `price:score` 15/15 recall, 4/4 exact), suite 1027 -> 1108 tests green, typecheck clean.** Full write-up with the mechanism per change is in `docs/RETRIEVAL.md` ("the sixteen"). The four that matter most: **(1) The Store API ladder stopped on any row rather than a RANKED one.** Woo's `search` matches descriptions, so a shop answering "פיקוס" with a bag of compost ended the ladder before the rung that works - and went out as `catalogueRead: true`, i.e. "this shop does not stock it". Rungs now merge and stop on a ranked row. **(2) Identification ran BEFORE the free JSON probe.** A host we had never met paid a homepage read, a rendered Firecrawl homepage at a 4s wait, two endpoint reads and an LLM call to learn the word "woo" - which `probeApiRoute` establishes with two plain GETs and writes back. Every nursery Places finds for a new user is such a host, so this was the production path and the fixtures cannot see it. **Measured live on a cold host: al-haderech answered `api`/`platform=woo` in 3.8s with ZERO identification scrapes.** **(3) The page route paid three model calls for rows it had already parsed.** A server-rendered grid gives the card reader name+price+URL paired by the shop's own markup; those rows were handed to extract + verify + adjudicate anyway, with prices force-snapped back afterwards because the model's copy was not trusted. Now ranked like the JSON route: 0 calls when decisive, 1 when not, old path untouched when ranking finds nothing. **(4) A third retrieval route, `scraper/sitemapCatalogue.ts`**, for the six shops with no storefront JSON: when their own search is missing or broken, read the product list they publish at a standard URL, rank slugs in Hebrew or Latin, open the best few and price them from their own markup. Gated on the SEARCH having failed, never on it having found nothing, and it never sets `catalogueRead`, so it can only add a shop - never manufacture an absence. Needed a product-page reader (`parseProductPage`): the card reader pairs a price with a titled LINK and a product page does not link to itself, so BOTH rescues were landing on pages they could not read. Also: Hebrew queries are planned now (they were getting a one-rung ladder, no alternates, no Latin); Woo pages past 100 and reports a truncated shelf as not `complete`; the excerpt keeps split-currency prices, `/items/`, and a bare price's name (Phase 3 of `SCRAPE-ACCURACY-PLAN.md`, finally shipped); discovery asks two terms and keeps 15 shops instead of 10; the price sanity pass checks every priced row but only the ones a MODEL read; plans are cached per plant; the Shopify catalogue reads page 1 alone then 3 at a time; the fan-out gives stragglers a 10s grace once 70% have settled instead of the full 45s ceiling; `judgeAnswered` stopped refetching a page it was handed and caches the control read per shop; prompts lead with the source text so the audit pass can hit the prefix cache, and the two narrow classification calls run at `reasoning_effort: 'low'` (A/B'd against their own hard cases first: 10/10 and 5/5 at both efforts, faster at low). **Still open, and still the biggest number: `cache.enabled: false` in production.** Both cache layers are no-ops without `SUPABASE_SERVICE_ROLE_KEY`. The new `nursery_shop_results` table (migration `20260915020000`) is the one that will actually hit - the existing cache keys on term + point rounded to 100m + radius, which GPS jitter alone defeats, while a shop's shelf for a plant is the same answer for everyone. |
| E2 | Photo timeline per plant | M | Nearly free after PlantStore (5). |
| E3 | Shareable diagnosis card | M | Virality after retention. |
| E6 | Light meter | M | Novelty, unclear retention. **No Trello card** - not worth one until it is wanted. |
| - | Verify the common-name table actually uses common names | S | Trello #73. `server/commonNames.ts`, shipped PR #4, 80 entries (77 species keys + 3 genus). Written from the model's own knowledge in one pass and never checked against how people actually talk - which is precisely the failure it exists to prevent, so it should not be trusted on the strength of having been written confidently. |
| - | Audit the rest of the plant catalog for botanical accuracy | M | Trello #76. 359 hand-authored entries from PR #5. A spot-check of ~35 found five real errors (Satin Pothos filed under Epipremnum, Warneckii carrying the snake-plant binomial, one entry whose id and name were two different plants, `Alocasia lutea` asserted as a species, `Philodendron scandens` an outdated synonym). All five fixed - the card is about the arithmetic, not those five. |
| - | Move plant species catalog server-side | M | Trello #74. `src/data/plantCatalog.ts` is a hand-authored static file (~350 entries); behind an endpoint, entries could be added without an app release. The client already goes through `searchCatalog`/`getEntry`, so a network source can replace the file without touching the UI. Needs a catalog table + search endpoint, client cache, offline fallback to a bundled seed. |
| - | Manually verify the scraping flow in the app | S | Trello #60. Everything has been measured through the dashboard, `curl` and `funnel:tally`; the flow has not been checked inside the actual app since the fetch layer changed. Synthetic taps do not register in the RN view, so this one is Ron's. |
| E7 | Cache nursery results per plant | M | Nothing cached across jobs today. |
| E8 | Inventory index as dataset | L | Platform play, premature. |
| ✅ | ~~E11 Scrape freshness monitoring~~ | M | **Done 2026-09-05.** `server/scrapeHealth.ts` retains per-host `ExtractFunnel.stage` (plus timeout/error), which the pipeline computed and threw away. Draws the one distinction that matters: `no_match`/`rejected` mean we READ the catalogue and the plant was absent (normal), everything else means we never read it (our fault). Stale after 3 consecutive unreadable reads - one timeout is weather - cleared by a single good read. Wired as an optional `onSiteRead` observer on `PipelineDeps`, wrapped so a broken counter cannot fail a paid scrape. `/health` gets counts; per-host detail sits behind `?errors=1` + the secret. |
| ✅ | ~~Firecrawl weekly cron~~ | S | **Dropped 2026-09-15 (PR #44), and the code it would have run is deleted.** The row asked for `scripts/scrape-nurseries.ts` on a weekly GitHub Action, refreshing `assets/nurseries.json`. That file had no readers: the only mention of it anywhere in `src/`, `server/`, `scraper/` or `app.config.js` was the script that wrote it. Live discovery has been `discoverNurseries()` per search for some time, and stock comes from the per-search scrape plus the Supabase cache - a static bundled inventory would be stale the day it shipped and wrong in a way the user could not see. So the cron would have spent Firecrawl and OpenAI credits every week to update a dead file. Script and JSON deleted, `npm run nurseries:scrape` removed. **Left behind:** `extractAndVerifyPlants` in `scraper/core.ts` now has only test callers - the live pipeline uses its own extraction path. Harmless, but it is dead weight the next reader will trust. |
| ✅ | ~~CI/CD for the container~~ | M | **Done 2026-09-05.** `.github/workflows/ci.yml`: `npm ci` + both tsconfig projects + full suite, and a second job that builds the Dockerfile, runs the container and requires `/health` to answer. No secrets - the smoke test passes four obviously fake provider keys to clear the server's fail-fast guard, so a fork's PR runs it in full. Found and fixed on the way: `npm run typecheck` was red on main (plantRepo tests never typechecked), so CI could never have gone green. |
| ✅ | ~~`jest-expo` + RN testing library~~ | L | **Done 2026-09-07 (PR #26).** Added for the half `node --test` cannot reach - anything that has to render. The two stacks stay separate on purpose: `node --test` keeps the pure logic fast and dependency-free, and jest-expo carries only what needs a renderer. |
| - | Streaming partial nursery results | M | - |
| - | Per-device quota / App Attest | M/L | Real protection vs a bundled secret. |
| - | Home: Dynamic Type survival | S | **Found 2026-09-15 by `/plan-design-review`, deliberately NOT fixed blind.** The hero title carries a hardcoded newline in both languages (`'Keep your plants\nthriving today.'`, and `he.ts:629`), and `grep -rn "fontScale\|maxFontSizeMultiplier" src/` returns nothing - the app has no Dynamic Type handling at all. At large text sizes the forced break plus scaling is the overflow case. **Why it was left:** the obvious fix, capping with `maxFontSizeMultiplier`, trades layout for legibility and can itself be an a11y regression for the low-vision users the feature exists for. Which fix is right depends on what actually breaks on hardware. **Repro:** Settings > Accessibility > Display & Text Size > Larger Text, push to maximum, open Home in both English and Hebrew. |
| - | Home: bell dot and strip count are one boolean twice | XS | **Surfaced 2026-09-15 by `/plan-design-review`, recorded rather than changed.** Both render `behind > 0`, about 600px apart. The counter-reading is that they serve different scan depths - the dot answers "is anything wrong" without scrolling, the count answers "how much" once you look - which is two jobs, not one repeated. Not clearly a defect, so changing it now would be guessing. Recorded so the next person to touch Home sees the question framed instead of adding a THIRD indicator for the same boolean. |
| - | **Write a DESIGN.md** | M | **The highest-leverage item from `/plan-design-review` 2026-09-15, and the only one that prevents recurrence rather than fixing an instance.** Pass 5 scored 6/10 - not because the system is weak but because it is undocumented. `src/theme/index.ts` is disciplined and reasoned (one family, four weights, named colour roles with contrast noted inline, `t.space`/`t.radius` scales, light + dark), and Home uses it with zero hardcoded hex. What is missing is the written artifact a review can calibrate against. **The cost of not having one is already measured:** the "do not touch Home" rule spent eight months protecting `#F0FDF4` and Lora/Raleway after the app shipped Inter and warm cream, and nobody noticed until this review. `/design-consultation` does most of the work; the rest is component vocabulary and copy standards, which the theme file cannot carry. |
| - | Home screen redesign | M | Scope undefined - what's changing and why. Conflicts with existing "do not touch Home" design-review rule; needs a design pass before code. **No Trello card** - deliberately, until the scope exists. |
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
  Last reconciled 2026-09-15 (PR #44) and redeployed - the page had drifted on three points from
  one day's work, which is how fast this goes stale when the trigger is not honoured.

- **Trello mirrors this file, and it is the file that is authoritative.** Board:
  https://trello.com/b/W6Kyf2ot/plantai - lists Done / In Progress / Backlog, labels by area
  (green shipped, yellow hygiene, orange scraper, blue infra, purple design, sky docs, red P0).
  Last reconciled 2026-09-15: 15 shipped PRs from 2026-09-07 onward had no card at all, four
  cards sat in In Progress that had shipped on 2026-09-07, and two Done cards still carried the
  "Backlog / Not started" label. Reconcile when a PR merges, not in batches - the drift above is
  eight days' worth.

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
| Structured prices | 2026-09-07, PR #30. Prices read from the page's own JSON-LD, microdata, meta tags and product cards instead of a model re-reading the markdown. The shop's DOM has already paired each name with its price, so asking a model to redo that pairing could only introduce error - and the input shrinks hugely (azurflowers: 589KB of markdown, 577 products, down to ~30KB of lines that get truncated far less). |
| QueryPlan | 2026-09-07, PR #31. Each shop is asked a question its own search can answer: a ladder of terms narrow to broad, plus the tokens used to rank whatever comes back. De-duplicated, because a one-word plant collapses every rung into the same string - all the cost of the ladder, none of the benefit. |
| Relevance bar on HTML | 2026-09-07, PR #32. Ranking guarded the structured/API route but not the HTML one, so the model picked unguarded there: a search for "Alocasia Regal Shield" came back from dizi-garden as "אלוקסיה וונטי" at ₪60, a different plant with no way for the user to tell. Both routes now meet the same bar. |
| Cloud-photo diagnosis | 2026-09-07, PR #29. A plant saved under an account keeps its photo in a private bucket, and re-diagnosing it read a local path that was no longer there. |
| Photo cache | 2026-09-07, PR #34. Photos survive a restart rather than being re-fetched and re-signed every launch; the due-this-week list expands instead of silently truncating. |
| Match by asking | 2026-09-08, PR #36. A hard score cut was reporting shops as not stocking plants they had on the shelf ("מונסטרה בכלי קרמיקה" for Monstera deliciosa, dropped at 0.10). What separates a real answer from a wrong cultivar is a judgement about words, so it is asked of a model. Rows ranking is already sure about stay free; only the middle band costs a call. |
| Shippers + contact-only | 2026-09-11, PR #37. National shippers read from disk, and nurseries Places has no website for are kept as contact-only rows rather than dropped - a real nursery with a phone number a kilometre away beats an unreachable one with a webshop. |
| Hebrew, second pass | 2026-09-11, PR #38. Copy and layout so the app reads as written in Hebrew rather than as English flipped right-to-left. |
| Leaf tracking | 2026-09-11, PR #39. A leaf tracked from first sight to unfurled. Deliberately independent of the watering schedule - tracking a leaf touches neither the schedule nor its reminder - and a damaged entry is hidden on read rather than written back over. |
| src/ by feature | 2026-09-11, PR #40. Dead code deleted and `src/` grouped by feature rather than by file type. |
| Explainer site | 2026-09-13, PR #41. `docs/api-site/index.html` rewritten as a tabbed, panelled dashboard. Live at https://plantai-api-docs.vercel.app |
| Honest claims | 2026-09-13, PR #42. `noteSite` ignored `answered === false` and carried a `!readable(stage)` guard, so a shop that 404s or serves its homepage to every query parsed into `no_match` - which counts as a SUCCESSFUL read. The guard let through exactly the cases it existed to catch. The rate read 96% before the fix; that number was false. Honest: 85% → 92%. |
| Real radius | 2026-09-13, PR #43. `locationBias` only weights ranking, so the radius bounded nothing - from Mitzpe Ramon at 10km, Places returned 18 nurseries, the farthest 174.6km away. Now `locationRestriction.rectangle` plus an exact haversine cut: 0 outside at every radius tested, and it finds MORE, because far results no longer spend slots out of a 20-result page. |
| API site truth | 2026-09-15, PR #44. The stack page documented neither the `radius` param, nor the inline `results` a finished search returns, nor the restrict-then-cut discovery. Also dropped the Firecrawl weekly cron and deleted the dead script and JSON behind it. |
| Product-page follow | 2026-09-15, PR #45. A catalogue that lists products without prices was indistinguishable from a shop that does not stock the plant, so the shop was hidden under a claim its own page could not support. Up to 5 product pages are opened and priced when the page links products naming the plant. mashtela: `no_match` → `ok`, ₪49. Gated on link relevance, not on a price count - the one ₪ on that page is the free-shipping banner. Bounded at 10s, because unbounded it took a fan-out from 1 timeout to 3. |

## HOME DESIGN REVIEW - 2026-09-15

`/plan-design-review`, target: the app's Home screen. Overall 7/10 -> 9/10.
Four findings fixed in-session, three recorded as backlog rows above.

### What already exists (reuse, do not reinvent)

- `src/theme/index.ts` - Inter in four weights, named colour roles with contrast
  stated inline (`textSecondary // >=4.5:1 on background`, `textMuted // metadata
  only, never body copy`), `t.space` / `t.radius` scales, light + dark. Home uses
  it with **zero hardcoded hex**.
- `src/lib/home.ts` - every Home rule lives here under `node --test`, not in JSX.
  `HOME_TASK_CAP = 2`, `STRIP_FACES = 3`, three greeting buckets, all with their
  reasoning written down.
- `PortfolioScreen`'s `warnCard` + `copy.portfolio.warnUnreadable*` / `warnFuture*` -
  reused verbatim by the fix below rather than inventing a second warning shape.
- `PortfolioScreen`'s `AccessibilityInfo.isReduceMotionEnabled()` pattern, copied
  to Home.
- `src/lib/i18n/rtl.ts` (`directionalIconStyle`, `iconRow`) - already applied
  throughout Home.

### NOT in scope (considered, explicitly deferred)

- **Cloud-sync indicator on Home** - Home is synchronous by design so a returning
  user never sees a flash of marketing content, and the local store is a mirror
  cloud-first writes keep correct. Chrome reporting a state the user cannot act on
  fails subtraction-default.
- **Branded placeholder on every image app-wide** - would fix Portfolio and
  PlantDetail too, but reaches well outside this review and into protected screens.
- **Brand mark on Home's first screen** - litmus check 1 fails, and that check is
  written for landing pages where a visitor may not know whose site they are on.
  Someone opening an installed app does. The greeting uses their name and the hero
  uses their photograph, which is stronger ownership than a wordmark.
- **A Home redesign** - the mockups generated for this review are a reference, not
  a mandate. The do-not-touch rule stands, restated below against real tokens.

### Fixed in-session

1. 🔴 **Home reported a damaged library as an empty garden.** `loadLocal()` returns
   `{ ok, plants }` and every failure path in `plantStore.ts` returns `plants: []`,
   so a corrupt blob and a new user were identical at the `.plants` level. Home read
   `.plants` alone and ran its new-user script in three places: "Start your garden
   with one photo.", "No plants yet.", and - worst - a green tick reading "Nothing
   due this week. Your plants are set." Portfolio has refused this conflation for
   months ("a damaged library must never be reported as an empty one - 'you have no
   plants' is indistinguishable from a deletion the user never performed"); Home is
   the FIRST screen and said it three times. New `gardenState()` in `src/lib/home.ts`,
   12 tests, 6 of which fail if the bug is reintroduced.
2. 🟠 **A broken photo defeated the guard against grey boxes.** `stripFaces` skips a
   plant with no `photoUri` and says why, but tested truthiness - an expired signed
   URL is a truthy string, so it drew exactly the empty square the filter exists to
   prevent. Now takes a `failed` set fed by `onError`. Overflow still counts the
   library, not the drawable part of it.
3. 🟡 **Reduce Motion ignored on Home.** Portfolio honours it; Home re-rolls its hero
   on every focus and crossfaded regardless, on the first screen, every launch.
4. 🟡 **Sub-44pt touch targets.** The two "See all" links were 14pt text with 8pt of
   slop = 36pt. The bell beside them was always a 44x44 circle.

### Mockups

| Screen | Path | Direction | Notes |
|---|---|---|---|
| Home | `~/.gstack/projects/rondahan04-PlantAI/designs/home-screen-20260915/variant-{A,B,C}.png` | Current structure re-rendered | Reference only. **All three drifted toward template in two ways the shipped code already avoids:** colour-washed glyph tiles (shipped uses neutral `surfaceMuted` with only the icon tinted - blacklist #3), and invented hero copy "Healthy plants, happy home." (blacklist #9, generic mood statement; shipped says "Keep your plants thriving today.", which is about the user's job). Do not copy either. |

---

## REVIEWS

| Run | Skill | Date | Result |
|-----|-------|------|--------|
| 1 | `/plan-ceo-review` | 2026-08-11 | clean - M1/M2/M3 scope |
| 2 | `/plan-eng-review` | 2026-08-11 | clean - 11 issues, D3-D9 |
| 3 | `/plan-design-review` | 2026-08-15..16 | 9 findings; F1-F6 closed, F7→7, F8→8, F9→11 |

Run 3 was screenshot-based (iPhone 17 Pro, iOS 26.1, `main` @ `cc0e5a2`); mockup generation
failed on `OpenAI organization verification required`. Board:
`~/.gstack/projects/rondahan04-PlantAI/designs/myplants-b14-20260815/design-board.html`

**Do not touch:** Home, Camera, Diagnosis layout. The nursery loading copy is the writing
standard for the rest of the app.

Restated 2026-09-15 (`/plan-design-review`), because the rule had gone stale and a stale rule
is one people learn to ignore. It protected `#F0FDF4` and Lora/Raleway; the app shipped **Inter**
in PR #19 and the background token has been `#F7F1E7` warm cream since the editorial redesign.
What the rule actually protects, in today's terms:

- **Type:** Inter only, four weights, from `t.type` - display/title/heading/body/label/caption.
  Display is separated from body by size and weight, never by a second typeface.
- **Colour:** `t.color` tokens only. Warm cream ground, deep green primary, one accent. No
  hardcoded hex on these three screens - Home currently has zero.
- **Rhythm:** the `t.space` scale. The 44pt touch floor is a hard minimum (the Home bell is a
  44x44 circle; text links buy it with hitSlop).
- **Home's budget:** two task cards (`HOME_TASK_CAP`), three strip faces (`STRIP_FACES`), one
  primary action. A third task card pushes the plant strip off the first screen, which is the
  whole reason the cap exists.

The rule is about CHURN, not about freezing bugs: a correctness fix that keeps the layout is
always in scope - see the damaged-library fix landed the same day.
