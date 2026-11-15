import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, withSelection } from './exportCsv.js';

test('export retains measurements, unavailable cells and quoted metadata alongside geographic context', () => {
  const input = 'year,month,harmonized,raw_modis,raw_viirs,source,incomplete_metrics,limitations\r\n2003,1,0,0,,backcast,,"A comma, a ""quote"" and\na newline"\r\n2026,7,3053,1111,2359,gapfill,raw_viirs,estimate\r\n';
  const result = parseCsv(withSelection(input, { regionName: 'Custom area', bounds: [-64, -28, -59, -24], start: '2003-01', end: '2026-10' }));
  const records = result.slice(1).map(row => Object.fromEntries(result[0].map((key, i) => [key, row[i]])));
  assert.equal(records[0].date, '2003-01');
  assert.equal(records[0].raw_viirs, '');
  assert.equal(records[0].harmonized, '0');
  assert.equal(records[0].limitations, 'A comma, a "quote" and\na newline');
  assert.equal(records[1].source, 'gapfill');
  assert.equal(records[1].raw_viirs, '2359');
  assert.equal(records[1].incomplete_metrics, 'raw_viirs');
  for (const row of records) {
    assert.equal(row.study_area, 'Custom area');
    assert.deepEqual([row.bbox_west, row.bbox_south, row.bbox_east, row.bbox_north], ['-64', '-28', '-59', '-24']);
    assert.equal(row.selection_start, '2003-01');
    assert.equal(row.selection_end, '2026-10');
  }
});

test('malformed exports fail rather than download invented context', () => {
  assert.throws(() => parseCsv('year,month\n"unterminated'), /unterminated/);
  assert.throws(() => withSelection('error\nUnavailable', { bounds: [] }), /missing date columns/);
});
