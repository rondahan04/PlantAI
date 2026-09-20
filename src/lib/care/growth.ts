/*
 * The growth journal: a plant's photographs over time, in the order they were
 * taken.
 *
 * WHY THIS IS NOT A CARE LOG AND NOT A LEAF. A watering is an instant with
 * nothing attached to it, so it stores as a timestamp. A leaf is an entity with
 * two ends, so it stores as a pair. A journal entry is a timestamp with a FILE
 * and a sentence hanging off it, and the file is the part that makes it
 * different from everything else in the app: the record and the bytes can
 * diverge, and every rule here exists because of that. An entry whose photo
 * never finished copying is still the user's note about their plant; an entry
 * with no photo AND no note is nothing at all.
 *
 * Pure, like every other lib/care module, for the same two reasons: the screens
 * that use it import React Native and cannot run under bare `node --test`, and
 * "which entry does the undo remove" is exactly the kind of rule that must be
 * tested rather than eyeballed on a device.
 */

export interface GrowthEntry {
  /*
   * Also the PHOTO FILE'S NAME on disk (see services/media/photos.ts). That is
   * why it is minted by the caller rather than derived from the timestamp: two
   * photos taken in the same second would otherwise share a file, and the
   * second would silently overwrite the first.
   */
  id: string;
  /* ISO-8601. The moment the user added it, which is the moment they took it
   * for every path the app offers - there is no back-dating. */
  takenAt: string;
  /*
   * Where the picture is. A document-directory URI once the copy lands, a
   * picker cache URI until then, and the empty string for an entry whose photo
   * could not be rescued at all. Readers must tolerate all three, exactly as
   * they already do for `StoredPlant.photoUri`.
   */
  photoUri: string;
  /*
   * What the user wrote about this shot. Absent means they did not write
   * anything, which is the common case - a photo is the point and the note is
   * the exception, so it must never be backfilled with a placeholder.
   */
  note?: string;
}

/*
 * Roughly a photo a week for four years. The journal is one JSON blob parsed
 * when a plant's screen opens, and - unlike the care logs - every entry it
 * holds also owns a file on disk, so an unbounded list is a leak in two
 * directions at once.
 */
export const MAX_GROWTH_ENTRIES = 200;

/*
 * A note is a caption, not a diary page. It renders into a timeline row that
 * gives it a few lines, so the bound is applied on the way in rather than by
 * truncating at every read site - the same rule as the onboarding name.
 */
export const MAX_NOTE_LENGTH = 280;

function isIso(v: unknown): v is string {
  return typeof v === 'string' && v !== '' && !Number.isNaN(Date.parse(v));
}

/*
 * Trim and bound what the user typed. Returns undefined for anything that is
 * not a usable note, so callers never have to special-case the empty string and
 * the record never holds a key that means nothing.
 *
 * Inner whitespace is LEFT ALONE, unlike `normalizeName`: a note is prose and
 * may legitimately hold a line break between two thoughts. Only the ends are
 * cleaned, because a trailing newline from a multiline field is an artefact of
 * the keyboard rather than something the user wrote.
 */
export function normalizeNote(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().slice(0, MAX_NOTE_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}

/*
 * Clean a stored list into something every reader can walk unguarded, newest
 * first.
 *
 * An entry with no usable timestamp is DROPPED: the journal is ordered by time
 * and a row that cannot be placed on that line has nowhere to be drawn. A
 * damaged photo URI is treated more gently - it becomes the empty string and
 * the entry survives, because the note and the date are the user's facts while
 * a lost file is the app's failure, and deleting the record over it would
 * compound one loss into two.
 *
 * An entry that ends up with NEITHER a photo nor a note is dropped. What would
 * be left is a date with nothing attached, which renders as an empty row the
 * user cannot explain and cannot act on.
 */
export function normalizeGrowth(raw: unknown): GrowthEntry[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: GrowthEntry[] = [];

  for (const candidate of list) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const e = candidate as Record<string, unknown>;
    if (typeof e.id !== 'string' || e.id === '') continue;
    if (!isIso(e.takenAt)) continue;
    if (seen.has(e.id)) continue;

    const photoUri = typeof e.photoUri === 'string' ? e.photoUri : '';
    const note = normalizeNote(e.note);
    if (photoUri === '' && note === undefined) continue;

    seen.add(e.id);
    out.push({ id: e.id, takenAt: e.takenAt, photoUri, ...(note !== undefined ? { note } : {}) });
  }

  /*
   * Sorted here rather than trusted from storage. Every writer below puts the
   * newest first, but a blob that has been through an older build, a merge, or
   * a hand edit has not necessarily kept that, and the timeline's whole meaning
   * is the order.
   */
  return out.sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt));
}

