/*
 * How far out a nursery search looks.
 *
 * This was one number in two places that could not see each other: the server
 * defaulted to 10km, and the copy said "within 10km" as a hardcoded string. Two
 * independent 10s are a lie waiting for someone to change one of them, and the
 * screen is the half the user believes.
 *
 * It also had no way to widen. A search that found nothing offered "Search
 * again", which re-ran the identical 10km search and could only fail the same
 * way - a dead end presented as a retry.
 */

/* What a search looks at unless asked otherwise. */
export const DEFAULT_RADIUS_M = 10_000;

/*
 * The widen ladder, offered a step at a time when a search comes back empty.
 *
 * Two steps rather than one, because the measurement said so. From Mitzpe Ramon
 * (2026-09-13), nurseries actually within the radius: 10km → 3, 25km → 4,
 * 50km → 12. Stopping at 25km would have stranded exactly the users this is
 * for - the ones with nothing nearby - one step short of the answer.
 *
 * Still a step at a time rather than jumping to 50km: in a dense area 10km is
 * the right answer and a shop 50km away is not somewhere anyone drives for a
 * houseplant, so the far search is offered, never assumed.
 */
export const WIDE_RADIUS_M = 25_000;

/* Places caps a Text Search circle at 50km and errors above it. */
export const MAX_RADIUS_M = 50_000;

/* Below this a radius is a mistake rather than a choice. */
const MIN_RADIUS_M = 1_000;

/* A radius the Places API will accept. Anything unreadable becomes the default
 * rather than zero: a search is what the user asked for, and 0m finds nothing
 * while still costing a request. */
export function clampRadius(m: unknown): number {
  const n = Number(m);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RADIUS_M;
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(n)));
}

/*
 * The next radius worth offering, or null when there is nothing further to try.
 *
 * Null is the honest answer at the widest step, and the caller must not offer a
 * button that re-runs the same search - that is the dead end this replaces.
 */
export function nextRadius(currentM: number): number | null {
  const current = clampRadius(currentM);
  if (current < WIDE_RADIUS_M) return WIDE_RADIUS_M;
  if (current < MAX_RADIUS_M) return MAX_RADIUS_M;
  return null;
}

/*
 * Whole kilometres, for the sentence on screen. Derived rather than written
 * down, so the number the user reads is the number we searched.
 */
export function radiusKm(m: number): number {
  return Math.round(clampRadius(m) / 1000);
}
