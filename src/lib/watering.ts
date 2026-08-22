import type { CarePlan } from '../types';

/*
 * The watering schedule.
 *
 * Pure on purpose - no storage, no clock, no notifications. Everything here is
 * (care plan, when it was last watered, now) → what to show. That is what makes
 * the interesting cases testable without a device: a plant three days overdue,
 * a plant never watered, a plant whose diagnosis carried no interval at all.
 *
 * TWO ENDS OF A RANGE, TWO MEANINGS. "Every 7-10 days" is not a deadline, it is
 * a window: watering is DUE at day 7 and OVERDUE after day 10. Picking a single
 * day out of that range would have meant choosing between nagging early and
 * warning late, and either choice is wrong for half the species - overwatering
 * kills more houseplants than drought, and the care plan's own advice is to
 * check the soil rather than obey the calendar. So the window is shown as a
 * window, and "due" means "go check it", not "you are late".
 */

export const DAY_MS = 86_400_000;

export type WateringStatus =
  /* No interval in the care plan - nothing to schedule, only prose to read. */
  | 'unscheduled'
  /* Scheduled, but the user has never logged a watering, so there is no anchor. */
  | 'never_watered'
  | 'ok'
  | 'due'
  | 'overdue';

export interface WateringState {
  status: WateringStatus;
  /* Start of the window, in whole days. Null when unscheduled. */
  intervalDays: number | null;
  /* End of the window when the care plan gave a range, else null. */
  intervalDaysMax: number | null;
  /* Epoch ms the plant becomes due. Null unless status is ok/due/overdue. */
  nextDueAt: number | null;
  /* Whole days until due; 0 is today, negative is late. Null when unknown. */
  daysUntilDue: number | null;
  /* One short line for the UI. Never empty except when unscheduled. */
  label: string;
}

export function hasSchedule(carePlan: CarePlan | undefined): boolean {
  return typeof carePlan?.waterEveryDays === 'number';
}

/* "Every 7-10 days" / "Every 14 days" - the interval as the user reads it. */
export function intervalLabel(carePlan: CarePlan | undefined): string {
  const min = carePlan?.waterEveryDays;
  if (typeof min !== 'number') return '';
  const max = carePlan?.waterEveryDaysMax;
  if (typeof max === 'number' && max > min) return `Every ${min}-${max} days`;
  return min === 1 ? 'Every day' : `Every ${min} days`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function wateringState(
  carePlan: CarePlan | undefined,
  lastWateredAt: string | undefined,
  now: number
): WateringState {
  const min = carePlan?.waterEveryDays;

  if (typeof min !== 'number') {
    return {
      status: 'unscheduled',
      intervalDays: null,
      intervalDaysMax: null,
      nextDueAt: null,
      daysUntilDue: null,
      label: '',
    };
  }

  const rawMax = carePlan?.waterEveryDaysMax;
  const max = typeof rawMax === 'number' && rawMax > min ? rawMax : null;

  const base = {
    intervalDays: min,
    intervalDaysMax: max,
  };

  /*
   * An unparseable timestamp is treated as no timestamp. A stored date that
   * cannot be read must not become `NaN` days overdue on the user's screen.
   */
  const last = lastWateredAt ? Date.parse(lastWateredAt) : NaN;
  if (Number.isNaN(last)) {
    return {
      ...base,
      status: 'never_watered',
      nextDueAt: null,
      daysUntilDue: null,
      label: `${intervalLabel(carePlan)} · tap to start`,
    };
  }

  const nextDueAt = last + min * DAY_MS;
  /*
   * The window closes at the far end of the range, plus the rest of that day -
   * a plant is not "1 day overdue" an hour after the window's last day begins.
   * With no range, the single figure gets the same one-day grace, so a schedule
   * never flips from on-time to late within the same day.
   */
  const overdueAt = last + ((max ?? min) + 1) * DAY_MS;

  // Round UP: any part of a day still to wait reads as a day to wait, so a
  // plant due in 20 hours says "in 1 day" rather than "today".
  const daysUntilDue = Math.ceil((nextDueAt - now) / DAY_MS);

  if (now >= overdueAt) {
    const late = Math.max(1, Math.floor((now - nextDueAt) / DAY_MS));
    return {
      ...base,
      status: 'overdue',
      nextDueAt,
      daysUntilDue,
      label: `${plural(late, 'day')} overdue`,
    };
  }

  if (now >= nextDueAt) {
    return {
      ...base,
      status: 'due',
      nextDueAt,
      daysUntilDue,
      label: max ? 'Due now - check the soil' : 'Due today',
    };
  }

  return {
    ...base,
    status: 'ok',
    nextDueAt,
    daysUntilDue,
    label: daysUntilDue <= 1 ? 'Next water tomorrow' : `Next water in ${plural(daysUntilDue, 'day')}`,
  };
}

/*
 * Whether the library list should call this plant out. Deliberately narrower
 * than `status !== 'ok'`: a plant that has never been watered is not a problem
 * to flag on the Home screen, it is a schedule the user has not started.
 */
export function needsWater(state: WateringState): boolean {
  return state.status === 'due' || state.status === 'overdue';
}
