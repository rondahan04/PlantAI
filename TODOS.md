# PlantAI — TODOs

> **CEO plan (2026-08-11):** `~/.gstack/projects/rondahan04-PlantAI/ceo-plans/2026-08-11-retention-spine.md`
> Mode: SELECTIVE EXPANSION. Thesis: diagnosis acquires, the marketplace transacts,
> **only a plant library retains.** Host the backend first (nobody can use the app
> today), then give the app memory.

---

## 🔴 P0 — Do these before anything else

- [x] **Fund the OpenAI account** — resolved 2026-08-16, verified live.
  On 2026-08-15 every diagnosis returned `429 "You have no credits remaining"`. A real
  photo now returns a real diagnosis on device. Does not affect the rotation item
  below, which stands on its own.

- [ ] **Rotate `EXPO_PUBLIC_OPENAI_API_KEY`.**
  **Why:** the key is compiled into the app bundle (`src/screens/CameraScreen.tsx:25`)
  and has already been distributed in the submitted assignment zip and any shared
  Expo Go build. Anyone holding either can extract and spend it.
  **How:** generate a new key, revoke the old one, update `.env`. Shared builds will
  stop working — that is correct, they were leaking.
  **Effort:** minutes. **Depends on:** nothing. Do it today.

- [ ] **Restrict `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` to the app bundle ID.**
  **Why:** ships via `app.config.js:9` (normal for the Maps SDK), but unrestricted it
  is free quota for whoever extracts it.
  **How:** Google Cloud console → Credentials → Application restrictions → iOS/Android
  bundle ID. **Effort:** S.

---

## Active: Retention Spine (A+B) — accepted scope, 2026-08-11

Reviewed by `/plan-ceo-review` and `/plan-eng-review` on 2026-08-11.
**Three milestones, each independently shippable.** Finish one before starting the next.

| Milestone | Contents | Done means |
|-----------|----------|------------|
| **M1** | P0 + A1-A4, T28, T30 | Someone other than Ron can use the app; no keys leaked; bill is bounded |
| **M2** | B1.1-B1.4, T23, T24, T26, E10 | Plants persist across launches; both data-loss gaps closed and tested |
| **M3** | E1, E9, E4, E5, hygiene, observability | The polish pass |

### A — Ship the loop (nothing below matters until this lands) — M1

- [ ] **A1. Gate `/api/nurseries` before it goes public.** ← ships *with* the deploy, not after
  **Why:** the endpoint has no auth, no rate limit, and `Access-Control-Allow-Origin: *`
  (`server/index.ts:73`). Every call spends money: 1 Places Enterprise search + N
  Firecrawl scrapes + N OpenAI passes. Public + unbounded = an open faucet.
  **How:** shared-secret header the app sends; per-IP rate limit; hard daily request
  cap returning 503 past the ceiling. **Decision D3 (CEO) → option A.**
  ⚠️ **The shared secret is a speed bump, not authentication** (eng review D3). It has
  to reach the app via `EXPO_PUBLIC_*`, which is the exact mechanism that leaked the
  OpenAI key — anyone with the bundle can extract it. **The hard daily cap is what
  actually bounds your bill.** Write that down in the code comment so a future you
  doesn't build something on top of this assuming the endpoint is authenticated.
  **Deploy order:** ship the gate in **log-only mode** first, let A4's `eas update`
  propagate, *then* flip to enforcing. Enforcing first locks you out of your own API.
  **Effort:** S (human ~3h / CC ~25m). **Blocks:** A2.

