import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRemoteUri } from './remoteUri.ts';

/*
 * The real input, first. This is the exact shape `fetchAll` puts in `photoUri`
 * for a logged-in user, and misjudging it is the whole bug: read as a local file
 * it throws, and "Diagnose all" reports a silent failure for every plant.
 */
test('a Supabase signed URL is remote', () => {
  assert.equal(
    isRemoteUri(
      'https://amehahtaiggookgekfjt.supabase.co/storage/v1/object/sign/plants/user/abc.jpg?token=ey'
    ),
    true
  );
});

test('a local photo is not remote, in every spelling the app produces', () => {
  // file:// is what the camera and the documents-directory copy both hand us;
  // the others are what the OS hands a picker. None of them need a download.
  for (const uri of [
    'file:///var/mobile/Containers/Data/Application/ABC/Documents/plant.jpg',
    'file:///data/user/0/com.plantai/cache/plant.jpg',
    '/var/mobile/Containers/Data/plant.jpg',
    'content://media/external/images/media/42',
    'ph://ABC-DEF',
    'asset:/plant.jpg',
  ]) {
    assert.equal(isRemoteUri(uri), false, uri);
  }
});

test('a data URI carries its own bytes and is not fetched', () => {
  assert.equal(isRemoteUri('data:image/jpeg;base64,/9j/4AAQ'), false);
});

test('the scheme is matched case-insensitively and past stray whitespace', () => {
  assert.equal(isRemoteUri('HTTPS://example.com/a.jpg'), true);
  assert.equal(isRemoteUri('  https://example.com/a.jpg'), true);
});

test('a host that merely mentions http is not remote', () => {
  // The scheme is at the front or it is not a scheme.
  assert.equal(isRemoteUri('file:///var/https/plant.jpg'), false);
  assert.equal(isRemoteUri('/photos/http/plant.jpg'), false);
});

test('junk never throws and is never called remote', () => {
  for (const junk of ['', '   ', 42 as unknown as string, null as unknown as string]) {
    assert.doesNotThrow(() => isRemoteUri(junk));
    assert.equal(isRemoteUri(junk), false);
  }
});
