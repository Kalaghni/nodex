// Document storage for the Nodex backend and the MCP toolkit.
//
// FileStore keeps one diagram per JSON file in a directory - the same files
// the editor saves, so a folder of existing .json diagrams works as-is. Each
// document's revision is a hash of its bytes: writes can require the
// revision they were based on (If-Match), so an MCP edit and a browser save
// never silently overwrite each other, and edits made outside the store
// (another program, a text editor) show up as new revisions too.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { normalizeDocument, newDocument, DocError } from './core/document.js';

export class NotFoundError extends Error {}
export class ConflictError extends Error {
  constructor(message, revision) {
    super(message);
    this.revision = revision;
  }
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
export const isValidId = (id) => typeof id === 'string' && ID_RE.test(id);

export const slugify = (name) =>
  (String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)) || 'diagram';

export const revisionOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const serialize = (doc) => JSON.stringify(doc, null, 2);

// Read-modify-write with optimistic concurrency, retried when someone else
// wrote in between. `mutate` changes the document in place and returns a
// result to pass back to the caller.
export const updateDocument = async (store, id, mutate, { retries = 4, source } = {}) => {
  for (let attempt = 0; ; attempt++) {
    const { doc, revision } = await store.get(id);
    const result = await mutate(doc);
    try {
      const saved = await store.put(id, doc, { ifMatch: revision, source });
      return { ...saved, result };
    } catch (err) {
      if (!(err instanceof ConflictError) || attempt >= retries) throw err;
    }
  }
};

export class FileStore extends EventEmitter {
  constructor(dir, { watch = false } = {}) {
    super();
    this.dir = path.resolve(dir);
    this.watchFiles = watch;
    this.known = new Map(); // id → last revision seen, for change detection
    this.locks = new Map();
    this.watcher = null;
  }

  async init() {
    await fsp.mkdir(this.dir, { recursive: true });
    if (this.watchFiles) this.startWatching();
    return this;
  }

  close() {
    this.watcher?.close();
    this.watcher = null;
  }

  file(id) {
    if (!isValidId(id)) throw new NotFoundError(`No document "${id}"`);
    return path.join(this.dir, `${id}.json`);
  }

