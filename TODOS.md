# PlantAI - TODOs

> Thesis: diagnosis acquire, marketplace transact, **only plant library retain.**
> CEO plan: `~/.gstack/projects/rondahan04-PlantAI/ceo-plans/2026-08-11-retention-spine.md`
> **M1 shipped 2026-08-18** - https://plantai-api-eev0.onrender.com. Diagnosis and nursery
> scrape both verified live against it. 92 tests green.

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
13. **[M2] E1. Plant.id v3 disease classification, server-side.** `EXPO_PUBLIC_PLANTID_API_KEY`
    sits unused. Shape in learning `plantid-v3-response-shape`. Map: `is_healthy` → healthy;
    disease prob <0.3 mild, <0.6 moderate, <0.85 severe, ≥0.85 critical.
14. **[M3] E5. WhatsApp `wa.me` + `tel:` handoff.** `phone` is already scraped; `onOrder` only
    opens a site. This is the transact half of the thesis and the cheapest conversion win here -
    Israeli nurseries answer WhatsApp, not web forms.
15. **[M3] E4. Hebrew / RTL - layout half done 2026-08-19, copy still missing.**
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
    - ❌ **Still open: the actual Hebrew copy.** No i18n module, no translated strings - the
      UI stays English in an RTL layout. That is the rest of E4.
16. **[ops] O2/O3/O4 observability.** Partly done: `/health?errors=1` returns a bounded ring of
    recent failures to a caller holding the shared secret (added 2026-08-18 - a deployed instance
    failing on a provider call was otherwise opaque without the host's log viewer, and that is
    what turned the r68 mystery into a two-minute diagnosis). Still open: JSON logs + request id
    (`server/index.ts:96,99,103`);
    `/health` reports last-successful-scrape per provider; one-page runbook. ⚠️ Also fix the
    `jobs` field while in there - `jobs: jobs.size()` (`server/index.ts:192`) counts *stored*
    jobs, including finished ones retained for polling, so it never returns to 0 on a healthy
    server and reads as "something is stuck" during an incident. Split into `{active, retained}`.
17. **[M3] H6. Accessibility.** `accessibilityLabel` on the star rating (`NurseriesScreen.tsx:27`),
    ≥44pt rows.
18. **[M3] Cleanups.** **H1** lift `env()` into `scraper/core.ts` (`dashboard/server.ts:50` and
    `scripts/scrape-nurseries.ts:20` still redeclare `EXPO_PUBLIC_TAVILY_API_KEY`). **H2** rename
    `nurseries_scraping_testing` → `nurseries-fallback.txt` (production config, read at
    `server/index.ts:100`). **H5** route table in `server/index.ts`.
19. **[ops] Tavily student plan.** Swap the key value, no code change.

---

## BACKLOG (unordered)

| # | Item | Size | Note |
|---|------|------|------|
| P2 | In-app live nursery discovery | M | GPS → `scraper/places.ts` `discoverNurseries()` server-side. The real product goal. Gated on scrape speed. |
| - | Scrape speed | M | Quality problem now, not correctness. Parallel fan-out, cheaper model, precomputed index. Best observed 47s (2026-08-17, 7 nurseries); worst seen 480s. |
| - | Show "stock unknown" instead of dropping the row | S | The auditor rejects extractor rows whose page never states stock - e.g. `[decogarden.co.il] verification REJECTED (conf 92): the source text does not explicitly state stock status`. Correct call by the verifier, but the user loses a nursery that does stock the plant. Product decision: surface as `unknown` rather than drop. |
| E2 | Photo timeline per plant | M | Nearly free after PlantStore (5). |
| E3 | Shareable diagnosis card | M | Virality after retention. |
| E6 | Light meter | M | Novelty, unclear retention. |
| E7 | Cache nursery results per plant | M | Nothing cached across jobs today. |
| E8 | Inventory index as dataset | L | Platform play, premature. |
| E11 | Scrape freshness monitoring | M | Live silent-failure gap. **Promote the day PlantStore (5) lands.** |
| - | Firecrawl weekly cron | S | `scripts/scrape-nurseries.ts` as a GitHub Action. |
| - | CI/CD for the container | M | No `.github/workflows/`; deploys are manual builds from the laptop. |
| - | `jest-expo` + RN testing library | L | 17 untested flows, second test stack. After M2. |
| - | Streaming partial nursery results | M | - |
| - | Per-device quota / App Attest | M/L | Real protection vs a bundled secret. |
| - | Home screen redesign | M | Scope undefined - what's changing and why. Conflicts with existing "do not touch Home" design-review rule; needs a design pass before code. |
| - | Settings tab | M | New nav surface. Scope undefined - what lives there (notifications, language, account, data export?). |

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
