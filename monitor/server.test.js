import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {
  createMonitorServer,
  probeTarget,
  validateTarget,
  normalizeAddress,
  parseAllowlist
} from './server.js';

let tcpServer;
let tcpPort;
let webServer;
let webPort;
let closedPort;

const listen = (srv) => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

before(async () => {
  tcpServer = net.createServer(s => s.end());
  tcpPort = await listen(tcpServer);
  webServer = http.createServer((req, res) => {
    res.statusCode = req.url === '/broken' ? 503 : 200;
    res.end('ok');
  });
  webPort = await listen(webServer);
  // A port that was just free — nothing listens there
  const tmp = net.createServer();
  closedPort = await listen(tmp);
  await new Promise(r => tmp.close(r));
});

after(() => {
  tcpServer.close();
  webServer.close();
});

test('address validation rejects option-like and malformed input', () => {
  assert.equal(normalizeAddress('10.0.0.5'), '10.0.0.5');
  assert.equal(normalizeAddress('db.internal'), 'db.internal');
  assert.equal(normalizeAddress('[fe80::1]'), 'fe80::1');
  assert.equal(normalizeAddress('-c 100 host'), null);
  assert.equal(normalizeAddress('-f'), null);
  assert.equal(normalizeAddress('host;rm -rf /'), null);
  assert.equal(normalizeAddress('a:b'), null);
  assert.equal(validateTarget({ address: '1.2.3.4', check: 'tcp', port: 70000 }), 'Invalid port');
  assert.equal(validateTarget({ address: '1.2.3.4', check: 'http', path: 'no-slash' }), 'Invalid path');
  assert.equal(validateTarget({ address: '1.2.3.4', check: 'nmap' }), 'Unknown check "nmap"');
  assert.equal(validateTarget({ address: '1.2.3.4', check: 'icmp' }), null);
});

test('tcp: open port is up, closed port is down', async () => {
  const up = await probeTarget({ address: '127.0.0.1', check: 'tcp', port: tcpPort });
  assert.equal(up.up, true);
  assert.ok(up.latencyMs >= 0);
  const down = await probeTarget({ address: '127.0.0.1', check: 'tcp', port: closedPort });
  assert.equal(down.up, false);
  assert.equal(down.error, 'Connection refused');
});

test('http: 2xx is up, 5xx is down, hostnames resolve', async () => {
  const ok = await probeTarget({ address: 'localhost', check: 'http', port: webPort, path: '/' });
  assert.equal(ok.up, true);
  assert.equal(ok.detail, 'HTTP 200');
  const broken = await probeTarget({ address: '127.0.0.1', check: 'http', port: webPort, path: '/broken' });
  assert.equal(broken.up, false);
  assert.equal(broken.error, 'HTTP 503');
});

test('icmp without a ping binary reports "can\'t check", not "down"', async () => {
  const r = await probeTarget({ address: '127.0.0.1', check: 'icmp' }, { pingPath: null });
  assert.equal(r.up, null);
});

test('allowlist blocks addresses outside the configured networks', async () => {
  const allow = parseAllowlist('10.0.0.0/8');
  const r = await probeTarget({ address: '127.0.0.1', check: 'tcp', port: tcpPort }, { allow });
  assert.equal(r.up, null);
  assert.match(r.error, /not allowed/);
  const allowLocal = parseAllowlist('127.0.0.0/8, ::1/128');
  const ok = await probeTarget({ address: 'localhost', check: 'tcp', port: tcpPort }, { allow: allowLocal });
  assert.equal(ok.up, true);
  assert.throws(() => parseAllowlist('not-a-cidr'));
});

test('HTTP API: auth, CORS preflight, probe, limits', async () => {
  const srv = createMonitorServer({ token: 'sekret', maxTargets: 3, pingPath: null });
  const port = await listen(srv);
  const base = `http://127.0.0.1:${port}`;
  try {
    const pre = await fetch(`${base}/probe`, {
      method: 'OPTIONS',
      headers: { 'Access-Control-Request-Private-Network': 'true' }
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
    assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);

    assert.equal((await fetch(`${base}/health`)).status, 401);
    const auth = { Authorization: 'Bearer sekret', 'Content-Type': 'application/json' };
    const health = await (await fetch(`${base}/health`, { headers: auth })).json();
    assert.equal(health.ok, true);
    assert.deepEqual(health.checks, ['tcp', 'http', 'https']);

    const res = await fetch(`${base}/probe`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        targets: [
          { key: 'a', address: '127.0.0.1', check: 'tcp', port: tcpPort },
          { key: 'b', address: '127.0.0.1', check: 'tcp', port: closedPort },
          { key: 'c', address: '-oops', check: 'tcp', port: 1 }
        ]
      })
    });
    const body = await res.json();
    assert.deepEqual(body.results.map(r => [r.key, r.up]), [['a', true], ['b', false], ['c', null]]);

    const tooMany = await fetch(`${base}/probe`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ targets: [{}, {}, {}, {}] })
    });
    assert.equal(tooMany.status, 400);
    const bad = await fetch(`${base}/probe`, { method: 'POST', headers: auth, body: '{nope' });
    assert.equal(bad.status, 400);
  } finally {
    srv.close();
  }
});

test('icmp: runs ping without a shell, parses the reply time, reports no-reply as down', async (t) => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodex-ping-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const argsFile = path.join(dir, 'args');
  const write = (name, body) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\n${body}\n`, { mode: 0o755 });
    return p;
  };
  const okPing = write('ping-ok', `echo '64 bytes from 10.0.0.5: icmp_seq=1 ttl=64 time=0.42 ms'; exit 0`);
  const r = await probeTarget({ address: '10.0.0.5', check: 'icmp' }, { pingPath: okPing, timeoutMs: 2000 });
  assert.equal(r.up, true);
  assert.equal(r.latencyMs, 0.4);
  const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
  assert.equal(args.at(-1), '10.0.0.5'); // address is the last, separate argument
  assert.ok(args.includes('-c') && args.includes('1'));

  const noReply = write('ping-down', `echo '1 packets transmitted, 0 received'; exit 1`);
  const d = await probeTarget({ address: '10.0.0.6', check: 'icmp' }, { pingPath: noReply, timeoutMs: 1000 });
  assert.equal(d.up, false);
  assert.equal(d.error, 'No reply');

  const denied = write('ping-eperm', `echo 'ping: socket: Operation not permitted' >&2; exit 2`);
  const e = await probeTarget({ address: '10.0.0.7', check: 'icmp' }, { pingPath: denied, timeoutMs: 1000 });
  assert.equal(e.up, null);

  const noV6 = write('ping-nov6', `echo 'ping: socket: Address family not supported by protocol' >&2; exit 2`);
  const v6 = await probeTarget({ address: 'fd00::5', check: 'icmp' }, { pingPath: noV6, timeoutMs: 1000 });
  assert.equal(v6.up, null);
  assert.match(v6.error, /IPv6/);
  assert.ok(fs.readFileSync(argsFile, 'utf8').includes('-6'));
});
