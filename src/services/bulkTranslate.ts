/*
 * Bring a whole library into the language the app is now speaking.
 *
 * The lazy path - translate a plant when its page is opened - is correct but
 * front-loads the wait onto the moment the user is trying to read something.
 * After a language switch EVERY plant is stale, so the list itself is half in
 * the wrong language and each tap costs fifteen seconds before the page settles.
 * Doing the library in the background instead means the wait happens while the
 * user is scrolling rather than while they are waiting.
 *
 * The same three properties as `bulkDiagnose`, and the same reasons:
 *
 *   IT OUTLIVES THE SCREEN, so it cannot be component state that unmounts on a
 *   tab change.
 *
 *   IT IS RATE LIMITED. The API gate allows a handful of billable requests a
 *   minute per device; firing a whole library at once earns 429s for most of it.
 *
 *   IT REPORTS HONESTLY. A plant that failed is counted as failed, not quietly
 *   left in the old language while the row says everything is done.
 *
 * What it does NOT do is decide what is stale. That is `needsCallFor` in
 * lib/diagnosisProse.ts, which answers from the cache first - so a second
 * switch back to a language already paid for selects nothing and this job
 * never runs at all.
 */

import type { StoredPlant } from './plantStore';
import type { PlantDiagnosis } from '../types';
/* Explicit `.ts`: a runtime import that `node --test` has to resolve.
 * The spacing is SHARED, not copied - both jobs spend the same per-device
 * request budget, so one constant has to govern both. */
import { SPACING_MS } from './bulkDiagnose.ts';

export interface TranslateProgress {
  /* 'idle' before the first run and after a finished one is dismissed. */
  state: 'idle' | 'running' | 'done';
  total: number;
  done: number;
  failed: number;
  /* What is being worked on right now, for the progress row. */
  currentName?: string;
}

const IDLE: TranslateProgress = { state: 'idle', total: 0, done: 0, failed: 0 };

export interface BulkTranslateDeps {
  /* One plant, one paid call. Resolves null when there was nothing to do -
   * the plant was already cached - which is counted as done, not as failed. */
  translate(plantId: string, diagnosis: PlantDiagnosis): Promise<PlantDiagnosis | null>;
  /* Save the translated record over the one that exists. */
  attach(id: string, diagnosis: PlantDiagnosis): Promise<{ ok: boolean }>;
  /* Injected so tests never actually wait a minute. */
  wait(ms: number): Promise<void>;
  /* How a plant is named in the progress row. */
  nameOf(plant: StoredPlant): string;
}

export function createBulkTranslate(deps: BulkTranslateDeps) {
  let progress: TranslateProgress = IDLE;
  const listeners = new Set<(p: TranslateProgress) => void>();
  let cancelled = false;

  function emit(next: Partial<TranslateProgress>): void {
    progress = { ...progress, ...next };
    for (const l of listeners) l(progress);
  }

  function subscribe(fn: (p: TranslateProgress) => void): () => void {
    listeners.add(fn);
    fn(progress); // a screen mounting mid-job sees the job immediately
    return () => listeners.delete(fn);
  }

  /*
   * Starts a run. A second call while one is running is IGNORED rather than
   * queued: this fires from a screen that can mount more than once, and a
   * remount must not double-spend the request budget.
   *
   * An empty target list is a no-op that does not even enter 'running', so the
   * common case - nothing stale, or everything already cached - shows no
   * progress row at all rather than one that flashes and vanishes.
   */
  async function run(targets: StoredPlant[]): Promise<TranslateProgress> {
    if (progress.state === 'running') return progress;
    if (targets.length === 0) return progress;

    cancelled = false;
    emit({ state: 'running', total: targets.length, done: 0, failed: 0, currentName: undefined });

    for (let i = 0; i < targets.length; i++) {
      if (cancelled) break;
      const plant = targets[i];
      const diagnosis = plant.diagnosis;
      if (!diagnosis) continue;

      emit({ currentName: deps.nameOf(plant) });

      let spent = true;
      try {
        const translated = await deps.translate(plant.id, diagnosis);
        if (translated === null) {
          /* Nothing to do, and nothing was billed - so do not pace behind it.
           * A library that is entirely cached should finish immediately rather
           * than crawl through a twelve-second gap it never needed. */
          spent = false;
          emit({ done: progress.done + 1 });
        } else {
          const stored = await deps.attach(plant.id, translated);
          /*
           * A translation that could not be SAVED is a failure too. The paid
           * call succeeded, but the record on disk is unchanged, so counting it
           * as done would mean paying for it again on the next launch.
           */
          emit(stored.ok ? { done: progress.done + 1 } : { failed: progress.failed + 1 });
        }
      } catch (err: unknown) {
        // One 429, one dropped connection: the plant is counted and the run
        // carries on. Aborting the batch over a single plant would punish the
        // eleven behind it. Logged, because a silent catch here is how a
        // whole-library failure looks like a feature that does nothing.
        console.warn(`[translate] ${deps.nameOf(plant)}: ${err instanceof Error ? err.message : err}`);
        emit({ failed: progress.failed + 1 });
      }

      // Space the NEXT request, never the last one - a trailing wait would make
      // the job look stuck for a minute after its final result landed.
      if (spent && i < targets.length - 1 && !cancelled) await deps.wait(SPACING_MS);
    }

    emit({ state: 'done', currentName: undefined });
    return progress;
  }

  /* Stops after the request in flight resolves. There is no way to un-send a
   * request already paid for, so the in-flight one finishes and is counted. */
  function cancel(): void {
    if (progress.state === 'running') cancelled = true;
  }

  /* Clears a finished run so the progress row disappears. */
  function dismiss(): void {
    if (progress.state === 'done') emit(IDLE);
  }

  return { subscribe, run, cancel, dismiss, get: () => progress };
}

export type BulkTranslate = ReturnType<typeof createBulkTranslate>;
