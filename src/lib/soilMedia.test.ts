import test from 'node:test';
import assert from 'node:assert/strict';
import { SOIL_MEDIA, SOIL_MEDIUM_IDS, soilMediumById, type SoilMediumId } from './soilMedia.ts';

test('every id has exactly one medium', () => {
  assert.equal(SOIL_MEDIA.length, SOIL_MEDIUM_IDS.length);
  const ids = new Set(SOIL_MEDIA.map((m) => m.id));
  assert.equal(ids.size, SOIL_MEDIA.length);
  for (const id of SOIL_MEDIUM_IDS) assert.ok(ids.has(id), `no medium for ${id}`);
});

test('soilMediumById returns the medium, or undefined for junk', () => {
  assert.equal(soilMediumById('leca')?.label, 'LECA');
  assert.equal(soilMediumById('not_a_medium' as SoilMediumId), undefined);
});

test('multipliers are sane and directional', () => {
  for (const m of SOIL_MEDIA) {
    assert.ok(m.waterMultiplier >= 0.4 && m.waterMultiplier <= 2.5, `${m.id} out of range`);
  }
  // Inert, fast-draining media dry out sooner than peat; water and moss hold on.
  assert.ok(soilMediumById('leca')!.waterMultiplier < soilMediumById('potting_mix')!.waterMultiplier);
  assert.ok(soilMediumById('sphagnum')!.waterMultiplier > soilMediumById('potting_mix')!.waterMultiplier);
});

test('every medium has a label, a one-line description and an icon', () => {
  for (const m of SOIL_MEDIA) {
    assert.ok(m.label.length > 0, `${m.id} label`);
    assert.ok(m.description.length > 0, `${m.id} description`);
    assert.ok(m.icon.length > 0, `${m.id} icon`);
    assert.ok(m.tint.length > 0, `${m.id} tint`);
  }
});
