import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialOf } from './initial.ts';

test('takes the first letter, uppercased', () => {
  assert.equal(initialOf('ron'), 'R');
  assert.equal(initialOf('Ron Dahan'), 'R');
});

test('ignores surrounding whitespace rather than rendering a blank circle', () => {
  assert.equal(initialOf('   ron  '), 'R');
});

test('has nothing to show for an absent or empty name', () => {
  assert.equal(initialOf(null), null);
  assert.equal(initialOf(undefined), null);
  assert.equal(initialOf(''), null);
  assert.equal(initialOf('   '), null);
});

test('keeps a Hebrew name intact - the app ships in two languages', () => {
  assert.equal(initialOf('רון'), 'ר');
});

/* `name[0]` would slice an astral character in half and render a replacement
 * box, which is worse than showing no initial at all. */
test('does not cut a surrogate pair in half', () => {
  assert.equal(initialOf('😀 plant'), '😀');
});

test('is not confused by a non-string', () => {
  assert.equal(initialOf(42 as unknown as string), null);
});
