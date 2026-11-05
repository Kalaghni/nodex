import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectTargets,
  applyResults,
  nodeLiveStatus,
  endpointLabel,
  validateAddress,
  uptimePercent
} from './monitor.js';

const nodes = [
  {
    id: 1,
    label: 'db',
    endpoints: [
      { id: 10, address: '10.0.0.5', check: 'icmp' },
      { id: 11, address: '10.0.0.5', check: 'tcp', port: '3306' }
    ]
  },
  { id: 2, label: 'web', endpoints: [{ id: 20, address: 'fe80::1', check: 'https', path: '/health' }] },
  { id: 3, label: 'bad', endpoints: [{ id: 30, address: '-oops', check: 'icmp' }] },
  { id: 4, label: 'plain' }
];

test('targets: one per valid endpoint, with defaults filled in', () => {
  const t = collectTargets(nodes);
  assert.deepEqual(t.map(x => x.key), ['1:10', '1:11', '2:20']);
  assert.equal(t[1].port, 3306);
  assert.equal(t[2].port, 443);
  assert.equal(t[2].path, '/health');
  assert.equal(t[0].port, undefined);
});

test('labels', () => {
  assert.equal(endpointLabel(nodes[0].endpoints[0]), '10.0.0.5');
  assert.equal(endpointLabel(nodes[0].endpoints[1]), '10.0.0.5:3306');
  assert.equal(endpointLabel(nodes[1].endpoints[0]), 'https://[fe80::1]/health');
  assert.equal(endpointLabel({ address: 'x.local', check: 'http', port: 8080 }), 'http://x.local:8080/');
  assert.equal(validateAddress(''), 'Enter an IP address or hostname');
  assert.equal(validateAddress('-f'), 'Not a valid address');
  assert.equal(validateAddress('10.1.2.3'), null);
});

test('an endpoint goes down only after consecutive failures', () => {
  const t = collectTargets(nodes);
  let s = applyResults(new Map(), t, [{ up: true, latencyMs: 2 }, { up: true }, { up: true }], 1, 2);
  assert.equal(s.get('1:10').status, 'up');

  s = applyResults(s, t, [{ up: false, error: 'No reply' }, { up: true }, { up: true }], 2, 2);
  assert.equal(s.get('1:10').status, 'up');
  assert.equal(s.get('1:10').suspect, true);
  assert.equal(nodeLiveStatus(nodes[0], s).status, 'up');
  assert.equal(nodeLiveStatus(nodes[0], s).suspect, true);

  s = applyResults(s, t, [{ up: false }, { up: true }, { up: true }], 3, 2);
  assert.equal(s.get('1:10').status, 'down');
  assert.equal(nodeLiveStatus(nodes[0], s).status, 'partial');

  s = applyResults(s, t, [{ up: false }, { up: false }, { up: true }], 4, 2);
  s = applyResults(s, t, [{ up: false }, { up: false }, { up: true }], 5, 2);
  assert.equal(nodeLiveStatus(nodes[0], s).status, 'down');
  assert.equal(nodeLiveStatus(nodes[1], s).status, 'up');
  assert.equal(uptimePercent(s.get('1:10')), 20);

  // Recovery is immediate
  s = applyResults(s, t, [{ up: true }, { up: true }, { up: true }], 6, 2);
  assert.equal(nodeLiveStatus(nodes[0], s).status, 'up');
});

test('unknown results (unsupported checks) never count as down', () => {
  const t = collectTargets(nodes);
  const s = applyResults(new Map(), t, [{ up: null, error: 'needs agent' }, { up: null }, { up: true }], 1, 1);
  assert.equal(nodeLiveStatus(nodes[0], s).status, 'unknown');
  assert.equal(nodeLiveStatus(nodes[3], s), null);
  // First failure with no history: pending, not down
  const p = applyResults(new Map(), t, [{ up: false }, { up: false }, { up: true }], 1, 2);
  assert.equal(nodeLiveStatus(nodes[0], p).status, 'pending');
});

test('removed endpoints are forgotten', () => {
  const t = collectTargets(nodes);
  let s = applyResults(new Map(), t, t.map(() => ({ up: true })), 1);
  s = applyResults(s, t.slice(0, 1), [{ up: true }], 2);
  assert.deepEqual([...s.keys()], ['1:10']);
});
