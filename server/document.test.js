import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newDocument, normalizeDocument, resolvePath, addNodes, updateNodes, removeNodes,
  addConnections, updateConnections, removeConnections, upsertZone, removeZones,
  upsertChannel, removeChannels, describeDiagram, outline, DocError
} from './core/document.js';
import { analyzeDiagram } from './core/analyze.js';
import { axialToOffset, offsetToAxial, hexDistance } from './core/geometry.js';

const docWith = (...labels) => {
  const doc = newDocument('Test');
  addNodes(doc, null, labels.map(label => ({ label })));
  return doc;
};
const root = (doc) => doc.diagrams.root;
const byLabel = (doc, label, path = 'root') => doc.diagrams[path].nodes.find(n => n.label === label);

test('offset and axial coordinates round-trip, including negatives', () => {
  for (let col = -5; col <= 5; col++) {
    for (let row = -5; row <= 5; row++) {
      const a = offsetToAxial(col, row);
      assert.deepEqual(axialToOffset(a.q, a.r), { col, row });
    }
  }
});

test('normalizeDocument fills gaps and rejects projects and junk', () => {
  const doc = normalizeDocument({ diagrams: { root: { nodes: [{ id: 1, label: 'a', q: 0, r: 0 }] } } }, 'fallback');
  assert.equal(doc.name, 'fallback');
  assert.equal(doc.version, 1);
  assert.ok(doc.uid);
  assert.deepEqual(doc.diagrams.root.connections, []);
  assert.deepEqual(doc.diagrams.root.channels, []);
  assert.throws(() => normalizeDocument({ version: 2, tabs: [] }), DocError);
  assert.throws(() => normalizeDocument({ nodes: [] }), DocError);
});

test('auto-placed nodes line up in a row on even columns with room for labels', () => {
  const doc = docWith('a', 'b', 'c');
  const pos = root(doc).nodes.map(n => axialToOffset(n.q, n.r));
  assert.ok(pos.every(p => p.col % 2 === 0));
  assert.ok(pos.every(p => p.row === pos[0].row));
  assert.ok(pos[1].col - pos[0].col >= 4 && pos[2].col - pos[1].col >= 4);
});

test('ids start above the clock and existing ids', () => {
  const doc = docWith('a');
  const id = root(doc).nodes[0].id;
  assert.ok(id >= Date.now() - 60000);
  addNodes(doc, null, [{ label: 'b' }]);
  assert.ok(root(doc).nodes[1].id > id);
});

test('explicit positions, near placement and occupied cells', () => {
  const doc = newDocument();
  addNodes(doc, null, [{ label: 'lb', position: { col: 2, row: 3 } }]);
  assert.deepEqual(axialToOffset(byLabel(doc, 'lb').q, byLabel(doc, 'lb').r), { col: 2, row: 3 });
  addNodes(doc, null, [{ label: 'web', near: 'lb', direction: 'below' }]);
  const web = byLabel(doc, 'web');
  assert.ok(hexDistance(web, byLabel(doc, 'lb')) >= 2);
  assert.ok(axialToOffset(web.q, web.r).row > 3);
  assert.throws(() => addNodes(doc, null, [{ label: 'x', position: { col: 2, row: 3 } }]), /already holds "lb"/);
});

