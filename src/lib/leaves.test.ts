/**
 * New-growth tracking. The rules worth pinning down are the ones a screen
 * cannot show you went wrong: which tap an undo reverses, that two leaves on
 * one day stay two leaves, and that a damaged record degrades to something a
 * calendar can still draw.
 *
 * Run: node --test src/lib/leaves.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LEAF_LOG,
  averageGrowthDays,
  emergeLeaf,
  isLeafEvent,
  leafAgeDays,
  leafCounts,
  leafDays,
  leafStamps,
  matureLeaf,
  normalizeLeaves,
  pendingLeaves,
  undoLastLeaf,
  type LeafEvent,
} from './leaves.ts';

const DAY = 86_400_000;
/* A fixed local noon, so nothing here depends on the machine's timezone
 * pushing a stamp over a day boundary. */
const T0 = new Date(2026, 0, 10, 12, 0, 0).getTime();

test('a new leaf is logged as pending', () => {
  const leaves = emergeLeaf([], 'a', T0);
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].id, 'a');
  assert.equal(leaves[0].maturedAt, undefined);
  assert.deepEqual(leafCounts(leaves), { total: 1, pending: 1, grown: 0 });
});

test('two leaves on the same day are two leaves, not one', () => {
  const leaves = emergeLeaf(emergeLeaf([], 'a', T0), 'b', T0 + 60_000);
  assert.equal(leaves.length, 2);
  assert.equal(pendingLeaves(leaves).length, 2);
});

test('marking one leaf grown leaves the others pending', () => {
  const two = emergeLeaf(emergeLeaf([], 'a', T0), 'b', T0 + DAY);
  const next = matureLeaf(two, 'a', T0 + 20 * DAY);
  assert.equal(next.find((l) => l.id === 'a')?.maturedAt !== undefined, true);
  assert.equal(next.find((l) => l.id === 'b')?.maturedAt, undefined);
  assert.deepEqual(leafCounts(next), { total: 2, pending: 1, grown: 1 });
});

test('maturing an already-grown or unknown leaf changes nothing, by reference', () => {
  const one = emergeLeaf([], 'a', T0);
  const grown = matureLeaf(one, 'a', T0 + DAY);
  assert.equal(matureLeaf(grown, 'a', T0 + 2 * DAY), grown);
  assert.equal(matureLeaf(grown, 'nope', T0 + 2 * DAY), grown);
});

test('a maturity behind the emergence is clamped up, not rejected', () => {
  const one = emergeLeaf([], 'a', T0);
  const next = matureLeaf(one, 'a', T0 - 5 * DAY);
  assert.equal(next[0].maturedAt, next[0].emergedAt);
});

test('undo reverses the most recent tap - a maturity, keeping the leaf', () => {
  const two = emergeLeaf(emergeLeaf([], 'old', T0), 'new', T0 + 30 * DAY);
  /* The OLD leaf is marked grown last, so undo must clear that stamp rather
   * than delete the newer leaf sitting at the top of the list. */
  const grown = matureLeaf(two, 'old', T0 + 40 * DAY);
  const undone = undoLastLeaf(grown);
  assert.equal(undone.length, 2);
  assert.equal(undone.find((l) => l.id === 'old')?.maturedAt, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(undone.find((l) => l.id === 'old')!, 'maturedAt'), false);
});

test('undo reverses the most recent tap - an emergence, removing the leaf', () => {
  const two = emergeLeaf(emergeLeaf([], 'old', T0), 'new', T0 + 30 * DAY);
  const undone = undoLastLeaf(two);
  assert.deepEqual(undone.map((l) => l.id), ['old']);
});

test('undo on an empty log is a no-op', () => {
  const empty: LeafEvent[] = [];
  assert.equal(undoLastLeaf(empty), empty);
});

