import type { StoredPlant, CareKind } from '../services/plantStore';
import type { GenusCarePlan } from './genusCarePlan.ts';
import {
  CARE_KINDS,
  EN_CARE_COPY,
  careState,
  monthsish,
  plantCarePlan,
  soilPlanFor,
  type CareCopy,
} from './care.ts';
import { EN_WATERING_COPY, type WateringCopy, type WateringState } from './watering.ts';

/*
 * Everything the Portfolio tab decides, decided here.
 *
 * The tab replaces "My Plants" and holds EVERY plant the user owns: the ones
 * they photographed for a diagnosis and the healthy ones they added by hand.
 * That mix is the whole reason this module exists. A screen that renders two
 * kinds of record has to keep answering the same three questions - is this one
 * diagnosed, what do I call it, and does it need anything this week - and each
 * of those answers has a wrong version that looks right on the four plants a
 * developer has on screen and goes wrong on a real library.
 *
 * Pure, like the rest of src/lib: no expo-*, no react-native, no clock and no
 * storage. `now` and the genus-plan lookup both arrive as arguments, so the
 * interesting cases - a plant two days overdue, a plant with no schedule at
 * all, a plant whose genus plan landed after the diagnosis did - are testable
 * under `node --test` without a device. The screen that comes later is a
 * renderer over this file, which is what keeps it a renderer.
 */

export type PortfolioFilter = 'all' | 'needsCare' | 'diagnosed';

/*
 * 'diagnosed' means HAS A DIAGNOSIS, not "arrived through the camera".
 *
 * `addedVia` is the tempting field and it is the wrong one. It records how the
 * record STARTED, and the two drift the moment a hand-added plant is
 * photographed: that plant is still `addedVia: 'manual'` and now carries a real
 * finding. The filter is answering "which of my plants have I actually had
 * checked", which is a question about the diagnosis, so it reads the diagnosis.
 *
 * Order is preserved rather than re-sorted. The list arrives newest first from
 * the store, and a filter that also reordered would make toggling the chip look
 * like the library had been shuffled.
 */
export function filterPortfolio(
  plants: StoredPlant[],
  filter: PortfolioFilter,
  /*
   * Whether a plant is behind on its care. Injected rather than computed here
   * because the answer needs a clock and a genus-plan lookup, and this function
   * is the one place in the module that is allowed to know neither - the caller
   * already builds the schedule for every card it draws, so it hands the
   * predicate down instead of making this file build it a second time.
   *
   * Absent, the chip filters nothing away: a caller that does not know what is
   * due must not silently claim nothing is.
   */
  isBehind?: (plant: StoredPlant) => boolean
): StoredPlant[] {
  if (filter === 'all') return plants;
  if (filter === 'needsCare') return isBehind ? plants.filter(isBehind) : plants;
  return plants.filter((p) => p.diagnosis !== undefined);
}

/*
 * What to call this plant, best answer first: the name the user gave it, then
 * the species they asserted, then whatever the camera decided.
 *
 * The order is the point. A nickname is the user speaking, a species is the
 * user pointing at a catalog entry, and `diagnosis.plantName` is a model's
 * guess - so the guess must never win over either. It is last rather than
 * absent because a scanned plant has nothing else.
 *
 * 'Unnamed plant' should be unreachable: the store drops any record carrying
 * neither a species nor a diagnosis, precisely so a nameless card cannot
 * render. It is here anyway because a library screen is the wrong place to
 * discover a storage bug, and an empty string in a title row reads as a broken
 * layout rather than as missing data.
 */
export function plantDisplayName(plant: StoredPlant): string {
  return (
    plant.nickname?.trim() ||
    plant.species?.name?.trim() ||
    plant.diagnosis?.plantName?.trim() ||
    'Unnamed plant'
  );
}

/*
 * The botanical line under the name - and EMPTY when it would only repeat what
 * is already on the card.
 *
 * Whichever name lost to the one above it is the natural subtitle: nickname
 * over species leaves the species, species alone leaves the binomial. But the
 * two collapse often enough to matter - a user who never nicknamed a Monstera
 * that the model named "Monstera deliciosa" would get the same string twice,
 * stacked - so the comparison is done rather than assumed. An empty string, not
 * a repeat: the caller renders nothing at all, and a card with one name looks
 * deliberate where a card with the same name twice looks broken.
 */
export function plantSecondaryName(plant: StoredPlant): string {
  const primary = plantDisplayName(plant);
  const candidates = [
    plant.nickname ? plant.species?.name : undefined,
    plant.species?.scientificName,
    plant.diagnosis?.scientificName,
    plant.diagnosis?.plantName,
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && value.toLowerCase() !== primary.toLowerCase()) return value;
  }
  return '';
}

