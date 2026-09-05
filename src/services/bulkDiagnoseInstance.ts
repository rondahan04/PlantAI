/*
 * The app's single bulk-diagnose job.
 *
 * Module-level rather than per-screen on purpose: the job outlives the
 * Portfolio screen, so switching tabs mid-run must not restart or orphan it.
 * The real dependencies are bound here; the logic and all of its edge cases
 * live in `bulkDiagnose.ts` under `node --test`.
 */
import { createBulkDiagnose } from './bulkDiagnose';
import { diagnosePlant } from './plantDiagnosis';
import { plantRepo } from './plantRepoInstance';
import { plantDisplayName } from '../lib/portfolio';

export const bulkDiagnose = createBulkDiagnose({
  diagnose: (photoUri) => diagnosePlant(photoUri),
  attach: async (id, diagnosis) => {
    const result = await plantRepo.setDiagnosis(id, diagnosis);
    return { ok: result.ok };
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  nameOf: plantDisplayName,
});
