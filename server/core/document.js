// Nodex document operations - the editing model behind the MCP toolkit.
//
// A document is the editor's single-diagram file format:
//   { version: 1, uid, name, diagrams: { root: {...}, 'root/<nodeId>': {...} }, currentPath }
// Every diagram holds { nodes, connections, zones, channels }. Functions here
// mutate a document in place (callers work on a fresh copy and save it), and
// throw DocError with a message meant for whoever made the request.

import { randomUUID } from 'node:crypto';
import { MODEL_IDS } from '../../src/three/modelIds.js';
import { normalizeLink, pathLabel } from '../../src/links.js';
import { getZonePolicy } from '../../src/analysis.js';
import {
  axialToOffset, offsetToAxial, axialToPixel, hexDistance, hexRing,
  hexagonCells, circleCells, rectangleCells, cellKey
} from './geometry.js';

export const ICON_IDS = MODEL_IDS;
export const POINTER_STYLES = ['none', 'arrow', 'open', 'circle', 'diamond'];
export const LINE_TYPES = ['solid', 'dashed', 'dotted', 'dash-dot', 'long-dash'];
export const PEER_MODE_IDS = ['failover', 'quorum', 'both', 'replica'];
export const ZONE_MODES = ['pool', 'failover', 'quorum', 'min', 'all'];
export const LABEL_SIDES = ['center', 'top', 'bottom', 'left', 'right'];
export const CHECKS = ['icmp', 'tcp', 'http', 'https'];

// The editor's palette - new channels and zones cycle through it
export const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4',
  '#ec4899', '#ef4444', '#84cc16', '#6366f1', '#14b8a6',
  '#f97316', '#a855f7', '#22c55e', '#eab308', '#64748b'
];
const DEFAULT_COLOR = '#3b82f6';
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export class DocError extends Error {}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const emptyDiagram = () => ({ nodes: [], connections: [], zones: [], channels: [] });

export const newDocument = (name = 'Untitled') => ({
  version: 1,
  uid: randomUUID(),
  name,
  diagrams: { root: emptyDiagram() },
  currentPath: ['root']
});

const fixDiagram = (d) => ({
  ...d,
  nodes: Array.isArray(d?.nodes) ? d.nodes : [],
  connections: Array.isArray(d?.connections) ? d.connections : [],
  zones: Array.isArray(d?.zones) ? d.zones : [],
  channels: Array.isArray(d?.channels) ? d.channels : []
});

// Accept anything the editor saves as a single diagram; reject the rest
export const normalizeDocument = (data, fallbackName = 'Untitled') => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new DocError('Not a Nodex document');
  if (Array.isArray(data.tabs)) {
    throw new DocError('Project files (several tabs in one file) are not supported here - save each tab as its own diagram');
  }
  if (!data.diagrams || typeof data.diagrams !== 'object' || !data.diagrams.root) {
    throw new DocError('Not a Nodex diagram: missing diagrams.root');
  }
  const diagrams = {};
  Object.entries(data.diagrams).forEach(([key, d]) => {
    if (key === 'root' || key.startsWith('root/')) diagrams[key] = fixDiagram(d);
  });
  const currentPath = Array.isArray(data.currentPath) && data.currentPath[0] === 'root' && diagrams[data.currentPath.join('/')]
    ? data.currentPath
    : ['root'];
  return {
    version: 1,
    uid: typeof data.uid === 'string' && data.uid ? data.uid : randomUUID(),
    name: typeof data.name === 'string' && data.name.trim() ? data.name : fallbackName,
    diagrams,
    currentPath
  };
};

// Ids: the editor mints Date.now()-based ids, so new ids start above both the
// clock and everything already in the document - they can't collide with ids
// the editor hands out later in the same session.
export const idMinter = (doc) => {
  let max = 0;
  Object.values(doc.diagrams).forEach(d => {
    [...d.nodes, ...d.connections, ...d.zones].forEach(x => {
      if (typeof x.id === 'number' && x.id > max) max = x.id;
    });
  });
  let next = Math.max(Date.now(), max + 1);
  return () => next++;
};

// ---------------------------------------------------------------------------
// Diagram paths: ['root', '<nodeId>', ...]. Callers may name levels by node
// label instead of id ("josh-docker/nginx"), or pass 'root/123'.
// ---------------------------------------------------------------------------