- [ ] **A2. `Dockerfile` + deploy the backend.**
  **Why:** `EXPO_PUBLIC_API_BASE_URL` is a LAN IP — the app only works on Ron's Mac.
  This gates every other item having a user.
  🔴 **Hard requirement, verify before writing the Dockerfile:** the host must allow
  request durations **over 90s**. `src/services/nurseryService.ts:13` sets
  `TIMEOUT_MS = 90000`, but Fly / Railway / Render / Cloud Run default to a 30-60s cap
  and return a generic 502. Result: the user waits 30s, gets a failure, and a scrape
  that was nearly done is discarded. Fly.io and Cloud Run both allow longer timeouts
  if you configure them explicitly. **Eng review D9 → option A.**
  🔴 **Design review measured this and 90s is not enough either** (F1, 2026-08-15):
  a real request logged `✔ 12 nurseries in 480187ms` — **eight minutes**. The client
  aborted at 90s and showed a failure screen; the scrape then succeeded 5.5 minutes
  later into nothing. There is no host timeout setting that rescues this. **E12's
  async-job rewrite is a prerequisite for the nursery feature working at all, not a
  later optimization.**
  🔴 **Also (F6):** `.env:8` is `http://10.0.0.10:4000` while the dev machine is on
  `10.0.0.6`. The app already breaks on your own Mac every time DHCP moves the IP,
  and the UI reports it as "Couldn't reach the nursery service" — indistinguishable
  from a real outage. Deploying fixes this permanently; until then it will keep
  costing you 90 seconds per debugging session.
  **Effort:** S. **Depends on:** A1.

- [ ] **A3. `POST /api/diagnose` — move PlantNet + OpenAI server-side.**
  **Why:** removes all AI keys from the app bundle (closes the root cause of the P0 above).
  **How:** mirror the `PipelineDeps` pattern from `scraper/pipeline.ts` —
  `DiagnosisDeps { identify, classifyDisease, assessPhoto }` so provider swaps are
  one-line.
  ✅ **D6 already landed client-side in `b09a3d7`** (with A5): the unguarded
  `JSON.parse(data.choices[0].message.content)` is now shape-validated via
  `isHealthAssessment()`, and `DiagnosisServiceError` / `DiagnosisUnavailableError`
  give named, logged failures. **Port these to the server rather than rewriting them** —
  the validator and error types move as-is.
  **Note:** this makes the server a single point of failure for diagnosis, which
  currently works client-side whenever the phone has internet. Accepted trade — see A5.
  **Effort:** M. **Depends on:** A2.

- [ ] **A4. Repoint `EXPO_PUBLIC_API_BASE_URL` + `eas update`.**
  **Why:** distribution. Absorbs the old "EAS Expo Go publish" item below.
  **Note:** existing Expo Go builds point at the LAN IP and will break. Expected.
  **Effort:** S. **Depends on:** A2, A3.

- [x] **A5. Delete `getMockDiagnosis` from the production bundle.** — done `b09a3d7`, 2026-08-16.
  Shipped ahead of A3, which F3 proved was safe. Also landed: named error types
  (`DiagnosisUnavailableError`, `DiagnosisServiceError`) so provider text never reaches
  the UI, a real retry that re-runs the same photo, and the D6 response-shape guard
  (`isHealthAssessment`) since deleting the fallback exposed it. Verified on device.
  **Why it mattered:** the mock returned a hardcoded Monstera root-rot diagnosis wired
  as a `CameraScreen` fallback. F2 confirmed on screen that it rendered at **"87%
  confidence"** with an urgent three-step treatment plan and zero visual difference
  from a real result — fabricated medical advice about a real person's plant.
  **Eng review D5 → option A.** Supersedes the old H4.
  **Follow-up left open:** the honest failure state is currently an `Alert` with a
  retry action, not an in-screen state. Upgrading it is E9's job, not A5's.

### B1 — Plant library + history (the retention hook) — M2

- [ ] **B1.1. `PlantStore` module — `expo-sqlite/kv-store`, versioned blob, DI seam.**
  **Why:** the app has zero persistence. Every session starts from scratch. The 2026
  plant-app category retains entirely on saved care history — it is the one moat
  PlantAI has never built.
  **Shape:** `{ version: 1, plants: [...] }`. **Version the blob from day one** —
  retrofitting a version field after user data exists is the expensive mistake.
  **Package** (eng review D4): `import Storage from 'expo-sqlite/kv-store'`. Expo 56
  names this the drop-in replacement for `@react-native-async-storage/async-storage`
  — same API **plus `getItemSync`/`setItemSync`**, which lets MyPlants render on the
  first frame instead of flashing a loading state every launch. Neither package is
  currently installed, so this costs the same one dependency either way, and it leaves
  real SQL available for E2 with no further deps. *(The blob-over-relational call from
  CEO D4 stands; this changes only which package provides it.)*
  **DI seam** (eng review D8): takes `StorageDeps { getItem, setItem, removeItem }`,
  mirroring `PipelineDeps` in `scraper/pipeline.ts`. Production passes the native
  module; tests pass an in-memory `Map` that can be told to throw `QuotaExceededError`
  or return truncated JSON. Without this seam the layer is untestable under
  `node --test`, because `expo-sqlite/kv-store` is native.
  **Two CRITICAL gaps this must close:**
  - quota-exceeded on save → user sees a success checkmark, plant is gone. Confirm
    writes by reading back; on failure show "Couldn't save — storage full" + retry.
  - corrupt JSON on load → **the whole library reads as empty.** Quarantine the bad
    blob to a `.corrupt` key instead of discarding; never render "you have no plants"
    because of a parse error.
  **Effort:** M (human ~1d / CC ~45m). **Depends on:** nothing (parallel with A).

