import type { CarePlan } from '../types';
import { wateringState, type WateringState } from './watering.ts';

/*
 * The schedule for every kind of care, not just watering.
 *
 * `watering.ts` already answers (care plan, last watered, now) -> what to show.
 * Repotting and feeding are the same question with a different interval, so
 * this is a thin generalisation rather than a second schedule engine: water
 * still goes through `wateringState` verbatim, and the other two kinds reuse
 * the same state machine with an interval that does not come from the model.
 *
 * WHY THE INTERVALS ARE CONSTANTS. The diagnosis returns `waterEveryDays` and
 * nothing else - there has never been a repot or fertilizer interval in a care
 * plan, so every plant already saved would have no schedule if we waited for
 * the model to start producing one. These are the standard houseplant figures,
 * and they are deliberately coarse: feeding is seasonal and repotting is driven
 * by the roots, so a due date here means "have a look", exactly as the watering
 * window does.
 */

/* Every 3 weeks - the middle of the usual "every 2-4 weeks in the growing
 * season" advice, and harmless if the user feeds a little late. */
export const FERTILIZE_EVERY_DAYS = 21;
export const FERTILIZE_EVERY_DAYS_MAX = 28;

/* 18 months. Most houseplants want a bigger pot every 1-2 years; erring long
 * matters more than erring short, because repotting on schedule rather than on
 * need is how a happy root-bound plant gets disturbed for nothing. */
export const REPOT_EVERY_DAYS = 540;
export const REPOT_EVERY_DAYS_MAX = 730;

/* One definition of the three kinds, owned by the store that persists them.
 * Type-only, so this stays a pure module with no storage behind it. */
export type { CareKind } from '../services/plantStore';
import type { CareKind } from '../services/plantStore';

export const CARE_KINDS: CareKind[] = ['water', 'repot', 'fertilizer'];

/*
 * The interval a kind is scheduled on, expressed as a care plan so the whole
 * calculation can go through `wateringState` unchanged. For water this is the
 * plant's own plan; for the others it is the constant above.
 */
export function intervalPlanFor(kind: CareKind, carePlan: CarePlan | undefined): CarePlan | undefined {
  if (kind === 'water') return carePlan;
  const [min, max] =
    kind === 'fertilizer'
      ? [FERTILIZE_EVERY_DAYS, FERTILIZE_EVERY_DAYS_MAX]
      : [REPOT_EVERY_DAYS, REPOT_EVERY_DAYS_MAX];
  /*
   * The prose fields (`soil`, `light`, `water`) are required on a CarePlan but
   * irrelevant here - wateringState reads only the two intervals. Blanks rather
   * than the plant's watering advice, so nothing downstream can mistake this
   * synthetic plan for the real one and quote watering prose about feeding.
   */
  const prose = carePlan ?? { soil: '', light: '', water: '' };
  return { ...prose, waterEveryDays: min, waterEveryDaysMax: max };
}

/*
 * Where this kind of care stands. Identical shape to `WateringState` because it
 * IS one - the caller reads `status`, `nextDueAt` and `label` the same way for
 * all three kinds.
 */
export function careState(
  kind: CareKind,
  carePlan: CarePlan | undefined,
  lastAt: string | undefined,
  now: number
): WateringState {
  const state = wateringState(intervalPlanFor(kind, carePlan), lastAt, now);
  if (kind === 'water') return state;
  // Only the wording differs, and only in the two places watering names itself.
  return { ...state, label: relabel(kind, state) };
}

const VERB: Record<Exclude<CareKind, 'water'>, string> = {
  repot: 'repot',
  fertilizer: 'feed',
};

function relabel(kind: Exclude<CareKind, 'water'>, state: WateringState): string {
  const verb = VERB[kind];
  switch (state.status) {
    case 'never_watered':
      return `Every ${monthsish(state.intervalDays)} · tap to start`;
    case 'due':
      return kind === 'repot' ? 'Due now - check the roots' : 'Due now';
    case 'ok':
      return state.daysUntilDue !== null && state.daysUntilDue <= 1
        ? `Next ${verb} tomorrow`
        : `Next ${verb} in ${state.daysUntilDue} days`;
    default:
      // 'overdue' and 'unscheduled' already read correctly for any kind
      // ("5 days overdue", "").
      return state.label;
  }
}

/* "3 weeks" / "18 months" - a 540-day interval read out in days is noise. */
export function monthsish(days: number | null): string {
  if (!days) return '';
  if (days >= 60) {
    const months = Math.round(days / 30);
    return months === 1 ? 'month' : `${months} months`;
  }
  if (days >= 14 && days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? 'week' : `${weeks} weeks`;
  }
  return days === 1 ? 'day' : `${days} days`;
}
