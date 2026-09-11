# PlantAI

Photograph a houseplant, get a species and a health read, and keep the plants you
own in a library that follows your account rather than the handset. When a plant
needs something you do not have, the app searches real Israeli nurseries for it.

An Expo/React Native app (iOS, Android) plus a small Node API. Hebrew and English,
both first-class - the Hebrew build is RTL, not a mirrored English one.

- **API:** https://plantai-api-eev0.onrender.com (Render, deployed from `main`)
- **Status and plan:** [`TODOS.md`](TODOS.md) - the single running record of what
  shipped, what is broken, and what is next. Read it before planning work.
- **Working agreements for coding agents:** [`AGENTS.md`](AGENTS.md)

## Run it

```bash
npm install
npm start                 # Expo dev server
npm run ios               # or: npm run android
npm run server            # the API, on http://localhost:3000
```

The app and the server both read `.env`; copy `.env.example` and fill it in.
`.env` is ignored in every variant - never commit one.

## Checks

```bash
npm run typecheck         # both tsconfigs: the app, and the server/scraper/scripts
npm test                  # node --test - the logic suite
npm run test:components   # jest + RNTL - the *.test.tsx component suite
npm run test:all          # both
```

Unused imports, locals and parameters are typecheck **errors**, not warnings, so
dead code fails CI rather than accumulating.

Anything visual has to be looked at on a device - synthetic taps do not register
in the RN view, so "the tests pass" is not "it works".

## Layout

```
App.tsx, index.ts      app entry and the navigation stack
src/
  screens/             one file per screen, grouped by area
    auth/              login, signup, password reset, change password
    settings/          settings, profile fields, account, notifications, language
    plants/            portfolio, detail, add/edit, watering history, species picker
    diagnosis/         camera and the diagnosis result
    (HomeScreen, NurseriesScreen, OnboardingScreen sit at the top level)
  components/          shared UI - plant/care/schedule/soil/leaf cards, status view
  services/            stateful edges: storage, network, device
    plants/            plantStore (local) -> plantRepo (facade) -> plantCloud -> supabasePlantCloud
    auth/              supabase client, session, sign-in/out
    media/             photo capture, on-device store, resize, signed URLs
    notifications/     reminder prefs and scheduling
    bulk/              batched diagnosis and translation
  lib/                 pure logic, no I/O - each module has a sibling *.test.ts
    care/              schedules, growing media, watering, calendar, leaves
    diagnosis/         confidence, triage, treatments, prose, failure kinds
    nursery/           availability, location, logos, WhatsApp links
    media/             image policy, cache keys, upload limits
    i18n/              language and RTL helpers
    copy/              en.ts / he.ts - every user-visible string
  data/                the species catalog
  theme/, types/, hooks/, navigation/, content/
server/                the API: diagnose, care plans, translation, gate, jobs, health
scraper/               nursery search - platform detection, retrieval, price extraction
scripts/               offline metrics and one-off tooling
dashboard/             local scraper test dashboard (npm run dashboard)
data/                  nursery URL lists the server reads at runtime
docs/                  runbook, retrieval and scrape-accuracy write-ups, design system
supabase/migrations/   schema, applied to the live project
```

`src/lib` modules import each other with an explicit `.ts` suffix so
`node --test` can run them directly - Node resolves no extensions of its own.
Keep that suffix when you add a module there.

## Metrics

The scraper is graded against captured fixtures, offline, against hand-written
labels rather than its own output:

```bash
npm run price:score       # price extraction: recall and quiet
npm run retrieval:score   # retrieval: did we find the plant at all
```

See [`docs/SCRAPE-ACCURACY-PLAN.md`](docs/SCRAPE-ACCURACY-PLAN.md) and
[`docs/RETRIEVAL.md`](docs/RETRIEVAL.md) for what those numbers mean.

## Operations

[`docs/RUNBOOK.md`](docs/RUNBOOK.md) covers reading `/health`, the bounded error
ring, the JSON log format, and a symptom table for the known incident classes.
