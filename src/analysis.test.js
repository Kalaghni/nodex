// Run with `npm test` (node's built-in test runner — no extra deps)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluate,
  findSinglePointsOfFailure,
  flowStages,
  traceThrough,
  nodeKey,
  zoneKey,
  connKey
} from './analysis.js';

// A trimmed-down version of a real HA web stack:
//
//   Customer → domain → lb1/lb2/lb3 (keepalived) → Swarm Web zone {web1, web2}
//     → WP zone {wp1, wp2} → mx2 (MaxScale "VIP", failover peers mx1/mx3)
//     → Galera {db1, db2, db3} (quorum) → schema
//   Employee → portal domain → lb1/lb2 → web1 → portal → patroni {pg1, pg2, pg3}
let nextId = 1;
const node = (label, q, r, extra = {}) => ({ id: nextId++, label, q, r, ...extra });
const conn = (from, to, extra = {}) => ({
  id: nextId++,
  from: from.id,
  fromType: from.cells ? 'zone' : 'node',
  to: to.id,
  toType: to.cells ? 'zone' : 'node',
  endStyle: 'arrow',
  startStyle: 'none',
  ...extra
});
const zone = (label, cells, extra = {}) => ({ id: nextId++, label, cells, ...extra });

const build = () => {
  nextId = 1;
  const cust = node('Customer', 0, -10);
  const emp = node('Employee', 4, -10);
  const domain = node('domain', 0, -8);
  const portalDomain = node('portal.domain', 4, -8);
  const lb1 = node('lb1', -2, -6);
  const lb2 = node('lb2', 0, -6);
  const lb3 = node('lb3', 2, -6);
  const web1 = node('web1', 0, -3);
  const web2 = node('web2', 1, -3);
  const wp1 = node('wp1', 0, 0);
  const wp2 = node('wp2', 1, 0);
  const portal = node('portal', 5, 0);
  const mx1 = node('mx1', -1, 3);
  const mx2 = node('mx2 (VIP)', 0, 3);
  const mx3 = node('mx3', 1, 3);
  const db1 = node('db1', -1, 6);
  const db2 = node('db2', 0, 6);
  const db3 = node('db3', 1, 6);
  const schema = node('schema', 0, 9);
  const pg1 = node('pg1', 4, 4);
  const pg2 = node('pg2', 5, 4);
  const pg3 = node('pg3', 6, 4);
  const obs = node('obs', 8, 0);
  const nodes = [cust, emp, domain, portalDomain, lb1, lb2, lb3, web1, web2, wp1, wp2, portal,
    mx1, mx2, mx3, db1, db2, db3, schema, pg1, pg2, pg3, obs];

  const swarmWeb = zone('Swarm Web', [{ q: 0, r: -3 }, { q: 1, r: -3 }]);
  const wpZone = zone('WP', [{ q: 0, r: 0 }, { q: 1, r: 0 }]);
  const zones = [swarmWeb, wpZone];

  const PUB = 100;
  const STAFF = 101;
  const channels = [{ id: PUB, name: 'Public', color: '#ef4444' }, { id: STAFF, name: 'Staff', color: '#8b5cf6' }];
  const pub = { channelIds: [PUB] };
  const staff = { channelIds: [STAFF] };
  const both = { channelIds: [PUB, STAFF] };

  const connections = [
    conn(cust, domain, pub),
    conn(domain, lb1, pub),
    conn(domain, lb2, pub),
    conn(domain, lb3, pub),
    conn(lb1, swarmWeb, pub),
    conn(lb2, swarmWeb, pub),
    conn(lb3, swarmWeb, pub),
    conn(swarmWeb, wpZone, pub),
    conn(wp1, mx2, pub),
    conn(wp2, mx2, pub),
    conn(mx1, db1, pub), conn(mx1, db2, pub), conn(mx1, db3, pub),
    conn(mx2, db1, pub), conn(mx2, db2, pub), conn(mx2, db3, pub),
    conn(mx3, db1, pub), conn(mx3, db2, pub), conn(mx3, db3, pub),
    conn(db1, schema, pub), conn(db2, schema, pub), conn(db3, schema, pub),
    // staff
    conn(emp, portalDomain, staff),
    conn(portalDomain, lb1, staff),
    conn(portalDomain, lb2, staff),
    conn(lb1, web1, staff),
    conn(lb2, web1, staff),
    conn(web1, portal, staff),
    conn(portal, pg2, staff),
    // keepalived, MaxScale VIP, Galera, Patroni
    conn(lb1, lb2, { kind: 'peer', peerMode: 'failover' }),
    conn(lb2, lb3, { kind: 'peer', peerMode: 'failover' }),
    conn(mx1, mx2, { kind: 'peer', peerMode: 'failover' }),
    conn(mx2, mx3, { kind: 'peer', peerMode: 'failover' }),
    conn(db1, db2, { kind: 'peer', peerMode: 'quorum' }),
    conn(db2, db3, { kind: 'peer', peerMode: 'quorum' }),
    conn(db1, db3, { kind: 'peer', peerMode: 'quorum' }),
    conn(pg1, pg2, { kind: 'peer', peerMode: 'both' }),
    conn(pg2, pg3, { kind: 'peer', peerMode: 'both' }),
    conn(pg1, pg3, { kind: 'peer', peerMode: 'both' }),
    // monitoring: unclassified, must never cascade
    conn(wpZone, obs),
    conn(schema, obs),
    conn(web1, both.channelIds ? obs : obs)
  ];

  const ids = { cust, emp, domain, portalDomain, lb1, lb2, lb3, web1, web2, wp1, wp2, portal, mx1, mx2, mx3, db1, db2, db3, schema, pg1, pg2, pg3, obs, swarmWeb, wpZone, PUB, STAFF };
  return { diagram: { nodes, zones, connections, channels }, ids };
};

