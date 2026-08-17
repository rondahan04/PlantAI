# PlantAI — TODOs

> Thesis: diagnosis acquire, marketplace transact, **only plant library retain.**
> CEO plan: `~/.gstack/projects/rondahan04-PlantAI/ceo-plans/2026-08-11-retention-spine.md`
> M1 code all written, typechecked, 80 tests green. Full loop verified from the iOS simulator
> over a public tunnel 2026-08-17 — diagnosis + nursery scrape. Fly deploy still blocked on billing.

---

## DO IN THIS ORDER

Ranked most → least important, 2026-08-17. Ranking rule: an unrevoked leaked key beats a broken
product beats a missing feature beats a cleanup. Within a tie, cheap-and-unblocking wins. The
milestone tag on each line preserves the old M1/M2/M3 grouping.

**Already settled:** OpenAI key rotated 2026-08-16 and verified end to end. `fly auth login` done
(`ron.dahan01@post.runi.ac.il`, org `personal`). Maps key restriction ❌ won't do — one key serves
both the Android bundle (`app.config.js:9`) and server-side Places (`server/index.ts:54`), so
restricting it to the app breaks Places, and splitting needs an `android.package` that `app.json`
doesn't have. Cheap partial anytime: API-restrict that key to Maps SDK for Android + Places API.

1. ✅ **[P0] Old OpenAI key revoked 2026-08-17.** The leak is closed.
2. **[M1] Deploy to Render.** Everything below assumes a backend that exists when your laptop
   doesn't. **Fly is abandoned — it will not provision without a credit card** (`fly launch` →
   `requested machine count exceeds organization limit` on an org with zero machines). Render's
   free tier needs no card: 750 instance-hours/month, Dockerfile deploys, `render.yaml` Blueprint
   committed. `fly.toml` and `scripts/fly-secrets.sh` are kept for the day a card exists.
   1. Push the branch, then render.com → sign up with **GitHub** (no card).
   2. **New → Blueprint** → pick `rondahan04/PlantAI` → it reads `render.yaml`.
   3. Paste the 6 `sync: false` secrets when prompted — plain names, encrypted at rest, never in
      git. `API_SHARED_SECRET` must equal `EXPO_PUBLIC_API_SECRET` in `.env` or every request 401s.
   4. `curl https://plantai-api.onrender.com/health` → gate/jobs counters.
   5. Point `EXPO_PUBLIC_API_BASE_URL` at the Render URL, restart `expo start --clear`. Retires
      the stale-URL failure mode (F6) and the tunnel for good.
   6. Free-tier spin-down: suspends after 15 min idle, ~1 min cold start. **Not a job-loss risk** —
      the client polls every 1.5-5s for the whole scrape, so the service can only sleep when
      nothing is in flight. Optional: free pinger (cron-job.org, no card) on `/health` every
      10 min keeps it warm; `/health` is gate-exempt so it costs nothing against the daily cap.
      750h/month ≈ 31 days, so one always-warm service fits and a second one would not.
   7. Flip `render.yaml` `branch:` to `main` once M1 merges, or Render tracks a deleted branch.
3. ✅ **[M2] Test discovery fixed 2026-08-17.** `"test": "node --test"` — bare recursive
   discovery, so anything matching `*.test.ts` anywhere outside `node_modules` runs. Replaces the
   explicit `scraper/*.test.ts server/*.test.ts` globs that silently skipped every future `src/`
   test. Verified with a throwaway canary under `src/`: 80 → 81 tests, then removed. 80 green.
4. ✅ **[M2] D7 and D8 decided 2026-08-17** — triage grouping, adaptive Home (H2). See OPEN
   DECISIONS for the consequences H2 puts on items 5, 7, and 8.
5. **[M2] `PlantStore`.** `import Storage from 'expo-sqlite/kv-store'`. Blob
   `{ version: 1, plants: [...] }`. DI seam `StorageDeps { getItem, setItem, removeItem }`,
   mirroring `PipelineDeps`. This is the retention thesis — the only part of the product a user
   comes back for.
   - quota-exceeded → read back to confirm the write; on fail "Couldn't save — storage full" + retry
   - corrupt JSON → quarantine to a `.corrupt` key; never render "you have no plants"
6. **[M2] `migrate()` chain.** Runs every load, chains v1→v2→v3. Version newer than app
   quarantines. No-op today + a test proving the chain runs. Cheap now, unshippable later — the
   first stored blob without it is a permanent migration problem.
7. **[M2] B1.3. Save button on `DiagnosisScreen`.** Nothing reaches the library without it.
   Decide placement first — new primary, or header icon so the commerce CTA keeps the accent
   (the screen already carries 3 actions + 2 URGENT badges). Handle: double-tap → dupes; killed
   mid-save → persist before navigating.
8. **[M2] B1.4. Home library layout + `PlantDetail`.** D8 = H2, so this is the returning-user
   Home, not a separate MyPlants screen: `SectionList` grouped by triage (D7), plus a detail
   screen. The first-run → library swap and the load-before-first-paint requirement are the hard
   parts — see D8's consequence list.
