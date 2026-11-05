// Nodex graph analysis — availability semantics, outage simulation, and
// per-channel traffic tracing. Pure functions over a diagram
// ({ nodes, zones, connections, channels }); nothing here touches React.
//
// Model
// -----
// Entities are keyed `n:<id>` (node) and `z:<id>` (zone); connections are
// `c:<id>`. Failures are a Set of those keys.
//
// • Zone membership is spatial: a node belongs to every zone whose cells it
//   sits on. Failing a zone takes down everything on it.
// • zone.policy = { mode, min, primaryId } decides when a zone (as a
//   service) is available — see ZONE_POLICIES.
// • Connections default to *traffic* links (from → to, or reversed when only
//   the start end carries an arrowhead). `required: true` makes the target a
//   hard dependency of the source.
// • `kind: 'peer'` connections carry no traffic; they bind entities into
//   clusters (connected components) whose `peerMode` adds failover (peers
//   assume a failed member's address/role) and/or quorum (members stop
//   serving without a strict majority — partitions included).
// • node.role === 'vip' marks a floating virtual IP: it has no capacity of
//   its own and is held by one healthy failover peer at a time.
//
// Channels are analysed as flows over the subgraph of connections carrying
// them. Zones expand into entry → members → exit vertices so traffic aimed
// at a zone is spread across (or failed over between) its members.

export const nodeKey = (id) => `n:${id}`;
export const zoneKey = (id) => `z:${id}`;
export const connKey = (id) => `c:${id}`;
export const entityKey = (id, type) => (type === 'zone' ? zoneKey(id) : nodeKey(id));

export const ZONE_POLICIES = [
  { id: 'pool', label: 'Redundant pool', help: 'Replicas behind a load balancer — available while any member is up.' },
  { id: 'failover', label: 'Active / standby', help: 'One active member serves traffic; a standby takes over when it fails.' },
  { id: 'quorum', label: 'Quorum', help: 'Consensus group — needs a strict majority up, otherwise every member stops serving.' },
  { id: 'min', label: 'At least N', help: 'Needs a minimum number of healthy members to carry the load.' },
  { id: 'all', label: 'All required', help: 'Every member is required (shards, no redundancy).' }
];

export const PEER_MODES = [
  { id: 'failover', label: 'Failover', help: 'Peers take over a failed member’s address and role (keepalived / VRRP, floating VIP).' },
  { id: 'quorum', label: 'Quorum', help: 'Members stop serving when they can’t see a majority of the cluster (Galera, etcd, Raft).' },
  { id: 'both', label: 'Failover + quorum', help: 'Leader election inside a consensus cluster (Patroni, Swarm managers).' },
  { id: 'replica', label: 'Replication', help: 'Data replication only — losing peers reduces redundancy, nothing fails over.' }
];

// Pointer style for each end of a connection: 'none' | 'arrow' | 'open' |
// 'circle' | 'diamond'. Falls back to the legacy arrowHead/arrowStyle pair
// (whose default was a filled arrow on the target end).
export const getConnEndStyles = (conn) => {
  if (conn.startStyle !== undefined || conn.endStyle !== undefined) {
    return { start: conn.startStyle || 'none', end: conn.endStyle || 'none' };
  }
  const style = conn.arrowStyle || 'arrow';
  const head = conn.arrowHead || 'end';
  return {
    start: head === 'start' || head === 'both' ? style : 'none',
    end: head === 'end' || head === 'both' ? style : 'none'
  };
};

const isArrowHead = (s) => s === 'arrow' || s === 'open';

// Traffic runs from → to, unless only the start end shows an arrowhead
export const connFlowReversed = (conn) => {
  const st = getConnEndStyles(conn);
  return isArrowHead(st.start) && !isArrowHead(st.end);
};

export const getZonePolicy = (zone) => {
  const p = zone?.policy || {};
  return {
    mode: p.mode || 'pool',
    min: Math.max(1, parseInt(p.min, 10) || 1),
    primaryId: p.primaryId ?? null
  };
};

// Nodes sitting on each zone's cells (and the reverse lookup)
export const computeMembership = (nodes, zones) => {
  const cellZones = new Map();
  zones.forEach(z => z.cells.forEach(c => {
    const k = `${c.q},${c.r}`;
    if (!cellZones.has(k)) cellZones.set(k, new Set());
    cellZones.get(k).add(z.id);
  }));
  const zoneMembers = new Map(zones.map(z => [z.id, []]));
  const nodeZones = new Map();
  nodes.forEach(n => {
    const zs = [...(cellZones.get(`${n.q},${n.r}`) || [])];
    nodeZones.set(n.id, zs);
    zs.forEach(zid => zoneMembers.get(zid).push(n.id));
  });
  return { zoneMembers, nodeZones };
};

const pushTo = (map, key, value) => {
  let list = map.get(key);
  if (!list) map.set(key, (list = []));
  list.push(value);
};

const bfs = (starts, next) => {
  const seen = new Set(starts);
  const stack = [...starts];
  while (stack.length) {
    const v = stack.pop();
    for (const w of next(v)) {
      if (!seen.has(w)) {
        seen.add(w);
        stack.push(w);
      }
    }
  }
  return seen;
};

// Flow-graph vertex → the entity it stands for (`zi:`/`zo:` are a zone's
// entry and exit sides)
export const vertexEntity = (v) =>
  v.startsWith('zi:') || v.startsWith('zo:') ? `z:${v.slice(3)}` : v;

