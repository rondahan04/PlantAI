import test from 'node:test';
import assert from 'node:assert/strict';
import { SOIL_MEDIA, soilMediumById, type SoilMediumId } from './soilMedia.ts';

test('SOIL_MEDIA contains exactly the eight known media, no more, no fewer', () => {
  const expected: SoilMediumId[] = [
    'potting_mix',
    'aroid_mix',
    'leca',
    'pon',
    'sphagnum',
    'bark',
    'perlite_mix',
    'water',
  ];
  const actual = SOIL_MEDIA.map((m) => m.id);
  assert.deepEqual([...actual].sort(), [...expected].sort());
  const ids = new Set(actual);
  assert.equal(ids.size, SOIL_MEDIA.length, 'ids must be unique');
});

test('soilMediumById returns the medium, or undefined for junk', () => {
  assert.equal(soilMediumById('leca')?.label, 'LECA');
  assert.equal(soilMediumById('not_a_medium' as SoilMediumId), undefined);
});

test('multipliers are sane and directional', () => {
  for (const m of SOIL_MEDIA) {
    assert.ok(m.waterMultiplier >= 0.4 && m.waterMultiplier <= 2.5, `${m.id} out of range`);
  }
  const pottingMix = soilMediumById('potting_mix')!.waterMultiplier;
  // Free-draining or inert media dry out sooner than peat, so they must sit
  // strictly below potting mix - every one of them, not just LECA, or a
  // regression like bark (0.7) climbing above potting mix would pass unnoticed.
  const fasterDrying: SoilMediumId[] = ['aroid_mix', 'leca', 'pon', 'bark', 'perlite_mix'];
  for (const id of fasterDrying) {
    assert.ok(
      soilMediumById(id)!.waterMultiplier < pottingMix,
      `${id} should dry out faster than potting mix`
    );
  }
  // Water-retentive media hold on longer than peat.
  const slowerDrying: SoilMediumId[] = ['sphagnum', 'water'];
  for (const id of slowerDrying) {
    assert.ok(
      soilMediumById(id)!.waterMultiplier > pottingMix,
      `${id} should hold water longer than potting mix`
    );
  }
});

test('every medium has a label, a one-line description and an icon', () => {
  for (const m of SOIL_MEDIA) {
    assert.ok(m.label.length > 0, `${m.id} label`);
    assert.ok(m.description.length > 0, `${m.id} description`);
    assert.ok(m.icon.length > 0, `${m.id} icon`);
    assert.ok(m.tint.length > 0, `${m.id} tint`);
  }
});
