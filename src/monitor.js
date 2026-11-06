// Live monitoring of the real addresses attached to nodes.
//
// Each node can carry `endpoints: [{ id, address, check, port?, path?, insecure? }]`
// in the diagram. Checks run through the Nodex monitor agent
// (monitor/server.js — ping, TCP, HTTP) or, without one, straight from the
// browser (HTTP/HTTPS only: browsers can't ping or open raw sockets).
// Settings (agent URL, token, interval) are per viewer, not per diagram.

export const CHECK_TYPES = [
  { id: 'icmp', label: 'Ping', long: 'Ping (ICMP)', port: false, path: false, agentOnly: true },
  { id: 'tcp', label: 'TCP', long: 'TCP port open', port: true, path: false, agentOnly: true, defaultPort: 22 },
  { id: 'http', label: 'HTTP', long: 'HTTP responds', port: true, path: true, agentOnly: false, defaultPort: 80 },
  { id: 'https', label: 'HTTPS', long: 'HTTPS responds', port: true, path: true, agentOnly: false, defaultPort: 443 }
];

export const DEFAULT_MONITOR_SETTINGS = {
  source: 'agent', // 'agent' | 'browser'
  // A hosted build sets VITE_MONITOR_URL (e.g. /monitor, proxied same-origin)
  agentUrl: import.meta.env?.VITE_MONITOR_URL || 'http://localhost:7070',
  token: '',
  intervalSec: 15,
  timeoutMs: 3000,
  // Consecutive failed checks before an endpoint counts as down — one
  // dropped packet shouldn't light up an outage
  failAfter: 2
};

const SETTINGS_KEY = 'nodex.monitor.settings';

export const loadMonitorSettings = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_MONITOR_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_MONITOR_SETTINGS };
  } catch {
    return { ...DEFAULT_MONITOR_SETTINGS };
  }
};

export const saveMonitorSettings = (settings) => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* storage unavailable — settings last for this session only */ }
};

// Same rules as the agent: hostname / IPv4 / IPv6, never option-like
export const validateAddress = (raw) => {
  const a = (raw || '').trim();
  if (!a) return 'Enter an IP address or hostname';
  if (a.length > 253 || a.startsWith('-') || !/^[A-Za-z0-9._:%[\]-]+$/.test(a)) return 'Not a valid address';
  return null;
};

export const checkType = (id) => CHECK_TYPES.find(c => c.id === id) || CHECK_TYPES[0];

export const endpointPort = (ep) => {
  const ct = checkType(ep.check);
  if (!ct.port) return null;
  const p = parseInt(ep.port, 10);
  return Number.isInteger(p) && p > 0 ? p : ct.defaultPort;
};

const hostForUrl = (address) => {
  const a = address.trim();
  return a.includes(':') && !a.startsWith('[') ? `[${a}]` : a;
};

// Human-readable form: "10.0.0.5", "10.0.0.5:3306", "https://portal.local/health"
export const endpointLabel = (ep) => {
  const ct = checkType(ep.check);
  const port = endpointPort(ep);
  if (ep.check === 'icmp') return ep.address;
  if (ep.check === 'tcp') return `${hostForUrl(ep.address)}:${port}`;
  const showPort = port !== ct.defaultPort ? `:${port}` : '';
  return `${ep.check}://${hostForUrl(ep.address)}${showPort}${ep.path || '/'}`;
};

export const endpointKey = (nodeId, ep) => `${nodeId}:${ep.id}`;

// Every endpoint of every node in a diagram, in the agent's wire format
export const collectTargets = (nodes) => {
  const targets = [];
  nodes.forEach(n => (n.endpoints || []).forEach(ep => {
    if (validateAddress(ep.address)) return;
    targets.push({
      key: endpointKey(n.id, ep),
      nodeId: n.id,
      address: ep.address.trim(),
      check: ep.check || 'icmp',
      port: endpointPort(ep) ?? undefined,
      path: checkType(ep.check).path ? (ep.path || '/') : undefined,
      insecure: ep.insecure || undefined
    });
  }));
  return targets;
};

const withTimeout = (ms) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
};

const agentHeaders = (settings) => ({
  'Content-Type': 'application/json',
  ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {})
});

const agentBase = (settings) => settings.agentUrl.trim().replace(/\/+$/, '');

// Explain a failed request to the agent in terms the user can act on
const agentError = (err, settings) => {
  if (err?.name === 'AbortError') return `Monitor agent at ${agentBase(settings)} didn't answer in time`;
  if (typeof location !== 'undefined' && location.protocol === 'https:' && agentBase(settings).startsWith('http:') &&
      !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(agentBase(settings))) {
    return 'This page is served over HTTPS, so the browser blocks an http:// agent — serve the agent over HTTPS or open Nodex over HTTP';
  }
  return `Can’t reach the monitor agent at ${agentBase(settings)} — is it running? (npm run monitor)`;
};

export const agentHealth = async (settings) => {
  const t = withTimeout(4000);
  try {
    const res = await fetch(`${agentBase(settings)}/health`, { headers: agentHeaders(settings), signal: t.signal });
    if (res.status === 401) return { ok: false, error: 'The agent requires a token — check the token setting' };
    if (!res.ok) return { ok: false, error: `Agent answered HTTP ${res.status}` };
    const body = await res.json();
    return { ok: true, ...body };
  } catch (err) {
    return { ok: false, error: agentError(err, settings) };
  } finally {
    t.done();
  }
};