  // One write at a time per document
  async withLock(id, fn) {
    const prev = this.locks.get(id) || Promise.resolve();
    let release;
    const mine = new Promise(r => { release = r; });
    const chained = prev.then(() => mine);
    this.locks.set(id, chained);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(id) === chained) this.locks.delete(id);
    }
  }

  async readRaw(id) {
    try {
      const text = await fsp.readFile(this.file(id), 'utf8');
      const stat = await fsp.stat(this.file(id));
      return { text, revision: revisionOf(text), updatedAt: stat.mtime.toISOString() };
    } catch (err) {
      if (err.code === 'ENOENT') throw new NotFoundError(`No document "${id}"`);
      throw err;
    }
  }

  async list() {
    const files = (await fsp.readdir(this.dir)).filter(f => f.endsWith('.json'));
    const out = [];
    for (const f of files) {
      const id = f.slice(0, -5);
      if (!isValidId(id)) continue;
      try {
        const { text, revision, updatedAt } = await this.readRaw(id);
        const data = JSON.parse(text);
        if (Array.isArray(data.tabs) || !data.diagrams) continue; // projects / other JSON
        const diagrams = Object.values(data.diagrams || {});
        out.push({
          id,
          name: data.name || id,
          revision,
          updatedAt,
          diagrams: diagrams.length,
          nodes: diagrams.reduce((s, d) => s + (d?.nodes?.length || 0), 0)
        });
      } catch { /* unreadable file - skip it */ }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id) {
    const { text, revision, updatedAt } = await this.readRaw(id);
    let data;
    try { data = JSON.parse(text); } catch { throw new DocError(`Document "${id}" is not valid JSON`); }
    const doc = normalizeDocument(data, id);
    this.known.set(id, revision);
    return { id, revision, updatedAt, doc };
  }

  async writeFile(id, text) {
    const tmp = path.join(this.dir, `.${id}.${randomUUID()}.tmp`);
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, this.file(id));
  }

  // ifMatch: the revision the write is based on (undefined = unconditional)
  async put(id, data, { ifMatch, mustExist = true, mustNotExist = false, source } = {}) {
    const doc = normalizeDocument(data, id);
    return this.withLock(id, async () => {
      let current = null;
      try { current = await this.readRaw(id); } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }
      if (!current && mustExist) throw new NotFoundError(`No document "${id}"`);
      if (current && mustNotExist) throw new ConflictError(`Document "${id}" already exists`, current.revision);
      if (ifMatch && ifMatch !== '*' && current && current.revision !== ifMatch) {
        throw new ConflictError(`Document "${id}" changed since revision ${ifMatch}`, current.revision);
      }
      const text = serialize(doc);
      const revision = revisionOf(text);
      if (current?.revision === revision) return { id, revision, updatedAt: current.updatedAt, unchanged: true };
      await this.writeFile(id, text);
      this.known.set(id, revision);
      const updatedAt = new Date().toISOString();
      this.emit('change', { id, revision, name: doc.name, updatedAt, source });
      return { id, revision, updatedAt };
    });
  }

  async create(name, data = null, { source } = {}) {
    const doc = data ? normalizeDocument({ ...data, name: name || data.name }, name) : newDocument(name);
    if (data && !data.uid) doc.uid = randomUUID();
    const base = slugify(name || doc.name);
    for (let i = 1; i < 1000; i++) {
      const id = i === 1 ? base : `${base}-${i}`;
      if (fs.existsSync(this.file(id))) continue;
      try {
        const saved = await this.put(id, doc, { mustExist: false, mustNotExist: true, source });
        return { ...saved, name: doc.name };
      } catch (err) {
        if (!(err instanceof ConflictError)) throw err; // taken in the meantime - try the next name
      }
    }
    throw new DocError('Too many documents with that name');
  }

  async remove(id, { ifMatch, source } = {}) {
    return this.withLock(id, async () => {
      const current = await this.readRaw(id);
      if (ifMatch && ifMatch !== '*' && current.revision !== ifMatch) {
        throw new ConflictError(`Document "${id}" changed since revision ${ifMatch}`, current.revision);
      }
      await fsp.unlink(this.file(id));
      this.known.delete(id);
      this.emit('change', { id, deleted: true, source });
      return { id, deleted: true };
    });
  }

  // Pick up edits made outside the store (another process, a text editor)
  startWatching() {
    const pending = new Map();
    try {
      this.watcher = fs.watch(this.dir, (_, filename) => {
        if (!filename || !filename.endsWith('.json') || filename.startsWith('.')) return;
        const id = filename.slice(0, -5);
        if (!isValidId(id)) return;
        clearTimeout(pending.get(id));
        pending.set(id, setTimeout(async () => {
          pending.delete(id);
          try {
            const { text, revision, updatedAt } = await this.readRaw(id);
            if (this.known.get(id) === revision) return;
            this.known.set(id, revision);
            let name = id;
            try { name = JSON.parse(text).name || id; } catch { /* partial write */ }
            this.emit('change', { id, revision, name, updatedAt, source: 'external' });
          } catch (err) {
            if (err instanceof NotFoundError && this.known.has(id)) {
              this.known.delete(id);
              this.emit('change', { id, deleted: true, source: 'external' });
            }
          }
        }, 150));
      });
    } catch {
      // fs.watch unsupported here - external edits are still picked up on the next read
    }
  }
}

// Talks to a running Nodex backend (server/server.js) - lets the stdio MCP
// server edit the same documents the browser has open
export class RemoteStore {
  constructor(baseUrl, token = '') {
    this.base = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  async request(method, url, body, headers = {}) {
    const res = await fetch(this.base + url, {
      method,
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.status === 404) throw new NotFoundError(data?.error || 'Not found');
    if (res.status === 409) throw new ConflictError(data?.error || 'Conflict', data?.revision);
    if (res.status === 400 || res.status === 422) throw new DocError(data?.error || 'Bad request');
    if (!res.ok) throw new Error(data?.error || `Nodex server answered ${res.status}`);
    return { data, res };
  }

  async list() {
    return (await this.request('GET', '/api/documents')).data.documents;
  }

  async get(id) {
    const { data, res } = await this.request('GET', `/api/documents/${encodeURIComponent(id)}`);
    return {
      id,
      revision: res.headers.get('etag')?.replace(/"/g, ''),
      updatedAt: res.headers.get('last-modified'),
      doc: normalizeDocument(data, id)
    };
  }

  async put(id, doc, { ifMatch } = {}) {
    return (await this.request('PUT', `/api/documents/${encodeURIComponent(id)}`, doc,
      ifMatch ? { 'If-Match': `"${ifMatch}"` } : {})).data;
  }

  async create(name, doc = null) {
    return (await this.request('POST', '/api/documents', { name, ...(doc ? { document: doc } : {}) })).data;
  }

  async remove(id, { ifMatch } = {}) {
    return (await this.request('DELETE', `/api/documents/${encodeURIComponent(id)}`, undefined,
      ifMatch ? { 'If-Match': `"${ifMatch}"` } : {})).data;
  }
}