- [ ] **B1.1b. `migrate()` chain + forward-compat quarantine.**
  **Why:** the version field is decided but the mismatch behavior was undefined. This
  data lives on phones you don't control, and a user can skip three app versions.
  **How:** `migrate(blob)` runs on every load and chains v1→v2→v3 as versions appear.
  A version **newer** than the app quarantines rather than reads, so a downgraded app
  never mangles newer data. Ships as a no-op today, with a test proving the chain runs.
  **Eng review D7 → option A.** **Effort:** S. **With:** B1.1.

- [ ] **B1.2. Photo persistence — copy into the app documents dir on save.**
  **Why:** camera output is a cache URI; iOS purges it unpredictably. Library full of
  broken images, weeks later, invisible in testing. **CEO review D5 → option A.**
  **Expo 56 API** — the functional API is deprecated, and `54e65ed` already moved this
  project to the new one:
  ```ts
  import { File, Paths } from 'expo-file-system';
  const source = new File(Paths.cache, 'temp-photo.jpg');
  const destination = new File(Paths.document, `plant-${id}.jpg`);
  await source.copy(destination);
  ```
  Not `FileSystem.copyAsync` / `FileSystem.documentDirectory`.
  **Do also:** downscale on save — 50 full-res photos will blow memory on an older
  device. **Effort:** S. **Depends on:** B1.1.

- [ ] **B1.3. "Save this plant" on `DiagnosisScreen`.**
  **Edge cases that must be handled** (Section 4): double-tap → two copies (disable on
  press); app killed mid-save (persist *before* navigating, not after); same plant
  saved twice (decide merge vs duplicate — currently undecided).
  🔴 **Placement is undecided and the screen is already full** (F7, 2026-08-15).
  The bottom of `DiagnosisScreen` today carries a delivery/pickup segmented toggle,
  a filled green "Find Delivery Options" primary, and a "Scan Another Plant"
  secondary — with two red URGENT treatment badges directly above competing for the
  same attention. Adding Save makes four actions in one viewport.
  **Decide before building:** is Save the new primary (it is the retention action),
  or does it move to the header as an icon so the commerce CTA keeps the accent?
  Screenshot for reference: `~/.gstack/projects/rondahan04-PlantAI/designs/myplants-b14-20260815/`
  **Effort:** S. **Depends on:** B1.1, B1.2.

- [ ] **B1.4. MyPlants + PlantDetail screens.**
  **Note:** `FlatList`, not `.map()`. Empty state is a feature, not an afterthought.
  **Open design question:** adding My Plants to Home conflicts with Home's current
  single-job clarity ("Is your plant in trouble?" → one button). For a returning user
  with saved plants, My Plants probably *is* the primary content and Diagnose becomes
  secondary — meaning first-run Home and returning Home should differ. Real design
  decision. **Run `/plan-design-review` before building this.**
  ✅ **Design review ran 2026-08-15 and confirmed the conflict is real** (F8): the
  live Home screenshot is entirely first-run content — hero question plus a numbered
  "How it works" explainer a returning user has already read. **The decision itself
  was deliberately deferred**: Ron scoped the review to documenting the current build
  only, since B1.4 is WIP and the screens do not exist yet. Three options were drawn
  and are recoverable from the session: (H1) a My Plants row below the CTA, one new
  stack route; (H2) adaptive Home — hero on first run, library once plants exist;
  (H3) a tab bar. **Re-run this decision when B1.1 lands and there is a real library
  to navigate to.**
  **Effort:** M. **Depends on:** B1.1.