9. **[M2] Photo persistence.** Camera output is a cache URI; iOS purges it, so saved plants lose
   their photos on a timeline you don't control. Copy on save, downscale.
    ```ts
    import { File, Paths } from 'expo-file-system';
    const source = new File(Paths.cache, 'temp-photo.jpg');
    const destination = new File(Paths.document, `plant-${id}.jpg`);
    await source.copy(destination);
    ```
    Not `FileSystem.copyAsync` — functional API deprecated.
10. **[M2] E10. Storage tests.** Needs 3 first.
    - save 50, force-quit mid-write, relaunch → all 50 readable
    - hand-write truncated JSON → recoverable error, not empty library
11. **[M2] E9 follow-up. Confidence rendering.** Confirmed live 2026-08-17: the simulator run
    rendered `Mini monstera` at **44%** with the same authority the old fabricated-87% mock had.
    A confidently-wrong species is the fastest way to lose a user's trust in the whole product.
    Thresholds can ship ahead of 12; real probabilities make them honest.
12. **[M2] E1. Plant.id v3 disease classification, server-side.** `EXPO_PUBLIC_PLANTID_API_KEY`
    sits unused. Shape in learning `plantid-v3-response-shape`. Map: `is_healthy` → healthy;
    disease prob <0.3 mild, <0.6 moderate, <0.85 severe, ≥0.85 critical.
13. **[M3] E5. WhatsApp `wa.me` + `tel:` handoff.** `phone` is already scraped; `onOrder` only
    opens a site. This is the transact half of the thesis and the cheapest conversion win here —
    Israeli nurseries answer WhatsApp, not web forms.
14. **[M3] E4. Hebrew / RTL.** Groundwork in `143e98d`; copy missing. Mirror-test the layout. The
    users are Israeli and the scraped inventory is already Hebrew.
15. **[ops] O2/O3/O4 observability.** JSON logs + request id (`server/index.ts:96,99,103`);
    `/health` reports last-successful-scrape per provider; one-page runbook. ⚠️ Also fix the
    `jobs` field while in there — `jobs: jobs.size()` (`server/index.ts:192`) counts *stored*
    jobs, including finished ones retained for polling, so it never returns to 0 on a healthy
    server and reads as "something is stuck" during an incident. Split into `{active, retained}`.
16. **[M3] H6. Accessibility.** `accessibilityLabel` on the star rating (`NurseriesScreen.tsx:27`),
    ≥44pt rows.
17. **[M3] Cleanups.** **H1** lift `env()` into `scraper/core.ts` (`dashboard/server.ts:50` and
    `scripts/scrape-nurseries.ts:20` still redeclare `EXPO_PUBLIC_TAVILY_API_KEY`). **H2** rename
    `nurseries_scraping_testing` → `nurseries-fallback.txt` (production config, read at
    `server/index.ts:100`). **H5** route table in `server/index.ts`.
18. **[ops] Tavily student plan.** Swap the key value, no code change.

**Stopgap in place while 2.1 is blocked — `cloudflared` quick tunnel.**
`cloudflared tunnel --url http://localhost:4000` fronts the local server on a public HTTPS URL;
`.env` `EXPO_PUBLIC_API_BASE_URL` points at it and `GATE_MODE=enforce` is on, because a public
billable endpoint with the gate in log mode is a stranger's daily cap. **Full loop verified from
the iOS simulator 2026-08-17:** `[r9] /api/diagnose 71343B → Mini monstera (44%) moderate in
10241ms`, then `[ra] scrape → ✔ 7 nurseries in 47238ms`; gate `allowed 2, rejected 0`, and a 401
for a request with no `x-plantai-key`. Restart the tunnel → new URL → paste it into `.env`; it
died once overnight already (`control stream encountered a failure`) and took the app with it.
Mac sleeps → everything is down. This does **not** close M1.

---

## BACKLOG (unordered)

| # | Item | Size | Note |
|---|------|------|------|
| B2.1 | Care schedule + `expo-notifications` | L | Config plugin + dev build. Permission prompt behind a flag — one-shot resource. Cancel on delete. |
| P2 | In-app live nursery discovery | M | GPS → `scraper/places.ts` `discoverNurseries()` server-side. The real product goal. Gated on scrape speed. |
| — | Scrape speed | M | Quality problem now, not correctness. Parallel fan-out, cheaper model, precomputed index. Best observed 47s (2026-08-17, 7 nurseries); worst seen 480s. |
| — | Show "stock unknown" instead of dropping the row | S | The auditor rejects extractor rows whose page never states stock — e.g. `[decogarden.co.il] verification REJECTED (conf 92): the source text does not explicitly state stock status`. Correct call by the verifier, but the user loses a nursery that does stock the plant. Product decision: surface as `unknown` rather than drop. |
| E2 | Photo timeline per plant | M | Nearly free after PlantStore (5). |
| E3 | Shareable diagnosis card | M | Virality after retention. |
| E6 | Light meter | M | Novelty, unclear retention. |
| E7 | Cache nursery results per plant | M | Nothing cached across jobs today. |
| E8 | Inventory index as dataset | L | Platform play, premature. |
| E11 | Scrape freshness monitoring | M | Live silent-failure gap. **Promote the day PlantStore (5) lands.** |
| — | Firecrawl weekly cron | S | `scripts/scrape-nurseries.ts` as a GitHub Action. |
| — | CI/CD for the container | M | No `.github/workflows/`; deploys are manual builds from the laptop. |
| — | `jest-expo` + RN testing library | L | 17 untested flows, second test stack. After M2. |
| — | Streaming partial nursery results | M | — |
| — | Per-device quota / App Attest | M/L | Real protection vs a bundled secret. |

