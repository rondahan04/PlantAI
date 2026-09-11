/*
 * The app's single library-translation job.
 *
 * Module-level rather than per-screen for the same reason as
 * `bulkDiagnoseInstance`: the job outlives the Portfolio screen, so switching
 * tabs mid-run must not restart or orphan it. The real dependencies are bound
 * here; the logic and its edge cases live in `bulkTranslate.ts` under
 * `node --test`.
 */
import { createBulkTranslate } from './bulkTranslate';
import { translateIfStale } from './diagnosisTranslation';
import { plantRepo } from './plantRepoInstance';
import { plantDisplayName } from '../lib/portfolio';

export const bulkTranslate = createBulkTranslate({
  translate: (id, diagnosis) => translateIfStale(id, diagnosis),
  attach: async (id, diagnosis) => {
    const result = await plantRepo.setDiagnosis(id, diagnosis);
    return { ok: result.ok };
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  nameOf: plantDisplayName,
});
