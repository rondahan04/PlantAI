# Onboarding — design

Date: 2026-08-19. Status: implemented.

## Decision

Onboarding only. **No accounts** — no email, no phone, no server user table, no
sessions. The app's data is device-local and the server is a stateless diagnose
API behind a shared secret; real auth would mean a user store, a mail or SMS
provider, token refresh, and plant sync, none of which the product needs to
deliver its first-run value. `complete()` has room for a later `userId` without
a migration, so the door stays open.

## Flow

One screen, three internal steps. Not four stack routes: the back gesture must
step backwards *inside* onboarding, and stack routes would pop out to nothing.

1. **Name** — "Hello, what should we call you?", skippable. Stated plainly as
   device-local with no account. Leads so the rest of onboarding can address the
   user by name instead of opening on a pitch.
2. **Slides** — three swipeable pages (Snap & Diagnose / Track & Water / Find
   Replacements), dots, `Next` → `Get Started`.
3. **Camera priming** — why the camera is needed, then the OS prompt. Skipped
   entirely when permission is already granted.

`Skip` in the header exits from any step. No step can dead-end: denial of the
camera still lands on Home, and `CameraScreen` re-asks with the viewfinder
context visible.

**Notifications are not asked here.** A permission requested before the user
owns a plant is a "no" that can never be re-asked; that prompt belongs to the
first watering reminder.

## Storage

`src/services/onboardingStore.ts` (pure, dependency-injected) +
`src/services/onboarding.ts` (binds `expo-sqlite/kv-store`) — the same split as
`plantStore` ↔ `plantLibrary`, so `node --test` runs the logic without an Expo
runtime.

- Key `plantai.onboarding`, version 1: `{ version, completedAt, name? }`.
- **Synchronous.** `App.tsx` picks `initialRouteName` from it during the first
  render; an async read would mount Home and push Onboarding over it.
- Separate from the library blob: the library is re-read on every render and
  every watering write, and onboarding is read once per launch.
- Writes are **read back and compared**. An unconfirmed write means onboarding
  replays on every launch.
- Every unreadable case resolves to "not onboarded" — replaying a 30-second
  intro beats stranding a first-time user on an empty Home. The one exception
  is a blob from a **newer** build, which is honoured rather than overwritten.

## Content ownership

`FEATURES` moved from `HomeScreen` into `src/content/features.ts`, with two
voices per feature: `blurb` for onboarding, `desc` for the Home card row. Two
copies would drift invisibly — the screens are never on-screen together.

The name, when given, greets on Home: `Hello, <name>` on the first-run layout,
`<name>'s plants` on the library layout.

## Tests

`src/services/onboardingStore.test.ts`, 16 cases: fresh install, persistence
across instances, skip-without-name, corrupt blob, invalid `completedAt`,
future version, name normalization, throwing reads, throwing and silent write
failures, `setName` not re-stamping `completedAt`, and `reset`.

The screen itself is verified manually on device.
