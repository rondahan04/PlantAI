/*
 * Month grid arithmetic for the watering calendar.
 *
 * Pure, dependency-free, and local-time throughout. That last part is the whole
 * reason this is its own module with its own tests: a watering is stored as an
 * instant (ISO-8601, UTC) but read as a DAY, and the two disagree for anyone
 * east or west of Greenwich. Watering a plant at 2am in Tel Aviv is 23:00 the
 * previous day in UTC — comparing the raw strings would light up the wrong
 * square, every time, for every user in the country this app was built in.
 * Everything below therefore goes through `new Date(...)` accessors, which are
 * local, and never through `toISOString().slice(0, 10)`, which is not.
 */

/* Sunday-first, matching the region this app is used in. */
export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export interface MonthCell {
  /* Null for the padding squares before the 1st and after the last day. */
  date: Date | null;
  day: number | null;
}

export interface MonthView {
  year: number;
  /* 0-11, as JavaScript counts them. */
  month: number;
  title: string;
  weeks: MonthCell[][];
}

/* A stable key for one local calendar day: "2026-08-19". */
export function dayKey(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/* The set of local days on which any of these timestamps fall. */
export function dayKeySet(timestamps: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const t of timestamps) {
    const key = dayKey(t);
    if (key) out.add(key);
  }
  return out;
}

/*
 * Build the six-row-max grid for a month, padded to whole weeks.
 *
 * The number of rows follows the month rather than being fixed at six: a fixed
 * grid leaves a blank row under most months, and the calendar is a small
 * element inside a scrolling screen, not a page of its own.
 */
export function monthView(year: number, month: number): MonthView {
  // Normalizes out-of-range months, so `monthView(2026, 12)` is January 2027
  // and the caller's next/previous buttons need no wrapping logic of their own.
  const first = new Date(year, month, 1);
  const y = first.getFullYear();
  const m = first.getMonth();

  // Day 0 of the following month is the last day of this one.
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const leading = first.getDay();

  const cells: MonthCell[] = [];
  for (let i = 0; i < leading; i++) cells.push({ date: null, day: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(y, m, d), day: d });
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null });

  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return {
    year: y,
    month: m,
    title: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    weeks,
  };
}

/* Step a month view forward or back. Year rollover is handled by monthView. */
export function shiftMonth(view: { year: number; month: number }, by: number): MonthView {
  return monthView(view.year, view.month + by);
}
