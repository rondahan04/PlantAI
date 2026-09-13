import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Every national shipper must ship with a logo.
 *
 * Read as TEXT rather than imported. nurseryLogos.ts resolves its images with
 * `require('...png')`, which Metro understands and Node does not, so importing
 * the module here would fail on the asset rather than on the thing under test.
 *
 * Worth guarding at all because the failure is silent: a shipper added to
 * data/nurseries-shippers.txt with no logo entry does not crash, it renders the
 * grey leaf placeholder - on a row that appears in EVERY Deliver-tab search,
 * which is how the placeholder became the most-seen image in the app the first
 * time round.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');

const source = fs.readFileSync(path.join(HERE, 'nurseryLogos.ts'), 'utf8');

/* The shipper hosts, derived the way Nursery.id is: lowercased, www stripped. */
function shipperHosts(): string[] {
  return fs
    .readFileSync(path.join(ROOT, 'data', 'nurseries-shippers.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('http'))
    .map((url) => new URL(url).hostname.toLowerCase().replace(/^www\./, ''));
}

test('every national shipper has a bundled logo', () => {
  const hosts = shipperHosts();
  assert.ok(hosts.length > 0, 'the shipper list should not be empty');
  for (const host of hosts) {
    assert.ok(
      source.includes(`'${host}'`),
      `${host} ships on every Deliver search but has no logo - it will render the leaf placeholder`
    );
  }
});

test('every logo a shipper is keyed to actually exists on disk', () => {
  const files = [...source.matchAll(/require\('([^']+\.png)'\)/g)].map((m) => m[1]);
  assert.ok(files.length > 0, 'no logos are registered at all');
  for (const rel of files) {
    const abs = path.resolve(HERE, rel);
    assert.ok(fs.existsSync(abs), `${rel} is required but missing - the bundle would fail to build`);
  }
});