test('icons and colours are validated', () => {
  const doc = newDocument();
  assert.throws(() => addNodes(doc, null, [{ label: 'x', icon: 'nope' }]), /Unknown icon/);
  assert.throws(() => addNodes(doc, null, [{ label: 'x', color: 'red' }]), /#rrggbb/);
});

test('nested diagrams are created on first use and addressed by label', () => {
  const doc = docWith('host');
  const host = byLabel(doc, 'host');
  const { path } = addNodes(doc, 'host', [{ label: 'app' }]);
  assert.deepEqual(path, ['root', String(host.id)]);
  assert.equal(doc.diagrams[`root/${host.id}`].nodes[0].label, 'app');
  assert.deepEqual(resolvePath(doc, ['root', String(host.id)]), path);
  assert.throws(() => resolvePath(doc, 'nope'), /No node "nope"/);
  assert.equal(outline(doc).length, 2);
});

test('ambiguous labels must be disambiguated', () => {
  const doc = docWith('web', 'web');
  assert.throws(() => updateNodes(doc, null, [{ node: 'web', color: '#ffffff' }]), /matches 2 items/);
});

test('connections: kinds, channels created on demand, duplicates refused', () => {
  const doc = docWith('client', 'lb', 'db', 'db2');
  const { created, channelsCreated } = addConnections(doc, null, [
    { from: 'client', to: 'lb', channels: ['Public'] },
    { from: 'lb', to: 'db', kind: 'dependency' },
    { from: 'db', to: 'db2', kind: 'peer', peerMode: 'quorum' }
  ]);
  assert.equal(created.length, 3);
  assert.deepEqual(channelsCreated, ['Public']);
  const [traffic, dep, peer] = root(doc).connections;
  assert.equal(traffic.endStyle, 'arrow');
  assert.deepEqual(traffic.channelIds, [root(doc).channels[0].id]);
  assert.equal(dep.required, true);
  assert.equal(peer.kind, 'peer');
  assert.equal(peer.peerMode, 'quorum');
  assert.equal(peer.endStyle, 'none');
  assert.throws(() => addConnections(doc, null, [{ from: 'client', to: 'lb' }]), /already exists/);
  assert.throws(() => addConnections(doc, null, [{ from: 'lb', to: 'lb' }]), /itself/);

  updateConnections(doc, null, [{ connection: traffic.id, reverse: true, line: 'dashed' }]);
  assert.equal(traffic.from, byLabel(doc, 'lb').id);
  assert.equal(traffic.startStyle, 'arrow');
  assert.equal(traffic.endStyle, 'none');
  assert.equal(traffic.lineType, 'dashed');

  removeConnections(doc, null, [dep.id]);
  assert.equal(root(doc).connections.length, 2);
});

test('removing nodes drops their connections and nested diagrams', () => {
  const doc = docWith('a', 'b');
  addConnections(doc, null, [{ from: 'a', to: 'b' }]);
  addNodes(doc, 'a', [{ label: 'inner' }]);
  const a = byLabel(doc, 'a');
  const res = removeNodes(doc, null, ['a']);
  assert.deepEqual(res.removed, ['a']);
  assert.equal(res.connectionsRemoved, 1);
  assert.equal(doc.diagrams[`root/${a.id}`], undefined);
});

test('zones fit around nodes and report members; removal drops zone links', () => {
  const doc = docWith('web1', 'web2', 'lb');
  const res = upsertZone(doc, null, { label: 'Web', area: { around: ['web1', 'web2'] }, policy: { mode: 'pool' } });
  assert.deepEqual(res.zone.members.sort(), ['web1', 'web2']);
  addConnections(doc, null, [{ from: 'lb', to: 'zone:Web' }]);
  assert.equal(root(doc).connections[0].toType, 'zone');
  const hex = upsertZone(doc, null, { label: 'Hex', area: { shape: 'hexagon', center: { col: 0, row: 0 }, radius: 1 } });
  assert.equal(hex.zone.cells, 7);
  assert.equal(root(doc).zones[1].shape, 'hexagon');
  upsertZone(doc, null, { zone: 'Web', policy: { mode: 'failover', primary: 'web1' } });
  assert.equal(root(doc).zones[0].policy.primaryId, byLabel(doc, 'web1').id);
  const removed = removeZones(doc, null, ['Web']);
  assert.equal(removed.connectionsRemoved, 1);
});

test('channels: create, rename, remove strips them from connections', () => {
  const doc = docWith('a', 'b');
  upsertChannel(doc, null, { name: 'API', color: '#ff0000' });
  assert.throws(() => upsertChannel(doc, null, { name: 'api' }), /already exists/);
  addConnections(doc, null, [{ from: 'a', to: 'b', channels: ['API'] }]);
  upsertChannel(doc, null, { channel: 'API', name: 'Public API' });
  assert.equal(root(doc).channels[0].name, 'Public API');
  removeChannels(doc, null, ['Public API']);
  assert.deepEqual(root(doc).connections[0].channelIds, []);
});

test('links point a node at another level and block nested content', () => {
  const doc = docWith('a', 'b');
  addNodes(doc, 'a', [{ label: 'inner' }]);
  updateNodes(doc, null, [{ node: 'b', link: 'a' }]);
  assert.deepEqual(byLabel(doc, 'b').link, ['root', String(byLabel(doc, 'a').id)]);
  assert.throws(() => updateNodes(doc, null, [{ node: 'a', link: 'root' }]), /own nested diagram/);
  assert.throws(() => addNodes(doc, 'b', [{ label: 'x' }]), /is a link/);
});

test('describeDiagram reports positions, kinds, channels and zone members', () => {
  const doc = docWith('a', 'b');
  addConnections(doc, null, [{ from: 'a', to: 'b', channels: ['Web'], label: 'HTTPS' }]);
  upsertZone(doc, null, { label: 'Z', area: { around: ['a'] } });
  const d = describeDiagram(doc, null);
  assert.equal(d.label, 'Root');
  assert.equal(d.nodes[0].col % 2, 0);
  assert.deepEqual(d.connections[0], { id: d.connections[0].id, from: 'a', to: 'b', kind: 'traffic', label: 'HTTPS', channels: ['Web'] });
  assert.deepEqual(d.zones[0].members, ['a']);
});

test('analyze traces flows, simulates failures and finds single points of failure', () => {
  const doc = docWith('user', 'lb', 'web1', 'web2', 'db');
  upsertZone(doc, null, { label: 'Web', area: { around: ['web1', 'web2'] } });
  addConnections(doc, null, [
    { from: 'user', to: 'lb', channels: ['Public'] },
    { from: 'lb', to: 'zone:Web', channels: ['Public'] },
    { from: 'zone:Web', to: 'db', channels: ['Public'] }
  ]);
  const healthy = analyzeDiagram(doc, null);
  assert.equal(healthy.channels[0].status, 'healthy');
  assert.ok(healthy.channels[0].stages.length >= 3);
  assert.deepEqual(healthy.affected, []);
  // Both web servers are redundant; everything else on the path is single
  const spof = healthy.singlePointsOfFailure;
  assert.deepEqual(spof.filter(s => s.type === 'node').map(s => s.component).sort(), ['db', 'lb']);
  assert.ok(spof.some(s => s.type === 'zone' && s.component === 'Web'));
  assert.ok(!spof.some(s => s.component.startsWith('web')));
  assert.deepEqual(spof[0].takesDown, ['Public']);

  const oneWeb = analyzeDiagram(doc, null, { fail: ['web1'] });
  assert.equal(oneWeb.channels[0].status, 'degraded');
  assert.ok(oneWeb.affected.some(a => a.component === 'web1' && a.failedDirectly));

  const noLb = analyzeDiagram(doc, null, { fail: ['lb'], singlePointsOfFailure: false });
  assert.equal(noLb.channels[0].status, 'down');
  assert.equal(noLb.singlePointsOfFailure, undefined);
});