// ---------------------------------------------------------------------------
// Model: everything derived from the diagram alone, shared by every
// simulation run (baseline, current, and the single-point-of-failure scan)
// ---------------------------------------------------------------------------
export const buildModel = (diagram) => {
  const nodes = diagram?.nodes || [];
  const zones = diagram?.zones || [];
  const connections = diagram?.connections || [];
  const channels = diagram?.channels || [];

  const entities = new Map();
  const order = new Map();
  nodes.forEach((n, i) => {
    entities.set(nodeKey(n.id), { type: 'node', id: n.id, obj: n });
    order.set(nodeKey(n.id), i);
  });
  zones.forEach((z, i) => {
    entities.set(zoneKey(z.id), { type: 'zone', id: z.id, obj: z });
    order.set(zoneKey(z.id), nodes.length + i);
  });

  const { zoneMembers, nodeZones } = computeMembership(nodes, zones);

  const label = (key) => {
    const e = entities.get(key);
    if (e) return e.obj.label || (e.type === 'zone' ? 'Unnamed zone' : 'Unnamed node');
    if (key.startsWith('c:')) return connLabel(key.slice(2));
    return key;
  };

  const connById = new Map(connections.map(c => [String(c.id), c]));
  const connLabel = (id) => {
    const c = connById.get(String(id));
    if (!c) return 'link';
    if (c.label) return c.label;
    const a = label(entityKey(c.from, c.fromType || 'node'));
    const b = label(entityKey(c.to, c.toType || 'node'));
    return `${a} → ${b}`;
  };

  const isVip = (key) => entities.get(key)?.obj.role === 'vip';

  const traffic = [];
  const peerLinks = [];
  connections.forEach(c => {
    const fk = entityKey(c.from, c.fromType || 'node');
    const tk = entityKey(c.to, c.toType || 'node');
    if (!entities.has(fk) || !entities.has(tk) || fk === tk) return;
    if (c.kind === 'peer') {
      peerLinks.push({ id: c.id, a: fk, b: tk, mode: c.peerMode || 'failover' });
      return;
    }
    const rev = connFlowReversed(c);
    traffic.push({
      id: c.id,
      srcKey: rev ? tk : fk,
      dstKey: rev ? fk : tk,
      required: !!c.required,
      channelIds: new Set(c.channelIds || [])
    });
  });

  const outgoing = new Map();
  traffic.forEach(t => pushTo(outgoing, t.srcKey, t));

  // A node also forwards through the zones it sits on, so a zone-level
  // channel link counts as one of its routes
  const nodeChannelRoutes = new Map();
  nodes.forEach(n => {
    const routes = (outgoing.get(nodeKey(n.id)) || []).filter(t => t.channelIds.size > 0);
    (nodeZones.get(n.id) || []).forEach(zid => {
      (outgoing.get(zoneKey(zid)) || []).forEach(t => {
        if (t.channelIds.size > 0) routes.push(t);
      });
    });
    nodeChannelRoutes.set(n.id, routes);
  });

  // Peer clusters: connected components over peer links (union–find)
  const parent = new Map();
  const find = (k) => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  };
  peerLinks.forEach(l => {
    [l.a, l.b].forEach(k => { if (!parent.has(k)) parent.set(k, k); });
    const ra = find(l.a);
    const rb = find(l.b);
    if (ra !== rb) parent.set(ra, rb);
  });
  const clusterByRoot = new Map();
  [...parent.keys()].forEach(k => {
    const root = find(k);
    if (!clusterByRoot.has(root)) {
      clusterByRoot.set(root, { id: root, members: [], links: [], failover: false, quorum: false });
    }
    clusterByRoot.get(root).members.push(k);
  });
  peerLinks.forEach(l => {
    const cl = clusterByRoot.get(find(l.a));
    cl.links.push(l);
    if (l.mode === 'failover' || l.mode === 'both') cl.failover = true;
    if (l.mode === 'quorum' || l.mode === 'both') cl.quorum = true;
  });
  const clusters = [...clusterByRoot.values()];
  clusters.forEach(cl => {
    cl.members.sort((a, b) => order.get(a) - order.get(b));
    // VIPs are addresses, not capacity — they never vote or hold
    cl.servers = cl.members.filter(k => !isVip(k));
  });
  const clusterOf = new Map();
  clusters.forEach(cl => cl.members.forEach(k => clusterOf.set(k, cl)));

  return {
    nodes,
    zones,
    connections,
    channels,
    entities,
    order,
    zoneMembers,
    nodeZones,
    traffic,
    peerLinks,
    outgoing,
    nodeChannelRoutes,
    clusters,
    clusterOf,
    isVip,
    label,
    connLabel
  };
};