const splitPath = (path) => {
  if (path == null || path === '') return [];
  const segs = Array.isArray(path) ? path.map(String) : String(path).split('/');
  const clean = segs.map(s => s.trim()).filter(Boolean);
  return clean[0]?.toLowerCase() === 'root' ? clean.slice(1) : clean;
};

const findNodeIn = (diagram, ref) => {
  const s = String(ref).trim();
  const byId = diagram.nodes.find(n => String(n.id) === s);
  if (byId) return byId;
  const matches = diagram.nodes.filter(n => (n.label || '').trim().toLowerCase() === s.toLowerCase());
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new DocError(`"${s}" matches ${matches.length} nodes (ids ${matches.map(n => n.id).join(', ')}) - use an id`);
  return null;
};

// Resolve to a canonical path. With `create`, a node's nested diagram is
// created on first use (that's how the editor opens a node, too).
export const resolvePath = (doc, path, { create = false } = {}) => {
  const out = ['root'];
  for (const seg of splitPath(path)) {
    const parent = doc.diagrams[out.join('/')];
    const node = parent && findNodeIn(parent, seg);
    if (!node) throw new DocError(`No node "${seg}" in ${pathLabel(doc.diagrams, out)}`);
    if (normalizeLink(node.link)) {
      throw new DocError(`"${node.label}" is a link to another diagram, so it has no nested diagram of its own`);
    }
    out.push(String(node.id));
    const key = out.join('/');
    if (!doc.diagrams[key]) {
      if (!create) throw new DocError(`"${node.label}" has no nested diagram yet - add something to it first`);
      doc.diagrams[key] = emptyDiagram();
    }
  }
  return out;
};

export const diagramAt = (doc, path, opts) => {
  const p = resolvePath(doc, path, opts);
  return { path: p, diagram: doc.diagrams[p.join('/')] };
};

// ---------------------------------------------------------------------------
// References to things inside one diagram
// ---------------------------------------------------------------------------

// A node or zone: an id, an exact label, or "zone:<label>" / "node:<label>"
export const resolveEntity = (diagram, ref, { nodes = true, zones = true } = {}) => {
  let s = String(ref).trim();
  let want = null;
  const m = /^(node|zone):(.*)$/i.exec(s);
  if (m) { want = m[1].toLowerCase(); s = m[2].trim(); }
  const tryNodes = nodes && want !== 'zone';
  const tryZones = zones && want !== 'node';

  const idHits = [
    ...(tryNodes ? diagram.nodes.filter(n => String(n.id) === s).map(n => ({ type: 'node', item: n })) : []),
    ...(tryZones ? diagram.zones.filter(z => String(z.id) === s).map(z => ({ type: 'zone', item: z })) : [])
  ];
  if (idHits.length) return idHits[0];

  const lower = s.toLowerCase();
  const hits = [
    ...(tryNodes ? diagram.nodes.filter(n => (n.label || '').trim().toLowerCase() === lower).map(n => ({ type: 'node', item: n })) : []),
    ...(tryZones ? diagram.zones.filter(z => (z.label || '').trim().toLowerCase() === lower).map(z => ({ type: 'zone', item: z })) : [])
  ];
  if (hits.length === 1) return hits[0];
  const what = tryNodes && tryZones ? 'node or zone' : tryNodes ? 'node' : 'zone';
  if (hits.length > 1) {
    throw new DocError(`"${s}" matches ${hits.length} items (${hits.map(h => `${h.type} ${h.item.id}`).join(', ')}) - use an id or a node:/zone: prefix`);
  }
  throw new DocError(`No ${what} "${s}" in this diagram`);
};

const resolveConnection = (diagram, ref) => {
  const c = diagram.connections.find(x => String(x.id) === String(ref).trim());
  if (!c) throw new DocError(`No connection ${ref} in this diagram`);
  return c;
};

// Channels by id or name. Unknown names are created when `create` is set.
const resolveChannels = (diagram, refs, { create = false, created = [] } = {}) => refs.map(ref => {
  const s = String(ref).trim();
  const ch = diagram.channels.find(c => String(c.id) === s) ||
    diagram.channels.find(c => (c.name || '').trim().toLowerCase() === s.toLowerCase());
  if (ch) return ch.id;
  if (!create) throw new DocError(`No channel "${s}" in this diagram`);
  const id = diagram.channels.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) + 1;
  const color = PALETTE[diagram.channels.length % PALETTE.length];
  diagram.channels.push({ id, name: s, color });
  created.push(s);
  return id;
});