### B2 — Care schedule + reminders (ships after B1)

- [ ] **B2.1. Species-derived care schedule + `expo-notifications`.**
  **Why:** completes the loop — the app tells you to open it instead of waiting to be
  remembered. This is what turns a tool into a habit.
  **Needs:** config plugin + a dev build (not Expo Go). Put the permission prompt
  behind a feature flag — permission prompts are a one-shot resource; ask at the wrong
  moment and you never get another chance.
  **Gaps to close:** permission denied → reminders silently never fire (explain +
  deep-link to settings); notification fires for a deleted plant (cancel on delete).
  **Effort:** L (human ~1w / CC ~2h). **Depends on:** B1.

### Accepted cherry-picks

- [ ] **E1. Restore Plant.id v3 disease classification (server-side).**
  **Why:** `EXPO_PUBLIC_PLANTID_API_KEY` sits unused in `.env` while diagnosis runs on
  PlantNet (species only) + a GPT-5.5 vision guess. Commit `975411e` traded a real
  disease classifier for an eyeball assessment — a regression that was never named.
  **How:** learning `plantid-v3-response-shape` has the exact shape —
  `result.is_plant.binary`, `result.classification.suggestions`, `result.is_healthy`,
  `result.disease.suggestions`. Condition mapping already worked out: `is_healthy` →
  healthy; disease prob <0.3 mild, <0.6 moderate, <0.85 severe, ≥0.85 critical.
  **Build this before E9** — it supplies the probabilities E9 displays.
  **Effort:** S. **Depends on:** A3.

