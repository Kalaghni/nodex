#!/usr/bin/env node
// Nodex backend (opt-in) - stores diagrams on the server so the editor and
// MCP clients (Claude Code, Claude Desktop, …) work on the same documents,
// and pushes every change to open editors as it happens.
//
//   node server/server.js            (or: npm run server)
//
// Nodex itself never needs this: without it, diagrams live in files on your
// device. Turn it on in the editor under Server.
//
// Environment
//   PORT                     listen port (default 7071)
//   HOST                     listen address (default 127.0.0.1 - local only)
//   NODEX_DATA               directory of diagram files (default ./data)
//   NODEX_SERVER_TOKEN       requests must send `Authorization: Bearer <token>`.
//                            Required when HOST isn't a loopback address.
//   NODEX_SERVER_INSECURE    set to 1 to allow no token beyond localhost
//                            (only behind something that authenticates)
//   NODEX_SERVER_ORIGIN      Access-Control-Allow-Origin (default *)
//   NODEX_SERVER_MAX_BODY    request size limit in bytes (default 16 MB -
//                            diagrams can embed custom 3D models)
//
// API (all JSON)
//   GET    /health                    → { ok, name, version, documents }
//   GET    /api/documents             → { documents: [{ id, name, revision, updatedAt, diagrams, nodes }] }
//   POST   /api/documents             { name, document? } → 201 { id, revision, name }
//   GET    /api/documents/:id         → the diagram (ETag: "<revision>")
//   PUT    /api/documents/:id         the diagram, optional If-Match → { id, revision } | 409 { revision }
//   DELETE /api/documents/:id         optional If-Match → { id, deleted }
//   GET    /api/events                Server-Sent Events: `document` events
//                                     { id, revision, name, updatedAt, deleted?, source }
//   POST   /mcp                       MCP (Streamable HTTP, stateless) - the Nodex toolkit

import http from 'node:http';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { FileStore, NotFoundError, ConflictError } from './store.js';
import { DocError } from './core/document.js';
import { createNodexMcpServer, VERSION } from './tools.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

const tokenMatches = (header, token) => {
  if (!token) return true;
  const want = Buffer.from(`Bearer ${token}`);
  const got = Buffer.from(String(header || ''));
  return got.length === want.length && timingSafeEqual(got, want);
};

class BodyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const readJson = (req, limit) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > limit) {
      reject(new BodyError(413, `Request too large (limit ${limit} bytes)`));
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (!chunks.length) return resolve(undefined);
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch {
      reject(new BodyError(400, 'Body is not valid JSON'));
    }
  });
  req.on('error', reject);
});

