# PlantAI — TODOs

> Thesis: diagnosis acquire, marketplace transact, **only plant library retain.**
> CEO plan: `~/.gstack/projects/rondahan04-PlantAI/ceo-plans/2026-08-11-retention-spine.md`
> M1 code all written, typechecked, 80 tests green, both endpoints verified live.

---

## DO IN THIS ORDER

### P0 — keys

1. ✅ **`EXPO_PUBLIC_OPENAI_API_KEY` rotated 2026-08-16.** New key in `.env`, verified end-to-end
   against `/api/diagnose`. ⚠️ Old key must be **deleted** on platform.openai.com — rotation
   without revocation is theatre. Also check platform.openai.com/usage for spend that isn't yours.
2. ❌ **Won't do — Maps key restriction.** One key serves two callers: the Android bundle
   (`app.config.js:9`) and server-side Places (`server/index.ts:54`). Restricting it to the app
   breaks Places; splitting it needs an `android.package` that `app.json` doesn't have yet.
   Revisit when a bundle ID exists. Cheap partial anytime: API-restrict the key to Maps SDK for
   Android + Places API.

### M1 — deploy (console only, no code left)

> **No EAS in this project** — no `eas.json`, no `expo-updates`, no EAS CLI. The app runs from
> `expo start` over the LAN, so there are no installed OTA builds. That deletes the old "ship an
> `eas update` first" step and the log→enforce soak that existed to protect those builds.
> `flyctl` v0.4.83 installed 2026-08-16 via brew.

3. ✅ `fly auth login` — done, `ron.dahan01@post.runi.ac.il`, org `personal`.
4. 🚧 **BLOCKED — add a payment method at https://fly.io/dashboard/personal/billing.**
   `fly launch --no-deploy --copy-config --name plantai-api --org personal --region cdg --yes`
   fails with `requested machine count exceeds organization limit` on an org with zero apps and
   zero machines: Fly provisions nothing without a card. Adding one charges nothing by itself;
   the configured `shared-cpu-1x`/512mb always-on machine is ~$2-4/mo. The failure was clean —
   no app created, `fly.toml` untouched — so re-run the same command once the card is in.
5. `./scripts/fly-secrets.sh` — pushes the 6 provider keys from `.env` under their PLAIN names,
   `--stage`, values never printed. `flyctl secrets list` to verify names.
6. `fly deploy --remote-only` — Docker Desktop stays off; Fly's builder does it. ⚠️ Keep
   `auto_stop_machines = false` and `min_machines_running = 1`. Jobs live in process memory; a
   suspended machine loses in-flight jobs and the money spent.
7. `curl https://plantai-api.fly.dev/health` → expect the gate/jobs counters block.
8. Repoint `EXPO_PUBLIC_API_BASE_URL` in `.env` to the Fly URL, restart `expo start`. Retires the
   stale-LAN-IP failure mode (F6) for good. `EXPO_PUBLIC_API_SECRET` is unchanged.
9. `fly secrets set GATE_MODE=enforce`. Safe as soon as 8 is done — nothing is installed that
   could be locked out. Check `wouldReject` on `/health` first anyway; non-zero means the client
   and server secrets disagree.

**Stopgap in place while 4 is blocked — `cloudflared` quick tunnel (2026-08-16).**
`cloudflared tunnel --url http://localhost:4000` fronts the local server on a public HTTPS URL;
`.env` `EXPO_PUBLIC_API_BASE_URL` points at it and `GATE_MODE=enforce` is on, because a public
billable endpoint with the gate in log mode is a stranger's daily cap. Verified through the
tunnel: `/health` counters, 401 without `x-plantai-key`, 415 past the gate with it, and a real
`Rhaphidophora tetrasperma` diagnosis end to end. Restart the tunnel → new URL → paste it into
`.env`. Mac sleeps → everything is down. This does **not** close M1.

### M2 — plant library (retention hook)