---

## OPEN DECISIONS

- ✅ **D7 — MyPlants list order → triage grouping** (decided 2026-08-17). Group by health:
  critical + severe, then moderate, then healthy. `PlantDiagnosis.condition` already carries the
  five-step scale, so the grouping key is free. Matches why the app gets opened.
- ✅ **D8 — Home vs My Plants nav → H2, adaptive Home** (decided 2026-08-17). Home shows the
  marketing/how-it-works content on first run and a library-first layout once ≥1 plant is saved.
  Chosen over H1 (library row under the CTA) and H3 (tab bar).
  Consequences to build around:
  - **Two Home layouts** to build, test, and keep on-token. The design review's *do not touch
    Home* rule was about not degrading the existing first-run screen — the returning-user layout
    is a new design and must hold the same tokens (`#F0FDF4`, Lora/Raleway, 8pt rhythm) on
    purpose, not by inheritance.
  - The swap fires once, the first time a user saves. Decide whether it animates or is simply
    true on next mount; a screen silently becoming a different screen is disorienting.
  - Empty state is now Home's first-run content, so "real empty state" in item 8 means the
    *transition* is the thing to get right, not an illustration.
  - Home needs the plant list to load before first paint, or it flashes marketing content at a
    returning user. Read `PlantStore` synchronously on mount — `expo-sqlite/kv-store` supports it.
  - No separate MyPlants *screen* in the H2 world; item 8 becomes the Home library layout +
    `PlantDetail`.

---

## SHIPPED (2026-08-16)

| Item | What |
|------|------|
| P0 funding | OpenAI credits restored; real photo → real diagnosis on device. |
| A1 gate | `server/gate.ts` — `x-plantai-key`, per-IP burst limit, daily cap → 503, `CORS: *` gone. Cap checked *before* secret; `GATE_MODE` fails safe to `log`; polling exempt. ⚠️ The secret is a speed bump, not auth — **the cap bounds the bill.** 14 tests. |
| A2 code | `Dockerfile` (node:26-alpine, non-root, zero deps), `.dockerignore`, `fly.toml`. 90s-timeout requirement retired by E12. |
| A3 | `POST /api/diagnose` — PlantNet + OpenAI server-side, `src/lib/api.ts` the only URL/header holder. **No provider key in app code.** Server sniffs image magic numbers → 415 `unsupported_image` (test photos are WebP named .jpeg). Server is now a single point of failure for diagnosis — accepted. |
| A5 | `getMockDiagnosis` deleted — it rendered fabricated root rot at "87% confidence". Plus named error types + `isHealthAssessment` guard. |
| E9 | `describeFailure` in `CameraScreen` is the single source of failure copy. Killed the three-error-languages problem. Confidence *rendering* still open → step 11. |
| E12 | Async job + poll. `POST /api/nurseries` → 202 `{jobId}`, `GET /api/nurseries/job/:id`. Client polls 1.5s→5s, tolerates 4 misses, 10 min cap. Dedupes in-flight; failed jobs not cached. Live: 8 nurseries in 80,907 ms. ⚠️ Jobs in process memory — see step 2.4. |
| H1 partial | `loadEnv()` overwrote real env vars, so `GATE_MODE=enforce` silently ran as `log`. Now skips already-set keys + comment lines. |
| H3 | One `fail()` helper — stable code to client, provider detail to log with request id. |
| H7 | Nursery cache `Map` capped at 20, oldest-first. |
| O1 | `GET /health` → `{gate: {day, allowed, rejected, wouldReject, cap, remaining}, jobs}`. |

## REVIEWS

| Run | Skill | Date | Result |
|-----|-------|------|--------|
| 1 | `/plan-ceo-review` | 2026-08-11 | clean — M1/M2/M3 scope |
| 2 | `/plan-eng-review` | 2026-08-11 | clean — 11 issues, D3-D9 |
| 3 | `/plan-design-review` | 2026-08-15..16 | 9 findings; F1-F6 closed, F7→7, F8→8, F9→11 |

Run 3 was screenshot-based (iPhone 17 Pro, iOS 26.1, `main` @ `cc0e5a2`); mockup generation
failed on `OpenAI organization verification required`. Board:
`~/.gstack/projects/rondahan04-PlantAI/designs/myplants-b14-20260815/design-board.html`

**Do not touch:** Home, Camera, Diagnosis layout — on-token (`#F0FDF4`, Lora/Raleway, 8pt
rhythm). The nursery loading copy is the writing standard for the rest of the app.
