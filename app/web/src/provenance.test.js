import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityLabel, comparisonBlocked } from './provenance.js';

test('model source is independent of processing and completeness, and hidden in raw view', () => {
  const row = {source:'gapfill', nrt:true, gap_flag:true, incomplete_metrics:['raw_viirs']};
  assert.match(qualityLabel(row), /Gap-filled estimate.*NRT/);
  assert.doesNotMatch(qualityLabel(row), /Incomplete/);
  assert.match(qualityLabel(row, 'raw_viirs'), /Incomplete observations.*NRT/);
  assert.doesNotMatch(qualityLabel(row, 'raw_viirs'), /Gap-filled/);
  assert.match(qualityLabel({source:'backcast'}), /Back-cast/);
  assert.equal(qualityLabel({source:'observed'}), 'Observed');
});

test('incomplete or unverified coverage cannot be interpreted as an anomaly', () => {
  assert.equal(comparisonBlocked({comparison_status:'incomplete'}), true);
  assert.equal(comparisonBlocked({comparison_status:'quality_unavailable'}), true);
  assert.equal(comparisonBlocked({comparison_status:'available'}), false);
});