const probeViaAgent = async (settings, targets) => {
  const t = withTimeout(settings.timeoutMs + 8000);
  try {
    const res = await fetch(`${agentBase(settings)}/probe`, {
      method: 'POST',
      headers: agentHeaders(settings),
      body: JSON.stringify({
        timeoutMs: settings.timeoutMs,
        targets: targets.map(({ key, address, check, port, path, insecure }) => ({ key, address, check, port, path, insecure }))
      }),
      signal: t.signal
    });
    if (res.status === 401) throw Object.assign(new Error('The agent requires a token — check the token setting'), { friendly: true });
    if (!res.ok) {
      const msg = await res.json().then(b => b.error).catch(() => null);
      throw Object.assign(new Error(msg || `Agent answered HTTP ${res.status}`), { friendly: true });
    }
    const body = await res.json();
    const byKey = new Map();
    body.results.forEach(r => byKey.set(r.key, r));
    return targets.map(tg => byKey.get(tg.key) || { up: null, error: 'No result from agent' });
  } catch (err) {
    throw new Error(err.friendly ? err.message : agentError(err, settings));
  } finally {
    t.done();
  }
};

// Browser-only checks. `no-cors` gives an opaque response, so all we learn
// is whether *something* answered — enough for up/down, not status codes.
const probeViaBrowser = async (settings, targets) => {
  const pageIsHttps = typeof location !== 'undefined' && location.protocol === 'https:';
  return Promise.all(targets.map(async (tg) => {
    if (checkType(tg.check).agentOnly) {
      return { up: null, error: `${checkType(tg.check).long} needs the monitor agent — browsers can’t do it` };
    }
    if (pageIsHttps && tg.check === 'http') {
      return { up: null, error: 'Browsers block http:// checks from an https:// page — use HTTPS or the agent' };
    }
    const url = endpointLabel({ ...tg, port: tg.port });
    const t = withTimeout(settings.timeoutMs);
    const t0 = performance.now();
    try {
      await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: t.signal });
      return { up: true, latencyMs: Math.round(performance.now() - t0) };
    } catch (err) {
      return { up: false, error: err?.name === 'AbortError' ? 'Timed out' : 'No response (or blocked by the browser, e.g. untrusted certificate)' };
    } finally {
      t.done();
    }
  }));
};

// Probe targets; resolves to results aligned with `targets`. Rejects with a
// user-facing message when the agent itself can't be used.
export const probeTargets = (settings, targets) =>
  (settings.source === 'browser' ? probeViaBrowser(settings, targets) : probeViaAgent(settings, targets));

const HISTORY = 30;

// Fold a round of results into per-endpoint state:
//   { status: 'up' | 'down' | 'unknown', fails, last, history[], since }
// `down` only after `failAfter` consecutive failures; until then the
// endpoint keeps its previous status and is flagged `suspect`.
export const applyResults = (prev, targets, results, nowMs, failAfter = 2) => {
  const next = new Map(prev);
  targets.forEach((tg, i) => {
    const r = results[i] || { up: null, error: 'No result' };
    const old = prev.get(tg.key);
    const history = [...(old?.history || []), { t: nowMs, up: r.up, latencyMs: r.latencyMs ?? null }].slice(-HISTORY);
    let status;
    let fails = 0;
    if (r.up === true) status = 'up';
    else if (r.up === null) status = 'unknown';
    else {
      fails = (old?.fails || 0) + 1;
      status = fails >= failAfter ? 'down' : (old?.status === 'up' || old?.status === 'down' ? old.status : 'pending');
    }
    next.set(tg.key, {
      status,
      fails,
      suspect: r.up === false && status !== 'down',
      last: { ...r, checkedAt: nowMs },
      history,
      since: old && old.status === status ? old.since : nowMs
    });
  });
  // Forget endpoints that no longer exist
  const keep = new Set(targets.map(t => t.key));
  [...next.keys()].forEach(k => { if (!keep.has(k)) next.delete(k); });
  return next;
};

// A node's live state from its endpoints:
//   up       every checkable endpoint answers
//   partial  some do, some don't
//   down     none do
//   pending  no conclusive result yet
//   unknown  nothing checkable (e.g. ping without an agent)
export const nodeLiveStatus = (node, state) => {
  const eps = (node.endpoints || []).filter(ep => !validateAddress(ep.address));
  if (eps.length === 0) return null;
  const rows = eps.map(ep => ({ ep, st: state.get(endpointKey(node.id, ep)) }));
  const checkable = rows.filter(r => r.st && r.st.status !== 'unknown');
  const conclusive = checkable.filter(r => r.st.status === 'up' || r.st.status === 'down');
  let status;
  if (rows.every(r => r.st?.status === 'unknown')) status = 'unknown';
  else if (conclusive.length === 0) status = 'pending';
  else {
    const up = conclusive.filter(r => r.st.status === 'up').length;
    status = up === conclusive.length ? 'up' : up === 0 ? 'down' : 'partial';
  }
  const latencies = checkable.map(r => r.st.last?.latencyMs).filter(v => v != null);
  return {
    status,
    endpoints: rows,
    suspect: rows.some(r => r.st?.suspect),
    latencyMs: latencies.length ? Math.max(...latencies) : null
  };
};

// Share of successful checks in an endpoint's recent history
export const uptimePercent = (st) => {
  const known = (st?.history || []).filter(h => h.up !== null);
  if (known.length === 0) return null;
  return Math.round((known.filter(h => h.up).length / known.length) * 100);
};
