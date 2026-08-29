import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoStore, photoExtension, PHOTO_DIR_NAME, type PhotoDeps } from './photoStore.ts';

/*
 * The failure this module exists to prevent is silent: a saved plant keeps its
 * record and loses its picture, weeks later, on a schedule iOS controls. So the
 * tests are mostly about what happens when the copy does NOT work - a purged
 * source, a throwing copy, a copy that reports success without writing bytes.
 * In every one of those the plant must survive with a usable answer, never a
 * URI pointing at nothing.
 */

const DOC = 'file:///doc/';
const DIR = `${DOC}${PHOTO_DIR_NAME}/`;

function fakeFs(seed: string[] = []) {
  const files = new Set(seed);
  // A seeded file implies its directory exists - the real filesystem cannot
  // hold a file inside a directory that does not.
  const dirs = new Set<string>(seed.map((f) => f.slice(0, f.lastIndexOf('/') + 1)));
  let copyMode: 'ok' | 'throw' | 'silent' = 'ok';
  const removed: string[] = [];

  const deps: PhotoDeps = {
    documentDir: DOC,
    ensureDir: (uri) => {
      dirs.add(uri);
    },
    exists: (uri) => files.has(uri),
    list: (uri) => (dirs.has(uri) ? [...files].filter((f) => f.startsWith(uri)).map((f) => f.slice(uri.length)) : []),
    copy: async (from, to) => {
      if (copyMode === 'throw') throw new Error('ENOSPC: no space left on device');
      // A copy that returns without writing anything is the quiet failure the
      // read-back exists to catch.
      if (copyMode === 'silent') return;
      if (!files.has(from)) throw new Error('source missing');
      files.add(to);
    },
    remove: (uri) => {
      removed.push(uri);
      files.delete(uri);
    },
  };

  return {
    deps,
    files,
    dirs,
    removed,
    setCopy: (m: typeof copyMode) => {
      copyMode = m;
    },
  };
}

test('adopt copies a cache photo into the document directory and returns its uri', async () => {
  const fs = fakeFs(['file:///cache/temp-photo.jpg']);
  const store = createPhotoStore(fs.deps);

  const uri = await store.adopt('abc123', 'file:///cache/temp-photo.jpg');

  assert.equal(uri, `${DIR}abc123.jpg`);
  assert.ok(fs.files.has(`${DIR}abc123.jpg`));
  assert.ok(fs.dirs.has(DIR), 'the photo directory is created on first adopt');
});

/*
 * iOS can keep an app's data container and still change the UUID in its path,
 * which strands every absolute URI already written into the library even
 * though the files themselves never moved.
 */
test('adopt repoints a photo stranded under a previous container path', async () => {
  const fs = fakeFs([`${DIR}abc123.jpg`]);
  const store = createPhotoStore(fs.deps);
  const stale = `file:///doc-OLD-CONTAINER/${PHOTO_DIR_NAME}/abc123.jpg`;

  const uri = await store.adopt('abc123', stale);

  assert.equal(uri, `${DIR}abc123.jpg`);
  // A repoint, not a copy - the bytes were already in the right place.
  assert.deepEqual(fs.removed, []);
});

test('adopt does not invent a photo when the stranded file is genuinely gone', async () => {
  const fs = fakeFs();
  const store = createPhotoStore(fs.deps);
  const stale = `file:///doc-OLD-CONTAINER/${PHOTO_DIR_NAME}/missing.jpg`;

  assert.equal(await store.adopt('missing', stale), null);
});

test('adopt preserves the source extension', async () => {
  const fs = fakeFs(['file:///cache/pick.HEIC']);
  const store = createPhotoStore(fs.deps);

  assert.equal(await store.adopt('p1', 'file:///cache/pick.HEIC'), `${DIR}p1.heic`);
});

test('adopt falls back to .jpg for a source with no usable extension', async () => {
  const fs = fakeFs(['file:///cache/ph-asset-id']);
  const store = createPhotoStore(fs.deps);

  assert.equal(await store.adopt('p1', 'file:///cache/ph-asset-id'), `${DIR}p1.jpg`);
});

test('adopt ignores a query string when reading the extension', async () => {
  const fs = fakeFs(['file:///cache/img.png?width=100']);
  const store = createPhotoStore(fs.deps);

  assert.equal(await store.adopt('p1', 'file:///cache/img.png?width=100'), `${DIR}p1.png`);
});

/*
 * The whole point of the feature: the record outlives the cache file. If the
 * source is already gone there is nothing to rescue, and the caller must be
 * told so rather than handed a document URI that was never written.
 */
test('adopt returns null when the source has already been purged', async () => {
  const fs = fakeFs([]);
  const store = createPhotoStore(fs.deps);

  assert.equal(await store.adopt('p1', 'file:///cache/gone.jpg'), null);
});

test('adopt returns null when the copy throws', async () => {
  const fs = fakeFs(['file:///cache/a.jpg']);
  fs.setCopy('throw');
  const store = createPhotoStore(fs.deps);

  assert.equal(await store.adopt('p1', 'file:///cache/a.jpg'), null);
});

