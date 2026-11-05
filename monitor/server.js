#!/usr/bin/env node
// Nodex monitor agent — checks the real addresses attached to diagram nodes.
//
// Browsers can't ping or open raw TCP connections, so Nodex asks this small
// agent to do it. The agent is stateless: Nodex POSTs the list of endpoints
// to check and gets results back. No dependencies beyond Node ≥ 18.
//
//   node monitor/server.js
//
// Environment
//   PORT                    listen port (default 7070)
//   HOST                    listen address (default 127.0.0.1 — local only)
//   NODEX_MONITOR_TOKEN     if set, requests must send `Authorization: Bearer <token>`
//   NODEX_MONITOR_ALLOW     comma-separated CIDRs (e.g. 10.0.0.0/8,192.168.1.0/24);
//                           if set, only addresses inside them are probed —
//                           hostnames are resolved first and every address checked
//   NODEX_MONITOR_ORIGIN    value for Access-Control-Allow-Origin (default *)
//   NODEX_MONITOR_MAX_TARGETS  per-request cap (default 256)
//
// API
//   GET  /health  → { ok, name, version, checks: [...], authRequired, allowlist }
//   POST /probe   { targets: [{ key, address, check, port?, path?, insecure? }], timeoutMs? }
//               → { checkedAt, results: [{ key, up, latencyMs, error?, detail? }] }
//     check: 'icmp' | 'tcp' | 'http' | 'https'
//     up: true / false, or null when the check couldn't be attempted
//         (invalid target, outside the allowlist, ping unavailable)

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const VERSION = '1.0.0';
const CHECKS = ['icmp', 'tcp', 'http', 'https'];
const MAX_BODY = 256 * 1024;
const CONCURRENCY = 32;
const MAX_INFLIGHT_REQUESTS = 8;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Hostnames, IPv4, IPv6 (optionally bracketed, optionally with a zone id).
// Never starts with '-' so it can't be read as an option by `ping`.
const ADDRESS_RE = /^[A-Za-z0-9._:%[\]-]+$/;

export const normalizeAddress = (raw) => {
  if (typeof raw !== 'string') return null;
  let a = raw.trim();
  if (!a || a.length > 253 || a.startsWith('-') || !ADDRESS_RE.test(a)) return null;
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  if (a.includes('[') || a.includes(']')) return null;
  if (a.includes(':') && net.isIP(a.split('%')[0]) !== 6) return null; // colons only in IPv6
  return a;
};

