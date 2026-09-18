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

import type { StoredPlant } from '../plants/plantStore';
import type { PlantDiagnosis } from '../../types/index';
/* Explicit `.ts`: a runtime import that `node --test` has to resolve.
 * The spacing is SHARED, not copied - both jobs spend the same per-device
 * request budget, so one constant has to govern both. */
import { SPACING_MS } from './bulkDiagnose.ts';

export interface TranslateProgress {
  /* 'idle' before the first run and after a finished one is dismissed. */
  state: 'idle' | 'running' | 'done';
  total: number;
  /* Plants whose prose really was translated and saved. Nothing else. */
  done: number;
  failed: number;
  /*
   * Plants there turned out to be nothing to do for - already cached, or
   * already given up on earlier in this process.
   *
   * Separate from `done` because the row is a claim about work: folding the
   * two together is how "Translated 1 diagnosis" came to appear on a launch
   * that translated nothing at all. They still count towards `total`, so the
   * bar advances through them rather than stalling.
   */
  skipped: number;
  /* What is being worked on right now, for the progress row. */
  currentName?: string;
}

const IDLE: TranslateProgress = { state: 'idle', total: 0, done: 0, failed: 0, skipped: 0 };

/* How far through the run the bar is: everything settled, however it settled. */
export function handledOf(p: TranslateProgress): number {
  return p.done + p.failed + p.skipped;
}

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
  /* The run's work list, appendable while the loop below is walking it. */
  let queue: StoredPlant[] = [];
  /* Ids already in `queue` this run, so a remount cannot enqueue them twice. */
  const queued = new Set<string>();

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
   * Starts a run, or feeds one already going.
   *
   * A second call while a run is in flight JOINS it: the new plants are
   * appended to the queue and `total` grows. It used to be ignored outright,
   * which was wrong for the case that actually happens - the screen paints
   * from the local mirror, calls with the two plants it has, and the cloud
   * copy lands a moment later with eleven. The larger batch was dropped, the
   * row reported the one plant it did know about, and the rest stayed in the
   * wrong language until the next launch, where the same thing happened again.
   *
   * Plants already queued this run are not queued twice, so a screen that
   * remounts and hands back the same list does not double-spend the budget.
   *
   * An empty target list is a no-op that does not even enter 'running', so the
   * common case - nothing stale, or everything already cached - shows no
   * progress row at all rather than one that flashes and vanishes.
   */
  async function run(targets: StoredPlant[]): Promise<TranslateProgress> {
    const fresh = targets.filter((p) => p.diagnosis && !queued.has(p.id));

    if (progress.state === 'running') {
      if (fresh.length === 0) return progress;
      for (const p of fresh) {
        queued.add(p.id);
        queue.push(p);
      }
      emit({ total: progress.total + fresh.length });
      return progress;
    }

    if (fresh.length === 0) return progress;

    cancelled = false;
    queue = [...fresh];
    queued.clear();
    for (const p of fresh) queued.add(p.id);
    emit({ state: 'running', total: queue.length, done: 0, failed: 0, skipped: 0, currentName: undefined });

    /* `queue.length` is re-read every pass, not captured: the whole point is
     * that it can grow underneath this loop. */
    for (let i = 0; i < queue.length; i++) {
      if (cancelled) break;
      const plant = queue[i];
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
          emit({ skipped: progress.skipped + 1 });
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
      if (spent && i < queue.length - 1 && !cancelled) await deps.wait(SPACING_MS);
    }

    queue = [];
    queued.clear();

    /*
     * A run that translated nothing and failed nothing has nothing to report,
     * so it ends where it started rather than leaving a green tick claiming
     * work it did not do. Everything was already in hand; the user never
     * needed telling.
     *
     * Only `state` is put back, not the tally: 'idle' already hides the row,
     * and a caller that wants to know what the run found - a test, a log -
     * should not have to watch every emit to get an answer. The next run
     * zeroes the counts on its way in.
     */
    emit(
      progress.done > 0 || progress.failed > 0
        ? { state: 'done', currentName: undefined }
        : { state: 'idle', currentName: undefined }
    );
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
