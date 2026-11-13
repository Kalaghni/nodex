// The opt-in backend over real HTTP: auth, REST with revisions, the live
// event stream, and MCP over Streamable HTTP editing the same documents.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { FileStore, RemoteStore, ConflictError } from './store.js';
import { createNodexServer } from './server.js';
import { createNodexMcpServer } from './tools.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const TOKEN = 'test-token';
let dir, store, server, base;
const auth = { Authorization: `Bearer ${TOKEN}` };

const api = async (method, url, body, headers = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { ...auth, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
};

// Read Server-Sent Events until `count` `document` events arrive
const collectEvents = async (count, trigger) => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events`, { headers: auth, signal: ctrl.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buf = '';
  await trigger();
  const deadline = Date.now() + 5000;
  while (events.length < count && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = frame.split('\n').find(l => l.startsWith('data: '));
      if (frame.includes('event: document') && data) events.push(JSON.parse(data.slice(6)));
    }
  }
  ctrl.abort();
  return events;
};

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nodex-server-'));
  store = await new FileStore(dir).init();
  server = createNodexServer({ store, token: TOKEN, heartbeatMs: 1000 });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
});

test('requests without the token are refused; CORS preflight is answered', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 401);
  assert.equal((await fetch(`${base}/api/documents`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST' })).status, 401);
  const pre = await fetch(`${base}/api/documents/x`, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /If-Match/);
  const health = await api('GET', '/health');
  assert.equal(health.body.name, 'nodex-server');
});

test('documents: create, read with ETag, conditional save, conflict, delete', async () => {
  const created = await api('POST', '/api/documents', { name: 'Office Network' });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(id, 'office-network');

  const got = await api('GET', `/api/documents/${id}`);
  const etag = got.headers.get('etag');
  assert.equal(etag, `"${created.body.revision}"`);
  assert.equal(got.body.name, 'Office Network');

  const doc = got.body;
  doc.diagrams.root.nodes.push({ id: 1, label: 'switch', iconId: 'network', color: '#3b82f6', q: 0, r: 0, description: '' });
  const saved = await api('PUT', `/api/documents/${id}`, doc, { 'If-Match': etag });
  assert.equal(saved.status, 200);
  const stale = await api('PUT', `/api/documents/${id}`, doc, { 'If-Match': etag });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.revision, saved.body.revision);

  assert.equal((await api('PUT', `/api/documents/${id}`, { nodes: [] })).status, 400);
  assert.equal((await api('GET', '/api/documents/missing')).status, 404);
  assert.ok((await api('GET', '/api/documents')).body.documents.some(d => d.id === id && d.nodes === 1));

  assert.equal((await api('DELETE', `/api/documents/${id}`)).status, 200);
  assert.equal((await api('GET', `/api/documents/${id}`)).status, 404);
});

test('every change is pushed to the event stream, MCP edits included', async () => {
  const { body: { id } } = await api('POST', '/api/documents', { name: 'Live' });

  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: auth } });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);

  const events = await collectEvents(2, async () => {
    const res = await client.callTool({ name: 'add_nodes', arguments: { document: id, nodes: [{ label: 'from-mcp' }] } });
    assert.ok(!res.isError, res.content[0].text);
    const { body: doc, headers } = await api('GET', `/api/documents/${id}`);
    doc.name = 'Live (renamed in editor)';
    await api('PUT', `/api/documents/${id}`, doc, { 'If-Match': headers.get('etag') });
  });
  await client.close();

  assert.equal(events.length, 2);
  assert.equal(events[0].id, id);
  assert.equal(events[0].source, 'mcp');
  assert.equal(events[1].source, 'api');
  assert.equal(events[1].name, 'Live (renamed in editor)');
  const final = await api('GET', `/api/documents/${id}`);
  assert.equal(final.headers.get('etag'), `"${events[1].revision}"`);
  assert.equal(final.body.diagrams.root.nodes[0].label, 'from-mcp');
});

test('MCP over HTTP: tools list, and GET is not allowed on the stateless endpoint', async () => {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: auth } });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.ok(tools.some(t => t.name === 'analyze'));
  await client.close();
  assert.equal((await fetch(`${base}/mcp`, { headers: auth })).status, 405);
});

test('the stdio toolkit can edit backend documents through RemoteStore', async () => {
  const remote = new RemoteStore(base, TOKEN);
  const mcp = createNodexMcpServer(remote);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await mcp.connect(a);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(b);

  const created = JSON.parse((await client.callTool({ name: 'create_document', arguments: { name: 'Remote' } })).content[0].text);
  const res = await client.callTool({ name: 'add_nodes', arguments: { document: created.document, nodes: [{ label: 'x' }, { label: 'y' }] } });
  assert.ok(!res.isError, res.content[0].text);
  assert.equal((await store.get(created.document)).doc.diagrams.root.nodes.length, 2);

  const { revision } = await remote.get(created.document);
  await remote.put(created.document, (await remote.get(created.document)).doc, { ifMatch: revision });
  await assert.rejects(remote.put(created.document, (await store.get(created.document)).doc, { ifMatch: 'stale' }), ConflictError);
  await client.close();
});