10. **`PlantStore`.** `import Storage from 'expo-sqlite/kv-store'`. Blob `{ version: 1, plants: [...] }`.
   DI seam `StorageDeps { getItem, setItem, removeItem }`, mirroring `PipelineDeps`.
   - quota-exceeded → read back to confirm the write; on fail "Couldn't save — storage full" + retry
   - corrupt JSON → quarantine to a `.corrupt` key; never render "you have no plants"
11. **`migrate()` chain.** Runs every load, chains v1→v2→v3. Version newer than app quarantines.
   No-op today + a test proving the chain runs.
12. **Photo persistence.** Camera output is a cache URI; iOS purges it. Copy on save, downscale.
    ```ts
    import { File, Paths } from 'expo-file-system';
    const source = new File(Paths.cache, 'temp-photo.jpg');
    const destination = new File(Paths.document, `plant-${id}.jpg`);
    await source.copy(destination);
    ```
    Not `FileSystem.copyAsync` — functional API deprecated.
13. **E1. Plant.id v3 disease classification, server-side.** `EXPO_PUBLIC_PLANTID_API_KEY` sits
    unused. Shape in learning `plantid-v3-response-shape`. Map: `is_healthy` → healthy; disease
    prob <0.3 mild, <0.6 moderate, <0.85 severe, ≥0.85 critical.
14. **E9 follow-up. Confidence rendering.** Repro: `photos_for_testing/sickmonstera.jpeg` →
    Gallery → diagnose → wrong species at 47%, rendered identically to the old 87% mock.
    Needs 13 for real probabilities. **Gates 16.**
15. **B1.3. Save button on `DiagnosisScreen`.** Decide placement first — new primary, or header
    icon so the commerce CTA keeps the accent (screen already carries 3 actions + 2 URGENT
    badges). Handle: double-tap → dupes; killed mid-save → persist before navigating.
16. **B1.4. MyPlants + PlantDetail.** Decide D8 first (below). `FlatList`, real empty state.
17. **E10. Storage tests.** Add `src/` to the glob first — it is
    `node --test scraper/*.test.ts server/*.test.ts` today, so new tests silently skip.
    - save 50, force-quit mid-write, relaunch → all 50 readable
    - hand-write truncated JSON → recoverable error, not empty library

### M3 — polish

18. **E4.** Hebrew / RTL. Groundwork in `143e98d`; copy missing. Mirror-test the layout.
19. **E5.** WhatsApp `wa.me` + `tel:` handoff. `phone` already scraped; `onOrder` only opens a site.
20. **H1.** Lift `env()` into `scraper/core.ts` — `dashboard/server.ts:50` and
    `scripts/scrape-nurseries.ts:20` still redeclare `EXPO_PUBLIC_TAVILY_API_KEY`.
21. **H2.** Rename `nurseries_scraping_testing` → `nurseries-fallback.txt` (production config,
    read at `server/index.ts:100`).
22. **H5.** Route table in `server/index.ts`. **H6.** `accessibilityLabel` on the star rating
    (`NurseriesScreen.tsx:27`), ≥44pt rows.
23. **O2.** JSON logs + request id (`server/index.ts:96,99,103`). **O3.** `/health` reports
    last-successful-scrape per provider. **O4.** One-page runbook.
24. **Tavily student plan.** Swap the key value, no code change.

---

## BACKLOG (unordered)

| # | Item | Size | Note |
|---|------|------|------|
| B2.1 | Care schedule + `expo-notifications` | L | Config plugin + dev build. Permission prompt behind a flag — one-shot resource. Cancel on delete. |
| P2 | In-app live nursery discovery | M | GPS → `scraper/places.ts` `discoverNurseries()` server-side. The real product goal. Gated on scrape speed. |
| — | Scrape speed (80-480s) | M | Quality problem now, not correctness. Parallel fan-out, cheaper model, precomputed index. |
| E2 | Photo timeline per plant | M | Nearly free after 8. |
| E3 | Shareable diagnosis card | M | Virality after retention. |
| E6 | Light meter | M | Novelty, unclear retention. |
| E7 | Cache nursery results per plant | M | Nothing cached across jobs today. |
| E8 | Inventory index as dataset | L | Platform play, premature. |
| E11 | Scrape freshness monitoring | M | Live silent-failure gap. **Promote the day 5 lands.** |
| — | Firecrawl weekly cron | S | `scripts/scrape-nurseries.ts` as a GitHub Action. |
| — | CI/CD for the container | M | No `.github/workflows/`; deploys are manual builds from the laptop. |
| — | `jest-expo` + RN testing library | L | 17 untested flows, second test stack. After M2. |
| — | Streaming partial nursery results | M | — |
| — | Per-device quota / App Attest | M/L | Real protection vs a bundled secret. |

