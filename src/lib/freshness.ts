/*
 * How old a stock check is, in words.
 *
 * Results are served from a cache for up to a week, so this line is what keeps
 * the screen honest: a price scraped five days ago is useful, but only if it is
 * labelled as five days old. Rounding is deliberately DOWN ("6 days ago", never
 * "a week ago" for something checked six days back) - overstating freshness is
 * the one error that sends someone to a shop for a plant that sold out.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function stockAgeLabel(
  scrapedAt: number | null,
  now: number,
  words: FreshnessCopy = EN_FRESHNESS_COPY
): string | null {
  if (scrapedAt === null || !Number.isFinite(scrapedAt)) return null;

  const age = now - scrapedAt;
  // A clock skew between server and phone must not produce "in 3 minutes".
  if (age < 2 * MINUTE) return words.justNow;
  if (age < HOUR) return words.minutesAgo(Math.floor(age / MINUTE));
  if (age < DAY) return words.hoursAgo(Math.floor(age / HOUR));
  const days = Math.floor(age / DAY);
  return days === 1 ? words.yesterday : words.daysAgo(days);
}

/*
 * The wording, injected like the other pure modules. Rounding stays DOWN here
 * on purpose - overstating freshness is the failure that matters.
 */
export interface FreshnessCopy {
  justNow: string;
  minutesAgo: (minutes: number) => string;
  hoursAgo: (hours: number) => string;
  yesterday: string;
  daysAgo: (days: number) => string;
}

/* English, so every existing caller and test behaves exactly as before. */
export const EN_FRESHNESS_COPY: FreshnessCopy = {
  justNow: 'Stock checked just now',
  minutesAgo: (minutes) => `Stock checked ${minutes} min ago`,
  hoursAgo: (hours) => `Stock checked ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`,
  yesterday: 'Stock checked yesterday',
  daysAgo: (days) => `Stock checked ${days} days ago`,
};