export interface DueItem {
  plant: StoredPlant;
  kind: CareKind;
  /* Whole days until due; 0 is today, negative is late. Never null here - an
   * item with no known due date is not in this list at all. */
  daysUntilDue: number;
  /* The kind-specific line from `careState`, ready to render. */
  label: string;
}

/* A week, because the strip is called "Due this week" and because a longer
 * window turns a short list of things to do today into a standing backlog. */
export const DUE_WINDOW_DAYS = 7;

/*
 * Everything due within the window, across every kind of care, most overdue
 * first.
 *
 * ONE ROW PER PLANT PER KIND, not per plant. The strip exists so nobody opens
 * nine plants to find out what needs doing, and a plant that is both thirsty
 * and hungry has two things to do; collapsing them would hide one of the two
 * behind a tap, which is exactly the tap the strip is meant to remove.
 *
 * `genusPlanFor` is a synchronous lookup and may be null. It has to be
 * synchronous because this runs on every render of the list, and it has to be
 * nullable because the cache is a nice-to-have: the plan for a genus may not
 * have been fetched yet, or the caller may be a context that has no cache to
 * consult. Passing null degrades to the diagnosis interval bent towards the
 * medium, which is what `plantCarePlan` already does.
 *
 * The strip is "Due THIS WEEK", so a plant that is merely on schedule and comes
 * up in six days belongs in it. The window is therefore the filter and the
 * status is not: anything with a known due date inside `DUE_WINDOW_DAYS` is
 * listed, whether it is late, due today, or still ahead of the user.
 *
 * 'unscheduled' and 'never_watered' both mean WE DO NOT KNOW, and neither is
 * allowed in. The first is a plant with no interval anywhere; the second is a
 * plant with an interval but no anchor, because the user has never logged this
 * kind of care. Treating either as due would fill the strip with plants that
 * are not actually due - most of a fresh library, on the first launch after
 * this ships - and a "due this week" list that is mostly guesses is one the
 * user learns to scroll past.
 */
export function dueSoon(
  plants: StoredPlant[],
  now: number,
  genusPlanFor: ((plant: StoredPlant) => GenusCarePlan | null) | null,
  /* Passed straight through to careState - this module decides WHICH plants
   * are due, never how that reads. */
  careWords: CareCopy = EN_CARE_COPY,
  wateringWords: WateringCopy = EN_WATERING_COPY
): DueItem[] {
  const items: DueItem[] = [];

  for (const plant of plants) {
    const genusPlan = genusPlanFor ? genusPlanFor(plant) : null;
    const soilPlan = soilPlanFor(genusPlan, plant.soilMedium);
    const carePlan = plantCarePlan(plant.diagnosis?.carePlan, genusPlan, plant.soilMedium);

    for (const kind of CARE_KINDS) {
      const state = careState(kind, carePlan, lastCareAt(plant, kind), now, soilPlan, careWords, wateringWords);
      if (state.status === 'unscheduled' || state.status === 'never_watered') continue;
      /* Belt and braces: a scheduled, anchored plant always carries a number,
       * but the type says null is possible and a NaN sort key would scramble
       * the whole strip rather than misplace one row. */
      if (state.daysUntilDue === null) continue;
      if (state.daysUntilDue > DUE_WINDOW_DAYS) continue;
      items.push({ plant, kind, daysUntilDue: state.daysUntilDue, label: state.label });
    }
  }

  /* Ascending, so the most negative - the most overdue - is first. Sort is
   * stable in Node, so plants tied on the same day keep the library's own
   * order rather than being reshuffled on each render. */
  return items.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

const LAST_AT: Record<CareKind, keyof StoredPlant> = {
  water: 'lastWateredAt',
  repot: 'lastRepottedAt',
  fertilizer: 'lastFertilizedAt',
};

function lastCareAt(plant: StoredPlant, kind: CareKind): string | undefined {
  const value = plant[LAST_AT[kind]];
  return typeof value === 'string' ? value : undefined;
}

/* One slot on a plant card: what the plant needs, when, in three words. */
export interface CareSlot {
  kind: CareKind;
  status: WateringState['status'];
  /* Whole days until due; 0 is today, negative is late. Null when there is no
   * schedule, or one that has never been started. */
  daysUntilDue: number | null;
  /* The compact line the card prints. Never empty. */
  label: string;
}

/* The short forms a card has room for. The long sentences in `CareCopy` -
 * "Next feed in 5 days" - are right on a detail screen and far too wide for
 * three columns under a plant name, so this is a separate, smaller vocabulary
 * rather than a truncation of that one. */
export interface ScheduleCopy {
  today: string;
  tomorrow: string;
  overdue: string;
  inDays: (days: number) => string;
  /* A schedule that exists but has never been started - the interval itself is
   * the most useful thing to show. */
  every: (interval: string) => string;
  /* No schedule at all, from the plant, its genus or its medium. */
  none: string;
}

export const EN_SCHEDULE_COPY: ScheduleCopy = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  overdue: 'Overdue',
  inDays: (days) => `In ${days} days`,
  every: (interval) => `Every ${interval}`,
  none: 'Not set',
};