---

## OPEN DECISIONS

- **D7 — MyPlants list order.** Triage grouping vs chronological vs photo grid. Recommendation:
  triage grouping — `PlantDiagnosis.condition` already carries the five-step scale.
- **D8 — Home vs My Plants nav.** H1 library row under the CTA / H2 adaptive Home / H3 tab bar.
  Home is 100% first-run content today (F8). Recommendation: H1, the only reversible option.

---

## SHIPPED (2026-08-16)

| Item | What |
|------|------|
| P0 funding | OpenAI credits restored; real photo → real diagnosis on device. |
| A1 gate | `server/gate.ts` — `x-plantai-key`, per-IP burst limit, daily cap → 503, `CORS: *` gone. Cap checked *before* secret; `GATE_MODE` fails safe to `log`; polling exempt. ⚠️ The secret is a speed bump, not auth — **the cap bounds the bill.** 14 tests. |
| A2 code | `Dockerfile` (node:26-alpine, non-root, zero deps), `.dockerignore`, `fly.toml`. 90s-timeout requirement retired by E12. |
| A3 | `POST /api/diagnose` — PlantNet + OpenAI server-side, `src/lib/api.ts` the only URL/header holder. **No provider key in app code.** Server sniffs image magic numbers → 415 `unsupported_image` (test photos are WebP named .jpeg). Server is now a single point of failure for diagnosis — accepted. |
| A5 | `getMockDiagnosis` deleted — it rendered fabricated root rot at "87% confidence". Plus named error types + `isHealthAssessment` guard. |
| E9 | `describeFailure` in `CameraScreen` is the single source of failure copy. Killed the three-error-languages problem. Confidence *rendering* still open → step 12. |
| E12 | Async job + poll. `POST /api/nurseries` → 202 `{jobId}`, `GET /api/nurseries/job/:id`. Client polls 1.5s→5s, tolerates 4 misses, 10 min cap. Dedupes in-flight; failed jobs not cached. Live: 8 nurseries in 80,907 ms. ⚠️ Jobs in process memory — see step 5. |
| H1 partial | `loadEnv()` overwrote real env vars, so `GATE_MODE=enforce` silently ran as `log`. Now skips already-set keys + comment lines. |
| H3 | One `fail()` helper — stable code to client, provider detail to log with request id. |
| H7 | Nursery cache `Map` capped at 20, oldest-first. |
| O1 | `GET /health` → `{gate: {day, allowed, rejected, wouldReject, cap, remaining}, jobs}`. |

## REVIEWS

| Run | Skill | Date | Result |
|-----|-------|------|--------|
| 1 | `/plan-ceo-review` | 2026-08-11 | clean — M1/M2/M3 scope |
| 2 | `/plan-eng-review` | 2026-08-11 | clean — 11 issues, D3-D9 |
| 3 | `/plan-design-review` | 2026-08-15..16 | 9 findings; F1-F6 closed, F7→13, F8→14, F9→12 |

Run 3 was screenshot-based (iPhone 17 Pro, iOS 26.1, `main` @ `cc0e5a2`); mockup generation
failed on `OpenAI organization verification required`. Board:
`~/.gstack/projects/rondahan04-PlantAI/designs/myplants-b14-20260815/design-board.html`

**Do not touch:** Home, Camera, Diagnosis layout — on-token (`#F0FDF4`, Lora/Raleway, 8pt
rhythm). The nursery loading copy is the writing standard for the rest of the app.
