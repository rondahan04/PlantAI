/*
 * The rule Home broke, stated as the copy contract it actually is.
 *
 * `gardenState` is tested in home.test.ts as a three-way decision. This file
 * asserts the consequence that decision exists for: the three reassuring lines
 * Home renders are keyed off the STATE, and none of them may be reachable when
 * the library did not load.
 *
 * Kept in `node --test` rather than jest because it is a rule, not a render -
 * the screen is a renderer over src/lib/home.ts, and this is the half that can
 * be proved rather than eyeballed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { gardenState } from './home.ts';
import { TREES } from './copy/index.ts';
import type { LoadResult } from '../services/plants/plantStore.ts';

const EN = TREES.en;
const HE = TREES.he;

const corrupt: LoadResult = { ok: false, reason: 'corrupt', plants: [] };
const future: LoadResult = { ok: false, reason: 'future_version', plants: [] };
const fresh: LoadResult = { ok: true, plants: [] };

/*
 * What Home puts in each slot, mirroring the ternaries in HomeScreen. If a
 * future edit changes the screen's branching without changing these, the
 * mirror is wrong and that is worth knowing - but the screen reads `garden.kind`
 * for all three, so there is exactly one thing to keep in step.
 */
const heroTitleFor = (lib: LoadResult) =>
  gardenState(lib).kind === 'empty' ? EN.home.heroEmptyTitle : EN.home.heroTitle;

const stripTextFor = (lib: LoadResult) =>
  gardenState(lib).kind === 'unreadable' ? EN.home.unreadableStrip : EN.home.emptyStrip;

const tasksTextFor = (lib: LoadResult) =>
  gardenState(lib).kind === 'unreadable' ? EN.home.tasksUnknown : EN.home.tasksEmpty;

test('an unreadable library never gets the new-user invitation', () => {
  /* "Start your garden with one photo." to someone who already has a garden
   * reads as the garden being gone. */
  for (const lib of [corrupt, future]) {
    assert.notEqual(heroTitleFor(lib), EN.home.heroEmptyTitle);
  }
  assert.equal(heroTitleFor(fresh), EN.home.heroEmptyTitle);
});

test('an unreadable library is never described as having no plants', () => {
  for (const lib of [corrupt, future]) {
    assert.notEqual(stripTextFor(lib), EN.home.emptyStrip);
    assert.equal(stripTextFor(lib), EN.home.unreadableStrip);
  }
  assert.equal(stripTextFor(fresh), EN.home.emptyStrip);
});

test('an unreadable library is never given the all-clear', () => {
  /* The worst of the three: a green tick and "Your plants are set." does not
   * merely mislead, it reassures. */
  for (const lib of [corrupt, future]) {
    assert.notEqual(tasksTextFor(lib), EN.home.tasksEmpty);
    assert.equal(tasksTextFor(lib), EN.home.tasksUnknown);
  }
  assert.equal(tasksTextFor(fresh), EN.home.tasksEmpty);
});

test('the unreadable copy says the data is not gone', () => {
  /* The single most important word in this whole fix. A user whose library
   * failed to load needs to know it is recoverable before anything else. */
  assert.match(EN.home.unreadableStrip, /not been deleted/i);
});

test('every line Home can show for an unreadable library is translated', () => {
  /* The copy tree's own walk skips nothing here - both keys are plain strings -
   * but these two are the ones a Hebrew user meets at the worst moment, so they
   * get their own assertion rather than relying on the generic sweep. */
  assert.notEqual(HE.home.unreadableStrip, EN.home.unreadableStrip);
  assert.notEqual(HE.home.tasksUnknown, EN.home.tasksUnknown);
  assert.match(HE.home.unreadableStrip, /[א-ת]/);
  assert.match(HE.home.tasksUnknown, /[א-ת]/);
});