/*
 * All three care kinds for one plant, always, in a fixed order.
 *
 * Always three, because the row is a rhythm: a card that shows one column for a
 * plant with only a watering schedule and three for the plant below it reads as
 * two different card designs. A kind with nothing scheduled says so in the
 * quietest way the palette allows, which is also the nudge to set one.
 *
 * The genus plan is the fallback that makes that rare. A hand-added Monstera
 * carries no feeding interval of its own, but its genus does, so the slot shows
 * the real interval rather than a dash - which is the whole reason
 * `plantCarePlan` takes a genus plan at all.
 */
export function plantSchedule(
  plant: StoredPlant,
  now: number,
  genusPlan: GenusCarePlan | null,
  words: ScheduleCopy = EN_SCHEDULE_COPY,
  careWords: CareCopy = EN_CARE_COPY,
  wateringWords: WateringCopy = EN_WATERING_COPY
): CareSlot[] {
  const soilPlan = soilPlanFor(genusPlan, plant.soilMedium);
  const carePlan = plantCarePlan(plant.diagnosis?.carePlan, genusPlan, plant.soilMedium);

  return CARE_KINDS.map((kind) => {
    const state = careState(kind, carePlan, lastCareAt(plant, kind), now, soilPlan, careWords, wateringWords);
    return { kind, status: state.status, daysUntilDue: state.daysUntilDue, label: slotLabel(state, words, careWords) };
  });
}

function slotLabel(state: WateringState, words: ScheduleCopy, careWords: CareCopy): string {
  switch (state.status) {
    case 'unscheduled':
      return words.none;
    case 'never_watered':
      return words.every(monthsish(state.intervalDays, careWords));
    case 'overdue':
      return words.overdue;
    case 'due':
      return words.today;
    default:
      if (state.daysUntilDue === null) return words.none;
      if (state.daysUntilDue <= 0) return words.today;
      return state.daysUntilDue === 1 ? words.tomorrow : words.inDays(state.daysUntilDue);
  }
}

/*
 * Behind on care - the Needs care chip, and the same rule the dashboard counts
 * with: due today or late, nothing further out. A plant due on Friday is not
 * one the user is behind on, and folding those in would leave the chip
 * permanently non-empty, which is the fastest way to make it stop meaning
 * anything.
 */
export function isBehindOnCare(slots: CareSlot[]): boolean {
  return slots.some((slot) => slot.status === 'due' || slot.status === 'overdue');
}

/*
 * Whether to offer a returning user the guest plants they saved before signing
 * up. Both halves of this were wrong on a real device, in opposite directions.
 *
 * Logged OUT the banner must not appear: `plantRepo.importGuestPlants()` has no
 * user id to write against, and the empty result it returns is byte-identical
 * to "every plant imported fine" - so the banner congratulated itself and
 * dismissed, having moved nothing.
 *
 * Logged IN it must appear even though the cloud mirror is empty, because a
 * mirror that is empty is exactly what a first login looks like. That is the
 * one moment this banner exists for.
 */
export function offersGuestImport(opts: { loggedIn: boolean; guestCount: number }): boolean {
  return opts.loggedIn && opts.guestCount > 0;
}

/*
 * Which of the two Home layouts to paint (D8: marketing on first run, library
 * once there is something to show).
 *
 * `offeringImport` belongs in this decision and its absence was a data-loss
 * bug: the library layout is the only one that renders the import banner, so a
 * freshly signed-up user - zero plants in the mirror, several still in the
 * guest key - was shown first-run marketing copy and given no way to reach the
 * plants they had just "lost". They were never deleted; they were unreachable,
 * which to the person holding the phone is the same thing.
 */
export function showsLibraryLayout(opts: {
  plantCount: number;
  libraryReadable: boolean;
  offeringImport: boolean;
}): boolean {
  return opts.plantCount > 0 || !opts.libraryReadable || opts.offeringImport;
}
