import test from 'node:test';
import assert from 'node:assert/strict';
import { heatColor, legendTicks } from './heatScale.js';
test('square-root colour scale and legend use the same inverse mapping', () => {
  assert.equal(heatColor(null, 100), undefined);
  assert.equal(heatColor(0, 100), 'rgb(0, 34, 78)');
  assert.equal(heatColor(100, 100), 'rgb(254, 232, 56)');
  assert.equal(heatColor(25, 100), 'rgb(125, 124, 118)'); // midpoint of the ramp
  assert.deepEqual(legendTicks(100).map(t => t.value), [0, 6.25, 25, 56.25, 100]);
  assert.equal(heatColor(0, 0), heatColor(0, 100));
  assert.equal(heatColor(150, 100), heatColor(100, 100));
});