const statusOf = (res, key) => res.cur.entities.get(key).status;

test('baseline: every channel healthy, zones expand to their members', () => {
  const { diagram, ids } = build();
  const res = evaluate(diagram);
  assert.equal(res.channels.get(ids.PUB).status, 'healthy');
  assert.equal(res.channels.get(ids.STAFF).status, 'healthy');
  const flow = res.cur.flows.get(ids.PUB);
  assert.deepEqual(flow.sources, [nodeKey(ids.cust.id)]);
  assert.deepEqual(flow.sinks, [nodeKey(ids.schema.id)]);
  // Members of zones are on the path even with no direct channel links
  assert.equal(flow.entityState.get(nodeKey(ids.web2.id)), 'active');
  assert.equal(flow.entityState.get(nodeKey(ids.wp1.id)), 'active');
  // mx1/mx3 aren't sources — they're failover standbys for mx2
  assert.equal(flow.entityState.get(nodeKey(ids.mx1.id)), 'standby');
  assert.equal(res.cur.counts.down, 0);
});

test('stages read source → sink with zones before their members', () => {
  const { diagram, ids } = build();
  const res = evaluate(diagram);
  const stages = flowStages(res.cur.flows.get(ids.PUB));
  assert.deepEqual(stages[0], [nodeKey(ids.cust.id)]);
  assert.deepEqual(stages[1], [nodeKey(ids.domain.id)]);
  assert.equal(stages[2].length, 3); // lb1..3
  assert.deepEqual(stages[3], [zoneKey(ids.swarmWeb.id)]);
  assert.deepEqual(stages.at(-1), [nodeKey(ids.schema.id)]);
});

test('losing one load balancer reroutes and degrades, nothing goes down', () => {
  const { diagram, ids } = build();
  const res = evaluate(diagram, new Set([nodeKey(ids.lb1.id)]));
  const pub = res.channels.get(ids.PUB);
  // lb1 is covered by keepalived peers — its address stays reachable
  assert.equal(res.cur.entities.get(nodeKey(ids.lb1.id)).coveredBy, nodeKey(ids.lb2.id));
  assert.equal(pub.status, 'degraded');
  assert.ok(pub.notes.some(n => n.tone === 'failover' && n.text.includes('lb1')));
  assert.equal(statusOf(res, nodeKey(ids.lb2.id)), 'degraded');
  assert.equal(statusOf(res, nodeKey(ids.cust.id)), 'healthy');
});

test('MaxScale VIP node fails over to a peer', () => {
  const { diagram, ids } = build();
  const res = evaluate(diagram, new Set([nodeKey(ids.mx2.id)]));
  assert.equal(res.channels.get(ids.PUB).status, 'degraded');
  assert.equal(res.cur.entities.get(nodeKey(ids.mx2.id)).coveredBy, nodeKey(ids.mx1.id));
  assert.ok(res.cur.failovers.some(f => f.from === nodeKey(ids.mx2.id) && f.to === nodeKey(ids.mx1.id)));
  assert.equal(statusOf(res, nodeKey(ids.wp1.id)), 'healthy');
});

