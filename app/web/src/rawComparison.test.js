import test from 'node:test';
import assert from 'node:assert/strict';
import { rawComparison } from './rawComparison.js';

const complete = { raw_modis: 200, raw_viirs: 500, quality_available: true, incomplete_metrics: [] };
test('raw comparison uses VIIRS minus MODIS and VIIRS over MODIS, retaining provisional observations', () => {
  assert.deepEqual(rawComparison(complete), { difference: 300, ratio: 2.5, reason: '', ratioReason: '' });
  assert.equal(rawComparison({ ...complete, nrt: true }).ratio, 2.5);
  assert.equal(rawComparison({ ...complete, raw_viirs: 100 }).difference, -100);
});
test('zero observations are valid but zero denominators do not produce ratios', () => {
  assert.equal(rawComparison({ ...complete, raw_viirs: 0 }).ratio, 0);
  const zeroModis = rawComparison({ ...complete, raw_modis: 0 });
  assert.equal(zeroModis.difference, 500);
  assert.equal(zeroModis.ratio, null);
  assert.match(zeroModis.ratioReason, /zero/);
});
test('missing, incomplete, gap-flagged and unverified raw observations cannot support comparisons', () => {
  for (const changes of [{ raw_modis: null }, { raw_viirs: null }, { incomplete_metrics: ['raw_viirs'] }, { incomplete_metrics: ['raw_modis'] }, { gap_flag: true }, { quality_available: false }]) {
    const result = rawComparison({ ...complete, ...changes });
    assert.equal(result.difference, null);
    assert.equal(result.ratio, null);
    assert.ok(result.reason);
  }
  assert.equal(rawComparison(undefined).ratio, null);
  // A harmonized estimate does not replace a raw sensor measurement.
  assert.equal(rawComparison({ ...complete, source: 'gapfill', harmonized: 900 }).ratio, 2.5);
});