const checkColor = (color) => {
  if (color == null) return undefined;
  if (!COLOR_RE.test(color)) throw new DocError(`Color must be #rrggbb, got "${color}"`);
  return color.toLowerCase();
};

const checkIcon = (icon) => {
  if (icon == null) return undefined;
  if (!ICON_IDS.includes(icon)) throw new DocError(`Unknown icon "${icon}"`);
  return icon;
};

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

const toAxial = (pos) => {
  if (pos == null) return null;
  if (Number.isInteger(pos.col) && Number.isInteger(pos.row)) return offsetToAxial(pos.col, pos.row);
  if (Number.isInteger(pos.q) && Number.isInteger(pos.r)) return { q: pos.q, r: pos.r };
  throw new DocError('A position is { col, row } or { q, r } (integers)');
};

const occupiedCells = (diagram) => new Set(diagram.nodes.map(cellKey));

// Free cell near a target: at least `gap` cells from every node, preferring
// even columns (so nodes line up in rows) and the closest spot on screen
const freeCellNear = (diagram, target, gap = 2) => {
  const nodes = diagram.nodes;
  const tp = axialToPixel(target.q, target.r);
  for (let ring = 0; ring < 60; ring++) {
    const ok = hexRing(target, ring).concat(ring ? hexRing(target, ring + 1) : [])
      .filter(c => nodes.every(n => hexDistance(n, c) >= gap));
    if (ok.length) {
      const score = (c) => {
        const p = axialToPixel(c.q, c.r);
        return Math.hypot(p.x - tp.x, p.y - tp.y) + (c.q % 2 === 0 ? 0 : 40);
      };
      return ok.sort((a, b) => score(a) - score(b))[0];
    }
  }
  throw new DocError('No free space found near that spot');
};

const DIRECTION_STEP = {
  right: { dc: 4, dr: 0 }, left: { dc: -4, dr: 0 },
  below: { dc: 0, dr: 2 }, above: { dc: 0, dr: -2 }
};

// Where the next auto-placed node goes: right of the previous one placed in
// this call, else right of everything already in the diagram
const defaultTarget = (diagram, previous) => {
  if (previous) {
    const o = axialToOffset(previous.q, previous.r);
    return offsetToAxial(o.col + 4, o.row);
  }
  if (diagram.nodes.length === 0) return { q: 0, r: 0 };
  const offs = diagram.nodes.map(n => axialToOffset(n.q, n.r));
  const maxCol = Math.max(...offs.map(o => o.col));
  const minRow = Math.min(...offs.map(o => o.row));
  return offsetToAxial(maxCol + 4 + (maxCol % 2 === 0 ? 0 : 1), minRow);
};

export const describePosition = (n) => {
  const o = axialToOffset(n.q, n.r);
  return { col: o.col, row: o.row };
};

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

const cleanEndpoints = (endpoints, mint) => {
  if (endpoints == null) return undefined;
  return endpoints.map(e => {
    if (!CHECKS.includes(e.check || 'icmp')) throw new DocError(`Unknown check "${e.check}"`);
    if (typeof e.address !== 'string' || !/^[A-Za-z0-9._:%[\]-]+$/.test(e.address.trim()) || e.address.trim().startsWith('-')) {
      throw new DocError(`Not a valid address: "${e.address}"`);
    }
    const out = { id: mint(), address: e.address.trim(), check: e.check || 'icmp' };
    if (e.port != null) out.port = e.port;
    if (e.path) out.path = e.path;
    if (e.insecure) out.insecure = true;
    return out;
  });
};

// A link points the node at another diagram of this document
const cleanLink = (doc, link) => {
  if (link == null) return undefined;
  const path = resolvePath(doc, link);
  return path;
};