test('adopt returns null when the copy reports success but writes nothing', async () => {
  const fs = fakeFs(['file:///cache/a.jpg']);
  fs.setCopy('silent');
  const store = createPhotoStore(fs.deps);

  assert.equal(await store.adopt('p1', 'file:///cache/a.jpg'), null);
});

/*
 * Re-adopting must be safe: the update that records the new URI can fail, and
 * the repair path on next load will call adopt again with the same arguments.
 */
test('adopt is idempotent when handed a uri it already owns', async () => {
  const fs = fakeFs([`${DIR}p1.jpg`]);
  const store = createPhotoStore(fs.deps);

  assert.equal(await store.adopt('p1', `${DIR}p1.jpg`), `${DIR}p1.jpg`);
  assert.deepEqual(fs.removed, [], 'an owned photo is never deleted by adopting it again');
});

test('adopt replaces an existing photo for the same id', async () => {
  const fs = fakeFs(['file:///cache/new.jpg', `${DIR}p1.jpg`]);
  const store = createPhotoStore(fs.deps);

  assert.equal(await store.adopt('p1', 'file:///cache/new.jpg'), `${DIR}p1.jpg`);
  assert.ok(fs.removed.includes(`${DIR}p1.jpg`), 'the stale file is removed before the copy');
});

test('adopt sanitises an id so it cannot escape the photo directory', async () => {
  const fs = fakeFs(['file:///cache/a.jpg']);
  const store = createPhotoStore(fs.deps);

  const uri = await store.adopt('../../etc/passwd', 'file:///cache/a.jpg');

  assert.ok(uri!.startsWith(DIR), `${uri} escaped ${DIR}`);
  assert.ok(!uri!.includes('..'));
});

test('owns() distinguishes a persisted photo from a cache uri', () => {
  const store = createPhotoStore(fakeFs().deps);

  assert.equal(store.owns(`${DIR}p1.jpg`), true);
  assert.equal(store.owns('file:///cache/temp-photo.jpg'), false);
  assert.equal(store.owns(''), false);
});

test('discard removes the photo for one id whatever its extension', () => {
  const fs = fakeFs([`${DIR}p1.heic`, `${DIR}p2.jpg`]);
  const store = createPhotoStore(fs.deps);

  store.discard('p1');

  assert.ok(!fs.files.has(`${DIR}p1.heic`));
  assert.ok(fs.files.has(`${DIR}p2.jpg`), 'another plant’s photo is untouched');
});

test('discard is silent when there is nothing to remove', () => {
  const fs = fakeFs([]);
  const store = createPhotoStore(fs.deps);

  assert.doesNotThrow(() => store.discard('p1'));
});

/*
 * Sweep is the only thing keeping the directory bounded: a crash between the
 * copy and the record update, or a removal that failed to persist, both leave a
 * file no plant points at.
 */
test('sweep deletes photos no plant claims and reports the count', () => {
  const fs = fakeFs([`${DIR}keep.jpg`, `${DIR}orphan.jpg`, `${DIR}alsoOrphan.png`]);
  const store = createPhotoStore(fs.deps);

  assert.equal(store.sweep(['keep']), 2);
  assert.ok(fs.files.has(`${DIR}keep.jpg`));
  assert.ok(!fs.files.has(`${DIR}orphan.jpg`));
  assert.ok(!fs.files.has(`${DIR}alsoOrphan.png`));
});

test('sweep does nothing when every photo is claimed', () => {
  const fs = fakeFs([`${DIR}a.jpg`, `${DIR}b.jpg`]);
  const store = createPhotoStore(fs.deps);

  assert.equal(store.sweep(['a', 'b']), 0);
  assert.deepEqual(fs.removed, []);
});

/*
 * A library that failed to load reports zero plants. Sweeping on that would
 * delete every photo the user has - the exact data loss the quarantine in
 * plantStore was written to avoid. The caller must pass `ok`, and sweep refuses
 * when it is false.
 */
test('sweep refuses to run against an unreadable library', () => {
  const fs = fakeFs([`${DIR}a.jpg`]);
  const store = createPhotoStore(fs.deps);

  assert.equal(store.sweep([], { libraryReadable: false }), 0);
  assert.ok(fs.files.has(`${DIR}a.jpg`));
});

test('sweep survives a directory that does not exist yet', () => {
  const fs = fakeFs([]);
  const store = createPhotoStore(fs.deps);

  assert.equal(store.sweep(['a']), 0);
});

test('photoExtension normalises what a real picker hands us', () => {
  assert.equal(photoExtension('file:///x/a.JPEG'), 'jpeg');
  assert.equal(photoExtension('file:///x/a.jpg'), 'jpg');
  assert.equal(photoExtension('file:///x/no-dot'), 'jpg');
  assert.equal(photoExtension('file:///x/a.verylongextension'), 'jpg');
  assert.equal(photoExtension('file:///x.dir/name'), 'jpg');
  assert.equal(photoExtension(''), 'jpg');
});