export const validateTarget = (t) => {
  if (!t || typeof t !== 'object') return 'Invalid target';
  if (!CHECKS.includes(t.check)) return `Unknown check "${t.check}"`;
  const address = normalizeAddress(t.address);
  if (!address) return 'Invalid address';
  if (t.check !== 'icmp') {
    const port = Number(t.port ?? (t.check === 'https' ? 443 : t.check === 'http' ? 80 : NaN));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Invalid port';
  }
  if (t.path != null) {
    if (typeof t.path !== 'string' || !t.path.startsWith('/') || t.path.length > 2048 || /[\s\u0000-\u001f]/.test(t.path)) {
      return 'Invalid path';
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------
export const parseAllowlist = (spec) => {
  if (!spec || !spec.trim()) return null;
  const list = new net.BlockList();
  spec.split(',').map(s => s.trim()).filter(Boolean).forEach(entry => {
    const [addr, bits] = entry.split('/');
    const type = net.isIP(addr) === 6 ? 'ipv6' : net.isIP(addr) === 4 ? 'ipv4' : null;
    if (!type) throw new Error(`NODEX_MONITOR_ALLOW: invalid entry "${entry}"`);
    if (bits === undefined) list.addAddress(addr, type);
    else list.addSubnet(addr, Number(bits), type);
  });
  return list;
};

const ipType = (addr) => (net.isIP(addr) === 6 ? 'ipv6' : 'ipv4');

// Resolve once and connect to the resolved address — checking a hostname
// against the allowlist and then letting the connection re-resolve would
// allow DNS rebinding around it
const resolveTarget = async (address, allow) => {
  const bare = address.split('%')[0];
  let addrs;
  if (net.isIP(bare)) addrs = [address];
  else {
    try {
      addrs = (await dns.lookup(address, { all: true })).map(r => r.address);
    } catch (err) {
      return { error: `DNS lookup failed (${err.code || err.message})`, up: false };
    }
  }
  if (allow && !addrs.every(a => allow.check(a.split('%')[0], ipType(a.split('%')[0])))) {
    return { error: 'Address not allowed by NODEX_MONITOR_ALLOW', up: null };
  }
  return { ip: addrs[0] };
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
const now = () => performance.now();

const tcpCheck = (ip, port, timeoutMs) => new Promise(resolve => {
  const t0 = now();
  const socket = net.connect({ host: ip, port });
  const done = (result) => {
    socket.destroy();
    resolve(result);
  };
  socket.setTimeout(timeoutMs, () => done({ up: false, error: 'Timed out' }));
  socket.once('connect', () => done({ up: true, latencyMs: now() - t0 }));
  socket.once('error', (err) => done(err.code === 'EAFNOSUPPORT'
    ? { up: null, error: 'IPv6 isn’t available on the monitor host' }
    : { up: false, error: err.code === 'ECONNREFUSED' ? 'Connection refused' : (err.code || err.message) }));
});

const httpCheck = (target, ip, timeoutMs) => new Promise(resolve => {
  const secure = target.check === 'https';
  const port = Number(target.port ?? (secure ? 443 : 80));
  const host = normalizeAddress(target.address);
  const hostHeader = net.isIP(host.split('%')[0]) === 6 ? `[${host}]` : host;
  const t0 = now();
  const req = (secure ? https : http).request({
    host: ip,
    port,
    method: 'GET',
    path: target.path || '/',
    headers: { Host: port === (secure ? 443 : 80) ? hostHeader : `${hostHeader}:${port}`, 'User-Agent': `nodex-monitor/${VERSION}` },
    servername: secure && !net.isIP(host.split('%')[0]) ? host : undefined,
    rejectUnauthorized: !target.insecure,
    timeout: timeoutMs
  }, (res) => {
    const latencyMs = now() - t0;
    res.resume();
    req.destroy();
    // Any answer below 500 means the service is up and responding
    resolve(res.statusCode < 500
      ? { up: true, latencyMs, detail: `HTTP ${res.statusCode}` }
      : { up: false, latencyMs, error: `HTTP ${res.statusCode}` });
  });
  req.on('timeout', () => {
    req.destroy();
    resolve({ up: false, error: 'Timed out' });
  });
  req.on('error', (err) => {
    const code = err.code || err.message;
    resolve({
      up: false,
      error: /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code) ? `TLS certificate: ${code}` :
        code === 'ECONNREFUSED' ? 'Connection refused' : code
    });
  });
  req.end();
});

// Ping via the system binary (raw ICMP sockets need privileges Node lacks).
// Arguments are passed as an array — no shell — and the address was
// validated, so nothing in it can be read as an option.
export const findPing = () => {
  const exe = process.platform === 'win32' ? ['ping.exe', 'PING.EXE'] : ['ping'];
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    for (const e of exe) {
      const p = path.join(d, e);
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return p;
      } catch { /* keep looking */ }
    }
  }
  return null;
};

const pingArgs = (ip, timeoutMs) => {
  const secs = String(Math.max(1, Math.ceil(timeoutMs / 1000)));
  const v6 = ipType(ip.split('%')[0]) === 'ipv6';
  if (process.platform === 'win32') return [...(v6 ? ['-6'] : []), '-n', '1', '-w', String(timeoutMs), ip];
  if (process.platform === 'darwin') return ['-c', '1', '-t', secs, ip];
  return [...(v6 ? ['-6'] : []), '-c', '1', '-W', secs, ip];
};

const icmpCheck = (pingPath, ip, timeoutMs) => new Promise(resolve => {
  if (!pingPath) {
    resolve({ up: null, error: 'Ping is not available on the monitor host' });
    return;
  }
  const t0 = now();
  let out = '';
  const child = spawn(pingPath, pingArgs(ip, timeoutMs), { stdio: ['ignore', 'pipe', 'pipe'] });
  const killer = setTimeout(() => child.kill('SIGKILL'), timeoutMs + 1500);
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  child.on('error', (err) => {
    clearTimeout(killer);
    resolve({ up: null, error: `Ping failed to start (${err.code || err.message})` });
  });
  child.on('close', (code) => {
    clearTimeout(killer);
    const m = out.match(/time[=<]\s*([\d.]+)\s*ms/i);
    if (code === 0) resolve({ up: true, latencyMs: m ? parseFloat(m[1]) : now() - t0 });
    else if (/permission|not permitted|operation not allowed/i.test(out)) resolve({ up: null, error: 'Ping not permitted on the monitor host (needs CAP_NET_RAW)' });
    // The agent's host has no IPv6 (common in containers) — that says
    // nothing about the target, so it's "can't check", not "down"
    else if (/address family not supported/i.test(out)) resolve({ up: null, error: 'IPv6 isn’t available on the monitor host' });
    else resolve({ up: false, error: 'No reply' });
  });
});

export const probeTarget = async (target, { timeoutMs = 3000, allow = null, pingPath = null } = {}) => {
  const invalid = validateTarget(target);
  if (invalid) return { up: null, error: invalid };
  const resolved = await resolveTarget(normalizeAddress(target.address), allow);
  if (!resolved.ip) return { up: resolved.up, error: resolved.error };
  let result;
  if (target.check === 'icmp') result = await icmpCheck(pingPath, resolved.ip, timeoutMs);
  else if (target.check === 'tcp') result = await tcpCheck(resolved.ip, Number(target.port), timeoutMs);
  else result = await httpCheck(target, resolved.ip, timeoutMs);
  if (result.latencyMs != null) result.latencyMs = Math.round(result.latencyMs * 10) / 10;
  return result;
};

// Run `fn` over items with bounded parallelism
const mapLimit = async (items, limit, fn) => {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
export const createMonitorServer = ({
  token = '',
  allow = null,
  origin = '*',
  maxTargets = 256,
  pingPath = findPing()
} = {}) => {
  let inflight = 0;
  const checks = CHECKS.filter(c => c !== 'icmp' || pingPath);

  const send = (res, status, body, extra = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      ...extra
    });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  const authorized = (req) => !token || req.headers.authorization === `Bearer ${token}`;

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'OPTIONS') {
      // Chrome's Private Network Access preflight asks before a public page
      // may reach a local/private address — answer it explicitly
      const pna = req.headers['access-control-request-private-network'] === 'true'
        ? { 'Access-Control-Allow-Private-Network': 'true' }
        : {};
      send(res, 204, undefined, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
        ...pna
      });
      return;
    }

    if (!authorized(req)) {
      send(res, 401, { error: 'Unauthorized — set the monitor token in Nodex' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, {
        ok: true,
        name: 'nodex-monitor',
        version: VERSION,
        checks,
        authRequired: !!token,
        allowlist: !!allow
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/probe') {
      if (inflight >= MAX_INFLIGHT_REQUESTS) {
        send(res, 429, { error: 'Too many concurrent probe requests' });
        return;
      }
      let size = 0;
      const chunks = [];
      let aborted = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          aborted = true;
          send(res, 413, { error: 'Request too large' });
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', async () => {
        if (aborted) return;
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          send(res, 400, { error: 'Invalid JSON' });
          return;
        }
        const targets = Array.isArray(body.targets) ? body.targets : null;
        if (!targets) {
          send(res, 400, { error: 'Expected { targets: [...] }' });
          return;
        }
        if (targets.length > maxTargets) {
          send(res, 400, { error: `Too many targets (max ${maxTargets})` });
          return;
        }
        const timeoutMs = Math.min(10000, Math.max(500, Number(body.timeoutMs) || 3000));
        inflight++;
        try {
          const results = await mapLimit(targets, CONCURRENCY, async (t) => ({
            key: typeof t?.key === 'string' ? t.key.slice(0, 200) : null,
            ...(await probeTarget(t, { timeoutMs, allow, pingPath }))
          }));
          send(res, 200, { checkedAt: Date.now(), results });
        } finally {
          inflight--;
        }
      });
      return;
    }

    send(res, 404, { error: 'Not found' });
  });
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(process.env.PORT || 7070);
  const host = process.env.HOST || '127.0.0.1';
  const token = process.env.NODEX_MONITOR_TOKEN || '';
  const allow = parseAllowlist(process.env.NODEX_MONITOR_ALLOW || '');
  const server = createMonitorServer({
    token,
    allow,
    origin: process.env.NODEX_MONITOR_ORIGIN || '*',
    maxTargets: Number(process.env.NODEX_MONITOR_MAX_TARGETS || 256)
  });
  server.listen(port, host, () => {
    const pingPath = findPing();
    console.log(`nodex-monitor ${VERSION} listening on http://${host.includes(':') ? `[${host}]` : host}:${port}`);
    console.log(`  checks: ${CHECKS.filter(c => c !== 'icmp' || pingPath).join(', ')}${pingPath ? '' : ' (no ping binary found — ICMP disabled)'}`);
    console.log(`  auth: ${token ? 'bearer token required' : 'none (set NODEX_MONITOR_TOKEN to require one)'}`);
    console.log(`  allowlist: ${allow ? process.env.NODEX_MONITOR_ALLOW : 'none (set NODEX_MONITOR_ALLOW to restrict targets)'}`);
    if (!token && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
      console.warn('  WARNING: listening beyond localhost without a token — anyone who can reach this port can make it probe hosts.');
      console.warn('           (Fine in Docker when the port is only published on 127.0.0.1, as in the bundled compose file.)');
    }
  });
}