export const addNodes = (doc, path, specs) => {
  const { path: p, diagram } = diagramAt(doc, path, { create: true });
  const mint = idMinter(doc);
  const created = [];
  let previous = null;
  for (const s of specs) {
    let cell = toAxial(s.position);
    if (cell) {
      if (occupiedCells(diagram).has(cellKey(cell))) {
        const other = diagram.nodes.find(n => cellKey(n) === cellKey(cell));
        throw new DocError(`Cell ${JSON.stringify(s.position)} already holds "${other.label}"`);
      }
    } else if (s.near) {
      const anchor = resolveEntity(diagram, s.near, { zones: false }).item;
      const step = DIRECTION_STEP[s.direction || 'right'];
      const o = axialToOffset(anchor.q, anchor.r);
      cell = freeCellNear(diagram, offsetToAxial(o.col + step.dc, o.row + step.dr));
    } else {
      cell = freeCellNear(diagram, defaultTarget(diagram, previous));
    }
    const node = {
      id: mint(),
      label: s.label,
      description: s.description || '',
      iconId: checkIcon(s.icon) || 'server',
      color: checkColor(s.color) || DEFAULT_COLOR,
      q: cell.q,
      r: cell.r
    };
    if (s.role === 'vip') node.role = 'vip';
    const eps = cleanEndpoints(s.endpoints, mint);
    if (eps?.length) node.endpoints = eps;
    const link = cleanLink(doc, s.link);
    if (link) node.link = link;
    diagram.nodes.push(node);
    previous = node;
    created.push({ id: node.id, label: node.label, ...describePosition(node) });
  }
  return { path: p, created };
};

export const updateNodes = (doc, path, updates) => {
  const { path: p, diagram } = diagramAt(doc, path);
  const mint = idMinter(doc);
  const updated = [];
  for (const u of updates) {
    const node = resolveEntity(diagram, u.node, { zones: false }).item;
    if (u.label != null) node.label = u.label;
    if (u.description != null) node.description = u.description;
    if (u.icon != null) node.iconId = checkIcon(u.icon);
    if (u.color != null) node.color = checkColor(u.color);
    if (u.role != null) {
      if (u.role === 'vip') node.role = 'vip'; else delete node.role;
    }
    if (u.endpoints !== undefined) {
      const eps = cleanEndpoints(u.endpoints || [], mint);
      if (eps.length) node.endpoints = eps; else delete node.endpoints;
    }
    if (u.link !== undefined) {
      if (u.link === null) delete node.link;
      else {
        const key = [...p, String(node.id)].join('/');
        const child = doc.diagrams[key];
        if (child && (child.nodes.length || child.zones.length)) {
          throw new DocError(`"${node.label}" has its own nested diagram, so it can't also link elsewhere`);
        }
        node.link = cleanLink(doc, u.link);
      }
    }
    if (u.position) {
      const cell = toAxial(u.position);
      const other = diagram.nodes.find(n => n !== node && cellKey(n) === cellKey(cell));
      if (other) throw new DocError(`Cell ${JSON.stringify(u.position)} already holds "${other.label}"`);
      node.q = cell.q;
      node.r = cell.r;
    }
    updated.push({ id: node.id, label: node.label, ...describePosition(node) });
  }
  return { path: p, updated };
};

export const removeNodes = (doc, path, refs) => {
  const { path: p, diagram } = diagramAt(doc, path);
  const ids = new Set(refs.map(r => resolveEntity(diagram, r, { zones: false }).item.id));
  const removed = diagram.nodes.filter(n => ids.has(n.id)).map(n => n.label);
  diagram.nodes = diagram.nodes.filter(n => !ids.has(n.id));
  const before = diagram.connections.length;
  diagram.connections = diagram.connections.filter(c =>
    !(c.fromType !== 'zone' && ids.has(c.from)) && !(c.toType !== 'zone' && ids.has(c.to)));
  diagram.zones.forEach(z => {
    if (z.policy && ids.has(z.policy.primaryId)) z.policy = { ...z.policy, primaryId: null };
  });
  // Nested diagrams under removed nodes go too
  let nested = 0;
  ids.forEach(id => {
    const prefix = [...p, String(id)].join('/');
    Object.keys(doc.diagrams).forEach(k => {
      if (k === prefix || k.startsWith(prefix + '/')) { delete doc.diagrams[k]; nested++; }
    });
  });
  if (!doc.diagrams[doc.currentPath.join('/')]) doc.currentPath = ['root'];
  return { path: p, removed, connectionsRemoved: before - diagram.connections.length, nestedDiagramsRemoved: nested };
};

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

