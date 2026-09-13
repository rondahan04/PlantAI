/*
 * Reading the two shapes POST /api/nurseries can answer with.
 *
 * It returns either a job to poll or, when the server already holds a fresh
 * result for this exact search, the finished results inline. Telling those
 * apart used to be `state === 'done'`, and that test is wrong in a way that
 * empties the screen.
 *
 * The server DEDUPES: an identical search that has already finished hands back
 * the existing job, and that response is `{ jobId, state: 'done' }` - done, but
 * with the results still sitting on the job rather than in the body. Read as
 * "inline results", it yields zero nurseries, and the screen says "No nurseries
 * found nearby" about an area we had just found 23 nurseries in.
 *
 * Not a rare path: any repeat of the same search inside the job retention
 * window reaches it - Search again, reopening the screen, a second device
 * asking the same question.
 *
 * So: results are inline only when the array is actually present. A `done`
 * without one is a job to COLLECT, and the caller polls it. The distinction
 * this preserves is between "we looked and there is nothing there", which is a
 * real answer worth showing, and "we do not have the answer in our hands",
 * which is not.
 */

export function hasInlineResults(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as { state?: unknown; results?: unknown };
  return b.state === 'done' && Array.isArray(b.results);
}
