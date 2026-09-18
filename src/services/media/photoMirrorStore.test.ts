import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPhotoMirror,
  mirrorExtension,
  idFromMirrorName,
  MIRROR_DIR_NAME,
  type MirrorDeps,
} from './photoMirrorStore.ts';

/*
 * What this module is defending against is a photograph that is on the phone
 * and still cannot be drawn: a partial download indexed as if it were whole, a
 * replaced picture served from a stale file, a sweep that fires against a
 * library that had not finished loading. All of those look like a working app
 * right up until the user opens it, so they are tested here rather than hoped
 * for on a device.
 */

const DOC = 'file:///doc/';
const DIR = `${DOC}${MIRROR_DIR_NAME}/`;
const REMOTE = 'https://bucket.example/plants/u1/p1.jpg?token=abc';

function fakeFs(seed: string[] = []) {
  const files = new Set(seed);
  const dirs = new Set<string>(seed.map((f) => f.slice(0, f.lastIndexOf('/') + 1)));
  let downloadMode: 'ok' | 'throw' | 'silent' = 'ok';
  let listMode: 'ok' | 'throw' = 'ok';
  const downloaded: string[] = [];

  const deps: MirrorDeps = {
    documentDir: DOC,
    ensureDir: (uri) => {
      dirs.add(uri);
    },
    exists: (uri) => files.has(uri),
    list: (uri) => {
      if (listMode === 'throw') throw new Error('EIO');
      if (!dirs.has(uri)) return [];
      return [...files].filter((f) => f.startsWith(uri)).map((f) => f.slice(uri.length));
    },
    download: async (url, destination) => {
      downloaded.push(url);
      if (downloadMode === 'throw') throw new Error('network');
      // A download that resolves without writing bytes - the quiet failure the
      // read-back exists to catch.
      if (downloadMode === 'silent') return;
      files.add(destination);
    },
    move: async (from, to) => {
      if (!files.has(from)) throw new Error('source missing');
      files.delete(from);
      files.add(to);
    },
    remove: (uri) => {
      files.delete(uri);
    },
  };

  return {
    deps,
    files,
    downloaded,
    setDownload: (mode: typeof downloadMode) => {
      downloadMode = mode;
    },
    setList: (mode: typeof listMode) => {
      listMode = mode;
    },
  };
}

// --- naming ---------------------------------------------------------------

test('mirrorExtension reads past the signing query, which is longer than the path', () => {
  assert.equal(mirrorExtension(REMOTE), 'jpg');
  assert.equal(mirrorExtension('https://x/y/z.PNG?a=1&b=2#frag'), 'png');
});

test('mirrorExtension falls back to jpg rather than guessing from a query', () => {
  // The token contains dots; none of them is an extension.
  assert.equal(mirrorExtension('https://x/y/photo?token=a.b.c'), 'jpg');
  assert.equal(mirrorExtension('https://x/y/photo'), 'jpg');
});

test('idFromMirrorName ignores in-flight downloads', () => {
  assert.equal(idFromMirrorName('p1.jpg'), 'p1');
  assert.equal(idFromMirrorName('p1.jpg.part'), null);
  assert.equal(idFromMirrorName('noextension'), null);
});

// --- the happy path -------------------------------------------------------

test('a remote photo is downloaded once and then served from disk', async () => {
  const fs = fakeFs();
  const mirror = createPhotoMirror(fs.deps);
  const plants = [{ id: 'p1', photoUri: REMOTE }];

  assert.equal(mirror.localFor('p1'), undefined);
  assert.equal(await mirror.ensure(plants), 1);
  assert.equal(mirror.localFor('p1'), `${DIR}p1.jpg`);

  // Second pass asks for nothing: the whole point of calling this on every focus.
  assert.equal(await mirror.ensure(plants), 0);
  assert.equal(fs.downloaded.length, 1);
});

test('an existing mirror is read from one directory listing, not re-downloaded', async () => {
  const fs = fakeFs([`${DIR}p1.jpg`]);
  const mirror = createPhotoMirror(fs.deps);

  assert.equal(mirror.localFor('p1'), `${DIR}p1.jpg`);
  assert.equal(await mirror.ensure([{ id: 'p1', photoUri: REMOTE }]), 0);
  assert.equal(fs.downloaded.length, 0);
});

test('local photos are never mirrored - they are already files', async () => {
  const fs = fakeFs();
  const mirror = createPhotoMirror(fs.deps);

  assert.equal(await mirror.ensure([{ id: 'g1', photoUri: 'file:///doc/plant-photos/g1.jpg' }]), 0);
  assert.equal(fs.downloaded.length, 0);
  assert.equal(mirror.localFor('g1'), undefined);
});

// --- failures that must not index a broken photo --------------------------

test('a download that writes nothing is not indexed', async () => {
  const fs = fakeFs();
  fs.setDownload('silent');
  const mirror = createPhotoMirror(fs.deps);

  assert.equal(await mirror.ensure([{ id: 'p1', photoUri: REMOTE }]), 0);
  assert.equal(mirror.localFor('p1'), undefined);
});

test('a failed download leaves no staging file behind', async () => {
  const fs = fakeFs();
  fs.setDownload('throw');
  const mirror = createPhotoMirror(fs.deps);

  await mirror.ensure([{ id: 'p1', photoUri: REMOTE }]);
  assert.deepEqual([...fs.files], []);
});