test('Galera keeps serving with 2/3 and stops without quorum', () => {
  const { diagram, ids } = build();
  const one = evaluate(diagram, new Set([nodeKey(ids.db1.id)]));
  assert.equal(statusOf(one, nodeKey(ids.db2.id)), 'degraded');
  assert.ok(one.cur.entities.get(nodeKey(ids.db2.id)).reasons.some(r => r.includes('quorum')));
  assert.equal(one.channels.get(ids.PUB).status, 'degraded');

  const two = evaluate(diagram, new Set([nodeKey(ids.db1.id), nodeKey(ids.db2.id)]));
  assert.equal(statusOf(two, nodeKey(ids.db3.id)), 'down');
  assert.equal(two.channels.get(ids.PUB).status, 'down');
  // Cascade upward: MaxScale has no backends → WP → … → customer cut off
  assert.equal(statusOf(two, nodeKey(ids.mx2.id)), 'down');
  assert.equal(statusOf(two, nodeKey(ids.cust.id)), 'down');
  // The destination is up but nothing reaches it any more
  assert.equal(statusOf(two, nodeKey(ids.schema.id)), 'degraded');
  assert.ok(two.cur.entities.get(nodeKey(ids.schema.id)).reasons.some(r => r.startsWith('Unreachable')));
  // Staff traffic doesn't touch Galera
  assert.equal(two.channels.get(ids.STAFF).status, 'healthy');
});

test('a network partition isolates the minority side', () => {
  const { diagram, ids } = build();
  const galeraLinks = diagram.connections.filter(c =>
    c.peerMode === 'quorum' && (c.from === ids.db1.id || c.to === ids.db1.id));
  const res = evaluate(diagram, new Set(galeraLinks.map(c => connKey(c.id))));
  assert.equal(statusOf(res, nodeKey(ids.db1.id)), 'down');
  assert.match(res.cur.entities.get(nodeKey(ids.db1.id)).reasons[0], /Partitioned/);
  assert.notEqual(statusOf(res, nodeKey(ids.db2.id)), 'down');
});

test('Patroni primary fails over to a replica; losing two loses the cluster', () => {
  const { diagram, ids } = build();
  const one = evaluate(diagram, new Set([nodeKey(ids.pg2.id)]));
  assert.equal(one.cur.entities.get(nodeKey(ids.pg2.id)).coveredBy, nodeKey(ids.pg1.id));
  assert.equal(one.channels.get(ids.STAFF).status, 'degraded');
  const two = evaluate(diagram, new Set([nodeKey(ids.pg2.id), nodeKey(ids.pg1.id)]));
  assert.equal(two.channels.get(ids.STAFF).status, 'down');
});

test('a failed zone takes down its members; pool policy survives partial loss', () => {
  const { diagram, ids } = build();
  const partial = evaluate(diagram, new Set([nodeKey(ids.web2.id)]));
  assert.equal(statusOf(partial, zoneKey(ids.swarmWeb.id)), 'degraded');
  assert.equal(partial.channels.get(ids.PUB).status, 'degraded');

  const zoneOut = evaluate(diagram, new Set([zoneKey(ids.swarmWeb.id)]));
  assert.equal(statusOf(zoneOut, nodeKey(ids.web1.id)), 'down');
  assert.equal(zoneOut.channels.get(ids.PUB).status, 'down');
  assert.equal(zoneOut.channels.get(ids.STAFF).status, 'down');
});

test('zone policies: all / min / quorum / active-standby', () => {
  const { diagram, ids } = build();
  const withPolicy = (policy) => ({
    ...diagram,
    zones: diagram.zones.map(z => z.id === ids.wpZone.id ? { ...z, policy } : z)
  });
  const fail = new Set([nodeKey(ids.wp1.id)]);
  assert.equal(statusOf(evaluate(withPolicy({ mode: 'all' }), fail), zoneKey(ids.wpZone.id)), 'down');
  assert.equal(statusOf(evaluate(withPolicy({ mode: 'min', min: 2 }), fail), zoneKey(ids.wpZone.id)), 'down');
  assert.equal(statusOf(evaluate(withPolicy({ mode: 'quorum' }), fail), zoneKey(ids.wpZone.id)), 'down');

  const standby = withPolicy({ mode: 'failover', primaryId: ids.wp1.id });
  const base = evaluate(standby);
  assert.equal(base.cur.flows.get(ids.PUB).entityState.get(nodeKey(ids.wp2.id)), 'standby');
  const promoted = evaluate(standby, fail);
  assert.equal(promoted.cur.flows.get(ids.PUB).entityState.get(nodeKey(ids.wp2.id)), 'active');
  assert.ok(promoted.channels.get(ids.PUB).notes.some(n => n.text.includes('promoted')));
});