// ---------------------------------------------------------------------------
// Core: entity health under a set of failures, then every channel's flow
// ---------------------------------------------------------------------------
const analyzeCore = (M, failures) => {
  const isFailed = (k) => failures.has(k);
  const connFailed = (id) => isFailed(connKey(id));

  const down = new Map(); // key → first reason it went down
  let changed = true;
  const markDown = (k, reason) => {
    if (!down.has(k)) {
      down.set(k, reason);
      changed = true;
    }
  };

  // Injected failures
  M.nodes.forEach(n => {
    if (isFailed(nodeKey(n.id))) markDown(nodeKey(n.id), 'Failed (simulated outage)');
  });
  M.zones.forEach(z => {
    const zk = zoneKey(z.id);
    if (!isFailed(zk)) return;
    markDown(zk, 'Failed (simulated outage)');
    M.zoneMembers.get(z.id).forEach(nid =>
      markDown(nodeKey(nid), `Inside failed zone “${M.label(zk)}”`)
    );
  });

  // Coverage: a failed member of a failover cluster keeps "existing" for
  // its consumers — a healthy peer has taken over its address and role
  let coveredBy = new Map();
  let vipHolder = new Map();
  const alive = (k) => !down.has(k) || coveredBy.has(k);

  const computeCoverage = () => {
    coveredBy = new Map();
    vipHolder = new Map();
    M.clusters.forEach(cl => {
      if (!cl.failover) return;
      const healthy = cl.servers.filter(k => !down.has(k));
      if (healthy.length === 0) return;
      cl.members.forEach(k => {
        if (M.isVip(k)) {
          if (!down.has(k)) vipHolder.set(k, healthy[0]);
        } else if (down.has(k)) {
          coveredBy.set(k, healthy[0]);
        }
      });
    });
  };

  const zoneHealthyCount = (zid) =>
    M.zoneMembers.get(zid).filter(nid => !down.has(nodeKey(nid))).length;

  // Fixpoint: `down` only ever grows, so this terminates
  let guard = 0;
  while (changed && guard++ < 500) {
    changed = false;
    computeCoverage();

    // Floating VIPs need a live peer to hold the address
    M.nodes.forEach(n => {
      const k = nodeKey(n.id);
      if (!M.isVip(k) || down.has(k)) return;
      const cl = M.clusterOf.get(k);
      if (cl && cl.failover && !vipHolder.has(k)) markDown(k, 'No peer left to hold the VIP');
    });

    // Quorum clusters: each partition (connected by live peer links) needs
    // a strict majority of the full membership to keep serving
    M.clusters.forEach(cl => {
      if (!cl.quorum) return;
      const n = cl.servers.length;
      const up = cl.servers.filter(k => !down.has(k));
      if (up.length === 0) return;
      const upSet = new Set(up);
      const adj = new Map();
      cl.links.forEach(l => {
        if (connFailed(l.id) || !upSet.has(l.a) || !upSet.has(l.b)) return;
        pushTo(adj, l.a, l.b);
        pushTo(adj, l.b, l.a);
      });
      const seen = new Set();
      up.forEach(start => {
        if (seen.has(start)) return;
        const part = bfs([start], v => adj.get(v) || []);
        part.forEach(v => seen.add(v));
        if (part.size * 2 > n) return;
        const reason = part.size === up.length
          ? `Cluster lost quorum (${part.size}/${n} up)`
          : `Partitioned from the cluster majority (sees ${part.size}/${n})`;
        part.forEach(k => markDown(k, reason));
      });
    });

    // Zone availability policies
    M.zones.forEach(z => {
      const zk = zoneKey(z.id);
      if (down.has(zk)) return;
      const members = M.zoneMembers.get(z.id);
      const n = members.length;
      if (n === 0) return;
      const up = zoneHealthyCount(z.id);
      const pol = getZonePolicy(z);
      let reason = null;
      if (pol.mode === 'all' && up < n) reason = `Requires every member (${up}/${n} up)`;
      else if (pol.mode === 'quorum' && up * 2 <= n) reason = `Lost quorum (${up}/${n} up)`;
      else if (pol.mode === 'min' && up < Math.min(pol.min, n)) reason = `Below minimum capacity (${up}/${Math.min(pol.min, n)} needed)`;
      else if (up === 0) reason = 'No members left';
      if (!reason) return;
      markDown(zk, reason);
      if (pol.mode === 'quorum') {
        members.forEach(nid => markDown(nodeKey(nid), `Zone “${M.label(zk)}” lost quorum`));
      }
    });

    // Hard dependencies
    M.traffic.forEach(t => {
      if (!t.required || down.has(t.srcKey)) return;
      let reason = null;
      if (connFailed(t.id)) reason = `Required link to ${M.label(t.dstKey)} failed`;
      else if (!alive(t.dstKey)) reason = `Requires ${M.label(t.dstKey)}, which is unavailable`;
      if (!reason) return;
      markDown(t.srcKey, reason);
      // A zone's dependency is shared by everything running in it
      if (t.srcKey.startsWith('z:')) {
        const zid = M.entities.get(t.srcKey).id;
        M.zoneMembers.get(zid).forEach(nid => markDown(nodeKey(nid), reason));
      }
    });

    // A node that can no longer forward any of its traffic is unavailable
    // (an LB with no backends answers 503). Only channel routes count —
    // unclassified links (monitoring, management) never cascade.
    M.nodes.forEach(n => {
      const k = nodeKey(n.id);
      if (down.has(k)) return;
      const routes = M.nodeChannelRoutes.get(n.id);
      if (routes.length === 0) return;
      if (routes.every(t => connFailed(t.id) || !alive(t.dstKey))) {
        markDown(k, 'No healthy downstream — can’t serve any traffic');
      }
    });
  }
  computeCoverage();

  // Active member of each active/standby zone
  const zoneActive = new Map();
  const zonePrimary = new Map();
  M.zones.forEach(z => {
    const pol = getZonePolicy(z);
    if (pol.mode !== 'failover') return;
    const members = M.zoneMembers.get(z.id);
    if (members.length === 0) return;
    const primary = members.includes(pol.primaryId) ? pol.primaryId : members[0];
    zonePrimary.set(z.id, primary);
    const active = !down.has(nodeKey(primary))
      ? primary
      : members.find(nid => !down.has(nodeKey(nid)));
    if (active != null) zoneActive.set(z.id, active);
  });

  // Degradation — still serving, but with reduced redundancy
  const degraded = new Map();
  const addDeg = (k, reason) => {
    if (down.has(k)) return;
    pushTo(degraded, k, reason);
  };

  M.clusters.forEach(cl => {
    const n = cl.servers.length;
    const up = cl.servers.filter(k => !down.has(k)).length;
    if (up === n || up === 0) return;
    cl.servers.forEach(k => {
      if (down.has(k)) return;
      addDeg(k, `Cluster at ${up}/${n} — redundancy reduced`);
      if (cl.quorum && (up - 1) * 2 <= n) addDeg(k, 'One more failure loses quorum');
    });
  });
  coveredBy.forEach((holder, k) => addDeg(holder, `Took over for ${M.label(k)}`));
  vipHolder.forEach((holder, vip) => {
    const cl = M.clusterOf.get(vip);
    if (cl.servers[0] !== holder) addDeg(vip, `VIP moved to ${M.label(holder)}`);
    const up = cl.servers.filter(k => !down.has(k)).length;
    if (up < cl.servers.length) addDeg(vip, `${up}/${cl.servers.length} peers can hold it`);
  });
  M.zones.forEach(z => {
    const zk = zoneKey(z.id);
    if (down.has(zk)) return;
    const n = M.zoneMembers.get(z.id).length;
    const up = zoneHealthyCount(z.id);
    if (n > 0 && up < n) addDeg(zk, `${up}/${n} members up`);
    const pol = getZonePolicy(z);
    if (pol.mode === 'min' && n > pol.min && up === pol.min) addDeg(zk, 'At minimum capacity');
    if (pol.mode === 'quorum' && n > 0 && up < n && (up - 1) * 2 <= n) addDeg(zk, 'One more failure loses quorum');
    const active = zoneActive.get(z.id);
    if (active != null && active !== zonePrimary.get(z.id)) {
      addDeg(zk, `Failed over to ${M.label(nodeKey(active))}`);
    }
    (M.outgoing.get(zk) || []).forEach(t => {
      if (connFailed(t.id) || !alive(t.dstKey)) addDeg(zk, `Lost link to ${M.label(t.dstKey)}`);
    });
  });
  M.nodes.forEach(n => {
    const k = nodeKey(n.id);
    if (down.has(k)) return;
    const routes = M.nodeChannelRoutes.get(n.id);
    const lost = routes.filter(t => connFailed(t.id) || !alive(t.dstKey));
    if (lost.length > 0) {
      const names = [...new Set(lost.map(t => M.label(t.dstKey)))];
      addDeg(k, `Lost ${lost.length}/${routes.length} traffic routes (${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''})`);
    }
    (M.outgoing.get(k) || []).forEach(t => {
      if (t.channelIds.size > 0 || t.required) return;
      if (connFailed(t.id) || !alive(t.dstKey)) addDeg(k, `Lost link to ${M.label(t.dstKey)}`);
    });
  });

  // Per-entity summary
  const entities = new Map();
  M.entities.forEach((_, k) => {
    const isDown = down.has(k);
    entities.set(k, {
      status: isDown ? 'down' : degraded.has(k) ? 'degraded' : 'healthy',
      failed: isFailed(k),
      reasons: isDown ? [down.get(k)] : (degraded.get(k) || []),
      coveredBy: coveredBy.get(k) || null,
      holder: vipHolder.get(k) || null
    });
  });

  // Per-connection status
  const conns = new Map();
  M.traffic.forEach(t => {
    let status = 'ok';
    let reason = null;
    if (connFailed(t.id)) { status = 'failed'; reason = 'Link failed (simulated outage)'; }
    else if (!alive(t.srcKey)) { status = 'down'; reason = `${M.label(t.srcKey)} is unavailable`; }
    else if (!alive(t.dstKey)) { status = 'down'; reason = `${M.label(t.dstKey)} is unavailable`; }
    conns.set(t.id, { status, reason, kind: 'traffic' });
  });
  M.peerLinks.forEach(l => {
    let status = 'ok';
    let reason = null;
    if (connFailed(l.id)) { status = 'failed'; reason = 'Peer link failed (simulated outage)'; }
    else if (down.has(l.a) || down.has(l.b)) { status = 'down'; reason = 'A peer is down'; }
    conns.set(l.id, { status, reason, kind: 'peer' });
  });

  // Failover arcs to draw: covered → holder, VIP → holder, standby promotion
  const failovers = [];
  coveredBy.forEach((holder, k) => failovers.push({ from: k, to: holder, kind: 'failover' }));
  vipHolder.forEach((holder, vip) => failovers.push({ from: vip, to: holder, kind: 'vip' }));
  zoneActive.forEach((active, zid) => {
    const primary = zonePrimary.get(zid);
    if (active !== primary) failovers.push({ from: nodeKey(primary), to: nodeKey(active), kind: 'standby' });
  });

  const ctx = { alive, connFailed, zoneActive, vipHolder, coveredBy };
  const flows = new Map();
  M.channels.forEach(ch => {
    const flow = buildFlow(M, ch, ctx);
    if (flow) flows.set(ch.id, flow);
  });

  const counts = countStatuses(M, entities);

  return { failures, entities, conns, failovers, flows, counts, alive, coveredBy, vipHolder, zoneActive };
};

