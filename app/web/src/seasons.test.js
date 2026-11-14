import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSeasons } from './seasons.js';

const row = (year, month, harmonized, extra = {}) => ({ year, month, harmonized, raw_modis: 99999, daynight: 'D', source: 'observed', incomplete_metrics: [], quality_available: true, ...extra });
const spring = (year, total, extra = {}) => [9, 10, 11].map(month => row(year, month, total / 3, extra));

test('summer belongs to its December year; January and February use the next year', () => {
  const rows = [row(2025, 12, 12), row(2026, 1, 20), row(2026, 2, 30), row(2025, 1, 1000)];
  const result = compareSeasons(rows, 'summer', 3, '2025-01', '2026-10');
  const season = result.seasons.find(s => s.year === 2025);
  assert.equal(season.label, 'Summer 2025–26');
  assert.deepEqual(season.months.map(m => m.key), ['2025-12', '2026-01', '2026-02']);
  assert.equal(season.total, 62);
  assert.equal(result.median, 62);
  assert.ok(result.seasons.every(s => s.year < 2026));
});

test('last N complete seasons determine odd and even medians; latest partial is extra context', () => {
  const rows = [spring(2022, 10), spring(2023, 20), spring(2024, 80), spring(2025, 40), row(2026, 9, 100), row(2026, 10, 200)].flat();
  const result = compareSeasons(rows, 'spring', 3, '2022-01', '2026-10');
  assert.deepEqual(result.complete.map(s => s.year), [2023, 2024, 2025]);
  assert.equal(result.median, 40);
  const partial = result.seasons.at(-1);
  assert.equal(partial.complete, false);
  assert.equal(partial.total, null);
  assert.equal(partial.partialTotal, 300);
  assert.equal(partial.months[2].value, null);
  assert.equal(partial.months[2].reason, 'Month unavailable');
  assert.equal(compareSeasons(rows, 'spring', 5, '2022-01', '2026-10').median, 30);
});

test('nulls, missing rows, incomplete harmonized observations and unknown coverage are never complete', () => {
  const rows = [...spring(2020, 30), ...spring(2021, 60), ...spring(2022, 90), ...spring(2023, 120), ...spring(2024, 150)];
  rows.find(r => r.year === 2021 && r.month === 11).harmonized = null;
  rows.find(r => r.year === 2022 && r.month === 10).incomplete_metrics = ['raw_viirs', 'harmonized'];
  rows.find(r => r.year === 2023 && r.month === 9).quality_available = false;
  const result = compareSeasons(rows.filter(r => !(r.year === 2024 && r.month === 11)), 'spring', 10, '2020-01', '2024-12');
  assert.deepEqual(result.complete.map(s => s.year), [2020]);
  assert.equal(result.median, 30);
  assert.ok(result.seasons.slice(1).every(s => s.total === null));
});

test('retain modelled, NRT and sensor flags without rejecting complete harmonized coverage', () => {
  const rows = [row(2026, 6, 10, {source:'backcast'}), row(2026, 7, 20, {source:'gapfill',gap_flag:true,incomplete_metrics:['raw_viirs']}), row(2026, 8, 30, {nrt:true})];
  const result = compareSeasons(rows, 'winter', 3, '2026-01', '2026-10');
  assert.equal(result.median, 60);
  const season = result.seasons[0];
  assert.ok(season.complete && season.estimated && season.nrt && season.gapFlag);
  assert.deepEqual(season.months.map(m => m.row.source), ['backcast','gapfill','observed']);
});

test('zero is an available observation, not a missing month; day and night never mix', () => {
  const rows = [...spring(2025, 0), ...spring(2025, 300, {daynight:'N'})];
  assert.equal(compareSeasons(rows, 'spring', 3, '2025-01', '2025-12').median, 0);
  assert.equal(compareSeasons(rows, 'spring', 3, '2025-01', '2025-12', 'N').median, 300);
  const missing = compareSeasons([], 'spring', 3, '2025-01', '2025-12');
  assert.equal(missing.median, null);
  assert.equal(missing.seasons[0].partialTotal, null);
});

test('end-of-record is respected even if extra rows are provided', () => {
  const result = compareSeasons(spring(2026, 300), 'spring', 3, '2026-01', '2026-10');
  assert.equal(result.complete.length, 0);
  assert.equal(result.seasons[0].partialTotal, 200);
  assert.equal(result.seasons[0].months[2].value, null);
});
