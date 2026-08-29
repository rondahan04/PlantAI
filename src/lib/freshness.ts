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

export function stockAgeLabel(scrapedAt: number | null, now: number): string | null {
  if (scrapedAt === null || !Number.isFinite(scrapedAt)) return null;

  const age = now - scrapedAt;
  // A clock skew between server and phone must not produce "in 3 minutes".
  if (age < 2 * MINUTE) return 'Stock checked just now';
  if (age < HOUR) return `Stock checked ${Math.floor(age / MINUTE)} min ago`;
  if (age < DAY) {
    const hours = Math.floor(age / HOUR);
    return `Stock checked ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(age / DAY);
  return days === 1 ? 'Stock checked yesterday' : `Stock checked ${days} days ago`;
}