const STATE_RANK = { dead: 0, stranded: 1, standby: 2, active: 3 };

// One channel's flow graph, sources/sinks, and the state of every hop
const buildFlow = (M, ch, ctx) => {
  const { alive, connFailed, zoneActive, vipHolder, coveredBy } = ctx;
  const chTraffic = M.traffic.filter(t => t.channelIds.has(ch.id));
  if (chTraffic.length === 0) return null;

  const isZone = (k) => k.startsWith('z:');
  const zid = (k) => M.entities.get(k).id;
  const members = (k) => M.zoneMembers.get(zid(k)) || [];
  // Zones with members split into entry/exit sides; empty zones are a
  // single vertex like a node
  const vIn = (k) => (isZone(k) && members(k).length ? `zi:${zid(k)}` : k);
  const vOut = (k) => (isZone(k) && members(k).length ? `zo:${zid(k)}` : k);

  // A failed member covered by a failover peer still answers on its
  // address (incoming links work), but the holder does the forwarding
  // with its own links — unless it has none for this channel, in which
  // case it inherits the failed member's routes
  const hasRoutes = new Set(chTraffic.map(t => t.srcKey));
  const canSend = (k) => {
    if (!alive(k)) return false;
    const holder = coveredBy.get(k);
    return !holder || !hasRoutes.has(holder);
  };

  const edges = [];
  const zonesIn = new Set();
  const zonesOut = new Set();
  chTraffic.forEach(t => {
    edges.push({
      from: vOut(t.srcKey),
      to: vIn(t.dstKey),
      connId: t.id,
      kind: 'conn',
      usable: !connFailed(t.id) && canSend(t.srcKey) && alive(t.dstKey),
      standby: false
    });
    if (isZone(t.srcKey)) zonesOut.add(t.srcKey);
    if (isZone(t.dstKey)) zonesIn.add(t.dstKey);
  });

  // Failover peers of anything on this flow are standbys for it. The hand-
  // off edge goes live while the member is covered by that peer: a zone
  // (DR site) always hands its traffic over; a node only when the holder
  // has its own routes for this channel (otherwise it inherits them)
  const onFlow = new Set();
  chTraffic.forEach(t => { onFlow.add(t.srcKey); onFlow.add(t.dstKey); });
  [...zonesIn, ...zonesOut].forEach(zk => members(zk).forEach(nid => onFlow.add(nodeKey(nid))));
  M.clusters.forEach(cl => {
    if (!cl.failover) return;
    cl.servers.forEach(k => {
      if (!onFlow.has(k)) return;
      cl.servers.forEach(p => {
        if (p === k) return;
        const covered = coveredBy.get(k) === p;
        const live = covered && (isZone(p) || hasRoutes.has(p));
        if (isZone(p) && covered) zonesIn.add(p);
        edges.push({
          from: vIn(k),
          to: vIn(p),
          kind: 'failover',
          usable: alive(k) && alive(p),
          standby: !live
        });
      });
    });
  });

  zonesIn.forEach(zk => {
    const ms = members(zk);
    if (ms.length === 0) return;
    const active = zoneActive.get(zid(zk));
    ms.forEach(nid => edges.push({
      from: vIn(zk),
      to: nodeKey(nid),
      kind: 'member',
      usable: alive(zk) && alive(nodeKey(nid)),
      standby: active != null && active !== nid
    }));
  });
  zonesOut.forEach(zk => {
    const ms = members(zk);
    if (ms.length === 0) return;
    const active = zoneActive.get(zid(zk));
    ms.forEach(nid => edges.push({
      from: nodeKey(nid),
      to: vOut(zk),
      kind: 'member',
      usable: alive(zk) && canSend(nodeKey(nid)),
      standby: active != null && active !== nid
    }));
  });

  // Floating VIPs hand traffic to whichever peer holds them; the other
  // peers are structurally on the path but on standby
  const present = new Set();
  edges.forEach(e => { present.add(e.from); present.add(e.to); });
  [...present].forEach(v => {
    if (!v.startsWith('n:') || !M.isVip(v)) return;
    const cl = M.clusterOf.get(v);
    if (!cl || !cl.failover) return;
    const holder = vipHolder.get(v);
    cl.servers.filter(k => k.startsWith('n:')).forEach(p => edges.push({
      from: v,
      to: p,
      kind: 'vip',
      usable: alive(v) && alive(p),
      standby: holder !== p
    }));
  });

  const V = new Set();
  const outIdx = new Map();
  const inIdx = new Map();
  edges.forEach((e, i) => {
    V.add(e.from);
    V.add(e.to);
    pushTo(outIdx, e.from, i);
    pushTo(inIdx, e.to, i);
  });

  const isReal = (v) => v.startsWith('n:') || v.startsWith('z:');
  const directOut = new Set(edges.filter(e => e.kind === 'conn').map(e => e.from));
  let sources = [...V].filter(v => isReal(v) && !inIdx.has(v) && directOut.has(v));
  // A zone of clients: members feed the zone's links and nothing feeds them
  zonesOut.forEach(zk => {
    const ms = members(zk);
    if (ms.length === 0 || zonesIn.has(zk)) return;
    if (ms.every(nid => !inIdx.has(nodeKey(nid)))) ms.forEach(nid => sources.push(nodeKey(nid)));
  });
  sources = [...new Set(sources)];
  const cyclic = sources.length === 0;
  if (cyclic) sources = [...directOut].filter(isReal);
  // Hand-off edges don't make a destination stop being one
  const forwards = (v) => (outIdx.get(v) || []).some(i => edges[i].kind !== 'failover');
  const fedBy = (v) => (inIdx.get(v) || []).some(i => edges[i].kind !== 'failover');
  const sinks = [...V].filter(v => isReal(v) && !forwards(v) && fedBy(v));

  const outOf = (v, pred) => (outIdx.get(v) || []).filter(i => pred(edges[i])).map(i => edges[i].to);
  const inOf = (v, pred) => (inIdx.get(v) || []).filter(i => pred(edges[i])).map(i => edges[i].from);

  // Structure: everything on some source → sink path (failure-independent
  // except for failover edges, which only exist while failed over)
  const all = () => true;
  const fwdAll = bfs(sources, v => outOf(v, all));
  const bwdAll = sinks.length ? bfs(sinks, v => inOf(v, all)) : fwdAll;
  const onPath = new Set([...V].filter(v => fwdAll.has(v) && bwdAll.has(v)));

  // Live traffic
  const vAlive = (v) => alive(vertexEntity(v));
  const live = (e) => e.usable && !e.standby;
  const fwd = bfs(sources.filter(vAlive), v => outOf(v, live));
  const bwd = bfs(sinks.filter(vAlive), v => inOf(v, live));

  const edgeState = edges.map(e => {
    if (!e.usable) return 'dead';
    if (e.standby) return 'standby';
    return fwd.has(e.from) && bwd.has(e.to) ? 'active' : 'stranded';
  });

  const vertexState = new Map();
  V.forEach(v => {
    let s;
    if (!vAlive(v)) s = 'dead';
    else if (fwd.has(v) && bwd.has(v)) s = 'active';
    else if ((inIdx.get(v) || []).some(i => edgeState[i] === 'standby')) s = 'standby';
    else s = 'stranded';
    vertexState.set(v, s);
  });

  // Best state per entity (a zone has up to two vertices)
  const entityState = new Map();
  vertexState.forEach((s, v) => {
    if (!onPath.has(v)) return;
    const k = vertexEntity(v);
    const prev = entityState.get(k);
    if (!prev || STATE_RANK[s] > STATE_RANK[prev]) entityState.set(k, s);
  });

  const connState = new Map();
  const connOnPath = new Set();
  edges.forEach((e, i) => {
    if (e.kind !== 'conn') return;
    connState.set(e.connId, edgeState[i]);
    if (onPath.has(e.from) && onPath.has(e.to)) connOnPath.add(e.connId);
  });

  // Which sinks each source can still reach
  const reach = new Map();
  sources.forEach(s => {
    if (!vAlive(s)) {
      reach.set(s, new Set());
      return;
    }
    const seen = bfs([s], v => outOf(v, live));
    reach.set(s, new Set(sinks.filter(k => seen.has(k) && vAlive(k))));
  });
  let pairs = 0;
  reach.forEach(set => { pairs += set.size; });

  const activeConns = [...connState.values()].filter(s => s === 'active').length;

  return {
    channelId: ch.id,
    edges,
    edgeState,
    outIdx,
    inIdx,
    sources,
    sinks,
    cyclic,
    onPath,
    connOnPath,
    vertexState,
    entityState,
    connState,
    reach,
    pairs,
    activeConns
  };
};

