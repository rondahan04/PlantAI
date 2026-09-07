import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoCacheKey } from './photoCacheKey.ts';

const SIGNED =
  'https://amehahtaiggookgekfjt.supabase.co/storage/v1/object/sign/plants/user-1/abc.jpg';

test('the same object signed twice gets one key', () => {
  /* This is the whole point: two launches, two tokens, one photo. Before this
   * the two strings were two cache entries and the phone downloaded both. */
  assert.equal(
    photoCacheKey(`${SIGNED}?token=eyJhbGciOiJIUzI1NiJ9.FIRST`),
    photoCacheKey(`${SIGNED}?token=eyJhbGciOiJIUzI1NiJ9.SECOND&expires=999`)
  );
});

test('the key is the object path, so two plants never share one', () => {
  const a = photoCacheKey(`${SIGNED}?token=x`);
  const b = photoCacheKey(
    'https://amehahtaiggookgekfjt.supabase.co/storage/v1/object/sign/plants/user-1/xyz.jpg?token=x'
  );
  assert.equal(a, SIGNED);
  assert.notEqual(a, b);
});

test('a local photo is left to key on its own URI', () => {
  // Already stable and unique. A key here would only be a way to get it wrong.
  for (const uri of [
    'file:///var/mobile/Containers/Data/Application/A/Documents/plants/abc.jpg',
    '/var/mobile/plant.jpg',
    'ph://ABC-DEF',
  ]) {
    assert.equal(photoCacheKey(uri), undefined, uri);
  }
});

test('junk never throws and never produces a key', () => {
  for (const junk of ['', '   ', 42 as unknown as string, null as unknown as string]) {
    assert.doesNotThrow(() => photoCacheKey(junk));
    assert.equal(photoCacheKey(junk), undefined);
  }
});
