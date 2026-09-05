/*
 * What the Home dashboard says, decided away from React.
 *
 * Home is the first thing the app shows now, so every rule it follows - which
 * greeting, which two tasks, how many plants are actually in trouble - is the
 * kind of thing that should be provable under `node --test` rather than
 * eyeballed on a device at 6pm. The screen is a renderer over this file.
 */
import { plantDisplayName, type DueItem } from './portfolio.ts';
import type { CareKind, StoredPlant } from '../services/plantStore';

export type Greeting = 'morning' | 'afternoon' | 'evening';

/*
 * Three buckets, not four. "Good night" reads as a farewell to someone opening
 * the app, so the evening bucket runs to midnight and swallows the small
 * hours - a user checking their plants at 2am gets "Good evening", which is
 * odd once a year and never wrong the way "Good night, Ron" would be.
 */
export function greetingFor(hour: number): Greeting {
  if (hour < 5) return 'evening';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export interface TaskGroup {
  kind: CareKind;
  /* Whole days until the soonest item in the group; 0 is today, negative late. */
  daysUntilDue: number;
  /* The plants in the group, soonest first. Never empty. */
  plants: StoredPlant[];
}

/*
 * Two cards, side by side, and that is the whole budget - Home is a glance, and
 * a third card would push the plant strip off the first screen.
 *
 * Grouping is by care kind rather than by plant because that is how the work is
 * actually done: nobody waters one plant, walks away, and comes back for the
 * next. "Water plants - Fern + 2 others" is one trip to the sink; three
 * separate watering rows would be the same trip listed three times.
 */
export const HOME_TASK_CAP = 2;

export function taskGroups(due: DueItem[], cap: number = HOME_TASK_CAP): TaskGroup[] {
  const byKind = new Map<CareKind, TaskGroup>();

  for (const item of due) {
    const existing = byKind.get(item.kind);
    if (existing === undefined) {
      byKind.set(item.kind, { kind: item.kind, daysUntilDue: item.daysUntilDue, plants: [item.plant] });
      continue;
    }
    /* One plant can be due for the same kind only once, so no de-dup is
     * needed - but the soonest date has to win, because dueSoon sorts across
     * kinds and a group's headline date is its most urgent member. */
    if (item.daysUntilDue < existing.daysUntilDue) existing.daysUntilDue = item.daysUntilDue;
    existing.plants.push(item.plant);
  }

  return [...byKind.values()]
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
    .slice(0, cap)
    .map((group) => ({
      ...group,
      plants: [...group.plants].sort((a, b) => plantDisplayName(a).localeCompare(plantDisplayName(b))),
    }));
}

/*
 * "Fern + 2 others". The first name is the plant, the rest is a count - listing
 * three names would wrap the card and listing none would make the card useless
 * for deciding whether to tap it.
 */
export function taskSubtitle(group: TaskGroup, others: (n: number) => string): string {
  const first = plantDisplayName(group.plants[0]);
  const rest = group.plants.length - 1;
  return rest === 0 ? first : `${first} ${others(rest)}`;
}

/*
 * The number under the plant strip. Counts PLANTS, not tasks: a plant that is
 * late on both water and feed is one plant that needs a little care, and
 * saying "2" about it would make the strip lie about the size of the job.
 *
 * Only overdue and due-today count. Something due on Friday is not care the
 * user is behind on, and folding it in would leave the number permanently
 * non-zero, which is the fastest way to make a badge stop meaning anything.
 */
export function needsCareCount(due: DueItem[]): number {
  const ids = new Set<string>();
  for (const item of due) if (item.daysUntilDue <= 0) ids.add(item.plant.id);
  return ids.size;
}

/*
 * The faces on the strip. Three, then a "+n" - the strip is an entry point to
 * the portfolio, not a second copy of it.
 *
 * Most-recently-saved first, because a plant added five minutes ago is the one
 * the user is most likely looking for, and a plant with no photo is skipped
 * rather than drawn as an empty square: the strip is meant to be recognisable
 * at 40pt, and a row of grey boxes is not.
 */
export const STRIP_FACES = 3;

export function stripFaces(
  plants: StoredPlant[],
  faces: number = STRIP_FACES
): { shown: StoredPlant[]; overflow: number } {
  const withPhoto = plants.filter((p) => p.photoUri !== undefined && p.photoUri !== '');
  const ordered = [...withPhoto].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  return { shown: ordered.slice(0, faces), overflow: Math.max(0, plants.length - faces) };
}

/*
 * Which of the user's plants is the face of the hero card this visit.
 *
 * It used to be `shown[0]` - always the newest plant, forever, so a garden of
 * twelve showed one of them and the card never changed. Picking at random
 * makes the whole library the subject rather than the last thing added.
 *
 * `previous` is excluded whenever there is anything else to show. Without it a
 * true random repeats the same photo about one visit in twelve, and a hero
 * that did not change reads as a screen that failed to load rather than as a
 * coincidence - the one impression this card cannot afford.
 *
 * Pure, and `roll` is passed in rather than drawn here, so the choice is
 * testable without stubbing Math.random.
 */
export function pickHeroPhoto(
  plants: StoredPlant[],
  roll: number,
  previous?: string
): string | undefined {
  const photos = plants
    .map((p) => p.photoUri)
    .filter((uri): uri is string => uri !== undefined && uri !== '');
  if (photos.length === 0) return undefined;

  const fresh = photos.filter((uri) => uri !== previous);
  const pool = fresh.length > 0 ? fresh : photos;
  // A roll of exactly 1 (or anything out of range) must not index past the end.
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(roll * pool.length)));
  return pool[index];
}