const applyConnectionFields = (diagram, conn, s, createdChannels) => {
  if (s.label != null) conn.label = s.label;
  if (s.line != null) {
    if (!LINE_TYPES.includes(s.line)) throw new DocError(`Line must be one of ${LINE_TYPES.join(', ')}`);
    conn.lineType = s.line;
  }
  if (s.startPointer != null) conn.startStyle = s.startPointer;
  if (s.endPointer != null) conn.endStyle = s.endPointer;
  if (s.routing != null) {
    if (s.routing === 'angled') conn.routing = 'angled'; else delete conn.routing;
  }
  if (s.color !== undefined) {
    if (s.color === null) delete conn.color; else conn.color = checkColor(s.color);
  }
  if (s.icon !== undefined) conn.iconId = s.icon === null ? null : checkIcon(s.icon);
  if (s.channels != null) conn.channelIds = resolveChannels(diagram, s.channels, { create: true, created: createdChannels });
  if (s.kind != null) {
    delete conn.kind; delete conn.peerMode; delete conn.required;
    if (s.kind === 'dependency') conn.required = true;
    if (s.kind === 'peer') {
      conn.kind = 'peer';
      conn.peerMode = s.peerMode || 'failover';
    }
  } else if (s.peerMode != null && conn.kind === 'peer') {
    conn.peerMode = s.peerMode;
  }
};

const connKind = (c) => (c.kind === 'peer' ? 'peer' : c.required ? 'dependency' : 'traffic');

export const addConnections = (doc, path, specs) => {
  const { path: p, diagram } = diagramAt(doc, path);
  const mint = idMinter(doc);
  const created = [];
  const createdChannels = [];
  for (const s of specs) {
    const from = resolveEntity(diagram, s.from);
    const to = resolveEntity(diagram, s.to);
    if (from.type === to.type && from.item.id === to.item.id) throw new DocError(`Can't connect "${from.item.label}" to itself`);
    const kind = s.kind || 'traffic';
    const dup = diagram.connections.find(c =>
      c.from === from.item.id && c.to === to.item.id && connKind(c) === kind);
    if (dup) throw new DocError(`"${from.item.label}" → "${to.item.label}" already exists (connection ${dup.id})`);
    const conn = {
      id: mint(),
      from: from.item.id,
      fromType: from.type,
      to: to.item.id,
      toType: to.type,
      label: '',
      iconId: null,
      rotation: 0,
      lineType: kind === 'peer' ? 'dotted' : 'solid',
      startStyle: 'none',
      endStyle: kind === 'peer' ? 'none' : 'arrow',
      channelIds: []
    };
    applyConnectionFields(diagram, conn, { ...s, kind }, createdChannels);
    diagram.connections.push(conn);
    created.push({ id: conn.id, from: from.item.label, to: to.item.label, kind });
  }
  return { path: p, created, channelsCreated: createdChannels };
};

export const updateConnections = (doc, path, updates) => {
  const { path: p, diagram } = diagramAt(doc, path);
  const createdChannels = [];
  const updated = [];
  for (const u of updates) {
    const conn = resolveConnection(diagram, u.connection);
    if (u.reverse) {
      [conn.from, conn.to] = [conn.to, conn.from];
      [conn.fromType, conn.toType] = [conn.toType, conn.fromType];
      [conn.startStyle, conn.endStyle] = [conn.endStyle, conn.startStyle];
    }
    applyConnectionFields(diagram, conn, u, createdChannels);
    updated.push(conn.id);
  }
  return { path: p, updated, channelsCreated: createdChannels };
};

export const removeConnections = (doc, path, refs) => {
  const { path: p, diagram } = diagramAt(doc, path);
  const ids = new Set(refs.map(r => resolveConnection(diagram, r).id));
  diagram.connections = diagram.connections.filter(c => !ids.has(c.id));
  return { path: p, removed: [...ids] };
};

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

