/*
 * Async job store for the nursery scrape (TODOS E12).
 *
 * WHY THIS EXISTS. The scrape was measured end-to-end at 480,187 ms - eight
 * minutes - against a 90,000 ms client abort. There is no host timeout setting
 * that rescues that: Fly, Cloud Run, Render and Railway all cap a single HTTP
 * request well below it, and even if they didn't, an eight-minute open socket
 * dies the moment the user backgrounds the app. The request/response shape was
 * the wrong shape for the work.
 *
 * So: POST starts a job and returns immediately with an id; the app polls a
 * cheap GET until the job is done. The scrape now runs to completion regardless
 * of how long it takes, survives the app being backgrounded, and the user can
 * be shown honest progress instead of a spinner that lies for 90 seconds and
 * then fails while the work is still running.
 *
 * Storage is in-process on purpose. A restart loses in-flight jobs, which is
 * correct at one machine and one developer: the client re-POSTs and gets a
 * fresh job. Moving to Redis is a change to this file only.
 */

export type JobState = 'running' | 'done' | 'error';

export interface Job<T> {
  id: string;
  state: JobState;
  startedAt: number;
  finishedAt?: number;
  result?: T;
  /* Stable client-safe code. Provider text never reaches this field. */
  errorCode?: string;
}

export interface JobStore<T> {
  start(key: string, run: () => Promise<T>): Job<T>;
  get(id: string): Job<T> | undefined;
  size(): number;
}

/*
 * Jobs are kept for RETENTION_MS after finishing so a slow or backgrounded
 * client can still collect a result it asked for minutes ago. That doubles as
 * the result cache: an identical request while a job is running or recently
 * finished joins the existing job instead of starting a second paid scrape.
 */
const RETENTION_MS = 10 * 60_000;

export function createJobStore<T>(
  now: () => number = Date.now,
  newId: () => string = () => crypto.randomUUID()
): JobStore<T> {
  const byId = new Map<string, Job<T>>();
  const byKey = new Map<string, string>();

  function sweep() {
    const t = now();
    for (const [id, job] of byId) {
      const age = job.finishedAt ? t - job.finishedAt : 0;
      if (job.finishedAt && age > RETENTION_MS) {
        byId.delete(id);
        for (const [k, v] of byKey) if (v === id) byKey.delete(k);
      }
    }
  }

  return {
    start(key, run) {
      sweep();

      // Dedupe: an identical in-flight or recent job is returned as-is. This is
      // what stops a user tapping retry from buying a second eight-minute
      // scrape of the same thing.
      const existingId = byKey.get(key);
      const existing = existingId ? byId.get(existingId) : undefined;
      if (existing && existing.state !== 'error') return existing;

      const job: Job<T> = { id: newId(), state: 'running', startedAt: now() };
      byId.set(job.id, job);
      byKey.set(key, job.id);

      // Deliberately not awaited: the HTTP handler returns the id immediately.
      // The catch is exhaustive - an unhandled rejection here would take the
      // whole server down and every other in-flight job with it.
      run().then(
        (result) => {
          job.state = 'done';
          job.result = result;
          job.finishedAt = now();
        },
        (err: unknown) => {
          job.state = 'error';
          job.errorCode = 'scrape_failed';
          job.finishedAt = now();
          console.error(`[job ${job.id}] failed: ${errText(err)}`);
        }
      );

      return job;
    },

    get(id) {
      sweep();
      return byId.get(id);
    },

    size() {
      return byId.size;
    },
  };
}

function errText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
