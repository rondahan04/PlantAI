import type { CarePlan } from '../types';
import { wateringState, type WateringState } from './watering.ts';
import { soilMediumById, type SoilMediumId } from './soilMedia.ts';
import type { GenusCarePlan, SoilCarePlan } from './genusCarePlan.ts';

/*
 * The schedule for every kind of care, not just watering.
 *
 * `watering.ts` already answers (care plan, last watered, now) -> what to show.
 * Repotting and feeding are the same question with a different interval, so
 * this is a thin generalisation rather than a second schedule engine: water
 * still goes through `wateringState` verbatim, and the other two kinds reuse
 * the same state machine with an interval that does not come from the model.
 *
 * WHY THE INTERVALS BELOW ARE CONSTANTS, AND WHEN THEY ARE NOT. The diagnosis
 * returns `waterEveryDays` and nothing else, so every plant already saved would
 * have no repot and no feed schedule if we waited for the model to start
 * producing one. These are the standard houseplant figures, deliberately
 * coarse: a due date here means "have a look", exactly as the watering window
 * does.
 *
 * Feeding has since outgrown its constant. A genus care plan carries a
 * `fertilizeEveryDays` PER MEDIUM, and it has to - pon comes with slow-release
 * feed built into the substrate and wants feeding a season apart, while the
 * same plant in inert LECA is fed on every water. So the fertilizer constant is
 * now the fallback for a plant with no genus plan cached, not the answer.
 *
 * Repotting stays constant on purpose. It is driven by the roots filling the
 * pot, not by what the pot is filled with, and no genus plan carries a repot
 * interval to override it with.
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
 * plant's own plan - already resolved against its medium by `plantCarePlan`
 * below, so nothing here has to know about soil. For feeding it is the genus
 * plan's per-medium figure when one has been cached and the constant when not,
 * and for repotting it is always the constant.
 *
 * `soilPlan` is optional and last so every call site written before media
 * existed still compiles and still behaves exactly as it did.
 */
