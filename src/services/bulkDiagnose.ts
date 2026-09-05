/*
 * Diagnose a whole portfolio in the background.
 *
 * Three things make this a service rather than a loop inside the screen:
 *
 *   IT OUTLIVES THE SCREEN. The job keeps running while the user browses, so
 *   it cannot live in component state that unmounts on a tab change.
 *
 *   IT IS RATE LIMITED. The API gate allows six billable requests a minute per
 *   device, so twelve plants take at least two minutes. Firing them at once
 *   earns 429s for most of the library and diagnoses almost nothing - the
 *   pacing here is what makes "diagnose all" mean all of them.
 *
 *   IT MUST REPORT HONESTLY. A plant whose diagnosis failed has to be counted
 *   as failed, not quietly dropped, or the button appears to have worked while
 *   half the library is untouched.
 *
 * Every dependency is injected so the whole thing is testable on a fake clock
 * with no network and no waiting.
 */

import type { PlantDiagnosis } from '../types';
import type { StoredPlant } from './plantStore';

/* The server's own per-device ceiling (RATE_LIMIT_PER_MIN on the API). Kept a
 * request below it: polling and any other screen share the same budget, and
 * spending the last token on a bulk job would rate-limit the user out of the
 * single diagnosis they take by hand. */
export const REQUESTS_PER_MINUTE = 5;
export const SPACING_MS = Math.ceil(60_000 / REQUESTS_PER_MINUTE);

export interface BulkProgress {
  /* 'idle' before the first run and after a finished one is dismissed. */
  state: 'idle' | 'running' | 'done';
  total: number;
  done: number;
  failed: number;
  /* Undiagnosed plants with no photograph. Carried from the selection step so
   * the finished message can say what it could not attempt. */
  skippedNoPhoto: number;
  /* What is being worked on right now, for the progress row. */
  currentName?: string;
}

const IDLE: BulkProgress = { state: 'idle', total: 0, done: 0, failed: 0, skippedNoPhoto: 0 };

export interface BulkDiagnoseDeps {
  /* One plant, one paid call. Rejects on any failure. */
  diagnose(photoUri: string): Promise<PlantDiagnosis>;
  /* Attach the finding to the plant that already exists. */
  attach(id: string, diagnosis: PlantDiagnosis): Promise<{ ok: boolean }>;
  /* Injected so tests never actually wait a minute. */
  wait(ms: number): Promise<void>;
  /* How a plant is named in the progress row. */
  nameOf(plant: StoredPlant): string;
}

export function createBulkDiagnose(deps: BulkDiagnoseDeps) {
  let progress: BulkProgress = IDLE;
  const listeners = new Set<(p: BulkProgress) => void>();
  let cancelled = false;

  function emit(next: Partial<BulkProgress>): void {
    progress = { ...progress, ...next };
    for (const l of listeners) l(progress);
  }

  function subscribe(fn: (p: BulkProgress) => void): () => void {
    listeners.add(fn);
    fn(progress); // a screen mounting mid-job sees the job immediately
    return () => listeners.delete(fn);
  }

  /*
   * Starts a run. A second call while one is running is IGNORED rather than
   * queued: the button stays tappable during the job (it shows progress), and
   * a double tap must not double-spend the request budget.
   */
  async function run(targets: StoredPlant[], skippedNoPhoto: number): Promise<BulkProgress> {
    if (progress.state === 'running') return progress;
    cancelled = false;
    emit({ state: 'running', total: targets.length, done: 0, failed: 0, skippedNoPhoto, currentName: undefined });

    for (let i = 0; i < targets.length; i++) {
      if (cancelled) break;
      const plant = targets[i];
      emit({ currentName: deps.nameOf(plant) });

      try {
        const diagnosis = await deps.diagnose(plant.photoUri!);
        const stored = await deps.attach(plant.id, diagnosis);
        /*
         * A diagnosis that could not be SAVED is a failure too. The paid call
         * succeeded, but the user sees no change on the card, so counting it as
         * done would make the button look like it worked when it did not.
         */
        emit(stored.ok ? { done: progress.done + 1 } : { failed: progress.failed + 1 });
      } catch {
        // One bad photo, one 429, one dropped connection: the plant is counted
        // and the run carries on. Aborting the batch over a single plant would
        // punish the eleven behind it.
        emit({ failed: progress.failed + 1 });
      }

      // Space the NEXT request, never the last one - a trailing wait would make
      // the job look stuck for a minute after its final result landed.
      if (i < targets.length - 1 && !cancelled) await deps.wait(SPACING_MS);
    }

    emit({ state: 'done', currentName: undefined });
    return progress;
  }

  /* Stops after the request in flight resolves. There is no way to un-send a
   * request already paid for, so the in-flight one is allowed to finish and be
   * counted rather than being discarded. */
  function cancel(): void {
    if (progress.state === 'running') cancelled = true;
  }

  /* Clears a finished run so the progress row disappears. */
  function dismiss(): void {
    if (progress.state === 'done') emit(IDLE);
  }

  return { subscribe, run, cancel, dismiss, get: () => progress };
}

export type BulkDiagnose = ReturnType<typeof createBulkDiagnose>;