// Stages of a flow, source → sink: entity keys grouped by hop distance.
// A zone's exit side is free (traffic leaves through the members that
// were already counted), so zone → members → onward reads naturally.
export const flowStages = (flow) => {
  if (!flow) return [];
  const dist = new Map();
  const deque = [];
  flow.sources.forEach(s => {
    if (!flow.onPath.has(s)) return;
    dist.set(s, 0);
    deque.push(s);
  });
  while (deque.length) {
    const v = deque.shift();
    (flow.outIdx.get(v) || []).forEach(i => {
      const w = flow.edges[i].to;
      if (!flow.onPath.has(w)) return;
      // Standby failover peers aren't a hop until they take over
      if (flow.edges[i].kind === 'failover' && flow.edgeState[i] !== 'active') return;
      const cost = w.startsWith('zo:') ? 0 : 1;
      const d = dist.get(v) + cost;
      if (!dist.has(w) || d < dist.get(w)) {
        dist.set(w, d);
        if (cost === 0) deque.unshift(w); else deque.push(w);
      }
    });
  }
  const byEntity = new Map();
  dist.forEach((d, v) => {
    if (v.startsWith('zo:')) return;
    const k = vertexEntity(v);
    if (!byEntity.has(k) || d < byEntity.get(k)) byEntity.set(k, d);
  });
  const stages = [];
  byEntity.forEach((d, k) => {
    if (!stages[d]) stages[d] = [];
    stages[d].push(k);
  });
  return stages.filter(Boolean);
};

