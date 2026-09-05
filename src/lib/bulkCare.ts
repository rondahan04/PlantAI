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
 * Plants "water all" marks: all of them.
 *
 * This was previously restricted to what was due, overdue, or never watered,
 * on the reasoning that marking a plant watered yesterday records water it
 * never got and pushes its next reminder a full interval late. That reasoning
 * is still true, and the button no longer honours it - by explicit product
 * decision (2026-09-05), because the label says "Water all" and a user who has
 * just walked round the flat with a can has in fact watered all of them.
 *
 * The honesty moved into the confirmation instead: it now says plainly that
 * plants which were not due are included, so the user is agreeing to the
 * schedule reset rather than discovering it later.
 *
 * Everything, including plants with no schedule at all: for those, the stamp
 * is simply a log entry with nothing to reschedule.
 *
 * Deduplicated by id defensively. The list comes from one store read so it
 * should not repeat, but watering a plant twice in one batch would write two
 * entries into the history for a single errand.
 */
export function waterTargets(plants: StoredPlant[]): StoredPlant[] {
  const seen = new Set<string>();
  const out: StoredPlant[] = [];
  for (const plant of plants) {
    if (seen.has(plant.id)) continue;
    seen.add(plant.id);
    out.push(plant);
  }
  return out;
}