test('floating VIP node is held by one peer and moves when it fails', () => {
  const { diagram, ids } = build();
  // Replace domain → lb1..3 with domain → VIP, VIP peered with the LBs
  const vip = { id: 999, label: 'edge VIP', q: 0, r: -7, role: 'vip' };
  const conns = diagram.connections
    .filter(c => !(c.from === ids.domain.id && [ids.lb1.id, ids.lb2.id, ids.lb3.id].includes(c.to)))
    .concat([
      { id: 1000, from: ids.domain.id, to: 999, endStyle: 'arrow', startStyle: 'none', channelIds: [ids.PUB] },
      { id: 1001, from: 999, to: ids.lb1.id, kind: 'peer', peerMode: 'failover' }
    ]);
  const d = { ...diagram, nodes: [...diagram.nodes, vip], connections: conns };

  const base = evaluate(d);
  assert.equal(base.cur.vipHolder.get('n:999'), nodeKey(ids.lb1.id));
  assert.equal(base.channels.get(ids.PUB).status, 'healthy');
  assert.equal(base.cur.flows.get(ids.PUB).entityState.get(nodeKey(ids.lb2.id)), 'standby');

  const moved = evaluate(d, new Set([nodeKey(ids.lb1.id)]));
  assert.equal(moved.cur.vipHolder.get('n:999'), nodeKey(ids.lb2.id));
  assert.equal(moved.channels.get(ids.PUB).status, 'degraded');

  const gone = evaluate(d, new Set([nodeKey(ids.lb1.id), nodeKey(ids.lb2.id), nodeKey(ids.lb3.id)]));
  assert.equal(statusOf(gone, 'n:999'), 'down');
  assert.equal(gone.channels.get(ids.PUB).status, 'down');
});

test('required dependencies cascade; unclassified links never do', () => {
  const { diagram, ids } = build();
  const obsDown = evaluate(diagram, new Set([nodeKey(ids.obs.id)]));
  assert.equal(statusOf(obsDown, nodeKey(ids.schema.id)), 'degraded');
  assert.equal(obsDown.channels.get(ids.PUB).status, 'healthy');

  const req = {
    ...diagram,
    connections: diagram.connections.map(c =>
      c.from === ids.schema.id && c.to === ids.obs.id ? { ...c, required: true } : c)
  };
  const hard = evaluate(req, new Set([nodeKey(ids.obs.id)]));
  assert.equal(statusOf(hard, nodeKey(ids.schema.id)), 'down');
  assert.equal(hard.channels.get(ids.PUB).status, 'down');
});

test('reversed arrows flip the traffic direction', () => {
  const { diagram, ids } = build();
  const flipped = {
    ...diagram,
    connections: diagram.connections.map(c =>
      c.from === ids.cust.id ? { ...c, from: ids.domain.id, to: ids.cust.id, startStyle: 'arrow', endStyle: 'none' } : c)
  };
  const res = evaluate(flipped);
  assert.deepEqual(res.cur.flows.get(ids.PUB).sources, [nodeKey(ids.cust.id)]);
});

test('single points of failure', () => {
  const { diagram, ids } = build();
  const res = evaluate(diagram);
  const spofs = findSinglePointsOfFailure(res);
  const keys = spofs.map(s => s.key);
  assert.ok(keys.includes(nodeKey(ids.domain.id)));
  assert.ok(keys.includes(nodeKey(ids.schema.id)));
  assert.ok(keys.includes(nodeKey(ids.web1.id))); // staff only goes through web1
  assert.ok(!keys.includes(nodeKey(ids.lb1.id)));
  assert.ok(!keys.includes(nodeKey(ids.mx2.id)));
  assert.ok(!keys.includes(nodeKey(ids.db1.id)));

  // With lb2 gone, only lb3 remains for the public flow... but keepalived
  // still covers it — no new SPOF among the LBs
  const after = findSinglePointsOfFailure(evaluate(diagram, new Set([nodeKey(ids.db1.id)])));
  assert.ok(after.some(s => s.key === nodeKey(ids.db2.id)));
});

test('trace through a node keeps only the paths that use it', () => {
  const { diagram, ids } = build();
  const res = evaluate(diagram);
  const t = traceThrough(res.cur.flows.get(ids.STAFF), nodeKey(ids.portal.id));
  assert.ok(t.entities.has(nodeKey(ids.emp.id)));
  assert.ok(t.entities.has(nodeKey(ids.pg2.id)));
  assert.ok(!t.entities.has(nodeKey(ids.cust.id)));
});
