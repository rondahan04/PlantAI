# PlantAI

Photograph a houseplant. Get back what it is, how it is doing, and what to do
about it - then keep it in a library that follows your account rather than the
handset. When a plant needs something you do not own, the app searches real
Israeli nurseries for it and compares prices.

An Expo / React Native app (iOS and Android) in front of a small Node API.
Hebrew and English are both first-class: the Hebrew build is genuinely RTL, not
a mirrored English one.

| | |
|---|---|
| **API** | https://plantai-api-eev0.onrender.com - Render, deployed from `main` |
| **API docs** | https://plantai-api-docs.vercel.app - [`docs/api-site`](docs/api-site), Vercel. Deployed by hand: `cd docs/api-site && vercel --prod`. `main` does not publish it. |

## Run it

```bash
npm install
npm start                 # Expo dev server
npm run ios               # or: npm run android
npm run server            # the API, on http://localhost:4000
```

Both read `.env`; copy `.env.example` and fill it in. Every `.env` variant is
gitignored - never commit one.

`npm run server` and `npm run dashboard` both want port 4000, and only the API
takes `PORT` from the environment. Move it (`PORT=4001 npm run server`) and let
`EXPO_PUBLIC_API_BASE_URL` follow.

Anything visual has to be looked at on a device. Synthetic taps do not register
in the React Native view, so "the tests pass" is not "it works".

## Checks

```bash
npm run typecheck         # both tsconfigs: the app, and server/scraper/scripts
npm test                  # node --test - the logic suite
npm run test:components   # jest + RNTL - the *.test.tsx component suite
npm run test:all          # both
```

[CI](.github/workflows/ci.yml) runs the typecheck, both suites and a Dockerfile
build on every PR and every push to `main`. It takes no secrets: every test is
hermetic and the server image installs nothing, so a fork's PR runs the lot.

Two rules keep the tree from silting up, and `tsc` enforces both rather than a
linter nobody runs. **Unused imports, locals and parameters are errors**, so
dead code fails the build instead of accumulating. **Both projects are
typechecked** - `tsconfig.json` is the app, `tsconfig.node.json` is `server/`,
`scraper/`, `scripts/`, `dashboard/` and every `*.test.ts`. The second exists
because a wrong-arity call once reached production through the gap.

## How a diagnosis happens

```
CameraScreen ──photo──► imageResize ──base64──► POST /api/diagnose
                                                     │
                            ┌────────────────────────┴───────────┐
                            │ server/diagnose.ts                 │
                            │  identify (PlantNet + model)       │
                            │  aggregate into one identity       │
                            │  health assessment + care plan     │
                            └────────────────────────┬───────────┘
                                                     ▼
DiagnosisScreen ◄── confidence tier, triage, treatments, prose ──┘
      │
      └─ save ─► plantStore (device) ─► plantRepo ─► supabasePlantCloud
                                              │
                                              └─ photos: photoStore on disk,
                                                 mirrored from cloud storage so
                                                 a cold start paints instantly
```

A nursery search is the same shape but asynchronous: `POST /api/nurseries`
returns a job id, the scraper works through the shop list in process, and the
client polls `GET /api/nurseries/job/:id` every 1.5-5s until it is done. The
whole stack, provider by provider, is drawn at
[plantai-api-docs.vercel.app](https://plantai-api-docs.vercel.app/#diagram).

## Layout

```
App.tsx, index.ts      entry and the navigation stack
src/
  screens/             one per screen: auth, settings, plants, diagnosis,
                       home, nurseries, onboarding
  components/          shared UI - plant, care, schedule, soil and leaf cards
  services/            stateful edges: plants, auth, media, profile,
                       notifications, bulk
  lib/                 pure logic, no I/O; every module has a sibling test -
                       care, diagnosis, nursery, media, i18n, and copy
                       (en.ts / he.ts, every user-visible string)
  data/, theme/, types/, hooks/, navigation/, content/
server/                the API: diagnose, care plans, translation, gate, jobs
scraper/               nursery search - platform detection, retrieval, prices
scripts/               offline metrics and one-off tooling
dashboard/             local scraper test dashboard (npm run dashboard)
data/                  nursery URL lists the server reads at runtime
docs/api-site/         the published API docs site
supabase/migrations/   schema, applied to the live project
```

The plant path runs `plantStore` (local) → `plantRepo` (facade) → `plantCloud`
→ `supabasePlantCloud`. `src/lib` modules import each other with an explicit
`.ts` suffix so `node --test` can run them directly - Node resolves no
extensions of its own. Keep that suffix when you add a module there.

## The API

Six routes, all on the Render service above.

| Route | What it does |
|---|---|
| `GET /health` | liveness, gate/job/cache stats, scrape summary. Gate-exempt; `?errors=1` adds the bounded error ring and per-host detail, and that half needs the key. |
| `POST /api/diagnose` | photo in, species + health + care plan out |
| `POST /api/translate-diagnosis` | an existing diagnosis, in the other language |
| `POST /api/care-plan` | a genus-level plan, cached per genus |
| `POST /api/nurseries` | start a nursery search, returns a job id |
| `GET /api/nurseries/job/:id` | poll that job |

Everything but `/health` is behind the gate (`server/gate.ts`): an
`x-plantai-key` header plus a daily request cap. `GATE_MODE=log` reports without
refusing, `GATE_MODE=enforce` refuses. **Ship the app with the key before
enforcing**, or you lock every build already in the field out of your own API.

## Metrics

The scraper is graded offline against captured fixtures and hand-written
labels, never against its own output:

```bash
npm run price:score       # price extraction: recall and quiet
npm run retrieval:score   # retrieval: did we find the plant at all
```

Both print the per-row table they scored - host, query, verdict - above the
summary, so a number is always readable next to the rows that produced it.
`npm run dashboard` drives the scraper by hand against a live shop.

## Deployment

The API ships as a Docker image (`node:26-alpine`, non-root, zero runtime
dependencies), built by Render from `main` via [`render.yaml`](render.yaml).
[`fly.toml`](fly.toml) and `scripts/fly-secrets.sh` are the Fly equivalents,
kept for the day the account has a card on it - Fly will not provision without
one, which is why Render won.

The app ships through EAS: `runtimeVersion` follows the app version, and OTA
updates go to the `preview` channel.

## License

MIT - see [`LICENSE`](LICENSE).