test('a photo that keeps failing stops being retried within the session', async () => {
  const fs = fakeFs();
  fs.setDownload('throw');
  const mirror = createPhotoMirror(fs.deps);
  const plants = [{ id: 'p1', photoUri: REMOTE }];

  await mirror.ensure(plants);
  await mirror.ensure(plants);
  await mirror.ensure(plants);
  // Two attempts, then it is left alone - otherwise every focus effect on every
  // screen re-requests a photo that is never going to arrive.
  assert.equal(fs.downloaded.length, 2);
});

test('an unlistable directory degrades to "nothing mirrored", not a throw', () => {
  const fs = fakeFs();
  fs.setList('throw');
  const mirror = createPhotoMirror(fs.deps);

  assert.equal(mirror.localFor('p1'), undefined);
  assert.equal(mirror.sweep(['p1'], { libraryReadable: true }), 0);
});

// --- staleness ------------------------------------------------------------

test('discard drops the file so a replaced photo is re-fetched', async () => {
  const fs = fakeFs();
  const mirror = createPhotoMirror(fs.deps);
  await mirror.ensure([{ id: 'p1', photoUri: REMOTE }]);

  mirror.discard('p1');
  assert.equal(mirror.localFor('p1'), undefined);
  assert.deepEqual([...fs.files], []);

  // And the failure count went with it, so a plant whose photo had failed
  // before can be fetched again once it is fixed.
  assert.equal(await mirror.ensure([{ id: 'p1', photoUri: REMOTE }]), 1);
});

// --- sweeping -------------------------------------------------------------

test('sweep deletes photos no plant claims, and abandoned downloads', () => {
  const fs = fakeFs([`${DIR}p1.jpg`, `${DIR}p2.jpg`, `${DIR}p3.jpg.part`]);
  const mirror = createPhotoMirror(fs.deps);

  assert.equal(mirror.sweep(['p1'], { libraryReadable: true }), 2);
  assert.deepEqual([...fs.files], [`${DIR}p1.jpg`]);
  assert.equal(mirror.localFor('p2'), undefined);
});

test('sweep does nothing against a library that failed to load', () => {
  const fs = fakeFs([`${DIR}p1.jpg`]);
  const mirror = createPhotoMirror(fs.deps);

  assert.equal(mirror.sweep([], { libraryReadable: false }), 0);
  assert.deepEqual([...fs.files], [`${DIR}p1.jpg`]);
});

test('clear removes another account\'s photographs at sign-out', async () => {
  const fs = fakeFs([`${DIR}p1.jpg`, `${DIR}p2.jpg`]);
  const mirror = createPhotoMirror(fs.deps);

  mirror.clear();
  assert.deepEqual([...fs.files], []);
  assert.equal(mirror.localFor('p1'), undefined);
});

// --- ids from a server ----------------------------------------------------

test('an id that is not filename-safe cannot escape the directory', async () => {
  const fs = fakeFs();
  const mirror = createPhotoMirror(fs.deps);

  await mirror.ensure([{ id: '../../etc/passwd', photoUri: REMOTE }]);
  for (const file of fs.files) assert.ok(file.startsWith(DIR), `${file} escaped ${DIR}`);
  // And it is still reachable under the same id it was written for.
  assert.ok(mirror.localFor('../../etc/passwd')?.startsWith(DIR));
});

// --- subscribers ----------------------------------------------------------

test('subscribers are told once per batch, not once per photo', async () => {
  const fs = fakeFs();
  const mirror = createPhotoMirror(fs.deps);
  let calls = 0;
  const off = mirror.subscribe(() => {
    calls++;
  });

  await mirror.ensure([
    { id: 'p1', photoUri: REMOTE },
    { id: 'p2', photoUri: REMOTE },
  ]);
  assert.equal(calls, 1);

  off();
  mirror.discard('p1');
  assert.equal(calls, 1);
});

test('a batch that lands nothing tells nobody', async () => {
  const fs = fakeFs();
  fs.setDownload('throw');
  const mirror = createPhotoMirror(fs.deps);
  let calls = 0;
  mirror.subscribe(() => {
    calls++;
  });

  await mirror.ensure([{ id: 'p1', photoUri: REMOTE }]);
  assert.equal(calls, 0);
});

// --- the expired-signature trap -------------------------------------------

test('a re-signed url gets a fresh attempt budget', async () => {
  /*
   * The first launch of a logged-in session: the mirror's stored urls were
   * minted last session and every one of them is dead. The budget must survive
   * that, because the url that works arrives seconds later from
   * `refreshFromCloud` - and if it is refused, the photo stays remote for the
   * whole session for no reason at all.
   */
  const fs = fakeFs();
  fs.setDownload('throw');
  const mirror = createPhotoMirror(fs.deps);
  const expired = 'https://bucket.example/plants/u1/p1.jpg?token=stale';

  await mirror.ensure([{ id: 'p1', photoUri: expired }]);
  await mirror.ensure([{ id: 'p1', photoUri: expired }]);
  assert.equal(fs.downloaded.length, 2, 'the dead url is written off');

  await mirror.ensure([{ id: 'p1', photoUri: expired }]);
  assert.equal(fs.downloaded.length, 2, 'and stays written off');

  fs.setDownload('ok');
  const resigned = 'https://bucket.example/plants/u1/p1.jpg?token=fresh';
  assert.equal(await mirror.ensure([{ id: 'p1', photoUri: resigned }]), 1);
  assert.equal(mirror.localFor('p1'), `${DIR}p1.jpg`);
});