const ifMatchOf = (req) => {
  const v = req.headers['if-match'];
  return v ? String(v).replace(/^W\//, '').replace(/"/g, '').trim() : undefined;
};

export const createNodexServer = ({
  store,
  token = '',
  origin = '*',
  maxBody = 16 * 1024 * 1024,
  heartbeatMs = 25000
} = {}) => {
  const clients = new Set();

  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': 'ETag, Last-Modified, Mcp-Session-Id',
    Vary: 'Origin'
  };

  const send = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors, ...extra });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  const sendError = (res, err) => {
    if (err instanceof NotFoundError) return send(res, 404, { error: err.message });
    if (err instanceof ConflictError) return send(res, 409, { error: err.message, revision: err.revision });
    if (err instanceof DocError) return send(res, 400, { error: err.message });
    if (err instanceof BodyError) return send(res, err.status, { error: err.message });
    console.error(err);
    return send(res, 500, { error: 'Internal error' });
  };

  // Live changes → every connected editor
  const onChange = (evt) => {
    const frame = `event: document\ndata: ${JSON.stringify(evt)}\n\n`;
    clients.forEach(res => res.write(frame));
  };
  store.on?.('change', onChange);
  const heartbeat = setInterval(() => clients.forEach(res => res.write(': ping\n\n')), heartbeatMs);
  heartbeat.unref();

  const handleMcp = async (req, res) => {
    if (req.method !== 'POST') {
      // Stateless server: no standalone SSE stream, no sessions to delete
      send(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }, { Allow: 'POST' });
      return;
    }
    const body = await readJson(req, maxBody);
    const mcp = createNodexMcpServer(store, { source: 'mcp' });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      mcp.close();
    });
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'OPTIONS') {
        const pna = req.headers['access-control-request-private-network'] === 'true'
          ? { 'Access-Control-Allow-Private-Network': 'true' } : {};
        send(res, 204, undefined, {
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
          'Access-Control-Max-Age': '600',
          ...pna
        });
        return;
      }

      if (!tokenMatches(req.headers.authorization, token)) {
        send(res, 401, { error: 'Unauthorized - set the server token in Nodex' }, { 'WWW-Authenticate': 'Bearer' });
        return;
      }

      if (url.pathname === '/mcp') return await handleMcp(req, res);

      if (req.method === 'GET' && url.pathname === '/health') {
        const docs = await store.list();
        send(res, 200, { ok: true, name: 'nodex-server', version: VERSION, documents: docs.length, mcp: '/mcp' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          ...cors
        });
        res.write('retry: 3000\n: connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }

      if (url.pathname === '/api/documents') {
        if (req.method === 'GET') {
          send(res, 200, { documents: await store.list() });
          return;
        }
        if (req.method === 'POST') {
          const body = await readJson(req, maxBody);
          const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : body?.document?.name;
          if (!name) throw new DocError('A new document needs a name');
          const created = await store.create(name, body.document || null, { source: 'api' });
          send(res, 201, created, { ETag: `"${created.revision}"` });
          return;
        }
      }

      const m = /^\/api\/documents\/([^/]+)$/.exec(url.pathname);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (req.method === 'GET') {
          const { doc, revision, updatedAt } = await store.get(id);
          send(res, 200, doc, { ETag: `"${revision}"`, 'Last-Modified': new Date(updatedAt).toUTCString() });
          return;
        }
        if (req.method === 'PUT') {
          const body = await readJson(req, maxBody);
          const saved = await store.put(id, body, { ifMatch: ifMatchOf(req), source: 'api' });
          send(res, 200, saved, { ETag: `"${saved.revision}"` });
          return;
        }
        if (req.method === 'DELETE') {
          send(res, 200, await store.remove(id, { ifMatch: ifMatchOf(req), source: 'api' }));
          return;
        }
      }

      send(res, 404, { error: 'Not found' });
    } catch (err) {
      if (res.headersSent) { res.end(); return; }
      sendError(res, err);
    }
  });

  // Event streams never go idle on their own, so end them when closing -
  // otherwise close() would wait on them forever
  const close = server.close.bind(server);
  server.close = (cb) => {
    clearInterval(heartbeat);
    store.off?.('change', onChange);
    clients.forEach(res => res.end());
    clients.clear();
    server.closeIdleConnections?.();
    return close(cb);
  };
  return server;
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(process.env.PORT || 7071);
  const host = process.env.HOST || '127.0.0.1';
  const token = process.env.NODEX_SERVER_TOKEN || '';
  const insecure = process.env.NODEX_SERVER_INSECURE === '1';
  if (!token && !LOOPBACK.has(host) && !insecure) {
    console.error(`nodex-server: refusing to listen on ${host} without NODEX_SERVER_TOKEN - anyone who can reach it could read and change your diagrams.`);
    console.error('              Set a token (e.g. `openssl rand -hex 32`), or NODEX_SERVER_INSECURE=1 if something in front of it already authenticates.');
    process.exit(1);
  }
  const dataDir = process.env.NODEX_DATA || path.resolve('data');
  const store = await new FileStore(dataDir, { watch: true }).init();
  const server = createNodexServer({
    store,
    token,
    origin: process.env.NODEX_SERVER_ORIGIN || '*',
    maxBody: Number(process.env.NODEX_SERVER_MAX_BODY || 16 * 1024 * 1024)
  });
  server.listen(port, host, () => {
    const where = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
    console.log(`nodex-server ${VERSION} listening on ${where}`);
    console.log(`  data: ${dataDir}`);
    console.log(`  auth: ${token ? 'bearer token required' : 'none (set NODEX_SERVER_TOKEN to require one)'}`);
    console.log(`  MCP:  ${where}/mcp (Streamable HTTP)`);
  });
  const shutdown = () => { store.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