// Everything upstream and downstream of one entity within a flow — the
// paths that actually pass through it
export const traceThrough = (flow, entity) => {
  if (!flow) return null;
  const starts = [...flow.onPath].filter(v => vertexEntity(v) === entity);
  if (starts.length === 0) return null;
  const fwd = bfs(starts, v => (flow.outIdx.get(v) || [])
    .map(i => flow.edges[i].to).filter(w => flow.onPath.has(w)));
  const bwd = bfs(starts, v => (flow.inIdx.get(v) || [])
    .map(i => flow.edges[i].from).filter(w => flow.onPath.has(w)));
  const vertices = new Set([...fwd, ...bwd]);
  const conns = new Set();
  flow.edges.forEach(e => {
    if (e.kind !== 'conn') return;
    if ((fwd.has(e.from) && fwd.has(e.to)) || (bwd.has(e.from) && bwd.has(e.to))) conns.add(e.connId);
  });
  return { entities: new Set([...vertices].map(vertexEntity)), conns };
};

// ---------------------------------------------------------------------------
// Channel impact: compare the current flow against the failure-free one
// ---------------------------------------------------------------------------
const summarizeChannel = (M, ch, base, cur) => {
  const bf = base.flows.get(ch.id);
  const cf = cur.flows.get(ch.id);
  if (!bf || !cf) {
    return { channelId: ch.id, status: 'unused', headline: 'Not on any connection', notes: [] };
  }

  const notes = [];
  const label = M.label;
  const sinkNames = (keys) => [...new Set(keys.map(vertexEntity))].map(label);

  if (bf.pairs === 0) {
    return {
      channelId: ch.id,
      status: 'broken',
      headline: bf.cyclic ? 'Circular — no clear entry point' : 'No complete route from entry to destination',
      notes: [],
      sources: bf.sources.length,
      sinks: bf.sinks.length
    };
  }

  let lostPairs = 0;
  const cutOff = [];
  const lostSinks = new Set();
  bf.reach.forEach((sinks, s) => {
    const now = cf.reach.get(s) || new Set();
    sinks.forEach(k => {
      if (!now.has(k)) {
        lostPairs++;
        lostSinks.add(k);
      }
    });
    if (sinks.size > 0 && now.size === 0) cutOff.push(s);
  });
  // Sinks nobody reaches any more (vs. lost for only some sources)
  const reachedNow = new Set();
  cf.reach.forEach(set => set.forEach(k => reachedNow.add(k)));
  const unreachable = [...lostSinks].filter(k => !reachedNow.has(k));

  if (cutOff.length) {
    notes.push({ tone: 'down', text: `Cut off: ${sinkNames(cutOff).join(', ')}` });
  }
  if (unreachable.length) {
    notes.push({ tone: 'down', text: `Can’t reach ${sinkNames(unreachable).join(', ')}` });
  }

  // Hops that carried traffic before and are dead now — and what the
  // traffic does instead. Root causes (injected failures, quorum loss…)
  // come first; nodes that merely lost their downstream are summarized.
  const deadEntities = [];
  bf.entityState.forEach((st, k) => {
    if (st === 'active' && cf.entityState.get(k) === 'dead') deadEntities.push(k);
  });
  const isCascade = (k) => /^No healthy downstream|^No members left/.test(cur.entities.get(k)?.reasons[0] || '');
  const rank = (k) => (cur.failures.has(k) ? 0 : isCascade(k) ? 2 : 1);
  deadEntities.sort((a, b) => rank(a) - rank(b));
  let cascaded = 0;
  let shown = 0;
  deadEntities.forEach(k => {
    if (rank(k) === 2) {
      cascaded++;
      return;
    }
    const alts = new Set();
    bf.edges.forEach((e, i) => {
      if (vertexEntity(e.to) !== k || bf.edgeState[i] !== 'active') return;
      (cf.outIdx.get(e.from) || []).forEach(j => {
        if (cf.edgeState[j] !== 'active' || cf.edges[j].kind === 'failover') return;
        const target = vertexEntity(cf.edges[j].to);
        if (target !== k) alts.add(target);
      });
    });
    if (shown++ >= 4) return;
    if (alts.size) {
      notes.push({ tone: 'reroute', text: `${label(k)} down → rerouted via ${[...alts].map(label).join(', ')}` });
    } else {
      notes.push({ tone: 'down', text: `${label(k)} down — no alternative path` });
    }
  });
  if (shown > 4) notes.push({ tone: 'down', text: `…and ${shown - 4} more hops down` });
  if (cascaded) {
    notes.push({ tone: 'down', text: `${cascaded} upstream hop${cascaded > 1 ? 's' : ''} stalled with nowhere to send traffic` });
  }

  // Failovers in use along this flow
  let failoverInUse = false;
  cur.coveredBy.forEach((holder, k) => {
    if (cf.entityState.get(k) === 'active' || bf.entityState.get(k) === 'active') {
      failoverInUse = true;
      notes.push({ tone: 'failover', text: `${label(k)} failed over to ${label(holder)}` });
    }
  });
  cur.vipHolder.forEach((holder, vip) => {
    const was = base.vipHolder.get(vip);
    if (was && was !== holder && cf.onPath.has(vip)) {
      failoverInUse = true;
      notes.push({ tone: 'failover', text: `VIP ${label(vip)} moved ${label(was)} → ${label(holder)}` });
    }
  });
  cur.zoneActive.forEach((active, zid) => {
    const was = base.zoneActive.get(zid);
    const zk = zoneKey(zid);
    if (was != null && was !== active && cf.entityState.has(zk)) {
      failoverInUse = true;
      notes.push({ tone: 'failover', text: `${label(zk)}: standby ${label(nodeKey(active))} promoted` });
    }
  });

  const redundancyLost = cf.activeConns < bf.activeConns;
  let status = 'healthy';
  if (cf.pairs === 0) status = 'down';
  else if (lostPairs > 0 || redundancyLost || failoverInUse || deadEntities.length > 0) status = 'degraded';

  let headline;
  if (status === 'down') headline = 'No route — traffic can’t get through';
  else if (lostPairs > 0) headline = `Partially reachable — ${cf.pairs} of ${bf.pairs} entry → destination routes`;
  else if (redundancyLost) headline = `Rerouted — ${cf.activeConns} of ${bf.activeConns} links still carry traffic`;
  else if (failoverInUse) headline = 'Running on failover';
  else if (status === 'degraded') headline = 'Reachable with reduced redundancy';
  else headline = 'All routes healthy';

  return {
    channelId: ch.id,
    status,
    headline,
    notes,
    sources: bf.sources.length,
    sinks: bf.sinks.length,
    pairs: cf.pairs,
    basePairs: bf.pairs
  };
};