const zoneCells = (diagram, area) => {
  if (!area) throw new DocError('A new zone needs an area');
  const shape = area.shape || 'rectangle';
  if (area.around) {
    const members = area.around.map(r => resolveEntity(diagram, r, { zones: false }).item);
    if (!members.length) throw new DocError('"around" needs at least one node');
    const pad = area.padding ?? 1;
    const offs = members.map(n => axialToOffset(n.q, n.r));
    if (shape === 'rectangle') {
      return {
        shape,
        cells: rectangleCells(
          { col: Math.min(...offs.map(o => o.col)) - pad, row: Math.min(...offs.map(o => o.row)) - pad },
          { col: Math.max(...offs.map(o => o.col)) + pad, row: Math.max(...offs.map(o => o.row)) + pad }
        )
      };
    }
    const center = offsetToAxial(
      Math.round(offs.reduce((s, o) => s + o.col, 0) / offs.length),
      Math.round(offs.reduce((s, o) => s + o.row, 0) / offs.length)
    );
    const radius = Math.max(...members.map(n => hexDistance(n, center))) + pad;
    return { shape, cells: shape === 'hexagon' ? hexagonCells(center, radius) : circleCells(center, radius) };
  }
  if (shape === 'rectangle') {
    if (!area.from || !area.to) throw new DocError('A rectangle needs "from" and "to" corners, or "around"');
    return { shape, cells: rectangleCells(area.from, area.to) };
  }
  if (!area.center || !Number.isInteger(area.radius)) throw new DocError(`A ${shape} needs "center" and "radius", or "around"`);
  const center = toAxial(area.center);
  return { shape, cells: shape === 'hexagon' ? hexagonCells(center, area.radius) : circleCells(center, area.radius) };
};

const zoneMembers = (diagram, zone) => {
  const cells = new Set(zone.cells.map(cellKey));
  return diagram.nodes.filter(n => cells.has(cellKey(n)));
};

export const upsertZone = (doc, path, s) => {
  const { path: p, diagram } = diagramAt(doc, path, { create: !s.zone });
  let zone = s.zone != null ? resolveEntity(diagram, s.zone, { nodes: false }).item : null;
  const isNew = !zone;
  if (isNew) {
    if (!s.label) throw new DocError('A new zone needs a label');
    zone = {
      id: idMinter(doc)(),
      label: s.label,
      color: PALETTE[diagram.zones.length % PALETTE.length],
      cells: [],
      labelSide: 'top',
      labelPlacement: 'outside'
    };
  }
  if (s.label != null) zone.label = s.label;
  if (s.color != null) zone.color = checkColor(s.color);
  if (s.area || isNew) {
    const { shape, cells } = zoneCells(diagram, s.area);
    zone.cells = cells;
    // Hexagons and circles are what the editor draws, so it can resize them;
    // a visual rectangle isn't one of its shapes and is left to inference
    if (shape === 'rectangle') delete zone.shape; else zone.shape = shape === 'circle' ? 'circular' : 'hexagon';
  }
  if (s.labelSide != null) zone.labelSide = s.labelSide;
  if (s.labelPlacement != null) zone.labelPlacement = s.labelPlacement;
  if (s.policy) {
    const cur = getZonePolicy(zone);
    zone.policy = {
      mode: s.policy.mode || cur.mode,
      min: s.policy.min ?? cur.min,
      primaryId: s.policy.primary != null
        ? resolveEntity(diagram, s.policy.primary, { zones: false }).item.id
        : cur.primaryId
    };
  } else if (isNew) {
    zone.policy = { mode: 'pool', min: 1, primaryId: null };
  }
  if (isNew) diagram.zones.push(zone);
  return {
    path: p,
    zone: { id: zone.id, label: zone.label, created: isNew, cells: zone.cells.length, members: zoneMembers(diagram, zone).map(n => n.label) }
  };
};