export function intervalPlanFor(
  kind: CareKind,
  carePlan: CarePlan | undefined,
  soilPlan?: SoilCarePlan
): CarePlan | undefined {
  if (kind === 'water') return carePlan;
  /*
   * No max from the genus plan: it gives a single `fertilizeEveryDays`, and
   * inventing a window around it would put a range on screen that the model
   * never said. A single figure renders as "Due today" rather than as a
   * "check it" window, which is the honest reading of a precise answer.
   */
  const [min, max] =
    kind === 'fertilizer'
      ? soilPlan
        ? [soilPlan.fertilizeEveryDays, undefined]
        : [FERTILIZE_EVERY_DAYS, FERTILIZE_EVERY_DAYS_MAX]
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
 * The genus plan's entry for one medium, and the ONLY place `bySoil` is
 * indexed.
 *
 * Centralised because the index is the one operation here that can come back
 * undefined despite the type saying otherwise: `Record<SoilMediumId, ...>`
 * promises every key, `isGenusCarePlan` enforces it on the way into storage,
 * and a plan that reaches us by any other route (a hand-built fixture, a
 * future server shape, a partially migrated cache) would hand a caller
 * `undefined` where the compiler swore there was a plan. One place to be
 * defensive is one place to get it right.
 */
export function soilPlanFor(
  genusPlan: GenusCarePlan | null | undefined,
  medium: SoilMediumId | undefined
): SoilCarePlan | undefined {
  if (!genusPlan || !medium) return undefined;
  return genusPlan.bySoil[medium] as SoilCarePlan | undefined;
}

/*
 * FALLBACK ONLY. The diagnosis interval bent towards the medium.
 *
 * Crude by design, and discarded the moment a real genus care plan arrives.
 * The diagnosis gives one interval with no idea what the plant is potted in,
 * so a single multiplier per medium (see `waterMultiplier` in soilMedia.ts) is
 * the most that can honestly be inferred: it captures "LECA dries faster than
 * moss" and nothing finer. It exists so a plant is still scheduled offline, or
 * before the genus call lands, rather than sitting unscheduled while the app
 * waits for a better answer.
 *
 * Never below one day, because a multiplier applied to a short interval rounds
 * to zero, and a zero-day interval is a plant that is due the instant it is
 * watered - permanently red on the Home screen, and untappable out of it.
 */
export function soilAdjustedPlan(
  carePlan: CarePlan | undefined,
  medium: SoilMediumId | undefined,
  /*
   * The medium's display name, passed in rather than read from soilMedia here,
   * because this module is pure and must not know which language the app is
   * speaking. Defaults to the English label so every pre-Hebrew caller and
   * test behaves exactly as before.
   */
  mediumLabel?: string
): CarePlan | undefined {
  if (!carePlan) return undefined;
  const multiplier = soilMediumById(medium)?.waterMultiplier;
  /* Potting mix is 1, and the identity case must return the plan itself so a
   * caller can tell "adjusted to the same number" from "not adjusted". */
  if (multiplier === undefined || multiplier === 1) return carePlan;
  if (typeof carePlan.waterEveryDays !== 'number') return carePlan;

  const scale = (days: number) => Math.max(1, Math.round(days * multiplier));
  return {
    ...carePlan,
    waterEveryDays: scale(carePlan.waterEveryDays),
    ...(typeof carePlan.waterEveryDaysMax === 'number'
      ? { waterEveryDaysMax: scale(carePlan.waterEveryDaysMax) }
      : {}),
  };
}

/*
 * The watering plan a plant should actually be scheduled on.
 *
 * Best answer first:
 *   1. the genus plan's entry for the medium this plant is in - a real interval
 *      for a real substrate, which is the whole point of fetching all eight;
 *   2. the diagnosis plan scaled by the medium's multiplier - a guess, but a
 *      guess pointed in the right direction;
 *   3. the diagnosis plan exactly as it came, when there is no medium to
 *      reason about.
 *
 * A plant with none of the three gets `undefined`, NOT a default interval. A
 * fabricated number does not stay a number: it becomes a due date, then a
 * notification, then a user watering on a schedule the app invented from
 * nothing. `wateringState` already renders a plan without an interval as
 * 'unscheduled', which reads as "no schedule yet" - honest, and recoverable the
 * moment a real plan arrives.
 */
export function plantCarePlan(
  diagnosisPlan: CarePlan | undefined,
  genusPlan: GenusCarePlan | null | undefined,
  medium: SoilMediumId | undefined,
  /*
   * The medium's display name, passed in rather than read from soilMedia here,
   * because this module is pure and must not know which language the app is
   * speaking. Defaults to the English label so every pre-Hebrew caller and
   * test behaves exactly as before.
   */
  mediumLabel?: string
): CarePlan | undefined {
  const soilPlan = soilPlanFor(genusPlan, medium);
  if (soilPlan) {
    /*
     * Built from the soil plan rather than merged over the diagnosis: the two
     * describe the same plant in different substrates, so keeping the
     * diagnosis's watering sentence beside the genus plan's interval would put
     * "water weekly" next to a four-day schedule. The medium's own label goes
     * into `soil` because that field is what the care screen prints as "what
     * it is growing in", and here we know it for a fact.
     */
    return {
      soil: mediumLabel ?? soilMediumById(medium)?.label ?? diagnosisPlan?.soil ?? '',
      light: soilPlan.light,
      water: soilPlan.water,
      waterEveryDays: soilPlan.waterEveryDays,
      ...(typeof soilPlan.waterEveryDaysMax === 'number'
        ? { waterEveryDaysMax: soilPlan.waterEveryDaysMax }
        : {}),
    };
  }
  return soilAdjustedPlan(diagnosisPlan, medium);
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
  now: number,
  soilPlan?: SoilCarePlan
): WateringState {
  const state = wateringState(intervalPlanFor(kind, carePlan, soilPlan), lastAt, now);
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