// Entry points (clients: nothing sends traffic to them) are judged by
// their flows rather than their links — a customer whose requests can't
// get through anywhere is cut off even if the next hop is still up
const applyClientImpact = (M, base, cur) => {
  const fed = new Set(M.traffic.map(t => t.dstKey));
  const perClient = new Map();
  base.flows.forEach((bf, chId) => {
    const cf = cur.flows.get(chId);
    if (!cf) return;
    const name = M.channels.find(c => c.id === chId)?.name || 'traffic';
    bf.reach.forEach((sinks, s) => {
      const k = vertexEntity(s);
      if (!k.startsWith('n:') || fed.has(k) || sinks.size === 0) return;
      if (!perClient.has(k)) perClient.set(k, { total: 0, lost: [], partial: [] });
      const rec = perClient.get(k);
      const now = cf.reach.get(s) || new Set();
      rec.total++;
      if (now.size === 0) rec.lost.push(name);
      else if (now.size < sinks.size) rec.partial.push(name);
    });
  });
  perClient.forEach((rec, k) => {
    const e = cur.entities.get(k);
    if (!e || e.status === 'down') return;
    if (rec.lost.length === rec.total) {
      e.status = 'down';
      e.reasons = [`Cut off — ${rec.lost.join(', ')} can’t get through`];
    } else if (rec.lost.length || rec.partial.length) {
      e.status = 'degraded';
      e.reasons = [
        ...e.reasons,
        ...rec.lost.map(n => `${n} can’t get through`),
        ...rec.partial.map(n => `${n} partially reachable`)
      ];
    }
  });

  // Destinations no flow reaches any more are stranded even if they're up
  const lostSinks = new Map();
  base.flows.forEach((bf, chId) => {
    const cf = cur.flows.get(chId);
    if (!cf) return;
    const name = M.channels.find(c => c.id === chId)?.name || 'traffic';
    const reachedBefore = new Set();
    const reachedNow = new Set();
    bf.reach.forEach(set => set.forEach(k => reachedBefore.add(vertexEntity(k))));
    cf.reach.forEach(set => set.forEach(k => reachedNow.add(vertexEntity(k))));
    reachedBefore.forEach(k => {
      if (!reachedNow.has(k)) pushTo(lostSinks, k, name);
    });
  });
  lostSinks.forEach((names, k) => {
    const e = cur.entities.get(k);
    if (!e || e.status === 'down') return;
    e.status = 'degraded';
    e.reasons = [...e.reasons, `Unreachable — no ${names.join(' / ')} traffic arrives`];
  });

  cur.counts = countStatuses(M, cur.entities);
};

