/*
 * When a plant row actually needs redrawing.
 *
 * WHY THIS IS NOT JUST `React.memo`. Every `setLibrary` re-reads storage, and
 * that read goes through `JSON.parse` - so every plant object is a brand new
 * reference even when nothing about it changed. Reference equality can
 * therefore never hold, and a bare `React.memo` would be pure overhead. The
 * Portfolio calls `setLibrary` on focus, after every bulk action, and after
 * each cloud refresh, so without this every row re-renders every time.
 *
 * It lives here, away from the component, because a wrong comparator is a
 * user-visible bug of the worst kind - a card that quietly keeps showing the
 * old name, the old photo, or "due today" for a plant that was watered an hour
 * ago - and `PlantCard.tsx` imports React Native, so nothing in it can be
 * tested under `node --test`.
 */

import type { StoredPlant } from '../services/plantStore';
import { plantDisplayName, plantSecondaryName, type CareSlot } from './portfolio.ts';

export interface PlantCardShape {
  plant: StoredPlant;
  slots?: CareSlot[];
  onEdit?: () => void;
}

const NO_SLOTS: CareSlot[] = [];

export function sameSlots(a: CareSlot[], b: CareSlot[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((slot, i) => {
    const other = b[i];
    return (
      slot.kind === other.kind &&
      slot.status === other.status &&
      slot.daysUntilDue === other.daysUntilDue &&
      slot.label === other.label
    );
  });
}

/*
 * Two rules worth stating, because both look like bugs until you know why:
 *
 * CALLBACK IDENTITY IS IGNORED. The list creates both handlers inline per row,
 * so they are new objects on every render and comparing them would defeat the
 * entire optimisation. That is safe here because they close over nothing but
 * the navigator and the plant's id, and the id IS compared - so a handler can
 * never be stale in a way this misses. Only the PRESENCE of `onEdit` matters,
 * since it swaps the trailing chevron for a pencil.
 *
 * `savedAt` IS COMPARED AS A STRING, not as the "3 days ago" line it renders.
 * That wording is a function of the clock, so it can go stale by a day without
 * any prop changing. Accepted deliberately: the screen re-reads on focus, and
 * nobody is watching a card tick over midnight.
 */
export function samePlantCard(a: PlantCardShape, b: PlantCardShape): boolean {
  const p = a.plant;
  const q = b.plant;
  return (
    p.id === q.id &&
    p.photoUri === q.photoUri &&
    p.savedAt === q.savedAt &&
    p.addedVia === q.addedVia &&
    p.diagnosis?.condition === q.diagnosis?.condition &&
    p.diagnosis?.conditionLabel === q.diagnosis?.conditionLabel &&
    /* The two name lines are derived from nickname, species and diagnosis in a
     * documented order. Compare what is actually printed rather than every
     * field that might feed into it - that way a change to the naming rule
     * cannot silently stop invalidating the card. */
    plantDisplayName(p) === plantDisplayName(q) &&
    plantSecondaryName(p) === plantSecondaryName(q) &&
    (a.onEdit === undefined) === (b.onEdit === undefined) &&
    sameSlots(a.slots ?? NO_SLOTS, b.slots ?? NO_SLOTS)
  );
}
