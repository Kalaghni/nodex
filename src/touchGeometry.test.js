import test from 'node:test';
import assert from 'node:assert/strict';
import { pinchView, touchPair } from './touchGeometry.js';

test('pinch zoom keeps the world point under the moving midpoint', () => {
  const view = { zoom: 1, offset: { x: 80, y: 50 } };
  const start = touchPair([{ x: 100, y: 100 }, { x: 200, y: 100 }]);
  const current = touchPair([{ x: 90, y: 120 }, { x: 290, y: 120 }]);
  const next = pinchView(view, start, current);
  assert.equal(next.zoom, 2);
  assert.equal((current.center.x - next.offset.x) / next.zoom, (start.center.x - view.offset.x) / view.zoom);
  assert.equal((current.center.y - next.offset.y) / next.zoom, (start.center.y - view.offset.y) / view.zoom);
});

test('two fingers pan without changing scale when their separation stays fixed', () => {
  const start = touchPair([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  const current = touchPair([{ x: 40, y: -20 }, { x: 140, y: -20 }]);
  assert.deepEqual(pinchView({ zoom: 1.5, offset: { x: 10, y: 20 } }, start, current), {
    zoom: 1.5, offset: { x: 50, y: 0 }
  });
});

test('pinching clamps scale while preserving its focal point', () => {
  const view = { zoom: 1, offset: { x: 0, y: 0 } };
  for (const [distance, expected] of [[1, 0.3], [1000, 3]]) {
    const start = { center: { x: 100, y: 100 }, distance: 100 };
    const current = { center: { x: 100, y: 100 }, distance };
    const next = pinchView(view, start, current);
    assert.equal(next.zoom, expected);
    assert.equal((100 - next.offset.x) / next.zoom, 100);
  }
});

test('coincident fingers never produce an infinite zoom or offset', () => {
  const pair = touchPair([{ x: 10, y: 20 }, { x: 10, y: 20 }]);
  const next = pinchView({ zoom: 1, offset: { x: 0, y: 0 } }, pair, pair);
  assert.ok(Number.isFinite(next.zoom));
  assert.ok(Number.isFinite(next.offset.x));
  assert.ok(Number.isFinite(next.offset.y));
});
