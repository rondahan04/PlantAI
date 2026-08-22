# PlantAI API - runbook

One page. If the deployed API (`https://plantai-api-eev0.onrender.com`) is acting up, start here.

## Is it up at all?

```
curl https://plantai-api-eev0.onrender.com/health
```

`{"ok":true,...}` with a fast response = up. No response for ~60s = cold start after 15min idle
(Render free tier), not an outage - retry once. Anything else, read on.

## Reading `/health`

```json
{
  "ok": true,
  "gate": { "day": "...", "allowed": 12, "rejected": 0, "wouldReject": 0, "cap": 200, "remaining": 188 },
  "jobs": { "active": 0, "retained": 3 },
  "lastSuccess": {
    "plantnet_identify": "2026-08-22T09:10:00.000Z",
    "health_assessment": "2026-08-22T09:10:04.000Z",
    "nursery_scrape": "2026-08-22T08:40:00.000Z"
  }
}
```

- **`gate.remaining` near 0** - the daily cap (200 billable requests) is close to hit. Not a bug;
  either legitimate traffic or the cap needs raising (`server/gate.ts`).
- **`jobs.active` stuck > 0 for minutes** - a nursery scrape is hung. `retained` staying nonzero is
  normal (10-minute retention for late polls, see `server/jobs.ts`); only `active` not returning to
  0 means something is actually stuck.
- **A `lastSuccess` field is `null` or old** - that provider hasn't succeeded recently. `null` on a
  fresh deploy is expected (nothing has run yet); an old timestamp on a server that's otherwise
  taking traffic means that specific provider is failing silently, not that it's never called.

## Reading the errors ring

```
curl -H "x-plantai-key: <EXPO_PUBLIC_API_SECRET value>" "https://plantai-api-eev0.onrender.com/health?errors=1"
```

Requires the shared secret (same one the app sends) - `/health` alone is public, `?errors=1` is not.
Returns the last 20 failures with `rid`, `code`, and `detail`. `detail` is raw provider error text
(may include account/billing sentences) - never forward it to a user, it exists for this runbook only.

## Log format

Every request/job event is one JSON line: `{"at","rid","event",...fields}`. `rid` is per-HTTP-request
(`r1`, `r2`, ...) and ties every line for one request together, including the async nursery-scrape job
it started. Grep by `rid` to follow one request end to end; grep by `"event":"error"` for failures.
Render's log viewer can filter on these fields directly.

## Common incidents

| Symptom | Likely cause | Where to look |
|---|---|---|
| `/api/diagnose` always 502 | Provider key expired/out of credits | `lastSuccess.plantnet_identify` vs `.health_assessment` tells you which provider; `?errors=1` has the raw detail |
| `/api/diagnose` always returns the same generic assessment | `DIAGNOSIS_SKIP_OPENAI=true` still set (Render env var) | This is TODOS item 0 - intentional stub mode, not a bug. Unset the Render env var once OpenAI credits are back |
| Nursery search never finishes | `jobs.active` stuck; check `?errors=1` for `scrape_failed` | Firecrawl/Tavily both down, or a target site started blocking |
| Every request 401s | `x-plantai-key` mismatch | `API_SHARED_SECRET` on Render must equal `EXPO_PUBLIC_API_SECRET` in the app bundle - see `render.yaml` |
| Gallery photo upload fails, camera works | Photo over `MAX_BODY_BYTES` (12MB) | `server/index.ts` `MAX_BODY_BYTES` - known gap, TODOS item 9 downscale note |

## Routes

See the header comment in `server/index.ts` - kept there, not duplicated here, so it can't drift.