// Health tally over every node and zone
const countStatuses = (M, entities) => {
  const counts = { healthy: 0, degraded: 0, down: 0 };
  M.entities.forEach((_, k) => { counts[entities.get(k).status]++; });
  return counts;
};

// Run the whole analysis: failure-free baseline, current state, and a
// per-channel impact summary
export const evaluate = (diagram, failures = new Set()) => {
  const M = buildModel(diagram);
  const base = analyzeCore(M, new Set());
  const cur = failures.size ? analyzeCore(M, failures) : base;
  if (cur !== base) applyClientImpact(M, base, cur);
  const channels = new Map();
  M.channels.forEach(ch => channels.set(ch.id, summarizeChannel(M, ch, base, cur)));
  return { model: M, base, cur, channels };
};

// Which single additional failure would take a channel down (on top of
// the current failures)? Candidates: every live node, zone, and traffic
// link that some channel currently relies on.
export const findSinglePointsOfFailure = (result) => {
  const { model: M, cur } = result;
  const liveFlows = [...cur.flows.values()].filter(f => f.pairs > 0);
  if (liveFlows.length === 0) return [];

  // Entry points (clients) are excluded — losing the customer isn't an
  // infrastructure failure — and so are the links leaving them
  const entries = new Set();
  liveFlows.forEach(f => f.sources.forEach(s => entries.add(vertexEntity(s))));
  // Every component is a candidate — not just hops on a flow: a required
  // dependency (cache, auth) or a peer link (quorum partition) can take a
  // flow down from off the path
  const candidates = new Set();
  M.entities.forEach((_, k) => {
    if (!entries.has(k) && !cur.failures.has(k) && cur.entities.get(k).status !== 'down') candidates.add(k);
  });
  M.connections.forEach(c => {
    const k = connKey(c.id);
    if (cur.failures.has(k)) return;
    const st = cur.conns.get(c.id);
    if (!st || st.status !== 'ok') return;
    const t = M.traffic.find(tt => tt.id === c.id);
    if (t && entries.has(t.srcKey)) return;
    candidates.add(k);
  });

  const out = [];
  candidates.forEach(k => {
    const trial = analyzeCore(M, new Set([...cur.failures, k]));
    const downChannels = [];
    liveFlows.forEach(f => {
      const tf = trial.flows.get(f.channelId);
      if (!tf || tf.pairs === 0) downChannels.push(f.channelId);
    });
    if (downChannels.length) {
      const type = k.startsWith('n:') ? 'node' : k.startsWith('z:') ? 'zone' : 'connection';
      out.push({ key: k, type, label: M.label(k), channels: downChannels });
    }
  });
  const typeRank = { node: 0, connection: 1, zone: 2 };
  out.sort((a, b) =>
    typeRank[a.type] - typeRank[b.type] ||
    b.channels.length - a.channels.length ||
    a.label.localeCompare(b.label)
  );
  return out;
};
