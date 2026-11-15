import test from 'node:test';
import assert from 'node:assert/strict';
import { annualHeldOutError, anomalyClass, climatology, completeYears, inverseNormal, normalCdf, seasonalTiming, trendTest } from './stats.js';

const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const year = (y, values) => values.map((value, i) => ({ year: y, month: i + 1, harmonized: value }));

test('normal distribution helpers match reference values', () => {
  close(normalCdf(1.959963985), 0.975, 2e-7);
  close(normalCdf(0), 0.5, 1e-9);
  close(normalCdf(-1), 0.158655254, 2e-7);
  close(inverseNormal(0.975), 1.959963985, 1e-8);
  close(inverseNormal(0.01), -2.326347874, 1e-8);
});

test('complete years exclude partial and null months, never filling them with zero', () => {
  const rows = [...year(2020, Array(12).fill(1)), ...year(2021, [1, 1, null, 1, 1, 1, 1, 1, 1, 1, 1, 1]), ...year(2022, Array(10).fill(2))];
  assert.deepEqual(completeYears(rows).map(y => y.year), [2020]);
});

test('climatology averages complete years and reports monthly shares of the annual mean', () => {
  const rows = [...year(2020, [0, 0, 0, 0, 0, 0, 0, 10, 20, 10, 0, 0]), ...year(2021, [0, 0, 0, 0, 0, 0, 0, 30, 40, 10, 0, 0]), ...year(2022, [5, 5])];
  const result = climatology(rows);
  assert.equal(result.years, 2); assert.equal(result.first, 2020); assert.equal(result.last, 2021);
  assert.equal(result.months[8].mean, 30);
  close(result.months[8].share, 50);
  close(result.months.reduce((sum, m) => sum + m.share, 0), 100);
  assert.equal(result.peak.month, 9);
  assert.equal(climatology([]).peak, null);
});

test('seasonal timing finds peak months, ties, and a circular centre across December–January', () => {
  const [tie] = seasonalTiming(year(2020, [10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10]));
  assert.deepEqual(tie.peaks, [1, 12]); assert.equal(tie.peak, null);
  close(tie.centre, 12.5, 1e-9);
  const [single] = seasonalTiming(year(2021, [0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0]));
  assert.equal(single.peak, 9); close(single.centre, 9, 1e-9); close(single.concentration, 1, 1e-12);
  const [flat] = seasonalTiming(year(2022, Array(12).fill(0)));
  assert.equal(flat.centre, null); assert.deepEqual(flat.peaks, []);
});

test('Mann–Kendall and Sen slope match hand-computed values, including ties', () => {
  const rising = trendTest(Array.from({ length: 10 }, (_, i) => ({ x: 2000 + i, y: i + 1 })));
  assert.equal(rising.s, 45); assert.equal(rising.variance, 125);
  close(rising.z, 44 / Math.sqrt(125), 1e-12);
  close(rising.p, 2 * (1 - normalCdf(44 / Math.sqrt(125))), 1e-12);
  assert.equal(rising.slope, 1); assert.equal(rising.lower, 1); assert.equal(rising.upper, 1);
  close(rising.tau, 1);
  const tied = trendTest([1, 2, 2, 3, 4, 5, 6, 7].map((y, i) => ({ x: i, y })));
  close(tied.variance, (8 * 7 * 21 - 18) / 18, 1e-12);
  assert.equal(tied.s, 27);
  const flat = trendTest(Array.from({ length: 9 }, (_, i) => ({ x: i, y: 5 })));
  assert.equal(flat.s, 0); assert.equal(flat.z, 0); close(flat.p, 1, 1e-6); assert.equal(flat.slope, 0);
  assert.equal(trendTest([{ x: 1, y: 1 }]).status, 'insufficient');
  // Intercept is the median of y − slope·x over unsorted input (a regression check).
  const shuffled = trendTest([9, 2, 7, 4, 5, 6, 3, 8, 1, 10].map((x, i) => ({ x: 2000 + x, y: 100 + 3 * x })));
  assert.equal(shuffled.slope, 3); assert.equal(shuffled.intercept + 3 * 2000, 100);
  const noisy = trendTest([3, 1, 4, 1, 5, 9, 2, 6, 5, 3].map((y, i) => ({ x: i, y })));
  assert.ok(noisy.lower <= noisy.slope && noisy.slope <= noisy.upper);
  assert.ok(noisy.p > 0.05);
});

test('annual held-out error uses scored months only', () => {
  const rows = [
    { year: 2020, month: 1, included: true, actual_viirs: 100, model_b: 110, raw_modis: 40 },
    { year: 2020, month: 2, included: true, actual_viirs: 100, model_b: 100, raw_modis: 40 },
    { year: 2020, month: 3, included: false, actual_viirs: 1, model_b: 999, raw_modis: 1 },
    { year: 2021, month: 1, included: true, actual_viirs: 50, model_b: 45, raw_modis: 20 },
  ];
  const [first, second] = annualHeldOutError(rows);
  assert.equal(first.months, 2); close(first.error_pct, 5); close(first.raw_error_pct, -60);
  close(second.error_pct, -10);
});

test('anomaly class uses mid-rank percentiles, explicit thresholds and a minimum baseline', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ year: 2000 + i, value: i + 1 }));
  const top = anomalyClass(10, history);
  close(top.percentile, 95); assert.equal(top.label, 'Well above typical');
  assert.equal(anomalyClass(5.5, history).label, 'Within the typical range');
  assert.equal(anomalyClass(0, history).label, 'Well below typical');
  close(anomalyClass(8, history).percentile, 75); assert.equal(anomalyClass(8, history).label, 'Above typical');
  assert.equal(anomalyClass(5, history.slice(0, 9)).status, 'insufficient');
  assert.equal(anomalyClass(null, history).status, 'unavailable');
});

test('unwrapping months keeps December–January neighbours continuous', async () => {
  const { unwrapMonths } = await import('./stats.js');
  const result = unwrapMonths([12.5, 1, 12, 0.9 + 12]);
  assert.ok(result.mean > 12.4 || result.mean < 1.1);
  const spread = Math.max(...result.values) - Math.min(...result.values);
  assert.ok(spread < 2, `spread ${spread}`);
  const plain = unwrapMonths([8, 9, 10]);
  close(plain.mean, 9, 1e-9); assert.deepEqual(plain.values.map(v => Math.round(v * 1e9) / 1e9), [8, 9, 10]);
  assert.equal(unwrapMonths([null]).mean, null);
});
