import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLink, isLink, pathResolves, resolveLink, diagramPaths, pathLabel, linkLabel,
  samePath, hasChildren, remapLinkTabs
} from './links.js';

const diagrams = {
  root: { nodes: [{ id: 1, label: 'Cluster' }, { id: 2, label: 'Edge' }, { id: 3, label: 'Shortcut', link: { tab: 'b', path: ['root'] } }], zones: [] },
  'root/1': { nodes: [{ id: 10, label: 'Pod' }], zones: [] },
  'root/1/10': { nodes: [], zones: [] }
};
const other = { root: { nodes: [{ id: 20, label: 'DB' }], zones: [] } };
const tabA = { uid: 'a', name: 'Main', diagrams };
const tabB = { uid: 'b', name: 'Data', diagrams: other };
const tabs = [tabA, tabB];

test('normalizeLink accepts {tab, path} and legacy path arrays', () => {
  assert.deepEqual(normalizeLink(['root', '1']), { tab: null, path: ['root', '1'] });
  assert.deepEqual(normalizeLink({ tab: 'b', path: ['root'] }), { tab: 'b', path: ['root'] });
  assert.deepEqual(normalizeLink({ path: ['root'] }), { tab: null, path: ['root'] });
  assert.equal(normalizeLink({ tab: 'b', path: ['1'] }), null);
  assert.equal(normalizeLink(['root', 1]), null);
  assert.equal(normalizeLink(undefined), null);
  assert.ok(isLink({ tab: 'a', path: ['root'] }));
  assert.ok(!isLink('root'));
});

test('pathResolves checks segments exist and are not linked nodes', () => {
  assert.ok(pathResolves(diagrams, ['root']));
  assert.ok(pathResolves(diagrams, ['root', '1', '10']));
  assert.ok(pathResolves(diagrams, ['root', '2'])); // no entry yet — still a valid (empty) diagram
  assert.ok(!pathResolves(diagrams, ['root', '9']));
  assert.ok(!pathResolves(diagrams, ['root', '3'])); // linked node's own diagram
  assert.ok(!pathResolves(undefined, ['root']));
});

test('resolveLink finds the target tab, or the node\'s own tab', () => {
  assert.equal(resolveLink(tabs, tabA, { tab: 'b', path: ['root', '20'] }).tab, tabB);
  assert.equal(resolveLink(tabs, tabA, ['root', '1']).tab, tabA);
  assert.equal(resolveLink(tabs, tabA, { tab: 'zzz', path: ['root'] }), null);
  assert.equal(resolveLink(tabs, tabA, { tab: 'b', path: ['root', '1'] }), null);
});

test('diagramPaths lists every reachable diagram, skipping linked nodes and the excluded subtree', () => {
  assert.deepEqual(diagramPaths(diagrams), [['root'], ['root', '1'], ['root', '1', '10'], ['root', '2']]);
  assert.deepEqual(diagramPaths(diagrams, ['root', '1']), [['root'], ['root', '2']]);
  assert.deepEqual(diagramPaths({}), [['root']]);
});

test('labels', () => {
  assert.equal(pathLabel(diagrams, ['root', '1', '10']), 'Root / Cluster / Pod');
  assert.equal(pathLabel(diagrams, ['root', '9']), 'Root / Node 9');
  assert.equal(linkLabel(tabs, tabA, { tab: 'a', path: ['root', '1'] }), 'Root / Cluster');
  assert.equal(linkLabel(tabs, tabA, { tab: 'b', path: ['root', '20'] }), 'Data › Root / DB');
  assert.equal(linkLabel(tabs, tabA, { tab: 'gone', path: ['root'] }), 'Broken link');
});

test('samePath and hasChildren', () => {
  assert.ok(samePath(['root', '1'], ['root', '1']));
  assert.ok(!samePath(['root', '1'], ['root']));
  assert.ok(hasChildren(diagrams, ['root'], 1));
  assert.ok(!hasChildren(diagrams, ['root'], 2));
  assert.ok(!hasChildren(diagrams, ['root', '1'], 10)); // empty diagram entry
});

test('remapLinkTabs rewrites only the mapped uids', () => {
  const out = remapLinkTabs(diagrams, { b: 'b2' });
  assert.deepEqual(out.root.nodes[2].link, { tab: 'b2', path: ['root'] });
  assert.equal(out['root/1'], diagrams['root/1']);
  assert.equal(remapLinkTabs(diagrams, {}), diagrams);
});