/*
 * Add one photograph, newest first and bounded.
 *
 * The bound drops the OLDEST entries, which is the opposite of what a photo
 * album would want and the only thing the storage can afford - see
 * MAX_GROWTH_ENTRIES. It is far enough out that nobody reaches it by using the
 * feature as intended; a user who does has already been told by the journal
 * itself, which shows the span it covers.
 */
export function addEntry(
  entries: readonly GrowthEntry[],
  entry: { id: string; photoUri: string; note?: string },
  at: number
): GrowthEntry[] {
  const note = normalizeNote(entry.note);
  const fresh: GrowthEntry = {
    id: entry.id,
    takenAt: new Date(at).toISOString(),
    photoUri: entry.photoUri,
    ...(note !== undefined ? { note } : {}),
  };
  /* Never two rows under one id - the id names a file, and a duplicate would
   * put two entries on one picture. */
  const rest = entries.filter((e) => e.id !== fresh.id);
  return [fresh, ...rest].slice(0, MAX_GROWTH_ENTRIES);
}

export function removeEntry(entries: readonly GrowthEntry[], id: string): GrowthEntry[] {
  return entries.filter((e) => e.id !== id);
}

/*
 * Point an entry at the copy that landed in the document directory.
 *
 * Called after the file copy finishes, the same way `plantLibrary.update` is
 * called after `plantPhotos.adopt`. A missing entry is not an error: the user
 * can delete a photo while its copy is still running, and inventing the row
 * back would resurrect something they just removed.
 */
export function repointPhoto(
  entries: readonly GrowthEntry[],
  id: string,
  photoUri: string
): GrowthEntry[] {
  return entries.map((e) => (e.id === id ? { ...e, photoUri } : e));
}

/*
 * Rewrite one entry's note. An empty note CLEARS it rather than storing '',
 * so "I never wrote anything" and "I deleted what I wrote" produce the same
 * record - they are the same fact.
 *
 * An entry left with neither photo nor note is dropped, for the reason
 * `normalizeGrowth` gives: it would render as a date with nothing under it.
 */
export function setNote(
  entries: readonly GrowthEntry[],
  id: string,
  note: string | undefined
): GrowthEntry[] {
  const clean = normalizeNote(note);
  const out: GrowthEntry[] = [];
  for (const e of entries) {
    if (e.id !== id) {
      out.push(e);
      continue;
    }
    if (clean === undefined && e.photoUri === '') continue;
    const { note: _dropped, ...rest } = e;
    out.push(clean === undefined ? rest : { ...rest, note: clean });
  }
  return out;
}

/*
 * Whole days between the oldest and newest entry, or undefined when there is
 * nothing to span - one photo is a moment, not a period.
 *
 * Read off the ends rather than off the length: a journal with three photos
 * taken in one afternoon has spanned nothing, and "3 photos over 0 days" is
 * the honest line there.
 */
export function growthSpanDays(entries: readonly GrowthEntry[]): number | undefined {
  if (entries.length < 2) return undefined;
  let oldest = Infinity;
  let newest = -Infinity;
  for (const e of entries) {
    const t = Date.parse(e.takenAt);
    if (Number.isNaN(t)) continue;
    if (t < oldest) oldest = t;
    if (t > newest) newest = t;
  }
  if (!Number.isFinite(oldest) || !Number.isFinite(newest)) return undefined;
  return Math.floor((newest - oldest) / 86_400_000);
}

/* Whole days since an entry was added, floored and never negative - a clock
 * that moved backwards must not produce "taken in -2 days". */
export function entryAgeDays(entry: GrowthEntry, now: number): number {
  const t = Date.parse(entry.takenAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/* Every photo file the journal still claims. The sweep that deletes orphaned
 * files needs exactly this list, and an entry with no photo owns no file. */
export function photoIds(entries: readonly GrowthEntry[]): string[] {
  return entries.filter((e) => e.photoUri !== '').map((e) => e.id);
}
