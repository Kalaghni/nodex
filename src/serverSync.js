// Client for the optional Nodex backend (server/server.js).
//
// Off by default: until it's enabled under Server, Nodex never contacts a
// backend. When on, a tab can be linked to a document on the server - saving
// writes it back (refused if someone else changed it first), and changes made
// elsewhere (another editor, an MCP client) arrive over a live event stream.
// Settings (URL, token) stay in this browser.

export const DEFAULT_SERVER_SETTINGS = {
  enabled: false,
  // A hosted build sets VITE_NODEX_SERVER_URL (e.g. /server, proxied same-origin)
  url: import.meta.env?.VITE_NODEX_SERVER_URL || 'http://localhost:7071',
  token: ''
};

const SETTINGS_KEY = 'nodex.server.settings';

export const loadServerSettings = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SERVER_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SERVER_SETTINGS };
  } catch {
    return { ...DEFAULT_SERVER_SETTINGS };
  }
};

export const saveServerSettings = (settings) => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* storage unavailable - settings last for this session only */ }
};

export class ServerError extends Error {
  constructor(message, status, revision) {
    super(message);
    this.status = status;
    this.revision = revision;
  }
}

const baseUrl = (settings) => (settings.url || '').trim().replace(/\/+$/, '');
const authHeaders = (settings) => (settings.token ? { Authorization: `Bearer ${settings.token}` } : {});
const etagRevision = (res) => res.headers.get('etag')?.replace(/^W\//, '').replace(/"/g, '') || null;

const request = async (settings, method, path, { body, ifMatch, signal } = {}) => {
  let res;
  try {
    res = await fetch(baseUrl(settings) + path, {
      method,
      signal,
      headers: {
        ...authHeaders(settings),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(ifMatch ? { 'If-Match': `"${ifMatch}"` } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ServerError(`Can't reach the server at ${baseUrl(settings) || '(no URL)'}`, 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = res.status === 401 ? 'Wrong or missing token' : data?.error || `Server answered ${res.status}`;
    throw new ServerError(message, res.status, data?.revision);
  }
  return { data, revision: etagRevision(res) };
};

export const serverHealth = async (settings) => {
  try {
    const { data } = await request(settings, 'GET', '/health');
    return { ok: true, version: data.version, documents: data.documents };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

export const listServerDocs = async (settings) =>
  (await request(settings, 'GET', '/api/documents')).data.documents;

export const fetchServerDoc = async (settings, id) => {
  const { data, revision } = await request(settings, 'GET', `/api/documents/${encodeURIComponent(id)}`);
  return { doc: data, revision };
};

// `revision` = the one this save is based on; null overwrites unconditionally
export const saveServerDoc = async (settings, id, doc, revision) =>
  (await request(settings, 'PUT', `/api/documents/${encodeURIComponent(id)}`, { body: doc, ifMatch: revision })).data;

export const createServerDoc = async (settings, name, doc) =>
  (await request(settings, 'POST', '/api/documents', { body: { name, document: doc } })).data;

// Server-Sent Events framing: complete events out, the unfinished tail back
export const parseSSE = (buffer) => {
  const events = [];
  const frames = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = frames.pop();
  frames.forEach(frame => {
    let event = 'message';
    const data = [];
    frame.split('\n').forEach(line => {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    });
    if (data.length) events.push({ event, data: data.join('\n') });
  });
  return { events, rest };
};

// Live document changes. EventSource can't send an Authorization header, so
// the stream is read with fetch. Reconnects with backoff; onState gets
// 'connecting' | 'live' | 'error'. Returns a function that stops it.
export const subscribeServerEvents = (settings, onEvent, onState = () => {}) => {
  const ctrl = new AbortController();
  let stopped = false;
  let delay = 2000;

  const run = async () => {
    while (!stopped) {
      onState('connecting');
      try {
        const res = await fetch(`${baseUrl(settings)}/api/events`, { headers: authHeaders(settings), signal: ctrl.signal });
        if (!res.ok || !res.body) throw new ServerError(`Server answered ${res.status}`, res.status);
        onState('live');
        delay = 2000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseSSE(buffer);
          buffer = rest;
          events.forEach(e => {
            if (e.event !== 'document') return;
            try { onEvent(JSON.parse(e.data)); } catch { /* malformed event - ignore */ }
          });
        }
      } catch (err) {
        if (stopped || err.name === 'AbortError') return;
      }
      if (stopped) return;
      onState('error');
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30000);
    }
  };
  run();
  return () => {
    stopped = true;
    ctrl.abort();
  };
};

// Highest numeric id in a diagrams map - new ids must start above it
export const maxIdIn = (diagrams) => {
  let max = 0;
  Object.values(diagrams || {}).forEach(d => {
    [...(d?.nodes || []), ...(d?.connections || []), ...(d?.zones || [])].forEach(x => {
      if (typeof x?.id === 'number' && x.id > max) max = x.id;
    });
  });
  return max;
};