test('normalize drops junk, keeps a leaf whose maturity is impossible', () => {
  const leaves = normalizeLeaves([
    null,
    { id: '', emergedAt: new Date(T0).toISOString() },
    { id: 'x', emergedAt: 'not a date' },
    { id: 'ok', emergedAt: new Date(T0).toISOString(), maturedAt: 'garbage' },
    { id: 'back', emergedAt: new Date(T0).toISOString(), maturedAt: new Date(T0 - DAY).toISOString() },
  ]);
  assert.deepEqual(leaves.map((l) => l.id).sort(), ['back', 'ok']);
  assert.equal(leaves.every((l) => l.maturedAt === undefined), true);
});

test('normalize dedupes by id and sorts newest first', () => {
  const leaves = normalizeLeaves([
    { id: 'a', emergedAt: new Date(T0).toISOString() },
    { id: 'b', emergedAt: new Date(T0 + DAY).toISOString() },
    { id: 'a', emergedAt: new Date(T0 + 99 * DAY).toISOString() },
  ]);
  assert.deepEqual(leaves.map((l) => l.id), ['b', 'a']);
});

test('the log is bounded, dropping the oldest', () => {
  const many = Array.from({ length: MAX_LEAF_LOG + 10 }, (_, i) => ({
    id: `l${i}`,
    emergedAt: new Date(T0 + i * DAY).toISOString(),
  }));
  const leaves = normalizeLeaves(many);
  assert.equal(leaves.length, MAX_LEAF_LOG);
  assert.equal(leaves.some((l) => l.id === `l${MAX_LEAF_LOG + 9}`), true);
  assert.equal(leaves.some((l) => l.id === 'l0'), false);
});

test('age is whole days, and runs to now while the leaf is still opening', () => {
  const pending: LeafEvent = { id: 'a', emergedAt: new Date(T0).toISOString() };
  assert.equal(leafAgeDays(pending, T0 + 3 * DAY + 1000), 3);
  const grown: LeafEvent = {
    id: 'b',
    emergedAt: new Date(T0).toISOString(),
    maturedAt: new Date(T0 + 21 * DAY).toISOString(),
  };
  assert.equal(leafAgeDays(grown, T0 + 999 * DAY), 21);
});

test('average growth counts only finished leaves', () => {
  const leaves = normalizeLeaves([
    { id: 'a', emergedAt: new Date(T0).toISOString(), maturedAt: new Date(T0 + 10 * DAY).toISOString() },
    { id: 'b', emergedAt: new Date(T0).toISOString(), maturedAt: new Date(T0 + 20 * DAY).toISOString() },
    { id: 'c', emergedAt: new Date(T0).toISOString() },
  ]);
  assert.equal(averageGrowthDays(leaves), 15);
  assert.equal(averageGrowthDays(normalizeLeaves([{ id: 'c', emergedAt: new Date(T0).toISOString() }])), undefined);
});

test('the calendar gets two separate day sets', () => {
  const leaves = normalizeLeaves([
    { id: 'a', emergedAt: new Date(T0).toISOString(), maturedAt: new Date(T0 + 20 * DAY).toISOString() },
  ]);
  const days = leafDays(leaves);
  assert.deepEqual([...days.emerged], ['2026-01-10']);
  assert.deepEqual([...days.matured], ['2026-01-30']);
});

test('stamps flatten both ends, newest first', () => {
  const leaves = normalizeLeaves([
    { id: 'a', emergedAt: new Date(T0).toISOString(), maturedAt: new Date(T0 + 20 * DAY).toISOString() },
    { id: 'b', emergedAt: new Date(T0 + 5 * DAY).toISOString() },
  ]);
  assert.deepEqual(
    leafStamps(leaves).map((s) => `${s.id}:${s.stage}`),
    ['a:matured', 'b:emerged', 'a:emerged']
  );
});

test('isLeafEvent is what the store validates with', () => {
  assert.equal(isLeafEvent({ id: 'a', emergedAt: new Date(T0).toISOString() }), true);
  assert.equal(isLeafEvent({ id: 'a' }), false);
  assert.equal(isLeafEvent({ emergedAt: new Date(T0).toISOString() }), false);
  assert.equal(isLeafEvent(undefined), false);
});
