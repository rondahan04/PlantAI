/*
 * Who a "do it for all of them" button actually acts on.
 *
 * Both portfolio bulk actions look like they mean "everything", and neither
 * does. The gap between the label and the truth is the whole reason this file
 * exists as pure, tested rules rather than a filter inlined in a screen: a bulk
 * action that quietly does the wrong thing to twelve plants at once is twelve
 * times worse than getting one plant wrong, and it is invisible until the
 * schedule has already drifted.
 */

import type { StoredPlant } from '../services/plantStore';
import type { DueItem } from './portfolio';

/*
 * Plants a bulk diagnosis can actually run on, and how many it has to leave
 * alone.
 *
 * Two exclusions, for different reasons:
 *
 *   already diagnosed - re-running would spend a paid call to overwrite a
 *                       finding with a fresh one from the SAME photograph.
 *                       Nothing has changed, so nothing can be learned.
 *   no photograph     - there is nothing to send. A hand-added plant off the
 *                       shelf frequently has no picture, and this is the case
 *                       the button must report rather than swallow: "diagnosed
 *                       4, skipped 8" is honest, silently doing 4 is not.
 *
 * Order is preserved so the progress row counts up the list the user is looking
 * at rather than in some internal order.
 */
export interface DiagnoseTargets {
  targets: StoredPlant[];
  /* Undiagnosed, but with no photo to send. Surfaced, never hidden. */
  skippedNoPhoto: number;
}

export function diagnoseTargets(plants: StoredPlant[]): DiagnoseTargets {
  const undiagnosed = plants.filter((p) => p.diagnosis === undefined);
  const targets = undiagnosed.filter((p) => p.photoUri !== undefined && p.photoUri !== '');
  return { targets, skippedNoPhoto: undiagnosed.length - targets.length };
}

/*
 * Plants "water all" may mark, which is NOT every plant.
 *
 * Watering is recorded, not just displayed: the stamp resets the plant's clock
 * and appends to a log the history screen shows. Marking a plant that was
 * watered yesterday therefore records water it never got AND pushes its next
 * reminder a full interval late - and overwatering is the most common way a
 * houseplant dies, so the failure is not cosmetic.
 *
 * Due and overdue only. That is also what actually happened if the user walked
 * around with a can doing the ones that needed it, which is the errand this
 * button exists for.
 *
 * Deduplicated by plant: `due` carries one row per care KIND, so a plant that
 * is due for both water and fertilizer appears twice and would otherwise be
 * marked (and counted) twice.
 */
export function waterTargets(due: DueItem[]): StoredPlant[] {
  const seen = new Set<string>();
  const out: StoredPlant[] = [];
  for (const item of due) {
    if (item.kind !== 'water') continue;
    // `dueSoon` also carries plants that are merely approaching. Only what is
    // actually due (today) or already late gets marked.
    if (item.daysUntilDue > 0) continue;
    if (seen.has(item.plant.id)) continue;
    seen.add(item.plant.id);
    out.push(item.plant);
  }
  return out;
}