- [ ] **E9. Confidence honesty + real empty/error states.**
  **Why:** a confidently wrong diagnosis is worse than no diagnosis — it is the moment
  a user stops trusting the app, and trust is the whole premise of letting it manage
  their plants. Currently low PlantNet confidence renders identically to high.
  **Also covers:** the new "backend is down" failure state introduced by A3.
  🔴 **Scope widened by the design review** (F4, F5, 2026-08-15). The app currently
  speaks **three different error languages in one session**:
  1. `NurseriesScreen` — a designed in-screen state: cloud icon, plain headline,
     retry button. Right shape, but line two is the raw exception
     `fetch failed: The request timed out.`
  2. `CameraScreen.tsx:52` — a native OS `Alert` dumping unparsed provider JSON,
     truncated mid-URL at 120 chars. Tells the user about credits on your API account.
  3. `CameraScreen.tsx:50` — a third register, hand-written friendly copy for
     `NotAPlantError`.
  A user who hits two of these in a row concludes the app is unreliable, which is the
  exact trust cost this item exists to prevent. **E9 must cover error language and
  placement app-wide, not only diagnosis confidence.** The standard to write to
  already exists in the app: the nursery loading copy ("Discovering shops within 10km
  and checking live stock for Monstera deliciosa. This can take 30–60 seconds.").
  🔴 **Now has a reproducible test case, not a hypothesis** (F9, 2026-08-16). First
  real diagnosis after A5 landed: a photo of a **Monstera deliciosa** came back as
  **"Mini monstera"** (Rhaphidophora tetrasperma — a different plant) at **48%
  confidence**, rendered in the same 32px Lora title and the same orange bar as the
  87% mock. Nothing on screen says "we are not sure." The user then gets a treatment
  plan for the wrong species, and nursery results for the wrong species.
  **Repro:** `photos_for_testing/sickmonstera.jpeg` → Gallery → diagnose.
  **This now gates B1.4** — a library of confidently mislabelled plants is worse than
  no library, because the mislabel persists and compounds.
  **Effort:** S → M. **Depends on:** E1.

- [ ] **E4. Hebrew / RTL localization.**
  **Why:** Israeli users, Israeli nurseries, Hebrew scraped data, English-only UI.
  RTL groundwork already shipped in `143e98d` — the copy is what's missing.
  **Note:** RTL means mirror-testing the whole layout, not just translating strings.
  **Effort:** M.

- [ ] **E5. WhatsApp + call handoff to the nursery.**
  **Why:** `phone` is already scraped and `onOrder` currently just opens a website,
  which is where intent goes to die. Israel runs on WhatsApp.
  **How:** `wa.me` deep link with a pre-filled message naming the plant, plus `tel:`.
  **Effort:** S.

- [ ] **E10. Tests — storage layer first. — M2**
  🔴 **Prerequisite, one line, do it first:** `package.json` runs
  `node --test scraper/*.test.ts`. **That glob cannot see `src/`.** Every test you
  write for the app would be silently skipped while `npm test` still reports green.
  Widen it to cover `src/` and `server/` before writing a single test.
  **Why:** zero app-side coverage today (codegraph: "no covering tests found").
  Storage is the one layer where a silent bug destroys user data rather than annoying
  someone, and a user who loses their plant history does not come back. `scraper/`
  already has real tests (`core.test.ts`, `places.test.ts`, `pipeline.test.ts`) —
  that's the bar, and it's the same runner.
  **Enabled by B1.1's `StorageDeps` seam** — no new test dependencies needed.
  **The 2am-Friday test:** save 50 plants, force-quit mid-write, relaunch, assert all
  50 readable. **The hostile-QA test:** hand-write truncated JSON into the storage key,
  relaunch, assert a recoverable error rather than an empty library.
  **Full case list:** `~/.gstack/projects/rondahan04-PlantAI/rondahan-main-eng-review-test-plan-20260811-172500.md`
  **Eng review D8 → option A.** **Effort:** M. **Depends on:** B1.1.

### Code hygiene surfaced by the review

- [ ] **H1. Unify env-var reading.** `dashboard/server.ts:50` and
  `scripts/scrape-nurseries.ts:20` each redeclare `EXPO_PUBLIC_TAVILY_API_KEY`
  directly, while `server/index.ts:28` uses a prefix-stripping `env()` helper. Three
  call sites, two conventions — **this inconsistency is why the Plant.id key sat
  unnoticed for two months.** Lift `env()` into `scraper/core.ts`. **Effort:** S.
- [ ] **H2. Rename `nurseries_scraping_testing`** → `nurseries-fallback.txt`. The name
  says "testing"; it is load-bearing production config read at `server/index.ts:62`.
- [ ] **H3. Stop returning raw `err.message` to clients** (`server/index.ts:105`).
  Provider errors sometimes echo the request including auth headers. Generic message
  out, detail to the log. **Effort:** S.
  🔴 **The same leak exists client-side** (F4): `plantDiagnosis.ts:129` and `:48`
  interpolate `errText.slice(0, 120)` straight into the message the user sees. Fix
  both call sites in one pass — named error types out, provider detail to the log.
- [x] **H4. `getMockDiagnosis`** — decided: delete from the production bundle. Now
  tracked as **A5** in M1, since it's coupled to A3 rather than a standalone cleanup.
- [ ] **H5. Route table in `server/index.ts`.** Hand-rolled `if` chains are fine at two
  endpoints, a smell at four. Not worth a framework. **Depends on:** A3.
- [ ] **H7. Evict the nursery cache `Map` by size, not only TTL.**
  `src/services/nurseryService.ts:99` expires entries on read but never removes them
  proactively, so a long session with many distinct searches grows it unbounded.
  Small, but real. **Effort:** S.
- [ ] **H6. Accessibility on `NurseriesScreen`.** Star rating (`NurseriesScreen.tsx:27`)
  conveys rating visually only — needs `accessibilityLabel`. New list rows need ≥44pt
  touch targets.

### Observability (thin, but the billing one is not optional)

- [ ] **O1. Request counter + spend visibility.** Ships with A1 — it is the only thing
  that tells you the daily cap is doing its job. **Effort:** S.
- [ ] **O2. Structured JSON logs with a request id.** Today: `console.log` with emoji
  (`server/index.ts:96,99,103`). A bug reported three weeks post-ship is currently
  unreconstructable. **Effort:** S.
- [ ] **O3. Extend `/health` to report last-successful-scrape per provider.** Ten lines,
  and it turns "is it broken?" from an investigation into a glance. **Effort:** S.
- [ ] **O4. One-page runbook** — how to restart, rotate a key, read logs. **Effort:** S.

---

## Deferred (considered on 2026-08-11, explicitly not now)

- **E2. Photo timeline per plant** (M) — then/now per saved plant. Nearly free once
  B1.1 exists. Deferred: delight, not load-bearing. **Depends on:** B1.
- **E3. Shareable diagnosis card** (M) — the design doc's named viral loop ("someone
  sent me this app and it diagnosed my plant"). Deferred: virality matters only after
  retention works.
- **E6. Light meter** (M) — Planta's signature hook, uses the existing camera.
  Deferred: novelty value, unclear retention value.
- **E7. Cache last nursery results per plant** (M) — server-side cache with an "as of
  2h ago" timestamp. Deferred: superseded by E12 if that lands. **Note:** currently
  *nothing* is cached — the same plant at the same location re-scrapes from scratch
  every call. Defensible at one user, indefensible the day it isn't.
- **E8. Nursery inventory index as a dataset** (L) — turn the request-scoped scrape
  into a cached, dated index; the same pipeline could then serve a web page, a WhatsApp
  bot, or a nursery dashboard. Deferred: platform play, premature at zero repeat users.
- **E11. Scrape freshness monitoring** (M) — alert when a nursery site stops parsing
  instead of silently returning zero plants. **This is a live silent-failure gap** and
  the review flagged it as load-bearing for detecting A1 abuse. Deferred only because
  there is no production traffic yet — promote it the day A2 ships.
- **E12. Cut scrape latency below 10s** (L) — 🔴 **NO LONGER DEFERRABLE.** Measured
  end-to-end on 2026-08-15: `✔ 12 nurseries in 480187ms` — **eight minutes**, against
  a 90s client abort (`nurseryService.ts:13`). The `c6b0404` prefetch does not mask a
  wait five times longer than the timeout. **The nursery feature cannot succeed
  through the UI today under any host configuration**, which means A1's gating and
  A2's deploy are protecting an endpoint no user can currently reach.
  Options: parallel fan-out, cheaper extraction model, precomputed index.
  **Blocks everything in Phase 2 below, and now blocks the nursery half of M1.**
  **Eng review adds the real fix here:** convert the scrape to an **async job + poll**
  (POST starts a job and returns an id; the app polls). That makes the pipeline immune
  to *any* HTTP request timeout, survives the app backgrounding, and unblocks live
  in-app discovery. It's most of E12 already. A2's ">90s host timeout" requirement is
  the stopgap until this lands. **Eng review D9 → option A now, B later.**

### Deferred by the eng review (2026-08-11)

- **CI/CD pipeline for the container** (M) — no `.github/workflows/` exists, so every
  deploy is a manual `docker build && push` from your laptop and the shipped image is
  whatever your working tree contained. Fine at one developer; name it rather than
  discover it. Promote when a second person deploys, or the first time you ship a
  broken image.
- **`jest-expo` + `@testing-library/react-native` for screen tests** (L) — would cover
  the 17 untested user flows in the coverage diagram. Costs a full second test stack
  alongside `node --test`. The storage-layer tests carry far more weight per hour;
  revisit once M2 is green.
- **Streaming partial nursery results** (M) — show nurseries as each resolves instead
  of a 40-second spinner. Better UX than A2's timeout fix and cheaper than the full
  async-job rewrite. Good candidate to pair with E12.
- **Per-device quota / App Attest on the API** (M/L) — real protection instead of a
  bundled shared secret. Revisit when traffic is more than you.

---

## Phase 2 (blocked on E12)

### In-app live nursery discovery (Places → scrape)
**What:** device GPS (`expo-location`, already wired in DiagnosisScreen) → live nearby
nurseries with live inventory.
**Why:** "nurseries near the user" is the real product goal.
**Blocked by:** E12 (scrape latency). At 30-60s/site this is unusable live.
**How to start:** reuse `scraper/places.ts` `discoverNurseries()` server-side; wire
`NurseriesScreen` to device GPS + the hosted endpoint.
*(The "keys must not ship in the bundle" half of this item is now handled by A3.)*

### Firecrawl scraping automation
**What:** scheduled scraper that refreshes nursery data weekly.
**Why:** data goes stale after ~1 week; freshness is what makes the marketplace moat
real. **How to start:** `scripts/scrape-nurseries.ts` exists — schedule it as a GitHub
Action (weekly cron → scrape → PR). **Depends on:** real user reactions first.
**Related:** E8, E11.

---

## Todo personal — API keys

- [ ] **Plant.id key — present but unused.** `.env` has `EXPO_PUBLIC_PLANTID_API_KEY`,
  no code reads it. Now tracked as **E1** above (restore disease classification
  server-side, not client-side — the key must not ship in the bundle).
- [ ] **Tavily student plan.** Key is already wired (`server/index.ts:31` via the
  prefix-stripping `env()` helper; used as the Firecrawl fallback in `server/index.ts`,
  `dashboard/server.ts`, `scripts/scrape-nurseries.ts`). Only the plan upgrade is left
  — swap the key value, no code change. **Related:** H1.

---

## GSTACK REVIEW REPORT

| Run | Skill | Date | Status | Findings |
|-----|-------|------|--------|----------|
| 1 | `/plan-ceo-review` | 2026-08-11 | clean | scope set, M1/M2/M3 |
| 2 | `/plan-eng-review` | 2026-08-11 | clean | 11 issues, D3-D9 |
| 3 | `/plan-design-review` | 2026-08-15..16 | issues_found | 9 findings (F1-F9), 2 decisions deferred, A5 shipped |

**Run 3 method.** Scope was set by Ron to the running build rather than to proposed
designs. Mockup generation via the gstack designer failed (`OpenAI organization
verification required`), so the review was run against **live simulator screenshots**
— iPhone 17 Pro, iOS 26.1, Expo SDK 56, branch `main` @ `cc0e5a2`. Seven screens
captured by driving the simulator directly. Board:
`~/.gstack/projects/rondahan04-PlantAI/designs/myplants-b14-20260815/design-board.html`

**Findings.**

| # | Finding | Lands on |
|---|---------|----------|
| F1 | Nursery scrape measured at **480,187 ms** vs a 90,000 ms client abort — the feature cannot succeed through the UI | E12 (promoted out of Deferred), A2 |
| F2 | `getMockDiagnosis` renders fabricated root rot at "87% confidence", visually identical to a real result | A5 (confirmed) |
| F3 | Mock fires only on *missing* keys, never on *failed* calls — so A5 is safe to do now, ahead of A3 | A5 (unblocked) |
| F4 | Raw provider errors reach the user client-side, not only server-side | H3 (widened), E9 |
| F5 | Three different error languages in one session | E9 (widened S → M) |
| F6 | `.env:8` points at a stale LAN IP; app breaks on the dev machine and reports it as a service outage | A2 |
| F7 | `DiagnosisScreen` bottom already carries 3 competing actions plus 2 red URGENT badges | B1.3 |
| F8 | Home is entirely first-run content — the B1.4 navigation conflict is real | B1.4 |
| F9 | A 48%-confidence result renders identically to an 87% one, and the species was wrong (2026-08-16, post-A5) | E9 (promoted, now gates B1.4) |

**Rated.** B1.4 design completeness: **2/10** at entry. Unchanged at exit by
decision — the two design decisions that would raise it were deliberately deferred,
so the score reflects the plan, not the review.

**What is strong and should not be touched.** Home, Camera, and the Diagnosis layout
are well-composed and correctly on-token (`#F0FDF4` canvas, Lora/Raleway, 8pt rhythm,
16-24px radii). The nursery loading copy is the best writing in the app and is the
standard E9 should hold the rest of it to.

**VERDICT: ISSUES_FOUND — 8 findings folded into the plan, 2 decisions open.**
CODEX / CROSS-MODEL: not run (outside voices skipped; review was screenshot-based).

**UNRESOLVED DECISIONS:**

- **D7 — MyPlants list order.** Triage grouping vs chronological rows vs photo grid. Deferred by Ron on 2026-08-15: B1.4 is WIP and the screens do not exist yet. Revisit when B1.1 lands. Recommendation on record: triage grouping, because the Diagnosis screen already establishes a condition-first visual language and `PlantDiagnosis.condition` already carries the five-step scale.
- **D8 — Home vs My Plants navigation.** H1 library row under the CTA / H2 adaptive Home / H3 tab bar. Deferred on the same grounds. Recommendation on record: H1, as the only reversible option, with H2 revisited once B2 reminders give returning users a reason to open the app.
