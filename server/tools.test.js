// The toolkit end to end: a real MCP client talking to the Nodex MCP server
// over an in-memory transport, backed by a FileStore in a temp folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FileStore, ConflictError, NotFoundError, updateDocument } from './store.js';
import { createNodexMcpServer } from './tools.js';
import { newDocument } from './core/document.js';

let dir, store, client;

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content[0].text;
  if (res.isError) {
    const err = new Error(text);
    err.toolError = true;
    throw err;
  }
  return JSON.parse(text);
};

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nodex-tools-'));
  store = await new FileStore(dir).init();
  const server = createNodexMcpServer(store);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(b);
});

after(async () => {
  await client.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('store: revisions, If-Match conflicts, and retrying updates', async () => {
  const { id, revision } = await store.create('Conflicts');
  const { doc } = await store.get(id);
  doc.name = 'Changed';
  const saved = await store.put(id, doc, { ifMatch: revision });
  assert.notEqual(saved.revision, revision);
  await assert.rejects(store.put(id, doc, { ifMatch: revision }), ConflictError);
  // Same bytes again → no new revision
  assert.equal((await store.put(id, doc)).unchanged, true);

  // Someone else writes between our read and our write: updateDocument retries
  let first = true;
  const res = await updateDocument(store, id, async (d) => {
    if (first) {
      first = false;
      const other = await store.get(id);
      other.doc.name = 'Sneaky';
      await store.put(id, other.doc);
    }
    d.name = `${d.name}!`;
    return 'ok';
  });
  assert.equal(res.result, 'ok');
  assert.equal((await store.get(id)).doc.name, 'Sneaky!');
  await assert.rejects(store.get('../etc/passwd'), NotFoundError);
});

test('store: lists existing editor files and skips projects', async () => {
  await fs.writeFile(path.join(dir, 'from-editor.json'), JSON.stringify({ ...newDocument('From editor') }));
  await fs.writeFile(path.join(dir, 'a-project.json'), JSON.stringify({ version: 2, type: 'nodex-project', tabs: [] }));
  const ids = (await store.list()).map(d => d.id);
  assert.ok(ids.includes('from-editor'));
  assert.ok(!ids.includes('a-project'));
});

test('tools are listed with schemas and annotations', async () => {
  const { tools } = await client.listTools();
  const names = tools.map(t => t.name);
  for (const n of ['list_documents', 'create_document', 'get_document', 'get_diagram', 'add_nodes', 'update_nodes',
    'remove_nodes', 'connect', 'update_connections', 'remove_connections', 'upsert_zone', 'remove_zones',
    'upsert_channel', 'remove_channels', 'analyze', 'rename_document']) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  const get = tools.find(t => t.name === 'get_diagram');
  assert.equal(get.annotations.readOnlyHint, true);
  assert.equal(tools.find(t => t.name === 'remove_nodes').annotations.destructiveHint, true);
  assert.ok(tools.find(t => t.name === 'add_nodes').inputSchema.properties.nodes);
});

test('build, read, nest and analyse a diagram through the tools', async () => {
  const { document } = await call('create_document', { name: 'Home Lab' });
  assert.equal(document, 'home-lab');

  await call('add_nodes', {
    document,
    nodes: [
      { label: 'Visitors', icon: 'users' },
      { label: 'Router', icon: 'wifi', color: '#10b981' },
      { label: 'docker', icon: 'container', endpoints: [{ address: '192.168.2.122', check: 'tcp', port: 443 }] },
      { label: 'db', icon: 'database', near: 'docker', direction: 'below' }
    ]
  });
  const conn = await call('connect', {
    document,
    connections: [
      { from: 'Visitors', to: 'Router', channels: ['Web'] },
      { from: 'Router', to: 'docker', channels: ['Web'], label: ':443' },
      { from: 'docker', to: 'db', kind: 'dependency' }
    ]
  });
  assert.deepEqual(conn.channelsCreated, ['Web']);

  // Nested level, addressed by label
  const nested = await call('add_nodes', { document, path: 'docker', nodes: [{ label: 'nginx' }, { label: 'app' }] });
  assert.equal(nested.path.length, 2);
  await call('connect', { document, path: 'docker', connections: [{ from: 'nginx', to: 'app' }] });

  const outline = await call('get_document', { document });
  assert.deepEqual(outline.levels.map(l => l.label), ['Root', 'Root / docker']);

  const d = await call('get_diagram', { document });
  assert.equal(d.nodes.length, 4);
  assert.deepEqual(d.nodes.find(n => n.label === 'docker').nested, { nodes: 2, zones: 0 });
  assert.equal(d.nodes.find(n => n.label === 'docker').endpoints[0].port, 443);
  assert.equal(d.connections.find(c => c.kind === 'dependency').to, 'db');

  const sim = await call('analyze', { document, fail: ['db'] });
  assert.equal(sim.channels[0].channel, 'Web');
  assert.equal(sim.channels[0].status, 'down');
  assert.ok(sim.affected.some(a => a.component === 'docker' && a.status === 'unavailable'));

  // What's on disk is a plain editor file
  const saved = JSON.parse(await fs.readFile(path.join(dir, 'home-lab.json'), 'utf8'));
  assert.equal(saved.version, 1);
  assert.equal(saved.name, 'Home Lab');
  assert.equal(Object.keys(saved.diagrams).length, 2);
});

test('edits that fail leave the document untouched and say why', async () => {
  const { document } = await call('create_document', { name: 'Errors' });
  await call('add_nodes', { document, nodes: [{ label: 'a' }] });
  const before = (await store.get(document)).revision;
  await assert.rejects(
    call('add_nodes', { document, nodes: [{ label: 'b' }, { label: 'c', near: 'missing' }] }),
    /No node "missing"/
  );
  assert.equal((await store.get(document)).revision, before);
  await assert.rejects(call('get_diagram', { document: 'nope' }), /No document "nope"/);
  // Schema validation happens before the handler runs
  await assert.rejects(call('add_nodes', { document, nodes: [{ label: 'x', icon: 'not-an-icon' }] }));
});

test('zones, channels, removals and renames through the tools', async () => {
  const { document } = await call('create_document', { name: 'Zones' });
  await call('add_nodes', { document, nodes: [{ label: 'lb' }, { label: 'web1' }, { label: 'web2' }] });
  const z = await call('upsert_zone', { document, label: 'Web', area: { around: ['web1', 'web2'] }, policy: { mode: 'pool' } });
  assert.deepEqual(z.zone.members.sort(), ['web1', 'web2']);
  await call('upsert_channel', { document, name: 'Public', color: '#3b82f6' });
  const c = await call('connect', { document, connections: [{ from: 'lb', to: 'zone:Web', channels: ['Public'] }] });
  await call('update_connections', { document, updates: [{ connection: c.created[0].id, routing: 'angled', color: '#ff0000' }] });
  await call('remove_channels', { document, channels: ['Public'] });
  await call('remove_zones', { document, zones: ['Web'] });
  await call('remove_nodes', { document, nodes: ['web2'] });
  await call('rename_document', { document, name: 'Zones v2' });
  const d = await call('get_diagram', { document });
  assert.deepEqual(d.nodes.map(n => n.label), ['lb', 'web1']);
  assert.equal(d.zones.length, 0);
  assert.equal(d.connections.length, 0);
  assert.equal((await call('get_document', { document })).name, 'Zones v2');
});