export const removeZones = (doc, path, refs) => {
  const { path: p, diagram } = diagramAt(doc, path);
  const ids = new Set(refs.map(r => resolveEntity(diagram, r, { nodes: false }).item.id));
  const removed = diagram.zones.filter(z => ids.has(z.id)).map(z => z.label);
  diagram.zones = diagram.zones.filter(z => !ids.has(z.id));
  const before = diagram.connections.length;
  diagram.connections = diagram.connections.filter(c =>
    !(c.fromType === 'zone' && ids.has(c.from)) && !(c.toType === 'zone' && ids.has(c.to)));
  return { path: p, removed, connectionsRemoved: before - diagram.connections.length };
};

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export const upsertChannel = (doc, path, s) => {
  const { path: p, diagram } = diagramAt(doc, path, { create: true });
  if (s.channel != null) {
    const [id] = resolveChannels(diagram, [s.channel]);
    const ch = diagram.channels.find(c => c.id === id);
    if (s.name != null) ch.name = s.name;
    if (s.color != null) ch.color = checkColor(s.color);
    return { path: p, channel: { ...ch, created: false } };
  }
  if (!s.name) throw new DocError('A new channel needs a name');
  if (diagram.channels.some(c => c.name.trim().toLowerCase() === s.name.trim().toLowerCase())) {
    throw new DocError(`Channel "${s.name}" already exists`);
  }
  const id = diagram.channels.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) + 1;
  const ch = { id, name: s.name, color: checkColor(s.color) || PALETTE[diagram.channels.length % PALETTE.length] };
  diagram.channels.push(ch);
  return { path: p, channel: { ...ch, created: true } };
};

export const removeChannels = (doc, path, refs) => {
  const { path: p, diagram } = diagramAt(doc, path);
  const ids = new Set(resolveChannels(diagram, refs));
  diagram.channels = diagram.channels.filter(c => !ids.has(c.id));
  diagram.connections.forEach(c => {
    if (Array.isArray(c.channelIds)) c.channelIds = c.channelIds.filter(id => !ids.has(id));
  });
  return { path: p, removed: [...ids] };
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const entityLabel = (diagram, id, type) => {
  const list = type === 'zone' ? diagram.zones : diagram.nodes;
  return list.find(x => x.id === id)?.label ?? `(missing ${type} ${id})`;
};

export const outline = (doc) => {
  const rows = [];
  Object.keys(doc.diagrams)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .forEach(key => {
      const d = doc.diagrams[key];
      const path = key.split('/');
      rows.push({
        path: key,
        label: pathLabel(doc.diagrams, path),
        nodes: d.nodes.length,
        connections: d.connections.length,
        zones: d.zones.length,
        channels: d.channels.length
      });
    });
  return rows;
};

export const describeDiagram = (doc, path) => {
  const { path: p, diagram } = diagramAt(doc, path);
  const channelName = (id) => diagram.channels.find(c => c.id === id)?.name ?? `(missing channel ${id})`;
  return {
    path: p.join('/'),
    label: pathLabel(doc.diagrams, p),
    nodes: diagram.nodes.map(n => {
      const childKey = [...p, String(n.id)].join('/');
      const child = doc.diagrams[childKey];
      const out = { id: n.id, label: n.label, icon: n.iconId, color: n.color, ...describePosition(n) };
      if (n.description) out.description = n.description;
      if (n.role === 'vip') out.role = 'vip';
      if (n.endpoints?.length) out.endpoints = n.endpoints.map(({ id, ...e }) => e);
      const link = normalizeLink(n.link);
      if (link) out.link = link.tab ? { tab: link.tab, path: link.path.join('/') } : link.path.join('/');
      if (child && (child.nodes.length || child.zones.length)) out.nested = { nodes: child.nodes.length, zones: child.zones.length };
      return out;
    }),
    connections: diagram.connections.map(c => {
      const out = {
        id: c.id,
        from: `${c.fromType === 'zone' ? 'zone:' : ''}${entityLabel(diagram, c.from, c.fromType)}`,
        to: `${c.toType === 'zone' ? 'zone:' : ''}${entityLabel(diagram, c.to, c.toType)}`,
        kind: connKind(c)
      };
      if (c.kind === 'peer') out.peerMode = c.peerMode || 'failover';
      if (c.label) out.label = c.label;
      if (c.channelIds?.length) out.channels = c.channelIds.map(channelName);
      if (c.lineType && c.lineType !== 'solid') out.line = c.lineType;
      if (c.routing === 'angled') out.routing = 'angled';
      if (c.color) out.color = c.color;
      return out;
    }),
    zones: diagram.zones.map(z => ({
      id: z.id,
      label: z.label,
      color: z.color,
      policy: getZonePolicy(z).mode,
      cells: z.cells.length,
      members: zoneMembers(diagram, z).map(n => n.label)
    })),
    channels: diagram.channels.map(c => ({ id: c.id, name: c.name, color: c.color }))
  };
};
