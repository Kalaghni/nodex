import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLinkPath, pathResolves, linkTargets, pathLabel, samePath, hasChildren } from './links.js';

const diagrams = {
  root: { nodes: [{ id: 1, label: 'Cluster' }, { id: 2, label: 'Edge' }], zones: [] },
  'root/1': { nodes: [{ id: 10, label: 'Pod' }], zones: [] },
  'root/1/10': { nodes: [], zones: [] }
};

test('isLinkPath accepts root-anchored string paths only', () => {
  assert.ok(isLinkPath(['root']));
  assert.ok(isLinkPath(['root', '1']));
  assert.ok(!isLinkPath([]));
  assert.ok(!isLinkPath(['1']));
  assert.ok(!isLinkPath(['root', 1]));
  assert.ok(!isLinkPath('root'));
  assert.ok(!isLinkPath(undefined));
});

test('pathResolves checks every segment exists in the diagram above it', () => {
  assert.ok(pathResolves(diagrams, ['root']));
  assert.ok(pathResolves(diagrams, ['root', '1']));
  assert.ok(pathResolves(diagrams, ['root', '1', '10']));
  assert.ok(!pathResolves(diagrams, ['root', '3']));
  assert.ok(!pathResolves(diagrams, ['root', '2', '10']));
  assert.ok(!pathResolves({}, ['root', '1']));
});

test('linkTargets lists the current diagram and its ancestors, nearest first', () => {
  assert.deepEqual(linkTargets(['root', '1', '10']), [['root', '1', '10'], ['root', '1'], ['root']]);
  assert.deepEqual(linkTargets(['root']), [['root']]);
});

test('pathLabel names each level by its node', () => {
  assert.equal(pathLabel(diagrams, ['root', '1', '10']), 'Root / Cluster / Pod');
  assert.equal(pathLabel(diagrams, ['root', '9']), 'Root / Node 9');
});

test('samePath and hasChildren', () => {
  assert.ok(samePath(['root', '1'], ['root', '1']));
  assert.ok(!samePath(['root', '1'], ['root']));
  assert.ok(hasChildren(diagrams, ['root'], 1));
  assert.ok(!hasChildren(diagrams, ['root'], 2));
  assert.ok(!hasChildren(diagrams, ['root', '1'], 10)); // empty diagram entry
});
