import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScrapeHealth, readable } from './scrapeHealth.ts';

/* A clock the test drives, so "how long since we read this shop" is asserted
 * rather than raced. */
function at(ms: number) {
  return new Date(ms).toISOString();
}

test('a shop we read is not a shop with a problem', () => {
  // The whole point: zero rows from a catalogue we READ is normal for any
  // uncommon plant. Counting it as breakage marks half the nurseries in the
  // country broken and makes the alarm worthless.
  assert.equal(readable('ok'), true);
  assert.equal(readable('no_match'), true);
  assert.equal(readable('rejected'), true);

  assert.equal(readable('no_markdown'), false);
  assert.equal(readable('no_excerpt'), false);
  assert.equal(readable('timeout'), false);
  assert.equal(readable('error'), false);
});

test('a shop that stops parsing goes stale; one that simply lacks the plant never does', () => {
  const h = createScrapeHealth({ staleAfter: 3, now: () => 1_000 });

  // The silent failure E11 exists to catch: readable markup, then nothing.
  h.record('broken.co.il', 'ok');
  h.record('broken.co.il', 'no_markdown');
  h.record('broken.co.il', 'no_markdown');
  assert.equal(h.summary().stale, 0, 'two in a row is weather, not a pattern');
  h.record('broken.co.il', 'no_markdown');

  // A perfectly healthy shop that just does not stock these plants.
  for (let i = 0; i < 10; i++) h.record('fine.co.il', 'no_match');

  assert.deepEqual(h.summary(), { hosts: 2, stale: 1 });
  // The name is in the gated report, not in the public summary.
  assert.equal(h.report()[0].host, 'broken.co.il');
  assert.equal(h.report()[0].stale, true);
});

test('one bad day does not raise an alarm, and recovery clears it', () => {
  const h = createScrapeHealth({ staleAfter: 3, now: () => 1_000 });
  h.record('shop.co.il', 'timeout');
  assert.equal(h.summary().stale, 0);

  h.record('shop.co.il', 'timeout');
  h.record('shop.co.il', 'timeout');
  assert.equal(h.summary().stale, 1);

  // A single good read means the site is parseable again. Anything else leaves
  // a fixed site alarming forever, which is how alarms get ignored.
  h.record('shop.co.il', 'ok');
  assert.equal(h.summary().stale, 0);
  assert.equal(h.report()[0].consecutiveUnreadable, 0);
});

test('lastReadableAt is when we could READ the shop, not when it last had stock', () => {
  let clock = 1_000;
  const h = createScrapeHealth({ now: () => clock });

  h.record('shop.co.il', 'no_match'); // read it, plant absent - still a read
  const readAt = clock;

  clock = 5_000;
  h.record('shop.co.il', 'no_excerpt'); // could not read it

  const [row] = h.report();
  assert.equal(row.lastReadableAt, at(readAt));
  assert.equal(row.lastSeenAt, at(5_000));
  assert.equal(row.attempts, 2);
});

test('a shop never once read reports null rather than a fake timestamp', () => {
  const h = createScrapeHealth({ now: () => 1_000 });
  h.record('walled.co.il', 'no_markdown');
  assert.equal(h.report()[0].lastReadableAt, null);
});

test('the report puts the worst hosts first', () => {
  let clock = 1_000;
  const h = createScrapeHealth({ staleAfter: 2, now: () => clock });

  h.record('healthy.co.il', 'ok');
  clock = 2_000;
  h.record('stale.co.il', 'timeout');
  h.record('stale.co.il', 'timeout');
  clock = 3_000;
  h.record('never-read.co.il', 'no_markdown');

  const hosts = h.report().map((r) => r.host);
  assert.equal(hosts[0], 'stale.co.il', 'stale hosts lead');
  // Never-read sorts above read-a-while-ago: an empty lastReadableAt is the
  // strongest evidence we cannot parse a site at all.
  assert.equal(hosts[1], 'never-read.co.il');
  assert.equal(hosts[2], 'healthy.co.il');
});

test('the ring is bounded and evicts the least recently seen host', () => {
  const h = createScrapeHealth({ maxHosts: 3, now: () => 1_000 });
  h.record('a.co.il', 'ok');
  h.record('b.co.il', 'ok');
  h.record('c.co.il', 'ok');
  h.record('a.co.il', 'ok'); // a is seen again, so b is now the oldest
  h.record('d.co.il', 'ok');

  const hosts = h.report().map((r) => r.host).sort();
  assert.equal(hosts.length, 3);
  assert.deepEqual(hosts, ['a.co.il', 'c.co.il', 'd.co.il']);
});

test('re-seeing a host updates it rather than adding a second row', () => {
  const h = createScrapeHealth({ now: () => 1_000 });
  h.record('shop.co.il', 'ok');
  h.record('shop.co.il', 'ok');
  assert.equal(h.summary().hosts, 1);
  assert.equal(h.report()[0].attempts, 2);
});

test('the public summary names no hosts at all', () => {
  // /health is unauthenticated. It can say "3 of 12 shops are unreadable"
  // without publishing which shops we scrape or which of them are down.
  const h = createScrapeHealth({ staleAfter: 1, now: () => 1_000 });
  h.record('broken.co.il', 'no_markdown');
  assert.deepEqual(Object.keys(h.summary()).sort(), ['hosts', 'stale']);
  assert.equal(JSON.stringify(h.summary()).includes('broken.co.il'), false);
});
