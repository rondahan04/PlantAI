import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING_KEY,
  ONBOARDING_VERSION,
  MAX_NAME_LENGTH,
  createOnboardingStore,
  normalizeName,
  type StorageDeps,
} from './onboardingStore.ts';

/*
 * Onboarding has exactly two ways to be wrong, and they are asymmetric:
 * replaying the intro is an annoyance, while skipping it strands a first-time
 * user on an empty Home with no explanation. Every ambiguous case below is
 * asserted to resolve toward "show onboarding".
 */

function fakeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  let failWrites: 'throw' | 'silent' | null = null;
  let failReads = false;

  const deps: StorageDeps = {
    getItem: (k) => {
      if (failReads) throw new Error('SQLITE_CORRUPT: database disk image is malformed');
      return data.get(k) ?? null;
    },
    setItem: (k, v) => {
      // Out of space throws on some platforms and silently no-ops on others.
      if (failWrites === 'throw') throw new Error('SQLITE_FULL: database or disk is full');
      if (failWrites === 'silent') return;
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };

  return {
    deps,
    data,
    failWrites: (mode: 'throw' | 'silent' | null) => (failWrites = mode),
    failReads: (on: boolean) => (failReads = on),
  };
}

const at = (iso: string) => ({ now: () => Date.parse(iso) });

// --- normalizeName ---------------------------------------------------------

test('normalizeName trims, collapses whitespace and bounds length', () => {
  assert.equal(normalizeName('  Ron  '), 'Ron');
  assert.equal(normalizeName('Ron   Dahan'), 'Ron Dahan');
  assert.equal(normalizeName('x'.repeat(200))?.length, MAX_NAME_LENGTH);
});

test('normalizeName rejects anything that is not a usable name', () => {
  assert.equal(normalizeName(''), undefined);
  assert.equal(normalizeName('   '), undefined);
  assert.equal(normalizeName(undefined), undefined);
  assert.equal(normalizeName(42), undefined);
});

// --- load ------------------------------------------------------------------

test('fresh install is not onboarded', () => {
  const s = fakeStorage();
  assert.equal(createOnboardingStore(s.deps).load(), null);
});

test('completing persists and is readable by a second store instance', () => {
  const s = fakeStorage();
  const written = createOnboardingStore(s.deps, at('2026-08-19T12:00:00.000Z')).complete('Ron');
  assert.equal(written.ok, true);

  // A second instance proves the fact survived in storage, not in a closure.
  const state = createOnboardingStore(s.deps).load();
  assert.deepEqual(state, {
    version: ONBOARDING_VERSION,
    completedAt: '2026-08-19T12:00:00.000Z',
    name: 'Ron',
  });
});

test('skipping the name step completes without one', () => {
  const s = fakeStorage();
  createOnboardingStore(s.deps).complete();
  const state = createOnboardingStore(s.deps).load();
  assert.ok(state);
  // Absent, never a placeholder — an invented greeting reads as a bug.
  assert.equal(state.name, undefined);
});

test('a corrupt blob shows onboarding again and clears itself', () => {
  const s = fakeStorage({ [ONBOARDING_KEY]: '{not json' });
  assert.equal(createOnboardingStore(s.deps).load(), null);
  assert.equal(s.data.has(ONBOARDING_KEY), false);
});

test('a blob without a valid completedAt is not onboarded', () => {
  for (const bad of ['{}', '"a string"', 'null', '[]', '{"completedAt":"not-a-date"}']) {
    const s = fakeStorage({ [ONBOARDING_KEY]: bad });
    assert.equal(createOnboardingStore(s.deps).load(), null, `expected null for ${bad}`);
  }
});

test('a blob from a newer build is honoured, not replayed or overwritten', () => {
  const future = JSON.stringify({ version: 99, completedAt: '2026-08-19T12:00:00.000Z', name: 'Ron' });
  const s = fakeStorage({ [ONBOARDING_KEY]: future });

  const state = createOnboardingStore(s.deps).load();
  assert.ok(state, 'a downgraded user must not be sent back through onboarding');
  assert.equal(state.version, 99);
  // The bytes survive the read: nothing this build writes has run yet.
  assert.equal(s.data.get(ONBOARDING_KEY), future);
});

test('a stored name is normalized on the way out too', () => {
  const s = fakeStorage({
    [ONBOARDING_KEY]: JSON.stringify({ version: 1, completedAt: '2026-08-19T12:00:00.000Z', name: '  Ron  ' }),
  });
  assert.equal(createOnboardingStore(s.deps).load()?.name, 'Ron');
});

test('a read that throws falls back to showing onboarding', () => {
  const s = fakeStorage();
  s.failReads(true);
  assert.equal(createOnboardingStore(s.deps).load(), null);
});

// --- complete failure modes ------------------------------------------------

test('a write that throws is reported, not swallowed', () => {
  const s = fakeStorage();
  s.failWrites('throw');
  assert.deepEqual(createOnboardingStore(s.deps).complete('Ron'), { ok: false, reason: 'storage_full' });
});

test('a write that silently drops is caught by the read-back', () => {
  const s = fakeStorage();
  s.failWrites('silent');
  // The dangerous case: setItem returns fine and nothing landed. Without the
  // read-back the app would report success and replay onboarding forever.
  assert.deepEqual(createOnboardingStore(s.deps).complete('Ron'), { ok: false, reason: 'storage_full' });
});

// --- setName ---------------------------------------------------------------

test('setName updates the name without re-stamping completedAt', () => {
  const s = fakeStorage();
  createOnboardingStore(s.deps, at('2026-08-19T12:00:00.000Z')).complete('Ron');

  const later = createOnboardingStore(s.deps, at('2026-09-01T09:00:00.000Z'));
  assert.equal(later.setName('Dana').ok, true);

  const state = later.load();
  assert.equal(state?.name, 'Dana');
  assert.equal(state?.completedAt, '2026-08-19T12:00:00.000Z');
});

test('setName with nothing clears the name', () => {
  const s = fakeStorage();
  const store = createOnboardingStore(s.deps);
  store.complete('Ron');
  store.setName('   ');
  assert.equal(store.load()?.name, undefined);
});

test('setName before onboarding completes it', () => {
  const s = fakeStorage();
  const store = createOnboardingStore(s.deps, at('2026-08-19T12:00:00.000Z'));
  assert.equal(store.setName('Ron').ok, true);
  assert.equal(store.load()?.name, 'Ron');
});

// --- reset -----------------------------------------------------------------

test('reset sends the user back through onboarding', () => {
  const s = fakeStorage();
  const store = createOnboardingStore(s.deps);
  store.complete('Ron');
  store.reset();
  assert.equal(store.load(), null);
});
