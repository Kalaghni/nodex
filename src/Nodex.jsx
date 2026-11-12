import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Database, Server, Cloud, Zap, Box, Globe, Lock, HardDrive, Cpu, Network, Shield, Wifi, Code, Container, FileText, Users, Settings, Activity, Mail, Phone, CheckCircle, XCircle, AlertCircle, Plus, Edit2, X, ChevronRight, Hexagon, Trash2, Save, FolderOpen, Download, FilePlus, ZoomIn, ZoomOut, Maximize, Undo, Redo, Copy, Clipboard, Grid, Eye, EyeOff, Home, Building, Factory, Warehouse, ShoppingCart, CreditCard, DollarSign, PieChart, BarChart, LineChart, TrendingUp, Clock, Calendar, Bell, MessageSquare, Send, Upload, Link, Layers, Package, Archive, Folder, Search, Filter, Terminal, GitBranch, Github, Smartphone, Tablet, Monitor, Printer, Camera, Mic, Video, Play, Pause, Square, Circle, Triangle, Star, Heart, ThumbsUp, ThumbsDown, Flag, Bookmark, Tag, Hash, AtSign, MapPin, Navigation, Compass, Map as MapIcon, Truck, Plane, Ship, Train, Car, Bike, Footprints, Key, Unlock, UserCheck, UserX, UserPlus, User, Bot, Cog, Wrench, Hammer, Lightbulb, Flame, Droplet, Wind, Sun, Moon, CloudRain, Snowflake, Thermometer, History, FlaskConical, PowerOff, RotateCcw, ShieldAlert, Focus, ArrowLeftRight, Workflow, LocateFixed, Axis3d } from 'lucide-react';
import {
  evaluate,
  findSinglePointsOfFailure,
  flowStages,
  traceThrough,
  getConnEndStyles,
  connFlowReversed,
  getZonePolicy,
  nodeKey,
  zoneKey,
  connKey,
  ZONE_POLICIES,
  PEER_MODES
} from './analysis.js';
import {
  CHECK_TYPES,
  loadMonitorSettings,
  saveMonitorSettings,
  validateAddress,
  checkType,
  endpointLabel,
  endpointKey,
  collectTargets,
  probeTargets,
  agentHealth,
  applyResults,
  nodeLiveStatus,
  uptimePercent
} from './monitor.js';
import { cleanModelOverride, readModelFile, MODEL_SCALE_MIN, MODEL_SCALE_MAX } from './three/modelSpec.js';
import { MODEL_IDS, NO_MODEL } from './three/modelIds.js';

// The 3D engine (three.js) loads on first use, not with the 2D editor
const Scene3D = React.lazy(() => import('./three/Scene3D.jsx'));
const ModelPreview = React.lazy(() => import('./three/ModelPicker.jsx'));
const ModelGrid = React.lazy(() => import('./three/ModelPicker.jsx').then(m => ({ default: m.ModelGrid })));

// Hexagon grid calculations
const HEX_SIZE = 40;

// Monotonic id generator — Date.now() alone can collide when two items are
// created within the same millisecond (e.g. paste twice, import + new tab)
let __nextId = Date.now();
const genId = () => __nextId++;

// ---- Recent files ----
// Stored in IndexedDB, not localStorage: FileSystemFileHandle objects are
// structured-cloneable, so the actual on-device file can be reopened later.
const RECENTS_DB = 'nodex';
const RECENTS_STORE = 'recents';
const RECENTS_MAX = 10;

const openRecentsDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(RECENTS_DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(RECENTS_STORE, { keyPath: 'id', autoIncrement: true });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const recentsGetAll = async () => {
  const db = await openRecentsDb();
  return new Promise((resolve, reject) => {
    const rq = db.transaction(RECENTS_STORE, 'readonly').objectStore(RECENTS_STORE).getAll();
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror = () => reject(rq.error);
  });
};

const recentsPut = async (entry) => {
  const db = await openRecentsDb();
  return new Promise((resolve, reject) => {
    const rq = db.transaction(RECENTS_STORE, 'readwrite').objectStore(RECENTS_STORE).put(entry);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
};

const recentsRemove = async (id) => {
  const db = await openRecentsDb();
  return new Promise((resolve, reject) => {
    const rq = db.transaction(RECENTS_STORE, 'readwrite').objectStore(RECENTS_STORE).delete(id);
    rq.onsuccess = () => resolve();
    rq.onerror = () => reject(rq.error);
  });
};

const timeAgo = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
};

const getHexagonPoints = (x, y, size) => {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    points.push([
      x + size * Math.cos(angle),
      y + size * Math.sin(angle)
    ]);
  }
  return points.map(p => p.join(',')).join(' ');
};

const axialToPixel = (q, r) => {
  const x = HEX_SIZE * (3 / 2 * q);
  const y = HEX_SIZE * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
  return { x, y };
};

const pixelToAxial = (x, y) => {
  const q = (2 / 3 * x) / HEX_SIZE;
  const r = (-1 / 3 * x + Math.sqrt(3) / 3 * y) / HEX_SIZE;
  return axialRound(q, r);
};

const axialRound = (q, r) => {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);

  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);

  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  }

  return { q: rq, r: rr };
};

// Hex distance using cube coordinates
const hexDistance = (q1, r1, q2, r2) => {
  // Convert to cube coordinates and get max of absolute differences
  const x1 = q1, z1 = r1, y1 = -q1 - r1;
  const x2 = q2, z2 = r2, y2 = -q2 - r2;
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
};

// Distance from a flat-top hexagon's center to its boundary along `angle`.
// Vertices sit at multiples of 60°, so within each 60° sector the boundary is
// a straight edge whose apothem is size·√3/2.
const hexBoundaryDistance = (size, angle) => {
  const sector = Math.PI / 3;
  let a = angle % sector;
  if (a < 0) a += sector;
  return (size * Math.sqrt(3) / 2) / Math.cos(a - sector / 2);
};

// Trim a segment between two hex centers so it starts/ends at the hexagon
// boundaries instead of the centers (keeps arrowheads visible at the edge).
const trimSegmentToHexEdges = (from, to, size) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return null;
  const angle = Math.atan2(dy, dx);
  let fromTrim = hexBoundaryDistance(size, angle);
  let toTrim = hexBoundaryDistance(size, angle + Math.PI);
  // Adjacent hexes touch — keep at least a sliver of line so markers don't NaN
  const totalTrim = fromTrim + toTrim;
  if (dist - totalTrim < 4) {
    const scale = Math.max(0, dist - 4) / totalTrim;
    fromTrim *= scale;
    toTrim *= scale;
  }
  const ux = dx / dist;
  const uy = dy / dist;
  return {
    from: { x: from.x + ux * fromTrim, y: from.y + uy * fromTrim },
    to: { x: to.x - ux * toTrim, y: to.y - uy * toTrim },
    ux,
    uy
  };
};

// Shared 2D context for measuring label text — SVG has no synchronous API
let __measureCtx = null;
const measureTextWidth = (text, font) => {
  if (!__measureCtx) __measureCtx = document.createElement('canvas').getContext('2d');
  __measureCtx.font = font;
  return __measureCtx.measureText(text).width;
};

// Size + placement of a connection's icon/label block (pre-rotation), used
// both to lay the content out and to cut matching gaps into lines
const CONN_ICON_SIZE = 16;
const CONN_ICON_GAP = 6;
const getConnLabelBox = (conn, cx, cy, channelCount = 0) => {
  const hasIcon = !!conn.iconId;
  const hasLabel = !!conn.label;
  if (!hasIcon && !hasLabel) return null;
  const textW = hasLabel ? measureTextWidth(conn.label, '11px system-ui, -apple-system, sans-serif') : 0;
  const dotsW = channelCount > 0 ? channelCount * 8 + 4 : 0;
  const contentW = (hasIcon ? CONN_ICON_SIZE : 0) + (hasIcon && hasLabel ? CONN_ICON_GAP : 0) + textW + dotsW;
  return {
    cx,
    cy,
    rot: ((conn.rotation || 0) * Math.PI) / 180,
    halfW: contentW / 2 + 6,
    halfH: 8 + 3,
    contentW,
    textW
  };
};

// t-interval [t0,t1] where the segment a→b crosses a rotated rectangle, or
// null if it misses entirely (slab test in the rect's local frame)
const segmentRectIntersection = (a, b, box) => {
  const cos = Math.cos(-box.rot);
  const sin = Math.sin(-box.rot);
  const local = (p) => ({
    x: cos * (p.x - box.cx) - sin * (p.y - box.cy),
    y: sin * (p.x - box.cx) + cos * (p.y - box.cy)
  });
  const p0 = local(a);
  const p1 = local(b);
  const d = { x: p1.x - p0.x, y: p1.y - p0.y };
  let t0 = 0;
  let t1 = 1;
  for (const [p, dd, half] of [[p0.x, d.x, box.halfW], [p0.y, d.y, box.halfH]]) {
    if (Math.abs(dd) < 1e-9) {
      if (Math.abs(p) > half) return null;
    } else {
      let ta = (-half - p) / dd;
      let tb = (half - p) / dd;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 >= t1) return null;
    }
  }
  return [t0, t1];
};

// Clip the segment p0→p1 against one hexagonal cell (Cyrus–Beck against the
// six edges). Returns the [t0,t1] parameter interval inside the hex, or null.
const segmentHexIntersection = (p0, p1, cx, cy, size) => {
  const d = { x: p1.x - p0.x, y: p1.y - p0.y };
  const dLen = Math.hypot(d.x, d.y) || 1;
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 6; i++) {
    const a1 = (Math.PI / 3) * i;
    const a2 = (Math.PI / 3) * (i + 1);
    const v1 = { x: cx + size * Math.cos(a1), y: cy + size * Math.sin(a1) };
    const v2 = { x: cx + size * Math.cos(a2), y: cy + size * Math.sin(a2) };
    let nx = v2.y - v1.y;
    let ny = -(v2.x - v1.x);
    // Point the edge normal inward
    if (nx * (cx - v1.x) + ny * (cy - v1.y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const denom = nx * d.x + ny * d.y;
    const num = nx * (v1.x - p0.x) + ny * (v1.y - p0.y);
    // Parallel case: p0 is inside this edge's slab iff n·(p0−v1) ≥ 0,
    // i.e. num ≤ 0 — reject only when strictly outside (the original
    // `num < 0` test was inverted, so a segment running exactly along
    // cell edges — perfectly aligned zone centers — rejected every cell
    // and the line fell through to the center untrimmed). Grazing along
    // an edge counts as touching; tolerances are relative.
    const nLen = size; // |n| equals the edge length
    if (Math.abs(denom) < 1e-9 * nLen * dLen) {
      if (num > 1e-6 * nLen) return null;
    } else {
      const t = num / denom;
      if (denom > 0) {
        t0 = Math.max(t0, t);
      } else {
        t1 = Math.min(t1, t);
      }
      if (t0 > t1) return null;
    }
  }
  return [t0, t1];
};

// Edge of a node hexagon in the direction of `toward`
const nodeEdgePoint = (center, toward) => {
  const ang = Math.atan2(toward.y - center.y, toward.x - center.x);
  const t = hexBoundaryDistance(HEX_SIZE, ang);
  return { x: center.x + Math.cos(ang) * t, y: center.y + Math.sin(ang) * t };
};

// A zone's anchor point: its cell centroid, snapped to the nearest cell
// when a concave blob pushes the centroid outside its own cells — so the
// anchor always lies inside the zone
const zoneAnchorPoint = (zone) => {
  let sx = 0, sy = 0;
  zone.cells.forEach(c => {
    const p = axialToPixel(c.q, c.r);
    sx += p.x;
    sy += p.y;
  });
  let cx = sx / zone.cells.length;
  let cy = sy / zone.cells.length;
  const cc = pixelToAxial(cx, cy);
  if (!zone.cells.some(c => c.q === cc.q && c.r === cc.r)) {
    let bd = Infinity;
    zone.cells.forEach(c => {
      const p = axialToPixel(c.q, c.r);
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bd) { bd = d; cx = p.x; cy = p.y; }
    });
  }
  return { x: cx, y: cy };
};

// Stable empty list — keeps memoized analysis from recomputing every render
const EMPTY_LIST = [];

// Status palette shared by the outage simulation visuals
const STATUS_COLORS = { healthy: '#22c55e', degraded: '#f59e0b', down: '#ef4444' };
const STATUS_LABELS = { healthy: 'Healthy', degraded: 'Degraded', down: 'Unavailable' };
// Live check result per node (the small dot at a node's lower left)
const LIVE_COLORS = { up: '#22c55e', partial: '#f59e0b', down: '#ef4444', pending: '#64748b', unknown: '#475569' };
const LIVE_LABELS = { up: 'Up', partial: 'Partly up', down: 'Down', pending: 'Checking…', unknown: 'Can’t check' };

const CHANNEL_STATUS = {
  healthy: { label: 'Healthy', color: '#22c55e' },
  degraded: { label: 'Degraded', color: '#f59e0b' },
  down: { label: 'Down', color: '#ef4444' },
  broken: { label: 'No route', color: '#f97316' },
  unused: { label: 'Unused', color: '#64748b' }
};

// Earliest parameter t where segment p0→p1 enters any cell of the zone
// (the blob's outer silhouette), or null if it never does
const zoneEntryT = (zone, p0, p1) => {
  let bestT = null;
  zone.cells.forEach(c => {
    const p = axialToPixel(c.q, c.r);
    const hit = segmentHexIntersection(p0, p1, p.x, p.y, HEX_SIZE);
    if (hit && (bestT === null || hit[0] < bestT)) bestT = hit[0];
  });
  return bestT;
};

// Neighbor direction → index of the hex vertex pair forming the shared
// edge (flat-top: vertex i sits at 60°·i)
const HEX_EDGE_DIRS = [
  { dq: 1, dr: 0, vi: 0 },
  { dq: 0, dr: 1, vi: 1 },
  { dq: -1, dr: 1, vi: 2 },
  { dq: -1, dr: 0, vi: 3 },
  { dq: 0, dr: -1, vi: 4 },
  { dq: 1, dr: -1, vi: 5 }
];

// Walk hex rings around a center cell, out to `radius`
const buildHexRingCells = (cq, cr, radius) => {
  const cells = [{ q: cq, r: cr }];
  const directions = [
    { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 },
    { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }
  ];
  for (let ring = 1; ring <= radius; ring++) {
    let q = cq + directions[4].q * ring;
    let r = cr + directions[4].r * ring;
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < ring; step++) {
        cells.push({ q, r });
        q += directions[side].q;
        r += directions[side].r;
      }
    }
  }
  return cells;
};

// Determine a zone's shape — stored on zones created after shapes were added,
// inferred from the cell layout for zones loaded from older files
const inferZoneShape = (zone) => {
  if (zone.shape) return zone.shape;
  const qs = zone.cells.map(c => c.q);
  const rs = zone.cells.map(c => c.r);
  const w = Math.max(...qs) - Math.min(...qs) + 1;
  const h = Math.max(...rs) - Math.min(...rs) + 1;
  if (zone.cells.length === w * h) return 'rectangle';
  // A full hex blob of radius R has 3R² + 3R + 1 cells
  const R = Math.round((Math.sqrt(12 * zone.cells.length - 3) - 3) / 6);
  if (3 * R * R + 3 * R + 1 === zone.cells.length) return 'hexagon';
  return 'circular';
};

// Center cell of a zone (cube-rounded centroid)
const zoneCenterCell = (zone) => {
  const cq = zone.cells.reduce((s, c) => s + c.q, 0) / zone.cells.length;
  const cr = zone.cells.reduce((s, c) => s + c.r, 0) / zone.cells.length;
  return axialRound(cq, cr);
};

// Where to draw a zone's label, from its labelSide (top/bottom/left/right/
// center) and labelPlacement (inside/outside — ignored for center).
// Defaults: center, matching the pre-labelSide behaviour.
//
// Top/bottom edges are measured at the label's x (and left/right at its y):
// a q/r rectangle is a slanted parallelogram in pixel space, so the bounding
// box edge can sit far away from the cells at the center. Vertical alignment
// uses explicit baseline offsets — dominant-baseline is unreliable across
// renderers (and in exported SVGs).
const getZoneLabelLayout = (zone) => {
  const side = zone.labelSide || 'center';
  const inside = (zone.labelPlacement || 'inside') === 'inside';
  const pts = zone.cells.map(c => axialToPixel(c.q, c.r));
  const V = HEX_SIZE * Math.sqrt(3) / 2; // vertical half-extent of a cell

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  pts.forEach(p => {
    minX = Math.min(minX, p.x - HEX_SIZE);
    maxX = Math.max(maxX, p.x + HEX_SIZE);
    minY = Math.min(minY, p.y - V);
    maxY = Math.max(maxY, p.y + V);
  });
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const pad = 8;
  const ASCENT = 11;  // ≈ cap height above baseline at fontSize 14
  const DESCENT = 4;  // ≈ descent below baseline
  const MID = 5;      // baseline shift that visually centers 14px text

  // Zone edges at the label's cross position
  const colBand = pts.filter(p => Math.abs(p.x - cx) <= HEX_SIZE);
  const rowBand = pts.filter(p => Math.abs(p.y - cy) <= V);
  const topEdge = (colBand.length ? Math.min(...colBand.map(p => p.y)) - V : minY);
  const bottomEdge = (colBand.length ? Math.max(...colBand.map(p => p.y)) + V : maxY);
  const leftEdge = (rowBand.length ? Math.min(...rowBand.map(p => p.x)) - HEX_SIZE : minX);
  const rightEdge = (rowBand.length ? Math.max(...rowBand.map(p => p.x)) + HEX_SIZE : maxX);

  switch (side) {
    case 'top':
      return inside
        ? { x: cx, y: topEdge + pad + ASCENT, textAnchor: 'middle' }
        : { x: cx, y: topEdge - pad - DESCENT, textAnchor: 'middle' };
    case 'bottom':
      return inside
        ? { x: cx, y: bottomEdge - pad - DESCENT, textAnchor: 'middle' }
        : { x: cx, y: bottomEdge + pad + ASCENT, textAnchor: 'middle' };
    case 'left':
      return inside
        ? { x: leftEdge + pad, y: cy + MID, textAnchor: 'start' }
        : { x: leftEdge - pad, y: cy + MID, textAnchor: 'end' };
    case 'right':
      return inside
        ? { x: rightEdge - pad, y: cy + MID, textAnchor: 'end' }
        : { x: rightEdge + pad, y: cy + MID, textAnchor: 'start' };
    case 'center':
    default:
      return { x: cx, y: cy + MID, textAnchor: 'middle' };
  }
};

// Round region: cells whose center lies within a Euclidean pixel radius —
// unlike buildHexRingCells this produces a circle, not a bigger hexagon
const buildCircularCells = (cq, cr, hexRadius) => {
  const center = axialToPixel(cq, cr);
  const pixelRadius = (hexRadius + 0.5) * HEX_SIZE * Math.sqrt(3) / 2 * 1.15;
  const cells = [];
  const range = hexRadius + 2;
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = -range; dr <= range; dr++) {
      const q = cq + dq;
      const r = cr + dr;
      const pos = axialToPixel(q, r);
      if (Math.hypot(pos.x - center.x, pos.y - center.y) <= pixelRadius) {
        cells.push({ q, r });
      }
    }
  }
  return cells;
};

const AVAILABLE_ICONS = [
  // Infrastructure
  { id: 'server', icon: Server, label: 'Server' },
  { id: 'database', icon: Database, label: 'Database' },
  { id: 'cloud', icon: Cloud, label: 'Cloud' },
  { id: 'storage', icon: HardDrive, label: 'Storage' },
  { id: 'compute', icon: Cpu, label: 'Compute' },
  { id: 'network', icon: Network, label: 'Network' },
  { id: 'container', icon: Container, label: 'Container' },
  { id: 'terminal', icon: Terminal, label: 'Terminal' },
  { id: 'git', icon: GitBranch, label: 'Git' },
  { id: 'github', icon: Github, label: 'GitHub' },
  // Services & APIs
  { id: 'api', icon: Zap, label: 'API' },
  { id: 'service', icon: Box, label: 'Service' },
  { id: 'web', icon: Globe, label: 'Web' },
  { id: 'code', icon: Code, label: 'Code' },
  { id: 'layers', icon: Layers, label: 'Layers' },
  { id: 'package', icon: Package, label: 'Package' },
  { id: 'link', icon: Link, label: 'Link' },
  { id: 'bot', icon: Bot, label: 'Bot/AI' },
  // Security
  { id: 'security', icon: Lock, label: 'Security' },
  { id: 'shield', icon: Shield, label: 'Shield' },
  { id: 'key', icon: Key, label: 'Key' },
  { id: 'unlock', icon: Unlock, label: 'Unlock' },
  // Communication
  { id: 'wifi', icon: Wifi, label: 'WiFi' },
  { id: 'mail', icon: Mail, label: 'Mail' },
  { id: 'phone', icon: Phone, label: 'Phone' },
  { id: 'message', icon: MessageSquare, label: 'Message' },
  { id: 'send', icon: Send, label: 'Send' },
  { id: 'bell', icon: Bell, label: 'Notification' },
  // Documents & Data
  { id: 'document', icon: FileText, label: 'Document' },
  { id: 'folder', icon: Folder, label: 'Folder' },
  { id: 'archive', icon: Archive, label: 'Archive' },
  { id: 'upload', icon: Upload, label: 'Upload' },
  { id: 'download', icon: Download, label: 'Download' },
  // Users
  { id: 'users', icon: Users, label: 'Users' },
  { id: 'user', icon: User, label: 'User' },
  { id: 'usercheck', icon: UserCheck, label: 'User Check' },
  { id: 'userplus', icon: UserPlus, label: 'User Plus' },
  // Business
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'building', icon: Building, label: 'Building' },
  { id: 'factory', icon: Factory, label: 'Factory' },
  { id: 'warehouse', icon: Warehouse, label: 'Warehouse' },
  { id: 'cart', icon: ShoppingCart, label: 'Cart' },
  { id: 'credit', icon: CreditCard, label: 'Payment' },
  { id: 'dollar', icon: DollarSign, label: 'Money' },
  // Analytics
  { id: 'activity', icon: Activity, label: 'Activity' },
  { id: 'piechart', icon: PieChart, label: 'Pie Chart' },
  { id: 'barchart', icon: BarChart, label: 'Bar Chart' },
  { id: 'linechart', icon: LineChart, label: 'Line Chart' },
  { id: 'trending', icon: TrendingUp, label: 'Trending' },
  // Tools & Settings
  { id: 'settings', icon: Settings, label: 'Settings' },
  { id: 'cog', icon: Cog, label: 'Cog' },
  { id: 'wrench', icon: Wrench, label: 'Wrench' },
  { id: 'hammer', icon: Hammer, label: 'Hammer' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'filter', icon: Filter, label: 'Filter' },
  // Devices
  { id: 'smartphone', icon: Smartphone, label: 'Mobile' },
  { id: 'tablet', icon: Tablet, label: 'Tablet' },
  { id: 'monitor', icon: Monitor, label: 'Monitor' },
  { id: 'printer', icon: Printer, label: 'Printer' },
  { id: 'camera', icon: Camera, label: 'Camera' },
  // Time
  { id: 'clock', icon: Clock, label: 'Clock' },
  { id: 'calendar', icon: Calendar, label: 'Calendar' },
  // Status
  { id: 'check', icon: CheckCircle, label: 'Check' },
  { id: 'error', icon: XCircle, label: 'Error' },
  { id: 'warning', icon: AlertCircle, label: 'Warning' },
  { id: 'star', icon: Star, label: 'Star' },
  { id: 'flag', icon: Flag, label: 'Flag' },
  { id: 'lightbulb', icon: Lightbulb, label: 'Idea' },
  // Media
  { id: 'play', icon: Play, label: 'Play' },
  { id: 'pause', icon: Pause, label: 'Pause' },
  { id: 'mic', icon: Mic, label: 'Microphone' },
  { id: 'video', icon: Video, label: 'Video' },
  // Location
  { id: 'mappin', icon: MapPin, label: 'Location' },
  { id: 'map', icon: MapIcon, label: 'Map' },
  { id: 'compass', icon: Compass, label: 'Compass' },
  // Transport
  { id: 'truck', icon: Truck, label: 'Truck' },
  { id: 'plane', icon: Plane, label: 'Plane' },
  { id: 'ship', icon: Ship, label: 'Ship' },
  // Shapes
  { id: 'hexagon', icon: Hexagon, label: 'Hexagon' },
  { id: 'circle', icon: Circle, label: 'Circle' },
  { id: 'square', icon: Square, label: 'Square' },
  { id: 'triangle', icon: Triangle, label: 'Triangle' },
  // Nature
  { id: 'flame', icon: Flame, label: 'Fire' },
  { id: 'droplet', icon: Droplet, label: 'Water' },
  { id: 'sun', icon: Sun, label: 'Sun' },
  { id: 'moon', icon: Moon, label: 'Moon' }
];

const COLOR_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4',
  '#ec4899', '#ef4444', '#84cc16', '#6366f1', '#14b8a6',
  '#f97316', '#a855f7', '#22c55e', '#eab308', '#64748b'
];

const ZONE_COLORS = [
  { color: '#3b82f6', label: 'Blue' },
  { color: '#10b981', label: 'Green' },
  { color: '#f59e0b', label: 'Amber' },
  { color: '#8b5cf6', label: 'Purple' },
  { color: '#ec4899', label: 'Pink' },
  { color: '#ef4444', label: 'Red' },
  { color: '#06b6d4', label: 'Cyan' },
  { color: '#64748b', label: 'Gray' }
];

const LINE_TYPES = [
  { id: 'solid', label: 'Solid', dasharray: null },
  { id: 'dashed', label: 'Dashed', dasharray: '8,4' },
  { id: 'dotted', label: 'Dotted', dasharray: '2,4' },
  { id: 'dash-dot', label: 'Dash-Dot', dasharray: '8,4,2,4' },
  { id: 'long-dash', label: 'Long Dash', dasharray: '16,8' }
];

// Create initial empty diagram state
const createEmptyDiagram = () => ({
  nodes: [],
  connections: [],
  zones: [],
  channels: []
});

// Channels: diagram-level flows (name + color). Connections subscribe via
// channelIds and render one strand per subscribed channel, so a flow can
// split and converge across the graph while keeping its color identity.
const CHANNEL_SPACING = 5;

// Offset a 2- or 3-point polyline perpendicular to its direction. The
// 3-point case is the angled route's 90° elbow — summing both segment
// normals at the corner is the exact miter for right angles.
const offsetPolyline = (pts, offset) => {
  const perp = (a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  };
  if (pts.length === 2) {
    const n = perp(pts[0], pts[1]);
    return [
      { x: pts[0].x + n.x * offset, y: pts[0].y + n.y * offset },
      { x: pts[1].x + n.x * offset, y: pts[1].y + n.y * offset }
    ];
  }
  const n0 = perp(pts[0], pts[1]);
  const n1 = perp(pts[1], pts[2]);
  return [
    { x: pts[0].x + n0.x * offset, y: pts[0].y + n0.y * offset },
    { x: pts[1].x + (n0.x + n1.x) * offset, y: pts[1].y + (n0.y + n1.y) * offset },
    { x: pts[2].x + n1.x * offset, y: pts[2].y + n1.y * offset }
  ];
};

// Create a new tab
const createTab = (name = 'Untitled', diagrams = null, fileHandle = null) => ({
  id: genId(),
  name,
  diagrams: diagrams || { root: createEmptyDiagram() },
  currentPath: ['root'],
  fileHandle
});

export default function Nodex() {
  // Tabs state
  const [tabs, setTabs] = useState([createTab('Untitled')]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  
  // Refs to avoid stale closures
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  
  // Get active tab
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  const diagrams = activeTab.diagrams;
  const currentPath = activeTab.currentPath;
  
  // Ref for currentPath
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  
  // Update active tab helper - use functional update to avoid stale closures
  const updateActiveTab = (updates) => {
    setTabs(prevTabs => prevTabs.map(t => t.id === activeTabIdRef.current ? { ...t, ...updates } : t));
  };
  
  // Undo/redo history, per tab. Snapshots of the whole `diagrams` map are
  // pushed before each change; rapid bursts (dragging) coalesce into one
  // entry via the 500 ms window. `historyVersion` just forces re-renders so
  // the Undo/Redo buttons enable/disable correctly.
  const historyRef = useRef({});
  const [, setHistoryVersion] = useState(0);
  const bumpHistory = () => setHistoryVersion(v => v + 1);

  // Unsaved-changes tracking for the beforeunload guard
  const dirtyRef = useRef(false);

  const getHistory = (tabId) => {
    if (!historyRef.current[tabId]) {
      historyRef.current[tabId] = { past: [], future: [], lastPush: 0 };
    }
    return historyRef.current[tabId];
  };

  const recordHistory = (tabId, diagramsSnapshot) => {
    const h = getHistory(tabId);
    const now = performance.now();
    if (now - h.lastPush > 500) {
      h.past.push(diagramsSnapshot);
      if (h.past.length > 100) h.past.shift();
      h.future = [];
      bumpHistory();
    }
    h.lastPush = now;
  };

  const undo = () => {
    const tabId = activeTabIdRef.current;
    const h = getHistory(tabId);
    if (h.past.length === 0) return;
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (!tab) return;
    const prevDiagrams = h.past.pop();
    h.future.push(tab.diagrams);
    h.lastPush = 0;
    dirtyRef.current = true;
    setTabs(prevTabs => prevTabs.map(t => t.id === tabId ? { ...t, diagrams: prevDiagrams } : t));
    setSelectedNodeIds([]);
    setSelectedZone(null);
    bumpHistory();
  };

  const redo = () => {
    const tabId = activeTabIdRef.current;
    const h = getHistory(tabId);
    if (h.future.length === 0) return;
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (!tab) return;
    const nextDiagrams = h.future.pop();
    h.past.push(tab.diagrams);
    h.lastPush = 0;
    dirtyRef.current = true;
    setTabs(prevTabs => prevTabs.map(t => t.id === tabId ? { ...t, diagrams: nextDiagrams } : t));
    setSelectedNodeIds([]);
    setSelectedZone(null);
    bumpHistory();
  };

  const activeHistory = historyRef.current[activeTabId];
  const canUndo = (activeHistory?.past.length || 0) > 0;
  const canRedo = (activeHistory?.future.length || 0) > 0;

  // Set diagrams for active tab - use functional update for diagrams too.
  // Every diagram mutation flows through here, so this is where history is
  // recorded and the document is marked dirty.
  const setDiagrams = (newDiagrams) => {
    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current);
    if (tab) recordHistory(tab.id, tab.diagrams);
    dirtyRef.current = true;
    setTabs(prevTabs => prevTabs.map(t => {
      if (t.id !== activeTabIdRef.current) return t;
      const updatedDiagrams = typeof newDiagrams === 'function' ? newDiagrams(t.diagrams) : newDiagrams;
      return { ...t, diagrams: updatedDiagrams };
    }));
  };
  
  // Set currentPath for active tab
  const setCurrentPath = (newPath) => {
    setTabs(prevTabs => prevTabs.map(t => {
      if (t.id !== activeTabIdRef.current) return t;
      const updatedPath = typeof newPath === 'function' ? newPath(t.currentPath) : newPath;
      return { ...t, currentPath: updatedPath };
    }));
  };
  
  // Current diagram data
  const currentDiagram = diagrams[currentPath.join('/')] || createEmptyDiagram();
  const nodes = currentDiagram.nodes;
  const connections = currentDiagram.connections;
  const zones = currentDiagram.zones;
  const channels = currentDiagram.channels || [];

  // ---- Traffic isolation + outage simulation ----
  // Both are view state, not document state: they never touch the diagram,
  // undo history, or saved files. Kept per tab + nesting level so switching
  // away and back restores the scenario you were looking at.
  const viewKey = `${activeTabId}|${currentPath.join('/')}`;
  const [simMode, setSimMode] = useState(false);
  const simModeRef = useRef(false);
  simModeRef.current = simMode;
  const [simFailuresByView, setSimFailuresByView] = useState({});
  const [isolationByView, setIsolationByView] = useState({});
  const [hoverChannelId, setHoverChannelId] = useState(null);
  const [showSpof, setShowSpof] = useState(false);
  // Left-drag pans in simulation mode; a drag must not also toggle the
  // component it started on
  const simPanRef = useRef({ x: 0, y: 0, moved: false });

  const simFailureList = simFailuresByView[viewKey] || EMPTY_LIST;
  const simFailures = useMemo(() => new Set(simFailureList), [simFailureList]);
  const isolatedIds = (isolationByView[viewKey] || []).filter(id => channels.some(ch => ch.id === id));
  // Hovering a channel chip previews it on its own
  const focusChannelIds = hoverChannelId != null && channels.some(ch => ch.id === hoverChannelId)
    ? [hoverChannelId]
    : isolatedIds;

  // ---- Live monitoring of the real addresses on nodes ----
  // Endpoints live in the diagram (node.endpoints); where to check them from
  // (agent URL, token, interval) is per-viewer and kept in localStorage.
  const [monitorSettings, setMonitorSettingsState] = useState(loadMonitorSettings);
  const monitorSettingsRef = useRef(monitorSettings);
  monitorSettingsRef.current = monitorSettings;
  const setMonitorSettings = (next) => {
    setMonitorSettingsState(next);
    saveMonitorSettings(next);
  };
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [liveState, setLiveState] = useState(() => new Map());
  const [liveError, setLiveError] = useState(null);
  const [liveLastRun, setLiveLastRun] = useState(null);
  const [liveChecking, setLiveChecking] = useState(false);
  const [showMonitorSettings, setShowMonitorSettings] = useState(false);
  const [monitorHealth, setMonitorHealth] = useState(null);
  const liveInFlightRef = useRef(false);

  const liveTargets = useMemo(() => collectTargets(nodes), [nodes]);
  const liveTargetsRef = useRef(liveTargets);
  liveTargetsRef.current = liveTargets;
  const liveTargetsSig = liveTargets.map(t => `${t.key}=${t.check}/${t.address}/${t.port}/${t.path}`).join('|');

  const runLiveChecks = async () => {
    if (liveInFlightRef.current) return;
    const targets = liveTargetsRef.current;
    if (targets.length === 0) {
      setLiveState(new Map());
      setLiveError(null);
      setLiveLastRun(Date.now());
      return;
    }
    liveInFlightRef.current = true;
    setLiveChecking(true);
    try {
      const settings = monitorSettingsRef.current;
      const results = await probeTargets(settings, targets);
      // Drop the round if the endpoints changed while it was in flight
      if (liveTargetsRef.current === targets) {
        setLiveState(prev => applyResults(prev, targets, results, Date.now(), settings.failAfter));
      }
      setLiveError(null);
    } catch (err) {
      setLiveError(err.message);
    } finally {
      liveInFlightRef.current = false;
      setLiveChecking(false);
      setLiveLastRun(Date.now());
    }
  };

  useEffect(() => {
    if (!liveEnabled) return undefined;
    runLiveChecks();
    const timer = setInterval(runLiveChecks, Math.max(5, Number(monitorSettings.intervalSec) || 15) * 1000);
    return () => clearInterval(timer);
  }, [liveEnabled, monitorSettings.intervalSec, monitorSettings.source, monitorSettings.agentUrl, monitorSettings.token, monitorSettings.timeoutMs, viewKey, liveTargetsSig]);

  const liveNodeStatus = useMemo(() => {
    const m = new Map();
    if (!liveEnabled) return m;
    nodes.forEach(n => {
      const st = nodeLiveStatus(n, liveState);
      if (st) m.set(n.id, st);
    });
    return m;
  }, [liveEnabled, nodes, liveState]);

  // Nodes really down right now. While the agent itself is unreachable we
  // know nothing new — never treat that as every host being down.
  const liveDownList = useMemo(() => {
    if (!liveEnabled || liveError) return EMPTY_LIST;
    const list = [];
    liveNodeStatus.forEach((st, id) => { if (st.status === 'down') list.push(nodeKey(id)); });
    return list.length ? list : EMPTY_LIST;
  }, [liveEnabled, liveError, liveNodeStatus]);
  const liveDownSet = useMemo(() => new Set(liveDownList), [liveDownList]);
  const liveImpact = liveDownSet.size > 0;
  // Status visuals (health badges, dead links, failover arcs) show during a
  // simulation and whenever monitoring finds a real outage
  const statusView = simMode || liveImpact;

  // Simulation and live monitoring never run together (see toggleSimMode /
  // toggleLive), so failures come from one or the other
  const effectiveFailures = simMode ? simFailures : liveDownSet;

  const analysisNeeded = statusView || focusChannelIds.length > 0;
  const analysis = useMemo(
    () => (analysisNeeded ? evaluate(currentDiagram, effectiveFailures) : null),
    [analysisNeeded, currentDiagram, effectiveFailures]
  );
  const spofs = useMemo(
    () => (simMode && showSpof && analysis ? findSinglePointsOfFailure(analysis) : null),
    [simMode, showSpof, analysis]
  );

  const toggleFailure = (key) => {
    setSimFailuresByView(prev => {
      const list = prev[viewKey] || [];
      return {
        ...prev,
        [viewKey]: list.includes(key) ? list.filter(k => k !== key) : [...list, key]
      };
    });
  };
  const resetFailures = () => setSimFailuresByView(prev => ({ ...prev, [viewKey]: [] }));

  const toggleIsolation = (channelId) => {
    setIsolationByView(prev => {
      const list = (prev[viewKey] || []).filter(id => channels.some(ch => ch.id === id));
      return {
        ...prev,
        [viewKey]: list.includes(channelId) ? list.filter(i => i !== channelId) : [...list, channelId]
      };
    });
  };
  const clearIsolation = () => setIsolationByView(prev => ({ ...prev, [viewKey]: [] }));

  // Simulation is a viewing mode: editing gestures are suspended, so any
  // in-flight edit state is dropped on the way in
  //
  // Simulation and live monitoring are mutually exclusive: a what-if view
  // mixed with real readings is easy to misread. Entering a simulation while
  // live monitoring has found outages carries them in as ordinary failures,
  // so the simulation still starts from what's really down.
  const toggleSimMode = () => {
    if (simModeRef.current) {
      setSimMode(false);
      return;
    }
    if (liveEnabled) {
      if (liveDownList.length > 0) {
        setSimFailuresByView(prev => {
          const list = prev[viewKey] || [];
          return { ...prev, [viewKey]: [...list, ...liveDownList.filter(k => !list.includes(k))] };
        });
      }
      setLiveEnabled(false);
    }
    setSimMode(true);
    setSelectedNodeIds([]);
    setSelectedConnectionIds([]);
    setSelectedZone(null);
    setConnectingFrom(null);
    setShowConnectionEditor(false);
    setEditingConnectionId(null);
    setIsCreatingZone(false);
    setSelectedZoneCells([]);
    setHoveredCell(null);
  };

  const toggleLive = (on = !liveEnabled) => {
    if (on && simModeRef.current) setSimMode(false);
    setLiveEnabled(on);
  };

  // World position of a node/zone key, for centering the view on it
  const entityCenter = (key) => {
    if (key.startsWith('n:')) {
      const n = nodes.find(nn => nodeKey(nn.id) === key);
      return n ? axialToPixel(n.q, n.r) : null;
    }
    if (key.startsWith('z:')) {
      const z = zones.find(zz => zoneKey(zz.id) === key);
      return z && z.cells.length ? zoneAnchorPoint(z) : null;
    }
    if (key.startsWith('c:')) {
      const g = connGeomsRef.current[key.slice(2)];
      return g ? g.mid : null;
    }
    return null;
  };
  const centerOn = (key) => {
    const p = entityCenter(key);
    if (!p) return;
    setViewOffset({ x: canvasSize.width / 2 - p.x * zoom, y: canvasSize.height / 2 - p.y * zoom });
  };
  const connGeomsRef = useRef({});

  // Clipboard state for copy-paste
  const [clipboard, setClipboard] = useState(null);
  const clipboardRef = useRef(null);
  clipboardRef.current = clipboard;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;

  // 2D / 3D view. Per viewer, not part of the document.
  const [view3d, setView3dState] = useState(() => {
    try { return localStorage.getItem('nodex.view3d') === '1'; } catch { return false; }
  });
  const setView3d = (on) => {
    setView3dState(on);
    try { localStorage.setItem('nodex.view3d', on ? '1' : '0'); } catch { /* storage blocked */ }
  };
  const scene3dRef = useRef(null);
  const [show3dHelp, setShow3dHelp] = useState(() => {
    try { return localStorage.getItem('nodex.view3dHelp') !== '0'; } catch { return true; }
  });
  const toggle3dHelp = (on) => {
    setShow3dHelp(on);
    try { localStorage.setItem('nodex.view3dHelp', on ? '1' : '0'); } catch { /* storage blocked */ }
  };
  const [modelErrors, setModelErrors] = useState({});

  // UI State
  const [showNodeCreator, setShowNodeCreator] = useState(false);
  const [showZoneCreator, setShowZoneCreator] = useState(false);
  const [editingNode, setEditingNode] = useState(null);
  const [editingZone, setEditingZone] = useState(null);
  const [newNodeData, setNewNodeData] = useState({
    label: '',
    description: '',
    iconId: 'server',
    color: '#3b82f6',
    role: 'standard',
    endpoints: []
  });
  // 3D model override in the node editor. `source` is UI-only (which tab
  // is picked) and is dropped when the node is saved.
  const modelSourceOf = (m) => m?.source || (m?.url ? 'custom' : m?.builtin === NO_MODEL ? 'none' : m?.builtin ? 'builtin' : 'icon');
  const nodeModelSource = modelSourceOf(newNodeData.model3d);
  const modelFileInputRef = useRef(null);
  const setNodeModel = (patch) => setNewNodeData(prev => ({ ...prev, model3d: { ...(prev.model3d || {}), ...patch } }));
  const pickModelSource = (source) => setNewNodeData(prev => {
    const m = prev.model3d || {};
    const keep = { scale: m.scale, rotation: m.rotation };
    if (source === 'icon') return { ...prev, model3d: keep };
    if (source === 'builtin') {
      const builtin = m.builtin && m.builtin !== NO_MODEL ? m.builtin : prev.iconId;
      return { ...prev, model3d: { ...keep, source, builtin } };
    }
    if (source === 'custom') return { ...prev, model3d: { ...keep, source, url: m.url, name: m.name } };
    return { ...prev, model3d: { ...keep, source: 'none', builtin: NO_MODEL } };
  });
  const handleModelFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(glb|gltf)$/i.test(file.name)) {
      alert('Choose a .glb or .gltf file');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      alert('That model is over 20 MB. It would be saved inside the diagram file — host it somewhere and use its URL instead.');
      return;
    }
    try {
      const url = await readModelFile(file);
      setNodeModel({ source: 'custom', url, name: file.name, builtin: undefined });
    } catch (err) {
      alert(`Couldn’t read the file: ${err.message}`);
    }
  };

  const [newZoneData, setNewZoneData] = useState({
    label: '',
    color: '#3b82f6',
    cells: [],
    labelSide: 'center',
    labelPlacement: 'inside'
  });
  const [draggingNode, setDraggingNode] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connectingFrom, setConnectingFrom] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [selectedNodeIds, setSelectedNodeIds] = useState([]);
  // Only the id is stored — the zone object is derived from `zones` so the
  // selection always reflects the latest edit/resize instead of a stale copy
  const [selectedZoneId, setSelectedZoneId] = useState(null);
  const selectedZone = zones.find(z => z.id === selectedZoneId) || null;
  const setSelectedZone = (zone) => setSelectedZoneId(zone ? zone.id : null);

  // Derived selection — `selectedNode` is only set when exactly one node is
  // selected (drives the single-node panel); bulk actions use the id list
  const selectedNodes = nodes.filter(n => selectedNodeIds.includes(n.id));
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  // Compat shim: select a single node (or clear) — used throughout
  const setSelectedNode = (node) => setSelectedNodeIds(node ? [node.id] : []);

  // Connection multi-selection (Ctrl+Click a line, or marquee over midpoints)
  const [selectedConnectionIds, setSelectedConnectionIds] = useState([]);
  const selectedConnections = connections.filter(c => selectedConnectionIds.includes(c.id));

  // Refs for selected items to avoid stale closures
  const selectedConnectionIdsRef = useRef([]);
  selectedConnectionIdsRef.current = selectedConnectionIds;
  const selectedNodeIdsRef = useRef([]);
  selectedNodeIdsRef.current = selectedNodeIds;
  const selectedNodeRef = useRef(null);
  selectedNodeRef.current = selectedNode;
  const selectedZoneRef = useRef(null);
  selectedZoneRef.current = selectedZone;

  // Marquee (box) selection, group-drag bookkeeping, zone resizing/moving
  const [marquee, setMarquee] = useState(null);
  const didMarqueeRef = useRef(false);
  const dragGroupRef = useRef(null);
  const [resizingZone, setResizingZone] = useState(null);
  const zoneDragRef = useRef(null);
  const zoneJustDraggedRef = useRef(false);
  const [isDraggingZone, setIsDraggingZone] = useState(false);

  // When a connection drag ends on an empty cell, the node creator opens and
  // this holds the source node id to auto-connect to the node being created
  const pendingConnectFromRef = useRef(null);

  // Debounce timer for clicks on the hover "+" over zone cells: a single
  // click opens the node creator, a double-click starts a zone connection
  const pendingCellClickRef = useRef(null);
  
  const [hoveredConnection, setHoveredConnection] = useState(null);
  // Id-based like zone selection: the drawer edits the live connection, so
  // every control change is applied (and undoable) immediately
  const [editingConnectionId, setEditingConnectionId] = useState(null);
  const editingConnection = connections.find(c => c.id === editingConnectionId) || null;
  const setEditingConnection = (conn) => setEditingConnectionId(conn ? conn.id : null);
  const [showConnectionEditor, setShowConnectionEditor] = useState(false);

  const updateEditingConnection = (patch) => {
    if (editingConnectionId == null) return;
    setConnections(prev => prev.map(c => c.id === editingConnectionId ? { ...c, ...patch } : c));
  };

  // Flip which end is the source: swaps endpoints and their pointer styles,
  // so the drawing looks the same but traffic analysis runs the other way
  const reverseConnection = (conn) => {
    const cur = getConnEndStyles(conn);
    setConnections(prev => prev.map(c => c.id === conn.id ? {
      ...c,
      from: conn.to,
      fromType: conn.toType || 'node',
      to: conn.from,
      toType: conn.fromType || 'node',
      startStyle: cur.end,
      endStyle: cur.start
    } : c));
  };

  // Bulk connection editing — apply a patch to every selected connection
  const updateSelectedConnections = (patch) => {
    const sel = new Set(selectedConnectionIdsRef.current);
    if (sel.size === 0) return;
    setConnections(prev => prev.map(c => sel.has(c.id) ? { ...c, ...patch } : c));
  };

  const deleteSelectedConnections = () => {
    const sel = new Set(selectedConnectionIdsRef.current);
    if (sel.size === 0) return;
    setConnections(prev => prev.filter(c => !sel.has(c.id)));
    setSelectedConnectionIds([]);
  };

  // Bulk pointer change: materialize the other end's current style per
  // connection so the legacy arrowHead/arrowStyle fallback can't shift it
  const setBulkPointer = (which, value) => {
    const sel = new Set(selectedConnectionIdsRef.current);
    if (sel.size === 0) return;
    setConnections(prev => prev.map(c => {
      if (!sel.has(c.id)) return c;
      const cur = getConnEndStyles(c);
      return {
        ...c,
        startStyle: which === 'start' ? value : cur.start,
        endStyle: which === 'end' ? value : cur.end
      };
    }));
  };
  const [viewOffset, setViewOffset] = useState({ x: 400, y: 300 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [hoveredCell, setHoveredCell] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredZone, setHoveredZone] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [tabMenu, setTabMenu] = useState(null); // { x, y, tabId } | null
  const [zoom, setZoom] = useState(1);
  const [isCreatingZone, setIsCreatingZone] = useState(false);
  const [zoneShape, setZoneShape] = useState('rectangle'); // 'rectangle', 'hexagon', or 'circular'
  const [zoneSelectionStart, setZoneSelectionStart] = useState(null);
  const [selectedZoneCells, setSelectedZoneCells] = useState([]);
  const [zoneRadius, setZoneRadius] = useState(2);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  // Autosave + project file link
  const [autosave, setAutosave] = useState(false);
  const [projectHandle, setProjectHandle] = useState(null);
  const projectHandleRef = useRef(null);
  projectHandleRef.current = projectHandle;

  // Recent files (IndexedDB-backed, see helpers at top)
  const [recentFiles, setRecentFiles] = useState([]);
  const [showRecents, setShowRecents] = useState(false);

  const refreshRecents = async () => {
    try {
      const all = await recentsGetAll();
      setRecentFiles(all.sort((a, b) => b.lastOpened - a.lastOpened));
    } catch (err) {
      // IndexedDB unavailable — feature quietly disabled
    }
  };

  useEffect(() => {
    refreshRecents();
  }, []);

  const addRecent = async (name, kind, handle) => {
    if (!handle) return;
    try {
      const all = await recentsGetAll();
      const entry = { name, kind, handle, lastOpened: Date.now() };
      for (const e of all) {
        try {
          if (e.handle && await e.handle.isSameEntry(handle)) {
            entry.id = e.id;
            break;
          }
        } catch (err) { /* dead handle — ignore */ }
      }
      await recentsPut(entry);
      const refreshed = (await recentsGetAll()).sort((a, b) => b.lastOpened - a.lastOpened);
      for (const stale of refreshed.slice(RECENTS_MAX)) {
        await recentsRemove(stale.id);
      }
      setRecentFiles(refreshed.slice(0, RECENTS_MAX));
    } catch (err) { /* non-fatal */ }
  };

  const removeRecent = async (id) => {
    try {
      await recentsRemove(id);
      refreshRecents();
    } catch (err) { /* non-fatal */ }
  };

  const openRecent = async (entry) => {
    setShowRecents(false);
    if (!entry.handle) return;
    try {
      let perm = await entry.handle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') perm = await entry.handle.requestPermission({ mode: 'read' });
      if (perm !== 'granted') return;
      const file = await entry.handle.getFile();
      const data = JSON.parse(await file.text());
      loadFileData(data, file.name, entry.handle);
      addRecent(file.name, Array.isArray(data.tabs) ? 'project' : 'diagram', entry.handle);
      // Reopened work should keep saving itself — the handle is linked,
      // so autosave has somewhere to write
      setAutosave(true);
    } catch (err) {
      alert('Could not open this file — it may have been moved or deleted.');
      removeRecent(entry.id);
    }
  };

  // Update canvas size on mount and resize
  useEffect(() => {
    const updateSize = () => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        setCanvasSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Connection selection is per-diagram — clear it on tab/level changes
  const currentPathKey = currentPath.join('/');
  useEffect(() => {
    setSelectedConnectionIds([]);
  }, [activeTabId, currentPathKey]);

  // Autosave: after any change settles for a second, write every linked
  // on-device file (project file and/or per-tab files). No-op until a file
  // has been linked via Save / Save Project.
  useEffect(() => {
    if (!autosave) return;
    const timer = setTimeout(async () => {
      try {
        let wrote = false;
        if (projectHandleRef.current) {
          await writeToHandle(projectHandleRef.current, getProjectData());
          wrote = true;
        }
        for (const t of tabsRef.current) {
          if (t.fileHandle) {
            await writeToHandle(t.fileHandle, {
              version: 1,
              name: t.name,
              diagrams: t.diagrams,
              currentPath: t.currentPath
            });
            wrote = true;
          }
        }
        if (wrote) dirtyRef.current = false;
      } catch (err) {
        console.warn('Autosave failed:', err);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [autosave, tabs]);

  // Calculate dynamic grid bounds to fill viewport and include content
  const getGridBounds = () => {
    // Calculate viewport bounds in hex coordinates
    const padding = 2;
    const topLeft = pixelToAxial(-viewOffset.x / zoom - HEX_SIZE * padding, -viewOffset.y / zoom - HEX_SIZE * padding);
    const bottomRight = pixelToAxial((canvasSize.width - viewOffset.x) / zoom + HEX_SIZE * padding, (canvasSize.height - viewOffset.y) / zoom + HEX_SIZE * padding);
    
    let minQ = Math.floor(topLeft.q) - padding;
    let maxQ = Math.ceil(bottomRight.q) + padding;
    let minR = Math.floor(topLeft.r) - padding;
    let maxR = Math.ceil(bottomRight.r) + padding;
    
    // Expand based on nodes
    nodes.forEach(n => {
      minQ = Math.min(minQ, n.q - 2);
      maxQ = Math.max(maxQ, n.q + 2);
      minR = Math.min(minR, n.r - 2);
      maxR = Math.max(maxR, n.r + 2);
    });
    
    // Expand based on zones
    zones.forEach(z => {
      z.cells.forEach(c => {
        minQ = Math.min(minQ, c.q - 2);
        maxQ = Math.max(maxQ, c.q + 2);
        minR = Math.min(minR, c.r - 2);
        maxR = Math.max(maxR, c.r + 2);
      });
    });
    
    // Expand based on current zone selection
    selectedZoneCells.forEach(c => {
      minQ = Math.min(minQ, c.q - 2);
      maxQ = Math.max(maxQ, c.q + 2);
      minR = Math.min(minR, c.r - 2);
      maxR = Math.max(maxR, c.r + 2);
    });
    
    // Expand based on dragging node
    if (draggingNode) {
      const node = nodes.find(n => n.id === draggingNode.id);
      if (node) {
        minQ = Math.min(minQ, node.q - 3);
        maxQ = Math.max(maxQ, node.q + 3);
        minR = Math.min(minR, node.r - 3);
        maxR = Math.max(maxR, node.r + 3);
      }
    }
    
    // Expand based on hovered cell
    if (hoveredCell) {
      minQ = Math.min(minQ, hoveredCell.q - 2);
      maxQ = Math.max(maxQ, hoveredCell.q + 2);
      minR = Math.min(minR, hoveredCell.r - 2);
      maxR = Math.max(maxR, hoveredCell.r + 2);
    }
    
    return { minQ, maxQ, minR, maxR };
  };

  const gridBounds = getGridBounds();

  // Tab management
  const addTab = (name = 'Untitled', diagrams = null, fileHandle = null) => {
    const newTab = createTab(name, diagrams, fileHandle);
    setTabs(prevTabs => [...prevTabs, newTab]);
    setActiveTabId(newTab.id);
    setSelectedNode(null);
    setSelectedZone(null);
    setViewOffset({ x: 400, y: 300 });
    setZoom(1);
  };

  const closeTab = (tabId) => {
    if (tabs.length === 1) {
      // Don't close the last tab, just replace it with a fresh one
      const fresh = createTab('Untitled');
      setTabs([fresh]);
      setActiveTabId(fresh.id);
      delete historyRef.current[tabId];
      return;
    }
    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);
    if (activeTabId === tabId) {
      setActiveTabId(newTabs[0].id);
    }
    // Drop the closed tab's undo history
    delete historyRef.current[tabId];
  };

  const renameTab = (tabId, newName) => {
    dirtyRef.current = true;
    setTabs(prevTabs => prevTabs.map(t => t.id === tabId ? { ...t, name: newName } : t));
  };

  // File operations
  const FILE_PICKER_TYPES = [{
    description: 'Nodex diagram',
    accept: { 'application/json': ['.json'] }
  }];

  const getTabSaveData = (tab) => ({
    version: 1,
    name: tab.name,
    diagrams: tab.diagrams,
    currentPath: tab.currentPath
  });

  const tabFileName = (tab) =>
    `${tab.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'nodex-diagram'}.json`;

  const writeToHandle = async (handle, data) => {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  };

  const downloadJson = (data, fileName) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Save one tab: writes back to its on-device file when one is linked,
  // otherwise prompts for a location (File System Access API) and links it.
  // Falls back to a plain download in browsers without the API.
  const saveTabToFile = async (tabId) => {
    const tab = tabsRef.current.find(t => t.id === tabId);
    if (!tab) return;
    const data = getTabSaveData(tab);

    if (tab.fileHandle) {
      try {
        await writeToHandle(tab.fileHandle, data);
        dirtyRef.current = false;
        return;
      } catch (err) {
        if (err.name === 'AbortError' || err.name === 'NotAllowedError') return;
        // Handle went bad (file moved/deleted) — fall through to re-pick
      }
    }

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: tabFileName(tab),
          types: FILE_PICKER_TYPES
        });
        await writeToHandle(handle, data);
        setTabs(prevTabs => prevTabs.map(t =>
          t.id === tabId ? { ...t, fileHandle: handle } : t
        ));
        dirtyRef.current = false;
        addRecent(handle.name, 'diagram', handle);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    downloadJson(data, tabFileName(tab));
    dirtyRef.current = false;
  };

  const saveToFile = () => saveTabToFile(activeTabIdRef.current);

  // Project = every open tab in a single file
  const getProjectData = () => ({
    version: 2,
    type: 'nodex-project',
    tabs: tabsRef.current.map(t => ({
      name: t.name,
      diagrams: t.diagrams,
      currentPath: t.currentPath
    }))
  });

  const saveProject = async () => {
    const data = getProjectData();

    if (projectHandleRef.current) {
      try {
        await writeToHandle(projectHandleRef.current, data);
        dirtyRef.current = false;
        return;
      } catch (err) {
        if (err.name === 'AbortError' || err.name === 'NotAllowedError') return;
        // Handle went bad — fall through to re-pick
      }
    }

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'nodex-project.json',
          types: FILE_PICKER_TYPES
        });
        await writeToHandle(handle, data);
        setProjectHandle(handle);
        dirtyRef.current = false;
        addRecent(handle.name, 'project', handle);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nodex-project.json';
    a.click();
    URL.revokeObjectURL(url);
    dirtyRef.current = false;
  };

  // A workspace we can silently replace: one unlinked tab with nothing drawn
  const isPristineWorkspace = (tabList) =>
    tabList.length === 1 &&
    !tabList[0].fileHandle &&
    Object.values(tabList[0].diagrams).every(
      d => d.nodes.length === 0 && d.connections.length === 0 && d.zones.length === 0
    );

  const loadFileData = (data, fileName, fileHandle = null) => {
    // Project file: restore all tabs
    if (Array.isArray(data.tabs)) {
      const newTabs = data.tabs
        .filter(t => t && t.diagrams)
        .map(t => ({
          ...createTab(t.name || 'Untitled', t.diagrams),
          currentPath: Array.isArray(t.currentPath) && t.currentPath.length > 0 ? t.currentPath : ['root']
        }));
      if (newTabs.length === 0) {
        alert('Failed to load file: project contains no diagrams');
        return;
      }
      setTabs(prevTabs => isPristineWorkspace(prevTabs) ? newTabs : [...prevTabs, ...newTabs]);
      setActiveTabId(newTabs[0].id);
      setSelectedNode(null);
      setSelectedZone(null);
      setViewOffset({ x: 400, y: 300 });
      setZoom(1);
      if (fileHandle) {
        setProjectHandle(fileHandle);
        // Opening a project always turns autosave on
        setAutosave(true);
      }
      return;
    }

    // Single-diagram file: open as a new tab
    if (data.diagrams) {
      const name = data.name || fileName?.replace('.json', '') || 'Imported';
      addTab(name, data.diagrams, fileHandle);
      // Update path after tab is created
      setTimeout(() => {
        setCurrentPath(data.currentPath || ['root']);
      }, 0);
    } else {
      alert('Failed to load file: not a Nodex diagram');
    }
  };

  // Open: uses the File System Access API when available so the tab stays
  // linked to the on-device file (Save then writes straight back to it)
  const openFromDevice = async () => {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: FILE_PICKER_TYPES,
          multiple: false
        });
        const file = await handle.getFile();
        const data = JSON.parse(await file.text());
        loadFileData(data, file.name, handle);
        addRecent(file.name, Array.isArray(data.tabs) ? 'project' : 'diagram', handle);
      } catch (err) {
        if (err.name !== 'AbortError') alert('Failed to load file: Invalid format');
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const openFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        loadFileData(data, file.name);
      } catch (err) {
        alert('Failed to load file: Invalid format');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Drag-and-drop file handling. Window-level with a depth counter: the
  // per-element version flickered (entering the overlay fired dragleave on
  // the canvas) and a drop landing on the toolbar/sidebar hit the browser
  // default, opening the JSON as a page. Only reacts to real file drags —
  // dragging selected text must not trigger the overlay.
  useEffect(() => {
    let depth = 0;
    const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

    const onDragEnter = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth++;
      setIsDraggingFile(true);
    };
    const onDragOver = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
    };
    const onDragLeave = (e) => {
      if (!isFileDrag(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDraggingFile(false);
    };
    const onDrop = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth = 0;
      setIsDraggingFile(false);

      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      if (!file.name.endsWith('.json')) {
        alert('Please drop a .json file');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          loadFileData(JSON.parse(event.target.result), file.name);
        } catch (err) {
          alert('Failed to load file: Invalid format');
        }
      };
      reader.readAsText(file);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // Warn before leaving the page with unsaved changes
  useEffect(() => {
    const handler = (e) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Bounding box (world coordinates) of everything in the current diagram —
  // exports must cover all content, not just what's scrolled into view
  const getContentBounds = () => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const include = (x, y, pad) => {
      minX = Math.min(minX, x - pad);
      maxX = Math.max(maxX, x + pad);
      minY = Math.min(minY, y - pad);
      maxY = Math.max(maxY, y + pad);
    };

    nodes.forEach(n => {
      const p = axialToPixel(n.q, n.r);
      include(p.x, p.y, HEX_SIZE);
      // Label below the hexagon — generous width since text size is unknown here
      include(p.x, p.y + HEX_SIZE + 22, 8 + n.label.length * 4);
    });
    zones.forEach(z => {
      z.cells.forEach(c => {
        const p = axialToPixel(c.q, c.r);
        include(p.x, p.y, HEX_SIZE);
      });
      // Zone labels can sit outside the cells — cover them too
      if (z.label && z.cells.length > 0) {
        const layout = getZoneLabelLayout(z);
        include(layout.x, layout.y, 12 + z.label.length * 4.5);
      }
    });

    if (minX === Infinity) return null;
    const margin = 30;
    return {
      x: minX - margin,
      y: minY - margin,
      width: maxX - minX + margin * 2,
      height: maxY - minY + margin * 2
    };
  };

  // Clone the live SVG into a standalone document: proper namespace, sized to
  // the full content bounds, dark background baked in, and lucide icons
  // pulled out of their <foreignObject> wrappers (foreignObject HTML doesn't
  // render outside the app because it relies on Tailwind classes/XHTML)
  const prepareExportSvg = () => {
    // The diagram itself — overlays (trace bar, legend) contain icon SVGs too
    const svgElement = canvasRef.current?.querySelector('svg.nx-canvas');
    const bounds = getContentBounds();
    if (!svgElement || !bounds) return null;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const clone = svgElement.cloneNode(true);
    clone.setAttribute('xmlns', SVG_NS);
    clone.removeAttribute('class');
    clone.setAttribute('width', Math.ceil(bounds.width));
    clone.setAttribute('height', Math.ceil(bounds.height));
    clone.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
    clone.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');

    // Neutralize the pan/zoom transform — the viewBox does the framing now
    const rootGroup = clone.querySelector('g');
    if (rootGroup) rootGroup.removeAttribute('transform');

    // Interaction-only elements (resize handles etc.) don't belong in exports
    clone.querySelectorAll('.ui-overlay').forEach(el => el.remove());

    // Background
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', bounds.x);
    bg.setAttribute('y', bounds.y);
    bg.setAttribute('width', bounds.width);
    bg.setAttribute('height', bounds.height);
    bg.setAttribute('fill', '#0f172a');
    clone.insertBefore(bg, clone.firstChild);

    // Replace each foreignObject with the lucide <svg> it wraps, centered in
    // the same box, so icons render in standalone SVG/PNG output
    clone.querySelectorAll('foreignObject').forEach(fo => {
      const innerSvg = fo.querySelector('svg');
      if (!innerSvg) {
        fo.remove();
        return;
      }
      const foX = parseFloat(fo.getAttribute('x')) || 0;
      const foY = parseFloat(fo.getAttribute('y')) || 0;
      const foW = parseFloat(fo.getAttribute('width')) || 0;
      const foH = parseFloat(fo.getAttribute('height')) || 0;
      const iconW = parseFloat(innerSvg.getAttribute('width')) || 24;
      const iconH = parseFloat(innerSvg.getAttribute('height')) || 24;
      const icon = innerSvg.cloneNode(true);
      icon.setAttribute('x', foX + (foW - iconW) / 2);
      icon.setAttribute('y', foY + (foH - iconH) / 2);
      icon.removeAttribute('class');
      fo.replaceWith(icon);
    });

    return {
      svgString: new XMLSerializer().serializeToString(clone),
      width: Math.ceil(bounds.width),
      height: Math.ceil(bounds.height)
    };
  };

  const exportFileName = (ext) =>
    `${activeTab.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'nodex-diagram'}.${ext}`;

  const exportAsSVG = () => {
    const prepared = prepareExportSvg();
    if (!prepared) {
      alert('Nothing to export — the diagram is empty');
      return;
    }
    const blob = new Blob([prepared.svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName('svg');
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAsPNG = () => {
    const prepared = prepareExportSvg();
    if (!prepared) {
      alert('Nothing to export — the diagram is empty');
      return;
    }

    // 2× normally, reduced for huge diagrams — past the browser's canvas
    // limit toDataURL silently produces a blank image
    const scale = Math.max(0.5, Math.min(2, 8192 / Math.max(prepared.width, prepared.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(prepared.width * scale);
    canvas.height = Math.round(prepared.height * scale);
    const ctx = canvas.getContext('2d');

    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = exportFileName('png');
      a.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(prepared.svgString)));
  };

  const newDiagram = () => {
    addTab('Untitled');
  };

  // Copy-paste functionality — read through refs so the keyboard shortcut
  // handler (registered once) never operates on stale state. Copying a
  // multi-selection also captures the connections between its members.
  const buildClipFromSelection = () => {
    const ids = selectedNodeIdsRef.current;
    const sel = nodesRef.current.filter(n => ids.includes(n.id));
    if (sel.length === 0) return null;
    if (sel.length === 1) return { type: 'node', data: { ...sel[0] } };
    const idSet = new Set(sel.map(n => n.id));
    const internalConns = connectionsRef.current.filter(c => idSet.has(c.from) && idSet.has(c.to));
    return {
      type: 'nodes',
      data: {
        nodes: sel.map(n => ({ ...n })),
        connections: internalConns.map(c => ({ ...c }))
      }
    };
  };

  const copyNode = () => {
    const clip = buildClipFromSelection();
    if (clip) setClipboard(clip);
  };

  const pasteClip = (clip) => {
    if (!clip) return;

    const currentNodes = nodesRef.current;
    const occupied = new Set(currentNodes.map(n => `${n.q},${n.r}`));
    // Candidate offsets, spiralling outward ring by ring
    const deltas = buildHexRingCells(0, 0, 12).slice(1);

    if (clip.type === 'node') {
      const nodeData = clip.data;
      const delta = deltas.find(d => !occupied.has(`${nodeData.q + d.q},${nodeData.r + d.r}`)) || { q: 1, r: 0 };

      // "Server 2" → "Server 3"; labels without a trailing number are kept as-is.
      // Keeps bumping past numbers already taken so repeated pastes don't collide.
      let label = nodeData.label;
      const numMatch = label.match(/^(.*?)(\d+)(\s*)$/);
      if (numMatch) {
        const [, prefix, num, trail] = numMatch;
        let next = parseInt(num, 10) + 1;
        while (currentNodes.some(n => n.label === `${prefix}${next}${trail}`)) next++;
        label = `${prefix}${next}${trail}`;
      }

      const newNode = {
        ...nodeData,
        id: genId(),
        q: nodeData.q + delta.q,
        r: nodeData.r + delta.r,
        label
      };
      setNodes(prev => [...prev, newNode]);
      setSelectedNodeIds([newNode.id]);
      return;
    }

    if (clip.type === 'nodes') {
      const { nodes: members, connections: memberConns } = clip.data;
      // Shift the whole group by one offset that leaves every member on a
      // free cell, preserving the group's internal layout
      const delta = deltas.find(d =>
        members.every(m => !occupied.has(`${m.q + d.q},${m.r + d.r}`))
      ) || { q: 1, r: 0 };

      const idMap = {};
      const newNodes = members.map(m => {
        const nid = genId();
        idMap[m.id] = nid;
        return { ...m, id: nid, q: m.q + delta.q, r: m.r + delta.r };
      });
      const newConns = memberConns.map(c => ({
        ...c,
        id: genId(),
        from: idMap[c.from],
        to: idMap[c.to]
      }));

      setNodes(prev => [...prev, ...newNodes]);
      if (newConns.length > 0) setConnections(prev => [...prev, ...newConns]);
      setSelectedNodeIds(newNodes.map(n => n.id));
    }
  };

  const pasteNode = () => pasteClip(clipboardRef.current);

  // Ctrl+D: copy + paste in one step, without touching the clipboard
  const duplicateSelection = () => pasteClip(buildClipFromSelection());

  // Zoom controls — anchored to the canvas center
  const zoomIn = () => zoomAt(1.2, canvasSize.width / 2, canvasSize.height / 2);
  const zoomOut = () => zoomAt(1 / 1.2, canvasSize.width / 2, canvasSize.height / 2);
  const resetView = () => {
    setZoom(1);
    setViewOffset({ x: canvasSize.width / 2, y: canvasSize.height / 2 });
  };

  // Helper to update current diagram — reads path via ref and previous state
  // via the functional updater so it's safe to call from event handlers and
  // keyboard shortcuts without capturing stale state
  const updateCurrentDiagram = (updates) => {
    const path = currentPathRef.current.join('/');
    setDiagrams(prev => {
      const diag = prev[path] || createEmptyDiagram();
      return { ...prev, [path]: { ...diag, ...updates } };
    });
  };

  const setDiagramField = (field, value) => {
    const path = currentPathRef.current.join('/');
    setDiagrams(prev => {
      const diag = prev[path] || createEmptyDiagram();
      const next = typeof value === 'function' ? value(diag[field]) : value;
      return { ...prev, [path]: { ...diag, [field]: next } };
    });
  };

  const setNodes = (newNodes) => setDiagramField('nodes', newNodes);
  const setConnections = (newConnections) => setDiagramField('connections', newConnections);
  const setZones = (newZones) => setDiagramField('zones', newZones);
  const setChannels = (newChannels) => setDiagramField('channels', newChannels);

  // Channel CRUD (sidebar inline form: { id: null | existing, name, color })
  const [channelForm, setChannelForm] = useState(null);

  const saveChannelForm = () => {
    if (!channelForm || !channelForm.name.trim()) return;
    if (channelForm.id != null) {
      setChannels(prev => (prev || []).map(ch =>
        ch.id === channelForm.id ? { ...ch, name: channelForm.name, color: channelForm.color } : ch
      ));
    } else {
      setChannels(prev => [...(prev || []), { id: genId(), name: channelForm.name, color: channelForm.color }]);
    }
    setChannelForm(null);
  };

  const deleteChannel = (channelId) => {
    setChannels(prev => (prev || []).filter(ch => ch.id !== channelId));
    setConnections(prev => prev.map(c =>
      c.channelIds ? { ...c, channelIds: c.channelIds.filter(i => i !== channelId) } : c
    ));
    setChannelForm(null);
  };

  // Bulk channel toggle: if every selected connection carries the channel,
  // remove it from all; otherwise add it to all
  const toggleBulkChannel = (channelId) => {
    const sel = new Set(selectedConnectionIdsRef.current);
    if (sel.size === 0) return;
    setConnections(prev => {
      const selected = prev.filter(c => sel.has(c.id));
      const allHave = selected.every(c => (c.channelIds || []).includes(channelId));
      return prev.map(c => {
        if (!sel.has(c.id)) return c;
        const ids = c.channelIds || [];
        return {
          ...c,
          channelIds: allHave ? ids.filter(i => i !== channelId) : [...new Set([...ids, channelId])]
        };
      });
    });
  };

  // Navigation. No diagram entry is created just for looking — reads fall
  // back to an empty diagram, and the entry is created on first write.
  // (Pre-creating polluted saved files with empty entries.)
  const navigateToNode = (node) => {
    const newPath = [...currentPath, node.id.toString()];
    setCurrentPath(newPath);
    setSelectedNode(null);
    setSelectedZone(null);
    setViewOffset({ x: 400, y: 300 });
  };

  const navigateUp = (index) => {
    setCurrentPath(currentPath.slice(0, index + 1));
    setSelectedNode(null);
    setSelectedZone(null);
  };

  // Get breadcrumb labels
  const getBreadcrumbs = () => {
    const crumbs = [{ label: 'Root', index: 0 }];
    
    for (let i = 1; i < currentPath.length; i++) {
      const nodeId = parseInt(currentPath[i]);
      const parentPath = currentPath.slice(0, i).join('/');
      const parentDiagram = diagrams[parentPath];
      const node = parentDiagram?.nodes.find(n => n.id === nodeId);
      crumbs.push({
        label: node?.label || `Node ${nodeId}`,
        index: i
      });
    }
    
    return crumbs;
  };

  const resetNodeForm = () => {
    setNewNodeData({
      label: '',
      description: '',
      iconId: 'server',
      color: '#3b82f6',
      role: 'standard',
      endpoints: [],
      model3d: undefined
    });
    setEditingNode(null);
    pendingConnectFromRef.current = null;
  };

  const openNodeCreator = (q = null, r = null) => {
    resetNodeForm();
    setShowNodeCreator(true);
    if (q !== null && r !== null) {
      setNewNodeData(prev => ({ ...prev, presetCoords: { q, r } }));
    }
  };

  const openNodeEditor = (node) => {
    setNewNodeData({
      label: node.label,
      description: node.description || '',
      iconId: node.iconId,
      color: node.color,
      role: node.role === 'vip' ? 'vip' : 'standard',
      endpoints: (node.endpoints || []).map(ep => ({ ...ep })),
      model3d: node.model3d ? { ...node.model3d } : undefined
    });
    setEditingNode(node);
    setShowNodeCreator(true);
  };

  // Endpoints as saved: blank rows dropped, addresses trimmed, ports
  // numeric; `undefined` (field omitted) when none are left
  const cleanEndpoints = (eps) => {
    const out = (eps || [])
      .filter(ep => ep.address && ep.address.trim())
      .map(ep => {
        const ct = checkType(ep.check);
        const port = parseInt(ep.port, 10);
        return {
          id: ep.id,
          address: ep.address.trim(),
          check: ct.id,
          ...(ct.port && Number.isInteger(port) && port !== ct.defaultPort ? { port } : {}),
          ...(ct.path && ep.path && ep.path !== '/' ? { path: ep.path } : {}),
          ...(ct.id === 'https' && ep.insecure ? { insecure: true } : {})
        };
      });
    return out.length ? out : undefined;
  };

  // One-off check from the node editor
  const [endpointTests, setEndpointTests] = useState({});
  const testEndpoint = async (ep) => {
    const [target] = collectTargets([{ id: 'test', endpoints: [ep] }]);
    if (!target) return;
    setEndpointTests(prev => ({ ...prev, [ep.id]: { pending: true } }));
    try {
      const [r] = await probeTargets(monitorSettingsRef.current, [target]);
      setEndpointTests(prev => ({ ...prev, [ep.id]: r }));
    } catch (err) {
      setEndpointTests(prev => ({ ...prev, [ep.id]: { up: null, error: err.message } }));
    }
  };

  const createOrUpdateNode = () => {
    if (!newNodeData.label.trim()) return;

    if (editingNode) {
      setNodes(nodes.map(n => 
        n.id === editingNode.id 
          ? { ...n, label: newNodeData.label, description: newNodeData.description, iconId: newNodeData.iconId, color: newNodeData.color, role: newNodeData.role === 'vip' ? 'vip' : undefined, endpoints: cleanEndpoints(newNodeData.endpoints), model3d: cleanModelOverride(newNodeData.model3d) }
          : n
      ));
    } else {
      // Without preset coords (toolbar/sidebar button), place at the first
      // free cell near the center of the current view instead of stacking
      // everything on (0,0)
      let coords = newNodeData.presetCoords;
      if (!coords) {
        const center = pixelToAxial(
          (canvasSize.width / 2 - viewOffset.x) / zoom,
          (canvasSize.height / 2 - viewOffset.y) / zoom
        );
        coords = buildHexRingCells(center.q, center.r, 10)
          .find(c => !nodes.some(n => n.q === c.q && n.r === c.r)) || center;
      }
      const newNode = {
        id: genId(),
        label: newNodeData.label,
        description: newNodeData.description,
        iconId: newNodeData.iconId,
        color: newNodeData.color,
        ...(newNodeData.role === 'vip' ? { role: 'vip' } : {}),
        ...(cleanEndpoints(newNodeData.endpoints) ? { endpoints: cleanEndpoints(newNodeData.endpoints) } : {}),
        ...(cleanModelOverride(newNodeData.model3d) ? { model3d: cleanModelOverride(newNodeData.model3d) } : {}),
        q: coords.q,
        r: coords.r
      };
      setNodes(prev => [...prev, newNode]);

      // Creator opened by clicking an empty cell mid-connection → wire the
      // new node to the source automatically
      if (pendingConnectFromRef.current) {
        const newConnection = {
          id: genId(),
          from: pendingConnectFromRef.current.id,
          fromType: pendingConnectFromRef.current.kind,
          to: newNode.id,
          toType: 'node',
          label: '',
          iconId: null,
          rotation: 0,
          lineType: 'solid'
        };
        setConnections(prev => [...prev, newConnection]);
        pendingConnectFromRef.current = null;
      }
    }

    setShowNodeCreator(false);
    resetNodeForm();
  };

  // Zone functions
  const startZoneCreation = () => {
    setIsCreatingZone(true);
    setSelectedZoneCells([]);
    setZoneSelectionStart(null);
    setSelectedNode(null);
    setSelectedZone(null);
  };

  const cancelZoneCreation = () => {
    setIsCreatingZone(false);
    setSelectedZoneCells([]);
    setZoneSelectionStart(null);
  };

  const openZoneEditor = (zone) => {
    setNewZoneData({
      label: zone.label,
      color: zone.color,
      cells: zone.cells,
      labelSide: zone.labelSide || 'center',
      labelPlacement: zone.labelPlacement || 'inside',
      policy: getZonePolicy(zone)
    });
    setEditingZone(zone);
    setShowZoneCreator(true);
  };

  const finishZoneCreation = () => {
    if (selectedZoneCells.length > 0) {
      setNewZoneData({
        label: '',
        color: '#3b82f6',
        cells: selectedZoneCells,
        labelSide: 'center',
        labelPlacement: 'inside'
      });
      setShowZoneCreator(true);
    }
  };

  const createOrUpdateZone = () => {
    if (editingZone) {
      setZones(zones.map(z =>
        z.id === editingZone.id
          ? {
              ...z,
              label: newZoneData.label,
              color: newZoneData.color,
              cells: newZoneData.cells,
              labelSide: newZoneData.labelSide,
              labelPlacement: newZoneData.labelPlacement,
              policy: newZoneData.policy || getZonePolicy(z)
            }
          : z
      ));
    } else {
      const newZone = {
        id: genId(),
        label: newZoneData.label,
        color: newZoneData.color,
        cells: selectedZoneCells,
        shape: zoneShape,
        labelSide: newZoneData.labelSide,
        labelPlacement: newZoneData.labelPlacement,
        policy: newZoneData.policy || getZonePolicy({})
      };
      setZones([...zones, newZone]);
    }

    setShowZoneCreator(false);
    setIsCreatingZone(false);
    setSelectedZoneCells([]);
    setNewZoneData({ label: '', color: '#3b82f6', cells: [], labelSide: 'center', labelPlacement: 'inside' });
    setEditingZone(null);
  };

  const deleteZone = (zoneId) => {
    const pathKey = currentPathRef.current.join('/');
    setDiagrams(prev => {
      const currentDiag = prev[pathKey] || { nodes: [], connections: [], zones: [] };
      return {
        ...prev,
        [pathKey]: {
          ...currentDiag,
          zones: currentDiag.zones.filter(z => z.id !== zoneId),
          connections: currentDiag.connections.filter(c => c.from !== zoneId && c.to !== zoneId)
        }
      };
    });
    setSelectedZone(null);
  };

  const handleCanvasMouseDown = (e) => {
    if (e.target.closest('.node-element')) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - viewOffset.x) / zoom;
    const worldY = (e.clientY - rect.top - viewOffset.y) / zoom;
    didMarqueeRef.current = false;

    // Simulation is a viewing mode: left-drag anywhere pans (clicks on
    // components toggle failures in their own handlers)
    if (simModeRef.current && (e.button === 0 || e.button === 1)) {
      simPanRef.current = { x: e.clientX, y: e.clientY, moved: false };
      setIsPanning(true);
      setPanStart({ x: e.clientX - viewOffset.x, y: e.clientY - viewOffset.y });
      e.preventDefault();
      return;
    }

    if (e.button === 1 || (e.button === 0 && e.shiftKey && !isCreatingZone)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - viewOffset.x, y: e.clientY - viewOffset.y });
      e.preventDefault();
    } else if (isCreatingZone && e.button === 0) {
      setZoneSelectionStart(pixelToAxial(worldX, worldY));
    } else if (connectingFrom && e.button === 0) {
      // Clicking an empty cell mid-connection creates a pre-connected node —
      // but cells inside a zone belong to the zone: their click finishes the
      // connection on the zone instead (handled by the zone's click handler)
      const { q, r } = pixelToAxial(worldX, worldY);
      const hasNode = nodes.some(n => n.q === q && n.r === r);
      const zoneUnderCell = getZoneForCell(q, r);
      if (!hasNode && !zoneUnderCell) {
        openNodeCreator(q, r);
        // Set after openNodeCreator — its resetNodeForm clears the ref
        pendingConnectFromRef.current = { id: connectingFrom.id, kind: connectingFrom.kind };
        setConnectingFrom(null);
        setHoveredCell(null);
      }
      // Clicks on nodes are handled by the node's own click handler
    } else if (e.button === 0) {
      // Marquee (box) selection — Ctrl held keeps the existing selection
      const additive = e.ctrlKey || e.metaKey;
      if (!additive) {
        setSelectedNodeIds([]);
        setSelectedConnectionIds([]);
        setSelectedZone(null);
        setConnectingFrom(null);
      }
      setMarquee({ start: { x: worldX, y: worldY }, end: { x: worldX, y: worldY }, additive });
      e.preventDefault();
    } else {
      setSelectedNodeIds([]);
      setSelectedConnectionIds([]);
      setSelectedZone(null);
      setConnectingFrom(null);
    }
  };

  const handleCanvasMouseMove = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldX = (screenX - viewOffset.x) / zoom;
    const worldY = (screenY - viewOffset.y) / zoom;
    
    setMousePos({ x: worldX, y: worldY });

    // Marquee selection drag
    if (marquee) {
      setMarquee(prev => prev ? { ...prev, end: { x: worldX, y: worldY } } : prev);
    }

    // Zone move drag — shift the zone's cells (and the nodes riding on
    // them) by the axial delta from the drag start
    if (zoneDragRef.current) {
      const drag = zoneDragRef.current;
      const cell = pixelToAxial(worldX, worldY);
      const dq = cell.q - drag.startCell.q;
      const dr = cell.r - drag.startCell.r;
      if (dq !== 0 || dr !== 0) drag.moved = true;
      setZones(prev => prev.map(z =>
        z.id === drag.id
          ? { ...z, cells: drag.cells0.map(c => ({ q: c.q + dq, r: c.r + dr })) }
          : z
      ));
      if (Object.keys(drag.nodes0).length > 0) {
        setNodes(prev => prev.map(n =>
          drag.nodes0[n.id]
            ? { ...n, q: drag.nodes0[n.id].q + dq, r: drag.nodes0[n.id].r + dr }
            : n
        ));
      }
      setHoveredCell(null);
      return;
    }

    // Zone resize drag — rebuild the zone's cells from its shape + anchor
    if (resizingZone) {
      const cell = pixelToAxial(worldX, worldY);
      let cells;
      if (resizingZone.shape === 'rectangle') {
        cells = [];
        const minQ = Math.min(resizingZone.anchor.q, cell.q);
        const maxQ = Math.max(resizingZone.anchor.q, cell.q);
        const minR = Math.min(resizingZone.anchor.r, cell.r);
        const maxR = Math.max(resizingZone.anchor.r, cell.r);
        for (let qi = minQ; qi <= maxQ; qi++) {
          for (let ri = minR; ri <= maxR; ri++) {
            cells.push({ q: qi, r: ri });
          }
        }
      } else {
        const radius = Math.max(1, hexDistance(resizingZone.anchor.q, resizingZone.anchor.r, cell.q, cell.r));
        const builder = resizingZone.shape === 'hexagon' ? buildHexRingCells : buildCircularCells;
        cells = builder(resizingZone.anchor.q, resizingZone.anchor.r, radius);
      }
      setZones(prev => prev.map(z =>
        z.id === resizingZone.id ? { ...z, cells, shape: resizingZone.shape } : z
      ));
      setHoveredCell(null);
      return;
    }

    // Zone selection drag
    if (isCreatingZone && zoneSelectionStart) {
      const { q, r } = pixelToAxial(worldX, worldY);
      let cells = [];

      if (zoneShape === 'rectangle') {
        const minQ = Math.min(zoneSelectionStart.q, q);
        const maxQ = Math.max(zoneSelectionStart.q, q);
        const minR = Math.min(zoneSelectionStart.r, r);
        const maxR = Math.max(zoneSelectionStart.r, r);

        for (let qi = minQ; qi <= maxQ; qi++) {
          for (let ri = minR; ri <= maxR; ri++) {
            cells.push({ q: qi, r: ri });
          }
        }
      } else if (zoneShape === 'hexagon') {
        // Hex-shaped zone: first click = center, drag outward to set radius
        const cq = zoneSelectionStart.q;
        const cr = zoneSelectionStart.r;
        const radius = Math.max(1, hexDistance(cq, cr, q, r));
        setZoneRadius(radius);
        cells = buildHexRingCells(cq, cr, radius);
      } else if (zoneShape === 'circular') {
        // Round zone: first click = center, drag outward to set radius —
        // cells are picked by Euclidean distance so the result is a circle,
        // not a bigger hexagon
        const cq = zoneSelectionStart.q;
        const cr = zoneSelectionStart.r;
        const radius = Math.max(1, hexDistance(cq, cr, q, r));
        setZoneRadius(radius);
        cells = buildCircularCells(cq, cr, radius);
      }
      setSelectedZoneCells(cells);
    }

    // Check hover over empty cells (skip if hovering a connection).
    // Stays active while connecting — clicking an empty cell then creates a
    // pre-connected node.
    if (!draggingNode && !isPanning && !isCreatingZone && !hoveredConnection && !marquee) {
      const { q, r } = pixelToAxial(worldX, worldY);
      const hasNode = nodes.some(n => n.q === q && n.r === r);
      // While connecting, zone cells are a drop target for the connection,
      // not a place to create nodes — hide the + overlay there so clicks
      // reach the zone
      const reservedForZone = connectingFrom && getZoneForCell(q, r);

      if (!hasNode && !reservedForZone) {
        setHoveredCell({ q, r });
      } else {
        setHoveredCell(null);
      }
    } else {
      setHoveredCell(null);
    }

    if (isPanning) {
      if (Math.hypot(e.clientX - simPanRef.current.x, e.clientY - simPanRef.current.y) > 4) {
        simPanRef.current.moved = true;
      }
      setViewOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    } else if (draggingNode) {
      // Group drag: move every node captured at drag start by the same
      // axial delta, preserving relative layout
      const { q, r } = pixelToAxial(worldX - dragOffset.x, worldY - dragOffset.y);
      const group = dragGroupRef.current;
      if (group) {
        const dq = q - group.anchor.q;
        const dr = r - group.anchor.r;
        setNodes(prev => prev.map(n => {
          const start = group.positions[n.id];
          return start ? { ...n, q: start.q + dq, r: start.r + dr } : n;
        }));
      }
    }
  };

  const handleCanvasMouseLeave = () => {
    setHoveredCell(null);
    setHoveredConnection(null);
  };

  // Registered on window (re-attached each render so closures stay fresh):
  // releasing the mouse over the sidebar/toolbar or outside the window must
  // still end drags, marquees, and zone resizes — a canvas-only listener
  // left them stuck to the cursor
  const handleCanvasMouseUp = () => {
    setIsPanning(false);
    setDraggingNode(null);
    dragGroupRef.current = null;
    setResizingZone(null);

    if (zoneDragRef.current) {
      // A real move must not fire the follow-up click (which would select
      // the zone or complete a connection)
      if (zoneDragRef.current.moved) zoneJustDraggedRef.current = true;
      zoneDragRef.current = null;
      setIsDraggingZone(false);
    }

    // Finish marquee selection: pick every node whose center is in the box.
    // A near-zero box is just a click — keep the click's clear behavior.
    if (marquee) {
      const moved = Math.abs(marquee.end.x - marquee.start.x) > 5 || Math.abs(marquee.end.y - marquee.start.y) > 5;
      if (moved) {
        didMarqueeRef.current = true;
        const x1 = Math.min(marquee.start.x, marquee.end.x);
        const x2 = Math.max(marquee.start.x, marquee.end.x);
        const y1 = Math.min(marquee.start.y, marquee.end.y);
        const y2 = Math.max(marquee.start.y, marquee.end.y);
        const ids = nodes
          .filter(n => {
            const p = axialToPixel(n.q, n.r);
            return p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
          })
          .map(n => n.id);
        setSelectedNodeIds(prev => marquee.additive ? [...new Set([...prev, ...ids])] : ids);
        // Connections whose midpoint falls inside the box get selected too
        const connIds = connections
          .filter(c => {
            const g = connGeoms[c.id];
            return g && g.mid.x >= x1 && g.mid.x <= x2 && g.mid.y >= y1 && g.mid.y <= y2;
          })
          .map(c => c.id);
        setSelectedConnectionIds(prev => marquee.additive ? [...new Set([...prev, ...connIds])] : connIds);
      }
      setMarquee(null);
    }

    if (isCreatingZone && zoneSelectionStart && selectedZoneCells.length > 0) {
      finishZoneCreation();
    }
    setZoneSelectionStart(null);
  };

  useEffect(() => {
    window.addEventListener('mouseup', handleCanvasMouseUp);
    return () => window.removeEventListener('mouseup', handleCanvasMouseUp);
  });

  // Zoom keeping a screen point fixed (focal zoom). Refs are updated
  // immediately so rapid wheel bursts between renders don't drift.
  const zoomStateRef = useRef({ zoom: 1, offset: { x: 400, y: 300 } });
  zoomStateRef.current = { zoom, offset: viewOffset };

  const zoomAt = (factor, screenX, screenY) => {
    const { zoom: prev, offset } = zoomStateRef.current;
    const next = Math.min(Math.max(prev * factor, 0.3), 3);
    if (next === prev) return;
    const ratio = next / prev;
    const newOffset = {
      x: screenX - (screenX - offset.x) * ratio,
      y: screenY - (screenY - offset.y) * ratio
    };
    zoomStateRef.current = { zoom: next, offset: newOffset };
    setZoom(next);
    setViewOffset(newOffset);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(e.deltaY > 0 ? 0.9 : 1.1, e.clientX - rect.left, e.clientY - rect.top);
  };

  const handleNodeMouseDown = (e, node) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Stop the browser starting a text selection — otherwise dragging a node
    // selects labels, and double-click selects the node's label text
    e.preventDefault();

    // Nodes don't move during a simulation; Shift+Click still descends
    if (simModeRef.current) {
      if (e.shiftKey) navigateToNode(node);
      return;
    }

    // Shift+click to navigate into nested diagram
    if (e.shiftKey) {
      navigateToNode(node);
      return;
    }

    // Ctrl/Cmd+click toggles the node in/out of the multi-selection (no drag)
    if (e.ctrlKey || e.metaKey) {
      setSelectedNodeIds(prev =>
        prev.includes(node.id) ? prev.filter(id => id !== node.id) : [...prev, node.id]
      );
      setSelectedZone(null);
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldX = (screenX - viewOffset.x) / zoom;
    const worldY = (screenY - viewOffset.y) / zoom;
    const nodePos = axialToPixel(node.q, node.r);

    // Clicking a member of the current selection drags the whole group;
    // clicking anything else selects (and drags) just that node
    const ids = selectedNodeIdsRef.current.includes(node.id)
      ? selectedNodeIdsRef.current
      : [node.id];
    const positions = {};
    nodesRef.current.forEach(n => {
      if (ids.includes(n.id)) positions[n.id] = { q: n.q, r: n.r };
    });
    dragGroupRef.current = { positions, anchor: { q: node.q, r: node.r } };

    setDragOffset({
      x: worldX - nodePos.x,
      y: worldY - nodePos.y
    });
    setDraggingNode(node);
    setSelectedNodeIds(ids);
    setSelectedZone(null);
    setHoveredCell(null);
  };

  const handleNodeClick = (e, node) => {
    e.stopPropagation();
    if (simModeRef.current) {
      if (!e.shiftKey) toggleFailure(nodeKey(node.id));
      return;
    }
    if (connectingFrom) {
      const isSelf = connectingFrom.kind === 'node' && connectingFrom.id === node.id;
      if (!isSelf) {
        const connectionExists = connections.some(
          c => (c.from === connectingFrom.id && c.to === node.id) ||
               (c.from === node.id && c.to === connectingFrom.id)
        );
        if (!connectionExists) {
          const newConnection = {
            id: genId(),
            from: connectingFrom.id,
            fromType: connectingFrom.kind,
            to: node.id,
            toType: 'node',
            label: '',
            iconId: null,
            rotation: 0,
            lineType: 'solid'
          };
          setConnections([...connections, newConnection]);
          // Open editor for new connection
          setEditingConnection(newConnection);
          setShowConnectionEditor(true);
        }
      }
      setConnectingFrom(null);
    }
  };

  const handleNodeDoubleClick = (e, node) => {
    e.stopPropagation();
    if (simModeRef.current) return;
    // Set initial mouse position to node position so the line doesn't jump to (0,0)
    const nodePos = axialToPixel(node.q, node.r);
    setMousePos({ x: nodePos.x, y: nodePos.y });
    setConnectingFrom({ kind: 'node', id: node.id, label: node.label, q: node.q, r: node.r });
  };

  const handleZoneClick = (e, zone) => {
    e.stopPropagation();
    if (simModeRef.current) {
      if (!simPanRef.current.moved) toggleFailure(zoneKey(zone.id));
      return;
    }
    // A marquee drag that ended on this zone fires a click — ignore it
    if (didMarqueeRef.current) return;
    // Same for the click that follows a zone move
    if (zoneJustDraggedRef.current) {
      zoneJustDraggedRef.current = false;
      return;
    }

    // Clicking a zone mid-connection finishes the connection on the zone
    if (connectingFrom) {
      const isSelf = connectingFrom.kind === 'zone' && connectingFrom.id === zone.id;
      if (!isSelf) {
        const connectionExists = connections.some(
          c => (c.from === connectingFrom.id && c.to === zone.id) ||
               (c.from === zone.id && c.to === connectingFrom.id)
        );
        if (!connectionExists) {
          const newConnection = {
            id: genId(),
            from: connectingFrom.id,
            fromType: connectingFrom.kind,
            to: zone.id,
            toType: 'zone',
            label: '',
            iconId: null,
            rotation: 0,
            lineType: 'solid'
          };
          setConnections(prev => [...prev, newConnection]);
          setEditingConnection(newConnection);
          setShowConnectionEditor(true);
        }
      }
      setConnectingFrom(null);
      return;
    }

    setSelectedZone(zone);
    setSelectedNode(null);
  };

  const handleZoneDoubleClick = (e, zone) => {
    e.stopPropagation();
    if (simModeRef.current) return;
    setConnectingFrom({ kind: 'zone', id: zone.id, label: zone.label || 'Zone' });
  };

  // Begin moving a zone (middle-click drag). Left-drag can't be used: the
  // hover "+" overlay owns plain clicks on empty zone cells, and left-drag
  // on the canvas is marquee selection.
  const startZoneDrag = (e, zone) => {
    e.stopPropagation();
    e.preventDefault();

    const rect = canvasRef.current.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - viewOffset.x) / zoom;
    const worldY = (e.clientY - rect.top - viewOffset.y) / zoom;

    // Nodes sitting on the zone's cells move along with it
    const cellSet = new Set(zone.cells.map(c => `${c.q},${c.r}`));
    const containedNodes = {};
    nodesRef.current.forEach(n => {
      if (cellSet.has(`${n.q},${n.r}`)) containedNodes[n.id] = { q: n.q, r: n.r };
    });

    zoneDragRef.current = {
      id: zone.id,
      startCell: pixelToAxial(worldX, worldY),
      cells0: zone.cells.map(c => ({ ...c })),
      nodes0: containedNodes,
      moved: false
    };
    setIsDraggingZone(true);
  };

  const handleZoneMouseDown = (e, zone) => {
    if (e.button !== 1) return;
    if (isCreatingZone || simModeRef.current) return;
    // Only a selected zone moves — middle-drag on unselected zones pans
    if (selectedZoneRef.current?.id !== zone.id) return;
    startZoneDrag(e, zone);
  };

  // Deletes every selected node (single or bulk), their connections, and
  // their nested diagrams
  const deleteSelectedNodes = () => {
    const ids = selectedNodeIdsRef.current;
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const pathKey = currentPathRef.current.join('/');

    setDiagrams(prev => {
      const currentDiag = prev[pathKey] || { nodes: [], connections: [], zones: [] };
      const newDiagrams = {
        ...prev,
        [pathKey]: {
          ...currentDiag,
          nodes: currentDiag.nodes.filter(n => !idSet.has(n.id)),
          connections: currentDiag.connections.filter(c => !idSet.has(c.from) && !idSet.has(c.to))
        }
      };
      // Remove the whole nested subtree of each deleted node — grandchildren
      // (root/X/Y) would otherwise linger as orphans in saved files
      ids.forEach(id => {
        const prefix = [...currentPathRef.current, id.toString()].join('/');
        Object.keys(newDiagrams).forEach(k => {
          if (k === prefix || k.startsWith(prefix + '/')) delete newDiagrams[k];
        });
      });
      return newDiagrams;
    });

    setSelectedNodeIds([]);
  };

  const deleteConnection = (connectionId) => {
    setConnections(prev => prev.filter(c => c.id !== connectionId));
    // If this connection was open in the drawer, close it
    if (editingConnectionId === connectionId) {
      setShowConnectionEditor(false);
      setEditingConnectionId(null);
    }
  };

  const clearAll = () => {
    const summary = [
      nodes.length && `${nodes.length} node${nodes.length > 1 ? 's' : ''}`,
      connections.length && `${connections.length} connection${connections.length > 1 ? 's' : ''}`,
      zones.length && `${zones.length} zone${zones.length > 1 ? 's' : ''}`
    ].filter(Boolean).join(', ');
    if (!window.confirm(`Clear this diagram? This removes ${summary || 'everything'} and all nested diagrams. (Ctrl+Z can undo it.)`)) {
      return;
    }
    const pathKey = currentPathRef.current.join('/');
    setDiagrams(prev => {
      // Also drop every nested diagram under this one
      const next = {};
      Object.keys(prev).forEach(k => {
        if (k !== pathKey && !k.startsWith(pathKey + '/')) next[k] = prev[k];
      });
      next[pathKey] = createEmptyDiagram();
      return next;
    });
    setSelectedNode(null);
    setSelectedZone(null);
    setConnectingFrom(null);
  };

  // Check if node has nested content
  const hasNestedDiagram = (nodeId) => {
    const pathKey = [...currentPath, nodeId.toString()].join('/');
    const diagram = diagrams[pathKey];
    return diagram && (diagram.nodes.length > 0 || diagram.zones.length > 0);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Save (Ctrl+S = active tab, Ctrl+Shift+S = whole project)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          saveProject();
        } else {
          saveToFile();
        }
        return;
      }
      const inField = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      const inModal = showNodeCreator || showZoneCreator || showConnectionEditor;
      // The connection drawer edits live — undo must stay available there
      const inBlockingModal = showNodeCreator || showZoneCreator;

      // Undo / redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inField && !inBlockingModal) {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !inField && !inBlockingModal) {
        e.preventDefault();
        redo();
        return;
      }

      // Select all nodes
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !inField && !inModal) {
        e.preventDefault();
        setSelectedNodeIds(nodesRef.current.map(n => n.id));
        return;
      }

      // Copy-paste — skip when typing in a field
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedNodeIdsRef.current.length > 0 && !inModal && !inField) {
        e.preventDefault();
        copyNode();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboardRef.current && !inModal && !inField && !simModeRef.current) {
        e.preventDefault();
        pasteNode();
      }
      // Duplicate selection (also blocks the browser's bookmark dialog)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && !inModal && !inField) {
        e.preventDefault();
        if (selectedNodeIdsRef.current.length > 0 && !simModeRef.current) duplicateSelection();
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && !inModal) {
        // Don't prevent default if we're in an input field
        if (inField || simModeRef.current) return;
        e.preventDefault();
        if (selectedNodeIdsRef.current.length > 0 || selectedConnectionIdsRef.current.length > 0) {
          if (selectedNodeIdsRef.current.length > 0) deleteSelectedNodes();
          if (selectedConnectionIdsRef.current.length > 0) deleteSelectedConnections();
        } else if (selectedZoneRef.current) {
          deleteZone(selectedZoneRef.current.id);
        }
      }
      if (e.key === 'Escape') {
        setShowMonitorSettings(false);
        setConnectingFrom(null);
        setSelectedNodeIds([]);
        setSelectedConnectionIds([]);
        setSelectedZone(null);
        setMarquee(null);
        setResizingZone(null);
        if (showNodeCreator) {
          setShowNodeCreator(false);
          resetNodeForm();
        }
        if (showZoneCreator) {
          setShowZoneCreator(false);
          setEditingZone(null);
        }
        if (showConnectionEditor) {
          setShowConnectionEditor(false);
          setEditingConnection(null);
        }
        if (isCreatingZone) {
          cancelZoneCreation();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showNodeCreator, showZoneCreator, showConnectionEditor, isCreatingZone, clipboard]);

  const gridHexagons = [];
  for (let q = gridBounds.minQ; q <= gridBounds.maxQ; q++) {
    for (let r = gridBounds.minR; r <= gridBounds.maxR; r++) {
      const { x, y } = axialToPixel(q, r);
      gridHexagons.push({ q, r, x, y });
    }
  }

  // Get zone for a cell
  const getZoneForCell = (q, r) => {
    return zones.find(z => z.cells.some(c => c.q === q && c.r === r));
  };

  const breadcrumbs = getBreadcrumbs();

  // Connection geometry + label boxes, computed once per render so every
  // line can subtract every label's footprint (including other connections').
  // A connection is a polyline: 2 points for direct routing, 3 for angled
  // (horizontal from the source, right-angle bend, vertical into the target).
  const connGeoms = {};
  connections.forEach(conn => {
    // Endpoints can be nodes or zones. A zone's center is its cell
    // centroid, snapped to the nearest cell when a concave blob pushes
    // the centroid outside its own cells — every center is guaranteed to
    // lie inside its entity, so the center-to-center segment always
    // crosses each silhouette and can be trimmed without leaving the axis.
    const resolveCenter = (id, type) => {
      if (type === 'zone') {
        const z = zones.find(zz => zz.id === id);
        if (!z || z.cells.length === 0) return null;
        const { x: cx, y: cy } = zoneAnchorPoint(z);
        return { type: 'zone', zone: z, x: cx, y: cy };
      }
      const n = nodes.find(nn => nn.id === id);
      if (!n) return null;
      const p = axialToPixel(n.q, n.r);
      return { type: 'node', x: p.x, y: p.y };
    };

    const epFrom = resolveCenter(conn.from, conn.fromType || 'node');
    const epTo = resolveCenter(conn.to, conn.toType || 'node');
    if (!epFrom || !epTo) return;

    // Center-to-center style: the arrow is a sub-segment of the exact
    // line between the entity centers — each end only slides along that
    // axis to its silhouette crossing, never off it. (Earlier attempts —
    // closest-cell anchors, silhouette closest-pair — all bent the line
    // away from the center axis somewhere and read as misaimed.)
    const a = { x: epFrom.x, y: epFrom.y };
    const b = { x: epTo.x, y: epTo.y };
    if (a.x === b.x && a.y === b.y) return;

    // Cut a polyline where it last leaves `zone` approaching its first
    // point: walk segments outward from the zone end and return the
    // polyline from the silhouette crossing on. Points stay ON the
    // polyline, so trimming never bends the line off the center axis.
    // Returns null when the whole polyline lies inside the zone.
    const trimPolyToZone = (poly, zone) => {
      for (let i = 1; i < poly.length; i++) {
        const t = zoneEntryT(zone, poly[i], poly[i - 1]);
        if (t !== null && t > 0) {
          return [{
            x: poly[i].x + (poly[i - 1].x - poly[i].x) * t,
            y: poly[i].y + (poly[i - 1].y - poly[i].y) * t
          }, ...poly.slice(i)];
        }
        // t === 0 → poly[i] is itself inside the zone; keep walking out
      }
      return null;
    };

    const routing = conn.routing || 'direct';
    const useElbow = routing === 'angled' &&
      Math.abs(b.x - a.x) > HEX_SIZE && Math.abs(b.y - a.y) > HEX_SIZE;
    let pts;

    if (epFrom.type === 'node' && epTo.type === 'node') {
      if (useElbow) {
        const corner = { x: b.x, y: a.y };
        pts = [nodeEdgePoint(a, corner), corner, nodeEdgePoint(b, corner)];
      } else {
        const trimmed = trimSegmentToHexEdges(a, b, HEX_SIZE);
        if (!trimmed) return;
        pts = [trimmed.from, trimmed.to];
      }
    } else {
      const basePoly = () => useElbow ? [a, { x: b.x, y: a.y }, b] : [a, b];
      // Trim the from-end, then flip and trim the to-end the same way.
      // Falling back to the untrimmed polyline (overlapping zones, where
      // no crossing exists) keeps the connection visible and clickable.
      let poly = epFrom.type === 'zone'
        ? (trimPolyToZone(basePoly(), epFrom.zone) || basePoly())
        : (() => { const p = basePoly(); p[0] = nodeEdgePoint(a, p[1]); return p; })();
      let rev = [...poly].reverse();
      rev = epTo.type === 'zone'
        ? (trimPolyToZone(rev, epTo.zone) || rev)
        : [nodeEdgePoint(b, rev[1]), ...rev.slice(1)];
      pts = rev.reverse();
      let len = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      }
      if (len < 2) return;
    }

    // Arc-length midpoint: where the label and delete button live
    const segLens = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const L = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      segLens.push(L);
      total += L;
    }
    let mid = pts[0];
    let acc = 0;
    for (let i = 0; i < segLens.length; i++) {
      if (acc + segLens[i] >= total / 2) {
        const t = (total / 2 - acc) / (segLens[i] || 1);
        mid = {
          x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
          y: pts[i].y + (pts[i + 1].y - pts[i].y) * t
        };
        break;
      }
      acc += segLens[i];
    }

    // Channels this connection subscribes to, in diagram order so strand
    // colors keep consistent sides across splits/merges
    const connChannels = (conn.channelIds || [])
      .length > 0
      ? channels.filter(ch => conn.channelIds.includes(ch.id))
      : [];

    const box = getConnLabelBox(conn, mid.x, mid.y, connChannels.length);
    if (box && connChannels.length > 1) {
      // Wider bundle needs a taller cut through crossing lines
      box.halfH += ((connChannels.length - 1) / 2) * CHANNEL_SPACING;
    }

    connGeoms[conn.id] = {
      pts,
      mid,
      box,
      channels: connChannels,
      fromZone: epFrom.type === 'zone' ? epFrom.zone : null,
      toZone: epTo.type === 'zone' ? epTo.zone : null
    };
  });
  connGeomsRef.current = connGeoms;

  // ---- Focus: which entities/strands the isolated channels pass through ----
  // `strands` is keyed connId|channelId so a connection shared by several
  // channels lights up only the isolated strands. Hovering a node narrows
  // the focus to the paths that actually pass through it.
  const flows = analysis ? analysis.cur.flows : null;
  const focus = (() => {
    if (!flows || focusChannelIds.length === 0) return null;
    const collect = (pick) => {
      const ents = new Set();
      const conns = new Set();
      const strands = new Set();
      focusChannelIds.forEach(chId => {
        const f = flows.get(chId);
        if (!f) return;
        const part = pick(f);
        if (!part) return;
        part.entities.forEach(k => ents.add(k));
        part.conns.forEach(id => {
          conns.add(id);
          strands.add(`${id}|${chId}`);
        });
      });
      return { ents, conns, strands };
    };
    let sets = collect(f => ({
      entities: [...f.entityState.keys()],
      conns: [...f.connOnPath]
    }));
    let tracing = null;
    const hoverKey = hoveredNode != null ? nodeKey(hoveredNode) : null;
    if (hoverKey && sets.ents.has(hoverKey)) {
      const traced = collect(f => traceThrough(f, hoverKey));
      if (traced.ents.size > 0) {
        sets = traced;
        tracing = hoverKey;
      }
    }
    // Zones that frame focused nodes stay visible as context
    const contextZones = new Set();
    nodes.forEach(n => {
      if (sets.ents.has(nodeKey(n.id))) {
        (analysis.model.nodeZones.get(n.id) || []).forEach(zid => contextZones.add(zid));
      }
    });
    return { ...sets, contextZones, tracing };
  })();

  // Best flow state of an entity across the focused channels
  const FLOW_RANK = { dead: 0, stranded: 1, standby: 2, active: 3 };
  const focusFlowState = (key) => {
    if (!focus) return null;
    let best = null;
    focusChannelIds.forEach(chId => {
      const s = flows.get(chId)?.entityState.get(key);
      if (s && (best === null || FLOW_RANK[s] > FLOW_RANK[best])) best = s;
    });
    return best;
  };
  const entityStatus = (key) => (statusView && analysis ? analysis.cur.entities.get(key) : null);

  // ---- 3D view ----
  // The 3D scene mirrors this level of the diagram. Everything that decides
  // how a component looks (selection, isolation, simulation, live status)
  // is computed here from the same state the 2D canvas uses.
  const visuals3d = (() => {
    if (!view3d) return null;
    const nodesV = new Map();
    const zonesV = new Map();
    const connsV = new Map();
    nodes.forEach(n => {
      const nk = nodeKey(n.id);
      const ns = entityStatus(nk);
      const flowState = focusFlowState(nk);
      const live = liveNodeStatus.get(n.id);
      nodesV.set(n.id, {
        selected: selectedNodeIds.includes(n.id),
        hovered: hoveredNode === n.id,
        status: ns?.status || null,
        failed: !!ns?.failed,
        collateralDown: ns?.status === 'down' && !ns?.failed,
        showHealthy: simMode,
        dimmed: !!focus && !focus.ents.has(nk),
        standby: !!focus && !statusView && flowState === 'standby',
        stranded: !!focus && !statusView && flowState === 'stranded',
        traceOrigin: focus?.tracing === nk,
        live: live ? LIVE_COLORS[live.status] : null,
        nested: !!hasNestedDiagram(n.id)
      });
    });
    zones.forEach(z => {
      const zk = zoneKey(z.id);
      const zs = entityStatus(zk);
      zonesV.set(z.id, {
        selected: selectedZone?.id === z.id,
        hovered: hoveredZone === z.id && hoveredNode == null && hoveredConnection == null,
        status: zs?.status || null,
        failed: !!zs?.failed,
        dimmed: !!focus && !focus.ents.has(zk) && !focus.contextZones.has(z.id)
      });
    });
    connections.forEach(conn => {
      const geom = connGeoms[conn.id];
      if (!geom) return;
      const lineColor = conn.color || '#64748b';
      const connSim = statusView && analysis ? analysis.cur.conns.get(conn.id) : null;
      const connBroken = connSim && connSim.status !== 'ok';
      const strands = (geom.channels.length > 0 ? geom.channels : [null]).map(ch => {
        let color = ch ? ch.color : lineColor;
        let dash = conn.lineType || 'solid';
        let opacity = 1;
        let animate = false;
        const flowState = ch && flows ? flows.get(ch.id)?.connState.get(conn.id) : null;
        const strandFocused = !focus || (ch ? focus.strands.has(`${conn.id}|${ch.id}`) : focus.conns.has(conn.id));
        if (connBroken || flowState === 'dead') {
          if (statusView) {
            color = STATUS_COLORS.down;
            dash = 'dashed';
            opacity = connSim?.status === 'failed' ? 0.95 : 0.6;
          }
        } else if (flowState === 'standby' && (statusView || focus)) {
          dash = 'dashed';
          opacity = 0.45;
        } else if (flowState === 'stranded' && (statusView || focus)) {
          dash = 'dotted';
          opacity = 0.3;
        } else if (flowState === 'active') {
          animate = !!focus;
        }
        if (focus && !strandFocused) {
          opacity = Math.min(opacity, 0.1);
          animate = false;
        }
        return { color, dash, opacity, animate };
      });
      connsV.set(conn.id, {
        strands,
        selected: selectedConnectionIds.includes(conn.id),
        hovered: hoveredConnection === conn.id,
        dimmed: !!focus && !focus.conns.has(conn.id),
        endStyles: getConnEndStyles(conn),
        reversed: connFlowReversed(conn)
      });
    });
    return { nodes: nodesV, zones: zonesV, conns: connsV };
  })();

  const zoneLabels3d = view3d
    ? Object.fromEntries(zones.filter(z => z.label && z.cells.length).map(z => [z.id, getZoneLabelLayout(z)]))
    : null;

  const handle3dHover = (hit) => {
    setHoveredNode(hit?.kind === 'node' ? hit.id : null);
    setHoveredZone(hit?.kind === 'zone' ? hit.id : null);
    setHoveredConnection(hit?.kind === 'conn' ? hit.id : null);
  };

  const handle3dPick = (hit, e) => {
    if (!hit) {
      if (!simMode) {
        setSelectedNodeIds([]);
        setSelectedZone(null);
        setSelectedConnectionIds([]);
      }
      return;
    }
    if (hit.kind === 'node') {
      const node = nodes.find(n => n.id === hit.id);
      if (!node) return;
      if (e.shiftKey) {
        navigateToNode(node);
        return;
      }
      if (simMode) {
        toggleFailure(nodeKey(node.id));
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        setSelectedNodeIds(prev => (prev.includes(node.id) ? prev.filter(id => id !== node.id) : [...prev, node.id]));
      } else {
        setSelectedNodeIds([node.id]);
      }
      setSelectedZone(null);
    } else if (hit.kind === 'zone') {
      const zone = zones.find(z => z.id === hit.id);
      if (!zone) return;
      if (simMode) {
        toggleFailure(zoneKey(zone.id));
        return;
      }
      setSelectedZone(zone);
      setSelectedNodeIds([]);
    } else if (hit.kind === 'conn') {
      const conn = connections.find(c => c.id === hit.id);
      if (!conn) return;
      if (simMode) {
        toggleFailure(connKey(conn.id));
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        setSelectedConnectionIds(prev => (prev.includes(conn.id) ? prev.filter(i => i !== conn.id) : [...prev, conn.id]));
        return;
      }
      setEditingConnection(conn);
      setShowConnectionEditor(true);
    }
  };

  // Right-click edits, like on the 2D canvas
  const handle3dContext = (hit) => {
    if (!hit || simMode) return;
    if (hit.kind === 'node') {
      const node = nodes.find(n => n.id === hit.id);
      if (!node) return;
      setSelectedNodeIds([node.id]);
      openNodeEditor(node);
    } else if (hit.kind === 'zone') {
      const zone = zones.find(z => z.id === hit.id);
      if (zone) openZoneEditor(zone);
    } else if (hit.kind === 'conn') {
      const conn = connections.find(c => c.id === hit.id);
      if (!conn) return;
      setEditingConnection(conn);
      setShowConnectionEditor(true);
    }
  };

  // Hover card text in 3D: what it is, its status and why
  const describe3d = (hit) => {
    const lines = [];
    let title = '';
    let kind = '';
    let key = null;
    if (hit.kind === 'node') {
      const n = nodes.find(nn => nn.id === hit.id);
      if (!n) return null;
      kind = 'Node';
      title = n.label;
      key = nodeKey(n.id);
      if (n.description) lines.push({ text: n.description });
      if (modelErrors[n.id] && n.model3d?.url) lines.push({ text: `3D model: ${modelErrors[n.id]}`, color: STATUS_COLORS.degraded });
      const live = liveNodeStatus.get(n.id);
      if (live) lines.push({ text: `Live: ${LIVE_LABELS[live.status]}`, color: LIVE_COLORS[live.status] });
    } else if (hit.kind === 'zone') {
      const z = zones.find(zz => zz.id === hit.id);
      if (!z) return null;
      kind = 'Zone';
      title = z.label || 'Zone';
      key = zoneKey(z.id);
    } else if (hit.kind === 'conn') {
      const c = connections.find(cc => cc.id === hit.id);
      if (!c) return null;
      kind = 'Link';
      const name = (id, type) => (type === 'zone'
        ? zones.find(z => z.id === id)?.label || 'Zone'
        : nodes.find(n => n.id === id)?.label || '?');
      title = c.label || `${name(c.from, c.fromType)} → ${name(c.to, c.toType)}`;
      if (c.label) lines.push({ text: `${name(c.from, c.fromType)} → ${name(c.to, c.toType)}` });
      key = connKey(c.id);
    }
    const es = key ? entityStatus(key) : null;
    if (es) {
      lines.push({ text: es.failed ? 'Failed (injected)' : STATUS_LABELS[es.status], color: STATUS_COLORS[es.status] });
      (es.reasons || [])
        .filter(r => !/^Failed \(simulated|Link failed \(simulated/.test(r))
        .forEach(r => lines.push({ text: `• ${r}` }));
    }
    if (simMode) lines.push({ text: `Click to ${es?.failed ? 'restore' : 'fail'}`, color: '#64748b' });
    return { kind, title, lines };
  };

  // Drawing zones and links happens on the grid — those tools drop back to 2D
  useEffect(() => {
    if (view3d && (isCreatingZone || connectingFrom)) setView3d(false);
  }, [view3d, isCreatingZone, connectingFrom]);

  const export3dPng = () => {
    const url = scene3dRef.current?.screenshot(2);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName('png').replace(/\.png$/, '-3d.png');
    a.click();
  };

  // ---- Sidebar: outage simulation panel ----
  const ChannelStatusPill = ({ status }) => {
    const meta = CHANNEL_STATUS[status] || CHANNEL_STATUS.unused;
    return (
      <span
        className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide shrink-0"
        style={{ color: meta.color, backgroundColor: `${meta.color}22` }}
      >
        {meta.label}
      </span>
    );
  };

  const NOTE_STYLES = {
    down: { color: '#fca5a5', mark: '✕' },
    reroute: { color: '#93c5fd', mark: '↪' },
    failover: { color: '#fcd34d', mark: '↻' }
  };

  const entityIcon = (key) => {
    if (key.startsWith('z:')) return <Hexagon size={13} className="shrink-0 text-slate-400" />;
    if (key.startsWith('c:')) return <ArrowLeftRight size={13} className="shrink-0 text-slate-400" />;
    return <Box size={13} className="shrink-0 text-slate-400" />;
  };

  const renderSimPanel = () => {
    if (!analysis) return null;
    const M = analysis.model;
    const failures = simFailureList.filter(k =>
      k.startsWith('c:') ? connections.some(c => connKey(c.id) === k) : M.entities.has(k));
    const listOf = (status) => [...M.entities.keys()]
      .filter(k => !simFailures.has(k) && !liveDownSet.has(k) && analysis.cur.entities.get(k).status === status);
    const unavailable = listOf('down');
    const degraded = listOf('degraded');
    const counts = analysis.cur.counts;
    const EntityRow = ({ k, color }) => {
      const es = analysis.cur.entities.get(k);
      return (
        <button
          onClick={() => centerOn(k)}
          className="w-full flex items-start gap-2 px-2 py-1.5 rounded hover:bg-slate-700 text-left group"
          title="Center on canvas"
        >
          <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: color }} />
          <span className="flex-1 min-w-0">
            <span className="block text-sm truncate">{M.label(k)}</span>
            {es.reasons[0] && <span className="block text-[11px] text-slate-400">{es.reasons[0]}</span>}
          </span>
          <LocateFixed size={13} className="mt-1 text-slate-500 opacity-0 group-hover:opacity-100 shrink-0" />
        </button>
      );
    };
    return (
      <div className="space-y-5">
        <div>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <FlaskConical size={18} className="text-red-400" />
              Outage simulation
            </h2>
            <button
              onClick={toggleSimMode}
              className="px-2 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600"
            >
              Exit
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Click nodes, links or zones on the canvas to fail them. Nothing in the diagram changes — this is a what-if view.
          </p>
        </div>

        {/* Health tiles */}
        <div className="grid grid-cols-3 gap-2">
          {['healthy', 'degraded', 'down'].map(st => (
            <div key={st} className="rounded-lg bg-slate-900/60 border border-slate-700 px-2 py-2 text-center">
              <div className="text-xl font-bold" style={{ color: STATUS_COLORS[st] }}>{counts[st]}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">{STATUS_LABELS[st]}</div>
            </div>
          ))}
        </div>

        {/* Injected failures */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-sm font-semibold text-slate-300">Failures ({failures.length})</h3>
            {failures.length > 0 && (
              <button onClick={resetFailures} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white">
                <RotateCcw size={12} /> Reset all
              </button>
            )}
          </div>
          {failures.length === 0 ? (
            <p className="text-xs text-slate-500">
              Nothing failed yet. Click a component on the canvas, or run the single-point-of-failure scan below for ideas.
            </p>
          ) : (
            <div className="space-y-1">
              {failures.map(k => (
                <div key={k} className="flex items-center gap-2 px-2 py-1.5 rounded bg-red-950/40 border border-red-900/60">
                  <PowerOff size={13} className="text-red-400 shrink-0" />
                  <button onClick={() => centerOn(k)} className="flex-1 min-w-0 text-left text-sm truncate hover:text-white text-slate-200">
                    {M.label(k)}
                  </button>
                  <button
                    onClick={() => toggleFailure(k)}
                    className="p-1 rounded text-slate-400 hover:text-emerald-300 hover:bg-slate-700"
                    title="Restore"
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Traffic flows */}
        {channels.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-1.5">Traffic flows</h3>
            <div className="space-y-2">
              {channels.map(ch => {
                const sum = analysis.channels.get(ch.id);
                const on = isolatedIds.includes(ch.id);
                return (
                  <div
                    key={ch.id}
                    className={`rounded-lg border px-2.5 py-2 ${on ? 'bg-slate-700/70' : 'bg-slate-900/40'}`}
                    style={{ borderColor: on ? ch.color : '#334155' }}
                    onMouseEnter={() => setHoverChannelId(ch.id)}
                    onMouseLeave={() => setHoverChannelId(null)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ch.color }} />
                      <span className="text-sm font-medium flex-1 truncate">{ch.name}</span>
                      <ChannelStatusPill status={sum?.status} />
                      <button
                        onClick={() => toggleIsolation(ch.id)}
                        className={`p-1 rounded ${on ? 'text-white bg-slate-600' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                        title={on ? 'Stop isolating' : 'Isolate on canvas'}
                      >
                        <Focus size={13} />
                      </button>
                    </div>
                    {sum && <p className="text-[11px] text-slate-400 mt-1">{sum.headline}</p>}
                    {sum?.notes?.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {sum.notes.map((n, i) => (
                          <li key={i} className="text-[11px] flex gap-1.5" style={{ color: NOTE_STYLES[n.tone]?.color }}>
                            <span className="shrink-0 w-3 text-center">{NOTE_STYLES[n.tone]?.mark}</span>
                            <span>{n.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {unavailable.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-red-300 mb-1">Unavailable ({unavailable.length})</h3>
            <div className="space-y-0.5">
              {unavailable.map(k => <EntityRow key={k} k={k} color={STATUS_COLORS.down} />)}
            </div>
          </div>
        )}
        {degraded.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-amber-300 mb-1">Degraded ({degraded.length})</h3>
            <div className="space-y-0.5">
              {degraded.map(k => <EntityRow key={k} k={k} color={STATUS_COLORS.degraded} />)}
            </div>
          </div>
        )}

        {/* Single points of failure */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
              <ShieldAlert size={14} className="text-orange-400" />
              Single points of failure
            </h3>
            <button
              onClick={() => setShowSpof(v => !v)}
              className="px-2 py-0.5 rounded text-xs bg-slate-700 hover:bg-slate-600"
            >
              {showSpof ? 'Hide' : 'Scan'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mb-1.5">
            {failures.length
              ? 'Components whose failure — on top of the current ones — would take a flow down.'
              : 'Components whose failure alone would take a flow down.'}
          </p>
          {showSpof && spofs && (
            spofs.length === 0 ? (
              <p className="text-xs text-emerald-400">No single point of failure — every flow survives any one more failure.</p>
            ) : (
              <div className="space-y-0.5">
                {spofs.map(sp => (
                  <button
                    key={sp.key}
                    onClick={() => toggleFailure(sp.key)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-700 text-left"
                    title="Click to simulate this failure"
                  >
                    {entityIcon(sp.key)}
                    <span className="flex-1 min-w-0 text-sm truncate">{sp.label}</span>
                    <span className="flex gap-1 shrink-0">
                      {sp.channels.map(chId => {
                        const ch = channels.find(c => c.id === chId);
                        return ch ? (
                          <span key={chId} className="w-2 h-2 rounded-full" style={{ backgroundColor: ch.color }} title={`Breaks ${ch.name}`} />
                        ) : null;
                      })}
                    </span>
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    );
  };


  // ---- Sidebar: live monitoring panel ----
  const renderLivePanel = () => {
    const counts = { up: 0, partial: 0, down: 0, pending: 0, unknown: 0 };
    liveNodeStatus.forEach(st => { counts[st.status]++; });
    const problems = nodes
      .filter(n => ['down', 'partial', 'unknown'].includes(liveNodeStatus.get(n.id)?.status) || liveNodeStatus.get(n.id)?.suspect)
      .sort((a, b) => ['down', 'partial', 'unknown', 'up'].indexOf(liveNodeStatus.get(a.id).status) -
        ['down', 'partial', 'unknown', 'up'].indexOf(liveNodeStatus.get(b.id).status));
    const impacted = liveImpact && analysis
      ? channels.map(ch => ({ ch, sum: analysis.channels.get(ch.id) })).filter(x => x.sum && x.sum.status !== 'healthy' && x.sum.status !== 'unused')
      : [];
    return (
      <div className="mb-5 p-3 rounded-lg bg-slate-900/60 border border-slate-700">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={15} className={liveChecking ? 'text-emerald-400 animate-pulse' : 'text-emerald-400'} />
          <h3 className="text-sm font-semibold flex-1">Live monitoring</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
            {monitorSettings.source === 'browser' ? 'Browser' : 'Agent'}
          </span>
          <button onClick={runLiveChecks} className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700" title="Check now">
            <RotateCcw size={12} />
          </button>
          <button onClick={() => setShowMonitorSettings(true)} className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700" title="Settings">
            <Settings size={12} />
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mb-2">
          {liveChecking ? 'Checking…' : liveLastRun ? `Last checked ${new Date(liveLastRun).toLocaleTimeString()}` : 'Starting…'}
          {' · every '}{monitorSettings.intervalSec}s
        </p>
        {liveError && (
          <div className="mb-2 p-2 rounded bg-amber-950/50 border border-amber-800/60 text-[11px] text-amber-200">
            {liveError}
          </div>
        )}
        {liveTargets.length === 0 ? (
          <p className="text-xs text-slate-400">
            No addresses to check yet. Right-click a node → <span className="text-slate-200">Monitoring</span> to attach its IP addresses or URLs.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-1 mb-2 text-center">
              {[['up', counts.up], ['partial', counts.partial], ['down', counts.down], ['pending', counts.pending + counts.unknown]].map(([k, v]) => (
                <div key={k} className="rounded bg-slate-800 py-1">
                  <div className="text-sm font-bold" style={{ color: LIVE_COLORS[k] }}>{v}</div>
                  <div className="text-[9px] uppercase tracking-wide text-slate-500">{k === 'pending' ? 'other' : LIVE_LABELS[k]}</div>
                </div>
              ))}
            </div>
            {problems.length === 0 && !liveError && counts.up > 0 && (
              <p className="text-xs text-emerald-400">All monitored nodes are answering.</p>
            )}
            <div className="space-y-0.5">
              {problems.map(n => {
                const st = liveNodeStatus.get(n.id);
                const bad = st.endpoints.find(r => r.st && r.st.status !== 'up') || st.endpoints.find(r => r.st?.suspect);
                return (
                  <button
                    key={n.id}
                    onClick={() => centerOn(nodeKey(n.id))}
                    className="w-full flex items-start gap-2 px-1.5 py-1 rounded hover:bg-slate-700 text-left"
                    title="Center on canvas"
                  >
                    <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: LIVE_COLORS[st.status] }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm truncate">
                        {n.label}
                        {st.suspect && st.status === 'up' && <span className="text-[10px] text-amber-400"> · missed a check</span>}
                      </span>
                      {bad && (
                        <span className="block text-[11px] text-slate-400 truncate">
                          {endpointLabel(bad.ep)} — {bad.st?.last?.error || LIVE_LABELS[bad.st?.status || 'pending']}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {impacted.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-700">
                <p className="text-[11px] font-semibold text-slate-300 mb-1">Traffic impact</p>
                {impacted.map(({ ch, sum }) => (
                  <div key={ch.id} className="flex items-center gap-2 py-0.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ch.color }} />
                    <span className="text-xs flex-1 truncate" title={sum.headline}>{ch.name}</span>
                    <ChannelStatusPill status={sum.status} />
                  </div>
                ))}
              </div>
            )}
            {liveImpact && (
              <button
                onClick={toggleSimMode}
                className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs bg-slate-700 hover:bg-slate-600"
                title="Stop live monitoring and open a simulation that starts from the current outages"
              >
                <FlaskConical size={12} />
                Explore impact & what-ifs
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  // ---- Sidebar: end-to-end trace of the isolated channels ----
  const FLOW_STATE_STYLES = {
    active: { opacity: 1, label: 'carrying traffic' },
    standby: { opacity: 0.55, label: 'standby' },
    stranded: { opacity: 0.4, label: 'stranded — no complete route' },
    dead: { opacity: 1, label: 'down' }
  };

  const renderTracePanel = () => {
    if (!analysis || isolatedIds.length === 0) return null;
    const M = analysis.model;
    return (
      <div className="mt-3 space-y-3">
        {isolatedIds.map(chId => {
          const ch = channels.find(c => c.id === chId);
          const flow = analysis.cur.flows.get(chId);
          const sum = analysis.channels.get(chId);
          if (!ch) return null;
          if (!flow) {
            return (
              <div key={chId} className="rounded-lg bg-slate-900/50 border border-slate-700 p-2.5 text-xs text-slate-400">
                <span className="font-medium" style={{ color: ch.color }}>{ch.name}</span> isn’t on any connection yet.
              </div>
            );
          }
          const stages = flowStages(flow);
          return (
            <div key={chId} className="rounded-lg bg-slate-900/50 border p-2.5" style={{ borderColor: `${ch.color}66` }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ch.color }} />
                <span className="text-sm font-medium flex-1 truncate">{ch.name}</span>
                {sum && sum.status !== 'healthy' && <ChannelStatusPill status={sum.status} />}
              </div>
              <p className="text-[11px] text-slate-400 mb-2">
                {flow.sources.length} entry point{flow.sources.length === 1 ? '' : 's'} → {flow.sinks.length} destination{flow.sinks.length === 1 ? '' : 's'} · {Math.max(0, stages.length - 1)} hop{stages.length === 2 ? '' : 's'}
              </p>
              {sum?.status === 'broken' && (
                <p className="text-[11px] text-orange-300 mb-2">
                  {sum.headline}. Check the arrow directions — traffic follows them (use Reverse in the connection drawer).
                </p>
              )}
              <ol className="relative space-y-1.5">
                {stages.map((stage, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="flex flex-col items-center shrink-0">
                      <span
                        className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-semibold"
                        style={{ backgroundColor: `${ch.color}33`, color: ch.color }}
                      >
                        {i + 1}
                      </span>
                      {i < stages.length - 1 && <span className="w-px flex-1 mt-0.5" style={{ backgroundColor: `${ch.color}55` }} />}
                    </span>
                    <span className="flex flex-wrap gap-1 pb-0.5">
                      {stage.map(k => {
                        const st = flow.entityState.get(k) || 'active';
                        const es = statusView ? analysis.cur.entities.get(k) : null;
                        const dotColor = es ? STATUS_COLORS[es.status] : ch.color;
                        return (
                          <button
                            key={k}
                            onClick={() => centerOn(k)}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-slate-700 hover:bg-slate-600 ${st === 'dead' ? 'line-through text-red-300' : ''}`}
                            style={{ opacity: FLOW_STATE_STYLES[st]?.opacity }}
                            title={`${M.label(k)} — ${FLOW_STATE_STYLES[st]?.label}`}
                          >
                            {k.startsWith('z:')
                              ? <Hexagon size={10} style={{ color: dotColor }} />
                              : <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dotColor }} />}
                            {M.label(k)}
                          </button>
                        );
                      })}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
        <p className="text-[11px] text-slate-500">Hover a node on the canvas to trace only the paths through it. Click a hop to center on it.</p>
      </div>
    );
  };


  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white">
      {/* Toolbar */}
      <div className="h-12 bg-slate-800 border-b border-slate-700 flex items-center px-2 gap-1 shrink-0">
        {/* File operations */}
        <div className="flex items-center gap-1 pr-2 border-r border-slate-600">
          <button
            onClick={newDiagram}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title="New Diagram"
          >
            <FilePlus size={18} />
          </button>
          <button
            onClick={openFromDevice}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title="Open File"
          >
            <FolderOpen size={18} />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowRecents(s => !s)}
              className={`p-2 rounded transition-colors ${showRecents ? 'bg-slate-700' : 'hover:bg-slate-700'}`}
              title="Open Recent"
            >
              <History size={18} />
            </button>
            {showRecents && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowRecents(false)} />
                <div className="absolute left-0 top-full mt-1 w-72 bg-slate-800 border border-slate-600 rounded-lg shadow-2xl z-50 py-1">
                  {recentFiles.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-400">
                      No recent files yet — files you open or save on this device will show up here.
                    </p>
                  ) : (
                    recentFiles.map(entry => (
                      <div
                        key={entry.id}
                        onClick={() => openRecent(entry)}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700 cursor-pointer group"
                      >
                        {entry.kind === 'project'
                          ? <Archive size={14} className="text-slate-400 shrink-0" />
                          : <FileText size={14} className="text-slate-400 shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{entry.name}</p>
                          <p className="text-xs text-slate-400">
                            {entry.kind === 'project' ? 'Project' : 'Diagram'} · {timeAgo(entry.lastOpened)}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRecent(entry.id);
                          }}
                          className="p-0.5 rounded hover:bg-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Remove from recents"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
          <button
            onClick={saveProject}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title={projectHandle ? `Save project to ${projectHandle.name} (Ctrl+Shift+S)` : 'Save Project — all tabs in one file (Ctrl+Shift+S)'}
          >
            <Archive size={18} />
          </button>
          <button
            onClick={() => setAutosave(a => !a)}
            className={`p-2 rounded transition-colors text-xs flex items-center gap-1 ${
              autosave
                ? 'bg-emerald-700 text-white hover:bg-emerald-600'
                : 'hover:bg-slate-700 text-slate-400'
            }`}
            title={autosave
              ? 'Autosave on — linked files are written automatically after each change'
              : 'Autosave off — click to enable (link a file with Save or Save Project first)'}
          >
            <Clock size={16} />
            <span>Auto</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={openFile}
            className="hidden"
          />
        </div>

        {/* Export */}
        <div className="flex items-center gap-1 pr-2 border-r border-slate-600">
          <button
            onClick={exportAsSVG}
            disabled={view3d}
            className="p-2 hover:bg-slate-700 rounded transition-colors text-xs flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
            title={view3d ? 'SVG export is 2D only — switch to 2D' : 'Export as SVG'}
          >
            <Download size={16} />
            <span>SVG</span>
          </button>
          <button
            onClick={view3d ? export3dPng : exportAsPNG}
            className="p-2 hover:bg-slate-700 rounded transition-colors text-xs flex items-center gap-1"
            title={view3d ? 'Export the 3D view as PNG' : 'Export as PNG'}
          >
            <Download size={16} />
            <span>PNG</span>
          </button>
        </div>

        {/* Zoom controls (camera controls in 3D) */}
        {view3d ? (
          <div className="flex items-center gap-1 pr-2 border-r border-slate-600">
            <button
              onClick={() => scene3dRef.current?.topView()}
              className="p-2 hover:bg-slate-700 rounded transition-colors text-xs"
              title="Look straight down"
            >
              Top
            </button>
            <button
              onClick={() => scene3dRef.current?.fit()}
              className="p-2 hover:bg-slate-700 rounded transition-colors"
              title="Fit the diagram in view"
            >
              <Maximize size={18} />
            </button>
          </div>
        ) : (
        <div className="flex items-center gap-1 pr-2 border-r border-slate-600">
          <button
            onClick={zoomOut}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title="Zoom Out"
          >
            <ZoomOut size={18} />
          </button>
          <span className="text-xs w-12 text-center">{(zoom * 100).toFixed(0)}%</span>
          <button
            onClick={zoomIn}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title="Zoom In"
          >
            <ZoomIn size={18} />
          </button>
          <button
            onClick={resetView}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title="Reset View"
          >
            <Maximize size={18} />
          </button>
        </div>
        )}

        {/* 2D / 3D */}
        <div className="flex items-center pr-2 border-r border-slate-600">
          <div className="flex rounded bg-slate-900/60 p-0.5" role="group" aria-label="View">
            {[{ id: false, label: '2D' }, { id: true, label: '3D' }].map(opt => (
              <button
                key={opt.label}
                onClick={() => setView3d(opt.id)}
                className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
                  view3d === opt.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'
                }`}
                title={opt.id ? '3D view — orbit around the diagram with 3D models for every node' : 'Flat hex-grid editor'}
                aria-pressed={view3d === opt.id}
              >
                {opt.id && <Axis3d size={14} />}
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Edit operations */}
        <div className="flex items-center gap-1 pr-2 border-r border-slate-600">
          <button
            onClick={() => openNodeCreator()}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title="Add Node"
          >
            <Plus size={18} />
          </button>
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-2 hover:bg-slate-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Undo (Ctrl+Z)"
          >
            <Undo size={18} />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-2 hover:bg-slate-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Redo (Ctrl+Y)"
          >
            <Redo size={18} />
          </button>
          <button
            onClick={copyNode}
            disabled={selectedNodes.length === 0}
            className="p-2 hover:bg-slate-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Copy Selection (Ctrl+C)"
          >
            <Copy size={18} />
          </button>
          <button
            onClick={pasteNode}
            disabled={!clipboard}
            className="p-2 hover:bg-slate-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Paste (Ctrl+V)"
          >
            <Clipboard size={18} />
          </button>
          <button
            onClick={deleteSelectedNodes}
            disabled={selectedNodes.length === 0}
            className="p-2 hover:bg-slate-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Delete Selected"
          >
            <Trash2 size={18} />
          </button>
        </div>

        {/* Outage simulation */}
        <div className="flex items-center gap-1 pr-2 border-r border-slate-600">
          <button
            onClick={toggleSimMode}
            className={`px-2 py-1.5 rounded transition-colors text-xs flex items-center gap-1.5 ${
              simMode
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'hover:bg-slate-700 text-slate-200'
            }`}
            title={simMode
              ? 'Exit outage simulation'
              : 'Outage simulation — fail nodes, links or zones and see what breaks'}
          >
            <FlaskConical size={16} />
            <span>{simMode ? 'Simulating' : 'Simulate'}</span>
            {simMode && simFailureList.length > 0 && (
              <span className="px-1.5 rounded-full bg-white/20 text-[10px]">{simFailureList.length}</span>
            )}
          </button>
          {(() => {
            const total = liveNodeStatus.size;
            const downCount = liveDownList.length;
            const dot = !liveEnabled ? null
              : liveError ? STATUS_COLORS.degraded
              : downCount > 0 ? STATUS_COLORS.down
              : [...liveNodeStatus.values()].some(st => st.status === 'partial') ? STATUS_COLORS.degraded
              : total > 0 ? STATUS_COLORS.healthy : '#64748b';
            return (
              <button
                onClick={() => toggleLive()}
                className={`px-2 py-1.5 rounded transition-colors text-xs flex items-center gap-1.5 ${
                  liveEnabled ? 'bg-slate-700 text-white hover:bg-slate-600' : 'hover:bg-slate-700 text-slate-200'
                }`}
                title={liveEnabled
                  ? (liveError || `Live monitoring on — ${total} monitored node${total === 1 ? '' : 's'}, ${downCount} down`)
                  : 'Live monitoring — check the real addresses attached to nodes'}
              >
                <Activity size={16} className={liveChecking ? 'animate-pulse' : undefined} />
                <span>Live</span>
                {dot && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dot }} />}
                {liveEnabled && downCount > 0 && (
                  <span className="px-1.5 rounded-full bg-red-600 text-white text-[10px]">{downCount}</span>
                )}
              </button>
            );
          })()}
          <button
            onClick={() => setShowMonitorSettings(true)}
            className="p-1.5 hover:bg-slate-700 rounded transition-colors text-slate-400 hover:text-white"
            title="Monitoring settings"
          >
            <Settings size={15} />
          </button>
        </div>

        {/* Breadcrumb in toolbar */}
        {currentPath.length > 1 && (
          <div className="flex items-center gap-1 ml-2 text-sm">
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRight size={14} className="text-slate-500" />}
                <button
                  onClick={() => navigateUp(crumb.index)}
                  className={`px-2 py-1 rounded hover:bg-slate-700 transition-colors ${
                    i === breadcrumbs.length - 1 ? 'text-blue-400 font-medium' : 'text-slate-300'
                  }`}
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Status info on right */}
        <div className="ml-auto flex items-center gap-4 text-xs text-slate-400">
          <span>Nodes: {nodes.length}</span>
          <span>Connections: {connections.length}</span>
          <span>Zones: {zones.length}</span>
          {connectingFrom && (
            <span className="text-amber-400">
              Connecting from: {connectingFrom.label} — click a node to link, or an empty cell to create one
            </span>
          )}
          {selectedNodes.length > 1 && (
            <span className="text-blue-400">Selected: {selectedNodes.length}</span>
          )}
          {clipboard && (
            <span className="text-green-400">
              Copied: {clipboard.type === 'nodes' ? `${clipboard.data.nodes.length} nodes` : clipboard.data?.label}
            </span>
          )}
        </div>
      </div>

      {/* Tabs bar */}
      <div className="h-9 bg-slate-850 border-b border-slate-700 flex items-center px-1 gap-1 shrink-0 overflow-x-auto scrollbar-thin"
           style={{ backgroundColor: '#1a2332' }}>
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-t text-sm cursor-pointer group ${
              tab.id === activeTabId
                ? 'bg-slate-800 text-white'
                : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
            onClick={() => setActiveTabId(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setTabMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
            }}
          >
            <span
              className="max-w-32 truncate"
              title={tab.fileHandle ? `Linked to ${tab.fileHandle.name}` : tab.name}
              onDoubleClick={(e) => {
                e.stopPropagation();
                const newName = prompt('Rename tab:', tab.name);
                if (newName) renameTab(tab.id, newName);
              }}
            >
              {tab.fileHandle && <span className="text-emerald-400 mr-1">●</span>}
              {tab.name}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="ml-1 p-0.5 rounded hover:bg-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <button
          onClick={() => addTab('Untitled')}
          className="p-1.5 hover:bg-slate-700 rounded transition-colors text-slate-400 hover:text-white"
          title="New Tab"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Tab context menu */}
      {tabMenu && (() => {
        const menuTab = tabs.find(t => t.id === tabMenu.tabId);
        if (!menuTab) return null;
        return (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setTabMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setTabMenu(null); }}
            />
            <div
              className="fixed z-50 w-48 bg-slate-800 border border-slate-600 rounded-lg shadow-2xl py-1"
              style={{ left: tabMenu.x, top: tabMenu.y }}
            >
              <button
                onClick={() => {
                  setTabMenu(null);
                  const newName = prompt('Rename tab:', menuTab.name);
                  if (newName) renameTab(menuTab.id, newName);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-slate-700 transition-colors"
              >
                <Edit2 size={14} />
                Rename
              </button>
              <button
                onClick={() => {
                  setTabMenu(null);
                  saveTabToFile(menuTab.id);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-slate-700 transition-colors"
                title={menuTab.fileHandle ? `Save to ${menuTab.fileHandle.name}` : 'Save this tab to a file'}
              >
                <Save size={14} />
                Save Page
              </button>
            </div>
          </>
        );
      })()}

      <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 bg-slate-800 p-4 border-r border-slate-700 overflow-y-auto scrollbar-thin">
        {simMode ? renderSimPanel() : (<>
        <h2 className="text-xl font-bold mb-4">Nodex</h2>
        {liveEnabled && renderLivePanel()}
        
        <button
          onClick={() => openNodeCreator()}
          className="w-full flex items-center justify-center gap-2 p-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors mb-2"
        >
          <Plus size={20} />
          Create Node
        </button>

        {!isCreatingZone ? (
          <div className="mb-6">
            <p className="text-xs text-slate-400 mb-2">Create Zone</p>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => {
                  setZoneShape('rectangle');
                  startZoneCreation();
                }}
                className="flex-1 flex items-center justify-center gap-1 p-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors text-sm"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="2" width="12" height="12" rx="1" />
                </svg>
                Rect
              </button>
              <button
                onClick={() => {
                  setZoneShape('hexagon');
                  startZoneCreation();
                }}
                className="flex-1 flex items-center justify-center gap-1 p-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors text-sm"
              >
                <Hexagon size={14} />
                Hex
              </button>
              <button
                onClick={() => {
                  setZoneShape('circular');
                  startZoneCreation();
                }}
                className="flex-1 flex items-center justify-center gap-1 p-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors text-sm"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="8" cy="8" r="6" />
                </svg>
                Circle
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={cancelZoneCreation}
            className="w-full flex items-center justify-center gap-2 p-3 bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors mb-6"
          >
            <X size={20} />
            Cancel Zone Selection
          </button>
        )}

        {isCreatingZone && (
          <div className="mb-4 p-3 bg-amber-900/30 border border-amber-600 rounded-lg text-sm">
            <p className="text-amber-200 font-medium mb-1">
              {zoneShape === 'rectangle' ? 'Rectangle' : zoneShape === 'hexagon' ? 'Hexagon' : 'Circular'} Zone Mode
            </p>
            <p className="text-amber-300/80 text-xs">
              {zoneShape === 'rectangle'
                ? 'Click and drag to select a rectangular area.'
                : zoneShape === 'hexagon'
                ? 'Click the center, drag outward — hex-shaped zone.'
                : 'Click the center, drag outward — round zone.'}
            </p>
            {(zoneShape === 'hexagon' || zoneShape === 'circular') && selectedZoneCells.length > 0 && (
              <p className="text-amber-200 text-xs mt-1">Size: {zoneRadius}</p>
            )}
          </div>
        )}

        <div className="mb-6 pt-4 border-t border-slate-700">
          <button
            onClick={() => setShowShortcuts(s => !s)}
            className="w-full flex items-center gap-1 text-sm font-semibold text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ChevronRight
              size={14}
              className={`transition-transform ${showShortcuts ? 'rotate-90' : ''}`}
            />
            Shortcuts
          </button>
          {showShortcuts && (
          <ul className="text-xs space-y-1 text-slate-300 mt-3">
            <li><kbd className="px-1 bg-slate-600 rounded">Drag canvas</kbd> Box-select nodes</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Ctrl+Click</kbd> Add/remove from selection</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Ctrl+A</kbd> Select all nodes</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Ctrl+C</kbd> Copy selection</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Ctrl+V</kbd> Paste</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Ctrl+D</kbd> Duplicate selection</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Ctrl+Z</kbd> Undo</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Ctrl+Y</kbd> Redo</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Ctrl+S</kbd> Save tab</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Ctrl+Shift+S</kbd> Save project</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Shift+Click</kbd> Open nested diagram</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Double-click</kbd> Start connecting</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Right-click</kbd> Edit node</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Delete</kbd> Remove selected</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Scroll</kbd> Zoom in/out</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Shift+Drag</kbd> Pan canvas</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Esc</kbd> Cancel action</li>
          </ul>
          )}
        </div>

        {selectedNode && (
          <div className="mb-4 p-4 bg-slate-700 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-semibold">Selected Node</h3>
              <button
                onClick={() => openNodeEditor(selectedNode)}
                className="text-blue-400 hover:text-blue-300"
              >
                <Edit2 size={16} />
              </button>
            </div>
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2">
                {React.createElement(
                  AVAILABLE_ICONS.find(i => i.id === selectedNode.iconId)?.icon || Server,
                  { size: 20, style: { color: selectedNode.color } }
                )}
                <p className="font-medium">{selectedNode.label}</p>
                {hasNestedDiagram(selectedNode.id) && (
                  <span className="text-xs bg-blue-600 px-1.5 py-0.5 rounded">Has children</span>
                )}
              </div>
              {selectedNode.description && (
                <p className="text-xs text-slate-300 mb-2">{selectedNode.description}</p>
              )}
              {(selectedNode.endpoints || []).length > 0 && (
                <div className="mt-2 space-y-1">
                  {selectedNode.endpoints.map(ep => {
                    const st = liveEnabled ? liveState.get(endpointKey(selectedNode.id, ep)) : null;
                    const up = uptimePercent(st);
                    return (
                      <div key={ep.id} className="flex items-center gap-2 text-xs">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: st ? LIVE_COLORS[st.status] : '#475569' }}
                          title={st ? LIVE_LABELS[st.status] : 'Live monitoring is off'}
                        />
                        <span className="text-slate-400 shrink-0">{checkType(ep.check).label}</span>
                        <span className="font-mono truncate flex-1" title={endpointLabel(ep)}>{endpointLabel(ep)}</span>
                        {st?.last && (
                          <span className="text-slate-400 shrink-0" title={st.last.error || st.last.detail || ''}>
                            {st.last.up ? `${Math.round(st.last.latencyMs ?? 0)} ms` : st.last.up === false ? 'down' : '?'}
                            {up != null && ` · ${up}%`}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {/* Recent check history, newest on the right */}
                  {liveEnabled && (() => {
                    const hist = selectedNode.endpoints
                      .map(ep => liveState.get(endpointKey(selectedNode.id, ep))?.history || []);
                    const len = Math.max(0, ...hist.map(h => h.length));
                    if (len === 0) return null;
                    const cols = Array.from({ length: len }, (_, i) => hist.map(h => h[h.length - len + i]).filter(Boolean));
                    return (
                      <div className="flex gap-px pt-1" title="Recent checks (all addresses)">
                        {cols.map((col, i) => {
                          const known = col.filter(c => c.up !== null);
                          const color = known.length === 0 ? LIVE_COLORS.unknown
                            : known.every(c => c.up) ? LIVE_COLORS.up
                            : known.some(c => c.up) ? LIVE_COLORS.partial : LIVE_COLORS.down;
                          return <span key={i} className="h-3 flex-1 rounded-sm" style={{ backgroundColor: color, opacity: 0.85 }} />;
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => navigateToNode(selectedNode)}
                className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors"
              >
                Open Diagram
              </button>
              <button
                onClick={deleteSelectedNodes}
                className="px-3 py-1.5 bg-red-500 hover:bg-red-600 rounded text-sm transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        )}

        {selectedNodes.length > 1 && (
          <div className="mb-4 p-4 bg-slate-700 rounded-lg">
            <h3 className="text-sm font-semibold mb-2">{selectedNodes.length} nodes selected</h3>
            <p className="text-xs text-slate-300 mb-3">
              Drag any selected node to move the group. Ctrl+Click to add/remove nodes.
            </p>
            <div className="flex gap-2">
              <button
                onClick={copyNode}
                className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors"
              >
                Copy Group
              </button>
              <button
                onClick={deleteSelectedNodes}
                className="px-3 py-1.5 bg-red-500 hover:bg-red-600 rounded text-sm transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        )}

        {selectedConnections.length > 0 && (
          <div className="mb-4 p-4 bg-slate-700 rounded-lg">
            <h3 className="text-sm font-semibold mb-2">
              {selectedConnections.length} connection{selectedConnections.length > 1 ? 's' : ''} selected
            </h3>
            <p className="text-xs text-slate-300 mb-3">
              Changes below apply to all of them. Ctrl+Click lines to add/remove.
            </p>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-slate-400 mb-1">Color</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => updateSelectedConnections({ color: null })}
                    className="w-6 h-6 rounded"
                    style={{ backgroundColor: '#64748b' }}
                    title="Default"
                  />
                  {COLOR_PALETTE.map(color => (
                    <button
                      key={color}
                      onClick={() => updateSelectedConnections({ color })}
                      className="w-6 h-6 rounded"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Line Style</p>
                <div className="flex flex-wrap gap-1">
                  {LINE_TYPES.map(lt => (
                    <button
                      key={lt.id}
                      onClick={() => updateSelectedConnections({ lineType: lt.id })}
                      className="px-2 py-1 rounded text-xs bg-slate-600 hover:bg-slate-500 transition-colors"
                    >
                      {lt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Route</p>
                <div className="flex gap-1">
                  <button
                    onClick={() => updateSelectedConnections({ routing: 'direct' })}
                    className="flex-1 px-2 py-1 rounded text-xs bg-slate-600 hover:bg-slate-500 transition-colors"
                  >
                    Direct
                  </button>
                  <button
                    onClick={() => updateSelectedConnections({ routing: 'angled' })}
                    className="flex-1 px-2 py-1 rounded text-xs bg-slate-600 hover:bg-slate-500 transition-colors"
                  >
                    Angled
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <select
                  onChange={(e) => setBulkPointer('start', e.target.value)}
                  defaultValue=""
                  className="flex-1 px-2 py-1 bg-slate-600 rounded text-xs"
                >
                  <option value="" disabled>Start pointer…</option>
                  {['none', 'arrow', 'open', 'circle', 'diamond'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <select
                  onChange={(e) => setBulkPointer('end', e.target.value)}
                  defaultValue=""
                  className="flex-1 px-2 py-1 bg-slate-600 rounded text-xs"
                >
                  <option value="" disabled>End pointer…</option>
                  {['none', 'arrow', 'open', 'circle', 'diamond'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Link type</p>
                <div className="flex gap-1 mb-1">
                  <button
                    onClick={() => updateSelectedConnections({ kind: undefined, required: undefined })}
                    className="flex-1 px-2 py-1 rounded text-xs bg-slate-600 hover:bg-slate-500 transition-colors"
                    title="Plain traffic links (not required, not peer)"
                  >
                    Traffic
                  </button>
                  <button
                    onClick={() => updateSelectedConnections({ required: true, kind: undefined })}
                    className="flex-1 px-2 py-1 rounded text-xs bg-slate-600 hover:bg-slate-500 transition-colors"
                    title="Traffic links where the source requires the target"
                  >
                    Required
                  </button>
                </div>
                <select
                  onChange={(e) => {
                    if (e.target.value) updateSelectedConnections({ kind: 'peer', peerMode: e.target.value });
                    e.target.value = '';
                  }}
                  defaultValue=""
                  className="w-full px-2 py-1 bg-slate-600 rounded text-xs"
                >
                  <option value="" disabled>Make peer links…</option>
                  {PEER_MODES.map(m => <option key={m.id} value={m.id}>Peer — {m.label}</option>)}
                </select>
              </div>
              {channels.length > 0 && (
                <div>
                  <p className="text-xs text-slate-400 mb-1">Channels (toggle on all)</p>
                  <div className="flex flex-wrap gap-1">
                    {channels.map(ch => (
                      <button
                        key={ch.id}
                        onClick={() => toggleBulkChannel(ch.id)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-slate-600 hover:bg-slate-500 transition-colors"
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ch.color }} />
                        {ch.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={deleteSelectedConnections}
                className="w-full px-3 py-1.5 bg-red-500 hover:bg-red-600 rounded text-sm transition-colors"
              >
                Delete Connections
              </button>
            </div>
          </div>
        )}

        {selectedZone && (
          <div className="mb-4 p-4 bg-slate-700 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-semibold">Selected Zone</h3>
              <button
                onClick={() => openZoneEditor(selectedZone)}
                className="text-blue-400 hover:text-blue-300"
              >
                <Edit2 size={16} />
              </button>
            </div>
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2">
                <div 
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: selectedZone.color }}
                />
                <p className="font-medium">{selectedZone.label}</p>
              </div>
              <p className="text-xs text-slate-300">
                {selectedZone.cells.length} cells · {ZONE_POLICIES.find(p => p.id === getZonePolicy(selectedZone).mode)?.label}
              </p>
              <p className="text-xs text-slate-400 mt-1">Middle-drag this selected zone to move it (nodes on it come along). Drag the round handle to resize.</p>
            </div>
            <button
              onClick={() => deleteZone(selectedZone.id)}
              className="w-full px-3 py-1.5 bg-red-500 hover:bg-red-600 rounded text-sm transition-colors"
            >
              Delete Zone
            </button>
          </div>
        )}

        {/* Zones List */}
        {zones.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold mb-2 text-slate-400">Zones</h3>
            <div className="space-y-1">
              {zones.map(zone => (
                <button
                  key={zone.id}
                  onClick={() => {
                    setSelectedZone(zone);
                    setSelectedNode(null);
                  }}
                  className={`w-full flex items-center gap-2 p-2 rounded text-left text-sm transition-colors ${
                    selectedZone?.id === zone.id ? 'bg-slate-600' : 'hover:bg-slate-700'
                  }`}
                >
                  <div 
                    className="w-3 h-3 rounded"
                    style={{ backgroundColor: zone.color }}
                  />
                  {zone.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Channels */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-400">Channels</h3>
            <button
              onClick={() => setChannelForm({ id: null, name: '', color: COLOR_PALETTE[0] })}
              className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Add Channel"
            >
              <Plus size={14} />
            </button>
          </div>
          {channels.length === 0 && !channelForm && (
            <p className="text-xs text-slate-500">
              Channels are colored flows that run through connections — and can split and converge across them. Add one, then toggle it on connections.
            </p>
          )}
          <div className="space-y-1">
            {channels.map(ch => {
              const on = isolatedIds.includes(ch.id);
              return (
              <div
                key={ch.id}
                className={`flex items-center gap-2 p-2 rounded group text-sm cursor-pointer ${on ? 'bg-slate-700' : 'hover:bg-slate-700'}`}
                onClick={() => toggleIsolation(ch.id)}
                onMouseEnter={() => setHoverChannelId(ch.id)}
                onMouseLeave={() => setHoverChannelId(null)}
                title={on ? 'Click to stop isolating' : 'Click to isolate this flow on the canvas'}
              >
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: ch.color }} />
                <span className="flex-1 truncate">{ch.name}</span>
                <Focus size={13} className={on ? 'text-white' : 'text-slate-500 opacity-0 group-hover:opacity-100'} />
                <button
                  onClick={(e) => { e.stopPropagation(); setChannelForm({ id: ch.id, name: ch.name, color: ch.color }); }}
                  className="opacity-0 group-hover:opacity-100 text-blue-400 hover:text-blue-300 transition-opacity"
                >
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteChannel(ch.id); }}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              );
            })}
          </div>
          {renderTracePanel()}
          {channelForm && (
            <div className="mt-2 p-3 bg-slate-700 rounded-lg space-y-2">
              <input
                type="text"
                value={channelForm.name}
                onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') saveChannelForm(); }}
                placeholder="e.g., Public traffic"
                autoFocus
                className="w-full px-2 py-1.5 bg-slate-800 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-sm"
              />
              <div className="flex flex-wrap gap-1.5">
                {COLOR_PALETTE.map(color => (
                  <button
                    key={color}
                    onClick={() => setChannelForm({ ...channelForm, color })}
                    className={`w-5 h-5 rounded ${channelForm.color === color ? 'ring-2 ring-white' : ''}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveChannelForm}
                  disabled={!channelForm.name.trim()}
                  className="flex-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded text-xs transition-colors"
                >
                  {channelForm.id != null ? 'Update' : 'Add'} Channel
                </button>
                <button
                  onClick={() => setChannelForm(null)}
                  className="px-2 py-1 bg-slate-600 hover:bg-slate-500 rounded text-xs transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {(nodes.length > 0 || zones.length > 0) && (
          <button
            onClick={clearAll}
            className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors"
          >
            Clear All
          </button>
        )}
        </>)}
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="flex-1 relative overflow-hidden select-none"
        onMouseDown={view3d ? undefined : handleCanvasMouseDown}
        onMouseMove={view3d ? undefined : handleCanvasMouseMove}
        onMouseLeave={view3d ? undefined : handleCanvasMouseLeave}
        onWheel={view3d ? undefined : handleWheel}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          cursor: view3d ? 'default' : isPanning || isDraggingZone ? 'grabbing' : simMode ? 'grab' : isCreatingZone ? 'crosshair' : connectingFrom ? 'crosshair' : resizingZone ? 'nwse-resize' : 'default'
        }}
      >
        {/* File drop overlay — pointer-events-none so it never steals the
            drag events that keep it visible */}
        {isDraggingFile && (
          <div className="fixed inset-0 bg-blue-500 bg-opacity-20 border-4 border-dashed border-blue-400 z-50 flex items-center justify-center pointer-events-none">
            <div className="bg-slate-800 px-6 py-4 rounded-lg shadow-lg text-center">
              <FolderOpen size={48} className="mx-auto mb-2 text-blue-400" />
              <p className="text-lg font-medium">Drop .json file to open</p>
            </div>
          </div>
        )}
        {/* Channel trace bar — click to isolate one or more flows, hover to
            preview one on its own */}
        {channels.length > 0 && !isCreatingZone && (
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-2 py-1 rounded-full bg-slate-800/90 backdrop-blur border border-slate-600 shadow-xl max-w-[calc(100%-2rem)] overflow-x-auto scrollbar-thin"
            onMouseDown={(e) => e.stopPropagation()}
            onMouseLeave={() => setHoverChannelId(null)}
          >
            <span className="flex items-center gap-1 pl-1 pr-2 text-xs text-slate-400 shrink-0" title="Isolate traffic channels">
              <Workflow size={14} />
              Trace
            </span>
            {channels.map(ch => {
              const on = isolatedIds.includes(ch.id);
              const chStatus = statusView && analysis ? analysis.channels.get(ch.id)?.status : null;
              return (
                <button
                  key={ch.id}
                  onClick={() => toggleIsolation(ch.id)}
                  onMouseEnter={() => setHoverChannelId(ch.id)}
                  onMouseLeave={() => setHoverChannelId(null)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs shrink-0 transition-colors border ${
                    on ? 'text-white' : 'text-slate-300 border-transparent hover:bg-slate-700'
                  }`}
                  style={on ? { backgroundColor: `${ch.color}33`, borderColor: ch.color } : undefined}
                  title={on ? `Stop isolating ${ch.name}` : `Isolate ${ch.name}`}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ch.color }} />
                  {ch.name}
                  {chStatus && chStatus !== 'healthy' && (
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: CHANNEL_STATUS[chStatus]?.color }}
                      title={CHANNEL_STATUS[chStatus]?.label}
                    />
                  )}
                </button>
              );
            })}
            {isolatedIds.length > 0 && (
              <button
                onClick={clearIsolation}
                className="ml-1 p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-700 shrink-0"
                title="Show all traffic"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {/* Simulation strip */}
        {simMode && (
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 pl-3 pr-1.5 py-1.5 rounded-full bg-slate-800/95 backdrop-blur border border-red-500/60 shadow-xl text-xs whitespace-nowrap"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span className="flex items-center gap-1.5 text-red-300 font-semibold">
              <FlaskConical size={14} />
              Outage simulation
            </span>
            <span className="text-slate-400 hidden md:inline">Click nodes, links or zones to fail / restore</span>
            {analysis && (
              <span className="flex items-center gap-2 text-slate-300">
                {['healthy', 'degraded', 'down'].map(st => (
                  <span key={st} className="flex items-center gap-1" title={`${STATUS_LABELS[st]} components`}>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[st] }} />
                    {analysis.cur.counts[st]}
                  </span>
                ))}
              </span>
            )}
            <button
              onClick={resetFailures}
              disabled={simFailureList.length === 0}
              className="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCcw size={12} />
              Reset
            </button>
            <button
              onClick={toggleSimMode}
              className="px-2.5 py-1 rounded-full bg-red-600 hover:bg-red-500 text-white"
            >
              Exit
            </button>
          </div>
        )}

        {/* Legend */}
        {(statusView || focus || liveEnabled) && (
          <div className="absolute bottom-4 left-4 z-10 px-3 py-2 rounded-lg bg-slate-800/90 backdrop-blur border border-slate-700 text-[11px] text-slate-300 space-y-1 pointer-events-none">
            {liveEnabled && (
              <div className="flex items-center gap-2 pb-0.5">
                <span className="relative flex items-center justify-center w-2.5 h-2.5">
                  <span className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: LIVE_COLORS.up, backgroundColor: '#0f172a' }} />
                </span>
                Live check (bottom-left dot)
              </div>
            )}
            {statusView && (
              <>
                {['healthy', 'degraded', 'down'].map(st => (
                  <div key={st} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[st] }} />
                    {STATUS_LABELS[st]}
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <PowerOff size={11} className="text-red-400" />
                  {simMode ? 'Failed (injected)' : 'Down (live check)'}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 font-bold w-2.5 text-center">↻</span>
                  Covered by failover
                </div>
              </>
            )}
            {focus && (
              <>
                <div className="flex items-center gap-2">
                  <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#e2e8f0" strokeWidth="2" /><line className="nx-flow" x1="0" y1="3" x2="22" y2="3" stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" strokeDasharray="0.5 13.5" /></svg>
                  Carrying traffic
                </div>
                <div className="flex items-center gap-2">
                  <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#e2e8f0" strokeWidth="2" strokeDasharray="6,5" opacity="0.5" /></svg>
                  Standby
                </div>
                <div className="flex items-center gap-2">
                  <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#e2e8f0" strokeWidth="2" strokeDasharray="2,4" opacity="0.4" /></svg>
                  Stranded (no complete route)
                </div>
                <div className="text-slate-500 pt-0.5">Hover a node to trace paths through it</div>
              </>
            )}
          </div>
        )}

        {/* Hover card — a component's status and why (simulation / live
            impact), plus the live check result of each of its addresses */}
        {!view3d && (simMode || liveEnabled) && (() => {
          let key = null;
          let kind = null;
          if (hoveredNode != null) { key = nodeKey(hoveredNode); kind = 'Node'; }
          else if (hoveredConnection != null) { key = connKey(hoveredConnection); kind = 'Link'; }
          else if (hoveredZone != null) { key = zoneKey(hoveredZone); kind = 'Zone'; }
          if (!key) return null;
          const live = kind === 'Node' ? liveNodeStatus.get(hoveredNode) : null;
          const showStatus = statusView && analysis;
          if (!showStatus && !live) return null;

          let title = kind === 'Node' ? nodes.find(n => n.id === hoveredNode)?.label : '';
          let status = null;
          let reasons = [];
          let failed = simFailures.has(key);
          const liveDown = liveDownSet.has(key);
          let extra = null;
          if (showStatus) {
            if (kind === 'Link') {
              const cs = analysis.cur.conns.get(hoveredConnection);
              if (!cs) return null;
              title = analysis.model.connLabel(hoveredConnection);
              status = cs.status === 'ok' ? 'healthy' : 'down';
              if (cs.reason) reasons = [cs.reason];
              const conn = connections.find(c => c.id === hoveredConnection);
              if (conn?.kind === 'peer') {
                extra = `Peer link · ${PEER_MODES.find(m => m.id === (conn.peerMode || 'failover'))?.label}`;
              } else if (conn?.required) {
                extra = 'Required dependency';
              }
            } else {
              const es = analysis.cur.entities.get(key);
              if (!es) return null;
              title = analysis.model.label(key);
              status = es.status;
              reasons = es.reasons;
              failed = es.failed && !liveDown;
              if (es.coveredBy) extra = `Role taken over by ${analysis.model.label(es.coveredBy)}`;
              else if (es.holder) extra = `VIP held by ${analysis.model.label(es.holder)}`;
              if (kind === 'Zone') {
                const z = zones.find(zz => zoneKey(zz.id) === key);
                const pol = ZONE_POLICIES.find(p => p.id === getZonePolicy(z).mode);
                extra = [extra, `Policy: ${pol?.label}`].filter(Boolean).join(' · ');
              }
            }
          }
          const height = 150 + (live ? live.endpoints.length * 18 : 0);
          const left = Math.min(mousePos.x * zoom + viewOffset.x + 16, canvasSize.width - 330);
          const top = Math.min(mousePos.y * zoom + viewOffset.y + 16, canvasSize.height - height);
          return (
            <div
              className="absolute z-30 w-80 px-3 py-2 rounded-lg bg-slate-900/95 border border-slate-600 shadow-2xl text-xs pointer-events-none"
              style={{ left, top }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-slate-500 uppercase tracking-wide text-[10px]">{kind}</span>
                <span className="font-semibold text-slate-100 truncate flex-1">{title}</span>
              </div>
              {status && (
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] }} />
                  <span style={{ color: STATUS_COLORS[status] }} className="font-medium">
                    {liveDown ? 'Down (live check)' : failed ? 'Failed (injected)' : STATUS_LABELS[status]}
                  </span>
                </div>
              )}
              {reasons.filter(r => !/^Failed \(simulated|Link failed \(simulated/.test(r)).map((r, i) => (
                <p key={i} className="text-slate-300">• {r}</p>
              ))}
              {extra && <p className="text-amber-300 mt-0.5">{extra}</p>}
              {live && (
                <div className={status ? 'mt-1.5 pt-1.5 border-t border-slate-700' : ''}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: LIVE_COLORS[live.status] }} />
                    <span className="font-medium" style={{ color: LIVE_COLORS[live.status] }}>Live: {LIVE_LABELS[live.status]}</span>
                  </div>
                  {live.endpoints.map(({ ep, st }) => (
                    <div key={ep.id} className="flex items-center gap-1.5 text-slate-300">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: LIVE_COLORS[st?.status || 'pending'] }} />
                      <span className="font-mono truncate">{checkType(ep.check).label} {endpointLabel(ep)}</span>
                      <span className="ml-auto shrink-0 text-slate-400">
                        {st?.last?.up ? `${Math.round(st.last.latencyMs ?? 0)} ms` : <span className="block max-w-[8rem] truncate" title={st?.last?.error}>{st?.last?.error || '…'}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {simMode && <p className="text-slate-500 mt-1">Click to {failed ? 'restore' : 'fail'}</p>}
            </div>
          );
        })()}

        {view3d && (
          <>
            <React.Suspense fallback={
              <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">Loading 3D view…</div>
            }>
            <Scene3D
              ref={scene3dRef}
              nodes={nodes}
              zones={zones}
              connections={connections}
              connGeoms={connGeoms}
              zoneLabels={zoneLabels3d}
              visuals={visuals3d}
              axialToPixel={axialToPixel}
              hexSize={HEX_SIZE}
              fitKey={viewKey}
              onPick={handle3dPick}
              onContextPick={handle3dContext}
              onHover={handle3dHover}
              describe={describe3d}
              onModelStatus={(id, err) => setModelErrors(prev => (prev[id] === (err || undefined) ? prev : { ...prev, [id]: err || undefined }))}
            />
            </React.Suspense>
            {show3dHelp ? (
              <div className="absolute top-4 right-4 z-10 pl-3 pr-7 py-2 rounded-lg bg-slate-800/90 backdrop-blur border border-slate-700 text-[11px] text-slate-400 leading-relaxed">
                <div><span className="text-slate-200">Drag</span> orbit · <span className="text-slate-200">Right / Shift-drag</span> pan · <span className="text-slate-200">Scroll</span> zoom</div>
                <div>
                  <span className="text-slate-200">Click</span> {simMode ? 'fail / restore' : 'select'} · <span className="text-slate-200">Right-click</span> edit · <span className="text-slate-200">Shift+Click</span> open · <span className="text-slate-200">Double-click</span> focus
                </div>
                <button
                  onClick={() => toggle3dHelp(false)}
                  className="absolute top-1.5 right-1.5 text-slate-500 hover:text-white"
                  title="Hide"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => toggle3dHelp(true)}
                className="absolute top-4 right-4 z-10 w-7 h-7 rounded-full bg-slate-800/90 border border-slate-700 text-xs text-slate-400 hover:text-white"
                title="3D controls"
              >
                ?
              </button>
            )}
          </>
        )}
        {!view3d && (
        <svg className="nx-canvas w-full h-full">
          <g transform={`translate(${viewOffset.x}, ${viewOffset.y}) scale(${zoom})`}>
            {/* Zone backgrounds */}
            {zones.map(zone => (
              (() => {
                const cellSet = new Set(zone.cells.map(c => `${c.q},${c.r}`));
                const isConnectTarget = connectingFrom && hoveredZone === zone.id &&
                  !(connectingFrom.kind === 'zone' && connectingFrom.id === zone.id);
                const isZoneSelected = selectedZone?.id === zone.id;
                const EDGE_DIRS = HEX_EDGE_DIRS;
                const zk = zoneKey(zone.id);
                const zs = entityStatus(zk);
                const zoneDimmed = focus && !focus.ents.has(zk) && !focus.contextZones.has(zone.id);
                const isSimHover = simMode && hoveredZone === zone.id && hoveredNode == null && hoveredConnection == null;
                let outline = isConnectTarget ? '#22c55e' : zone.color;
                let outlineWidth = isConnectTarget || isZoneSelected ? 2.5 : 1.5;
                let outlineDash = null;
                if (zs && zs.status !== 'healthy') {
                  outline = STATUS_COLORS[zs.status];
                  outlineWidth = zs.failed ? 3 : 2.5;
                  outlineDash = zs.status === 'down' && !zs.failed ? '6,4' : null;
                }
                if (isSimHover) outlineWidth += 1;
                return (
                  <g
                    key={`zone-${zone.id}`}
                    opacity={zoneDimmed ? 0.25 : 1}
                    style={{ transition: 'opacity 200ms' }}
                    onClick={(e) => handleZoneClick(e, zone)}
                    onDoubleClick={(e) => handleZoneDoubleClick(e, zone)}
                    onMouseDown={(e) => handleZoneMouseDown(e, zone)}
                    onMouseEnter={() => setHoveredZone(zone.id)}
                    onMouseLeave={() => setHoveredZone(null)}
                  >
                    {zone.cells.map(cell => {
                      const pos = axialToPixel(cell.q, cell.r);
                      return (
                        <polygon
                          key={`zone-${zone.id}-${cell.q}-${cell.r}`}
                          points={getHexagonPoints(pos.x, pos.y, HEX_SIZE)}
                          fill={zone.color}
                          opacity={isConnectTarget ? 0.35 : isZoneSelected ? 0.4 : isSimHover ? 0.3 : zs?.status === 'down' ? 0.1 : 0.2}
                          className="cursor-pointer transition-opacity"
                        />
                      );
                    })}
                    {/* Failed zone: red hatch over every cell */}
                    {zs?.failed && zone.cells.map(cell => {
                      const pos = axialToPixel(cell.q, cell.r);
                      return (
                        <polygon
                          key={`zhatch-${zone.id}-${cell.q}-${cell.r}`}
                          points={getHexagonPoints(pos.x, pos.y, HEX_SIZE)}
                          fill="url(#nx-hatch)"
                          pointerEvents="none"
                        />
                      );
                    })}
                    {/* Outer silhouette: only edges not shared with another
                        cell of this zone — makes the zone's true extent
                        obvious (0.2-opacity fills alone vanish on dark bg,
                        so connection endpoints looked like they floated) */}
                    {zone.cells.flatMap(cell => {
                      const pos = axialToPixel(cell.q, cell.r);
                      return EDGE_DIRS
                        .filter(d => !cellSet.has(`${cell.q + d.dq},${cell.r + d.dr}`))
                        .map(d => {
                          const a1 = (Math.PI / 3) * d.vi;
                          const a2 = (Math.PI / 3) * (d.vi + 1);
                          return (
                            <line
                              key={`zedge-${zone.id}-${cell.q}-${cell.r}-${d.vi}`}
                              x1={pos.x + HEX_SIZE * Math.cos(a1)}
                              y1={pos.y + HEX_SIZE * Math.sin(a1)}
                              x2={pos.x + HEX_SIZE * Math.cos(a2)}
                              y2={pos.y + HEX_SIZE * Math.sin(a2)}
                              stroke={outline}
                              strokeWidth={outlineWidth}
                              strokeDasharray={outlineDash}
                              opacity="0.9"
                              strokeLinecap="round"
                              pointerEvents="none"
                            />
                          );
                        });
                    })}
                  </g>
                );
              })()
            ))}

            {/* Zone labels */}
            {zones.map(zone => {
              if (zone.cells.length === 0 || !zone.label) return null;
              const layout = getZoneLabelLayout(zone);
              const zk = zoneKey(zone.id);
              const zs = entityStatus(zk);
              const dimmed = focus && !focus.ents.has(zk) && !focus.contextZones.has(zone.id);
              return (
                <text
                  key={`zone-label-${zone.id}`}
                  x={layout.x}
                  y={layout.y}
                  fill={zone.color}
                  fontSize="14"
                  fontWeight="bold"
                  textAnchor={layout.textAnchor}
                  pointerEvents="none"
                  opacity={dimmed ? 0.25 : 1}
                  style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)', transition: 'opacity 200ms' }}
                >
                  {zone.label}
                  {zs && zs.status !== 'healthy' && (
                    <tspan fill={STATUS_COLORS[zs.status]} fontSize="11">
                      {'  '}{zs.failed ? '⏻ FAILED' : zs.status === 'down' ? '● DOWN' : '● DEGRADED'}
                    </tspan>
                  )}
                </text>
              );
            })}

            {/* Zone selection preview */}
            {selectedZoneCells.map(cell => {
              const pos = axialToPixel(cell.q, cell.r);
              return (
                <polygon
                  key={`selection-${cell.q}-${cell.r}`}
                  points={getHexagonPoints(pos.x, pos.y, HEX_SIZE)}
                  fill="#f59e0b"
                  opacity="0.3"
                  stroke="#f59e0b"
                  strokeWidth="2"
                />
              );
            })}

            {/* Grid hexagons */}
            {gridHexagons.map(({ q, r, x, y }) => (
              <polygon
                key={`${q},${r}`}
                points={getHexagonPoints(x, y, HEX_SIZE)}
                fill="none"
                stroke="#334155"
                strokeWidth="1"
                opacity="0.3"
              />
            ))}

            {/* Hovered cell with plus button */}
            {hoveredCell && !isCreatingZone && !simMode && (
              <g 
                transform={`translate(${axialToPixel(hoveredCell.q, hoveredCell.r).x}, ${axialToPixel(hoveredCell.q, hoveredCell.r).y})`}
                onClick={(e) => {
                  e.stopPropagation();
                  const { q, r } = hoveredCell;
                  const openCreatorHere = () => {
                    openNodeCreator(q, r);
                    if (connectingFrom) {
                      pendingConnectFromRef.current = { id: connectingFrom.id, kind: connectingFrom.kind };
                      setConnectingFrom(null);
                    }
                    setHoveredCell(null);
                  };
                  // On zone cells, wait long enough to tell a double-click
                  // (start a connection from the zone) from a single click
                  // (create a node here) — the overlay owns both gestures
                  if (!connectingFrom && getZoneForCell(q, r)) {
                    clearTimeout(pendingCellClickRef.current);
                    pendingCellClickRef.current = setTimeout(openCreatorHere, 250);
                  } else {
                    openCreatorHere();
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const zone = getZoneForCell(hoveredCell.q, hoveredCell.r);
                  if (zone) {
                    clearTimeout(pendingCellClickRef.current);
                    setConnectingFrom({ kind: 'zone', id: zone.id, label: zone.label || 'Zone' });
                  }
                }}
                onMouseDown={(e) => {
                  // This overlay sits on top of zone cells — pass a
                  // middle-drag through as a move of the selected zone
                  if (e.button === 1) {
                    const zone = getZoneForCell(hoveredCell.q, hoveredCell.r);
                    if (zone && selectedZone?.id === zone.id) startZoneDrag(e, zone);
                  }
                }}
                className="cursor-pointer"
              >
                <polygon
                  points={getHexagonPoints(0, 0, HEX_SIZE)}
                  fill={connectingFrom ? '#f59e0b' : '#3b82f6'}
                  opacity="0.2"
                  stroke={connectingFrom ? '#f59e0b' : '#3b82f6'}
                  strokeWidth="2"
                />
                <circle cx="0" cy="0" r="15" fill={connectingFrom ? '#f59e0b' : '#3b82f6'} />
                <line x1="-8" y1="0" x2="8" y2="0" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="0" y1="-8" x2="0" y2="8" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              </g>
            )}

            {/* Connections */}
            {connections.map(conn => {
              const geom = connGeoms[conn.id];
              if (!geom) return null;
              const { pts, mid } = geom;
              const isHovered = hoveredConnection === conn.id;
              const labelRotation = conn.rotation || 0;
              const ConnIcon = conn.iconId ? AVAILABLE_ICONS.find(i => i.id === conn.iconId)?.icon : null;
              const lineTypeData = LINE_TYPES.find(lt => lt.id === (conn.lineType || 'solid'));
              const strokeDasharray = lineTypeData?.dasharray || null;
              const endStyles = getConnEndStyles(conn);
              const lineColor = conn.color || '#64748b';
              const markerColorKey = lineColor.replace('#', '');
              const isConnSelected = selectedConnectionIds.includes(conn.id);
              const connSim = statusView && analysis ? analysis.cur.conns.get(conn.id) : null;
              const connBroken = connSim && connSim.status !== 'ok';
              const connDimmed = focus && !focus.conns.has(conn.id);
              // Flow direction for the animated particles
              const flowReversed = connFlowReversed(conn);

              // Visible pieces per polyline segment: [0,1] minus the exact
              // footprint of every label box the segment crosses — its own
              // and any other connection's whose label overlaps it
              const pieces = [];
              for (let i = 0; i < pts.length - 1; i++) {
                const A = pts[i];
                const B = pts[i + 1];
                const segLen = Math.hypot(B.x - A.x, B.y - A.y);
                let intervals = [[0, 1]];
                connections.forEach(other => {
                  const box = connGeoms[other.id]?.box;
                  if (!box) return;
                  const hit = segmentRectIntersection(A, B, box);
                  if (!hit) return;
                  intervals = intervals.flatMap(([s, e]) => {
                    if (hit[1] <= s || hit[0] >= e) return [[s, e]];
                    const kept = [];
                    if (hit[0] > s) kept.push([s, hit[0]]);
                    if (hit[1] < e) kept.push([hit[1], e]);
                    return kept;
                  });
                });
                intervals
                  .filter(([s, e]) => (e - s) * segLen > 2)
                  .forEach(([s, e]) => {
                    pieces.push({
                      segIdx: i,
                      s,
                      e,
                      p1: { x: A.x + (B.x - A.x) * s, y: A.y + (B.y - A.y) * s },
                      p2: { x: A.x + (B.x - A.x) * e, y: A.y + (B.y - A.y) * e },
                      atStart: i === 0 && s < 0.01,
                      atEnd: i === pts.length - 2 && e > 0.99
                    });
                  });
              }
              const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');

              return (
                <g key={conn.id} opacity={connDimmed ? 0.08 : 1} style={{ transition: 'opacity 200ms' }}>
                  {/* Wider invisible hit area for hover */}
                  <path
                    d={pathD}
                    stroke="transparent"
                    strokeWidth="20"
                    fill="none"
                    className="cursor-pointer"
                    onMouseEnter={() => {
                      setHoveredConnection(conn.id);
                      setHoveredCell(null);
                    }}
                    onMouseLeave={() => setHoveredConnection(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (simMode) {
                        if (!simPanRef.current.moved) toggleFailure(connKey(conn.id));
                        return;
                      }
                      if (didMarqueeRef.current) return;
                      // Ctrl+Click toggles the connection in the bulk selection.
                      // If the single-edit drawer is open, its connection joins
                      // the selection and the drawer closes — otherwise edits
                      // would silently keep applying to only the drawer's line.
                      if (e.ctrlKey || e.metaKey) {
                        const editingId = showConnectionEditor ? editingConnectionId : null;
                        setSelectedConnectionIds(prev => {
                          let base = prev;
                          if (editingId != null && !base.includes(editingId)) base = [...base, editingId];
                          if (conn.id !== editingId) {
                            base = base.includes(conn.id) ? base.filter(i => i !== conn.id) : [...base, conn.id];
                          }
                          return base;
                        });
                        if (editingId != null) {
                          setShowConnectionEditor(false);
                          setEditingConnectionId(null);
                        }
                        return;
                      }
                      setEditingConnection(conn);
                      setShowConnectionEditor(true);
                    }}
                  />
                  {/* Selection glow under the line (covers the whole bundle) */}
                  {isConnSelected && pieces.map((piece, i) => (
                    <line
                      key={`sel-${i}`}
                      x1={piece.p1.x}
                      y1={piece.p1.y}
                      x2={piece.p2.x}
                      y2={piece.p2.y}
                      stroke="#fbbf24"
                      strokeWidth={7 + Math.max(0, geom.channels.length - 1) * CHANNEL_SPACING}
                      opacity="0.35"
                      strokeLinecap="round"
                      pointerEvents="none"
                    />
                  ))}
                  {/* Visible line pieces left after label footprints were
                      subtracted; arrowheads on the pieces touching the nodes.
                      With channels, one parallel strand per channel; without,
                      a single strand at offset 0 in the connection color. */}
                  {(geom.channels.length > 0 ? geom.channels : [null]).map((ch, si, strandArr) => {
                    const offset = (si - (strandArr.length - 1) / 2) * CHANNEL_SPACING;
                    let sPts = offset === 0 ? pts : offsetPolyline(pts, offset);
                    // Offset strands end on a square cap, which pokes past
                    // slanted zone edges — re-trim each strand's zone end
                    // against the silhouette along the strand's own line
                    if (offset !== 0 && (geom.fromZone || geom.toZone)) {
                      sPts = sPts.map(p => ({ ...p }));
                      const retrim = (endIdx, innerIdx, zone) => {
                        const pEnd = sPts[endIdx];
                        const pIn = sPts[innerIdx];
                        const dx = pEnd.x - pIn.x;
                        const dy = pEnd.y - pIn.y;
                        const len = Math.hypot(dx, dy) || 1;
                        const ext = {
                          x: pEnd.x + (dx / len) * HEX_SIZE,
                          y: pEnd.y + (dy / len) * HEX_SIZE
                        };
                        const t = zoneEntryT(zone, pIn, ext);
                        if (t !== null && t > 0) {
                          sPts[endIdx] = {
                            x: pIn.x + (ext.x - pIn.x) * t,
                            y: pIn.y + (ext.y - pIn.y) * t
                          };
                        }
                      };
                      if (geom.fromZone) retrim(0, 1, geom.fromZone);
                      if (geom.toZone) retrim(sPts.length - 1, sPts.length - 2, geom.toZone);
                    }
                    let strandColor = ch ? ch.color : (isHovered && !conn.color ? '#94a3b8' : lineColor);
                    let strandDash = strokeDasharray;
                    let strandOpacity = 1;
                    let animate = false;
                    // Flow state of this strand: active / standby / stranded / dead
                    const flowState = ch && flows ? flows.get(ch.id)?.connState.get(conn.id) : null;
                    const strandFocused = !focus || (ch
                      ? focus.strands.has(`${conn.id}|${ch.id}`)
                      : focus.conns.has(conn.id));
                    if (connBroken || flowState === 'dead') {
                      if (statusView) {
                        strandColor = STATUS_COLORS.down;
                        strandDash = '5,4';
                        strandOpacity = connSim?.status === 'failed' ? 0.95 : 0.6;
                      }
                    } else if (flowState === 'standby' && (statusView || focus)) {
                      strandDash = '6,5';
                      strandOpacity = 0.45;
                    } else if (flowState === 'stranded' && (statusView || focus)) {
                      strandDash = '2,4';
                      strandOpacity = 0.3;
                    } else if (flowState === 'active') {
                      animate = !!focus;
                    }
                    if (focus && !strandFocused) {
                      strandOpacity = Math.min(strandOpacity, 0.1);
                      animate = false;
                    }
                    const strandKey = strandColor.replace('#', '');
                    return pieces.map((piece, i) => {
                      const A = sPts[piece.segIdx];
                      const B = sPts[piece.segIdx + 1];
                      const p1 = { x: A.x + (B.x - A.x) * piece.s, y: A.y + (B.y - A.y) * piece.s };
                      const p2 = { x: A.x + (B.x - A.x) * piece.e, y: A.y + (B.y - A.y) * piece.e };
                      return (
                        <React.Fragment key={`${si}-${i}`}>
                          <line
                            x1={p1.x}
                            y1={p1.y}
                            x2={p2.x}
                            y2={p2.y}
                            stroke={strandColor}
                            strokeWidth={isHovered ? 3 : 2}
                            strokeDasharray={strandDash}
                            opacity={strandOpacity}
                            markerStart={piece.atStart && endStyles.start !== 'none' ? `url(#arrow-${endStyles.start}-${strandKey})` : undefined}
                            markerEnd={piece.atEnd && endStyles.end !== 'none' ? `url(#arrow-${endStyles.end}-${strandKey})` : undefined}
                            pointerEvents="none"
                          />
                          {/* Moving particles show which way traffic flows */}
                          {animate && (
                            <line
                              className={`ui-overlay ${flowReversed ? 'nx-flow-rev' : 'nx-flow'}`}
                              x1={p1.x}
                              y1={p1.y}
                              x2={p2.x}
                              y2={p2.y}
                              stroke={strandColor}
                              strokeWidth="4"
                              strokeLinecap="round"
                              strokeDasharray="0.5 13.5"
                              pointerEvents="none"
                            />
                          )}
                        </React.Fragment>
                      );
                    });
                  })}
                  {/* Label and icon - hidden when hovered */}
                  {geom.box && (!isHovered || simMode) && connSim?.status !== 'failed' && (
                    <g transform={`translate(${mid.x}, ${mid.y}) rotate(${labelRotation})`}>
                      {ConnIcon && (
                        <foreignObject
                          x={-geom.box.contentW / 2}
                          y={-CONN_ICON_SIZE / 2}
                          width={CONN_ICON_SIZE}
                          height={CONN_ICON_SIZE}
                          pointerEvents="none"
                        >
                          <div className="w-full h-full flex items-center justify-center">
                            <ConnIcon size={14} color={conn.color || '#94a3b8'} />
                          </div>
                        </foreignObject>
                      )}
                      {conn.label && (
                        <text
                          x={ConnIcon
                            ? -geom.box.contentW / 2 + CONN_ICON_SIZE + CONN_ICON_GAP + geom.box.textW / 2
                            : -geom.box.contentW / 2 + geom.box.textW / 2}
                          y="0"
                          fill={conn.color || '#e2e8f0'}
                          fontSize="11"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          pointerEvents="none"
                        >
                          {conn.label}
                        </text>
                      )}
                      {/* Channel dots after the label */}
                      {geom.channels.map((ch, i) => (
                        <circle
                          key={ch.id}
                          cx={geom.box.contentW / 2 - (geom.channels.length - i) * 8 + 4}
                          cy="0"
                          r="3"
                          fill={ch.color}
                          pointerEvents="none"
                        />
                      ))}
                    </g>
                  )}
                  {/* Simulated link failure marker */}
                  {connSim?.status === 'failed' && (
                    <g transform={`translate(${mid.x}, ${mid.y})`} pointerEvents="none">
                      <circle r="9" fill="#0f172a" stroke={STATUS_COLORS.down} strokeWidth="2" />
                      <path d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5" stroke={STATUS_COLORS.down} strokeWidth="2" strokeLinecap="round" />
                    </g>
                  )}
                  {/* Delete button - centered on line, only visible on hover */}
                  {isHovered && !simMode && (
                    <>
                      <circle
                        cx={mid.x}
                        cy={mid.y}
                        r="12"
                        fill="transparent"
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredConnection(conn.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConnection(conn.id);
                        }}
                      />
                      <text
                        x={mid.x}
                        y={mid.y}
                        fill="#ef4444"
                        fontSize="18"
                        fontWeight="bold"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        pointerEvents="none"
                        style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}
                      >
                        ×
                      </text>
                    </>
                  )}
                </g>
              );
            })}

            {/* Failover arcs: failed member → peer that took over its role,
                floating VIP → current holder, primary → promoted standby */}
            {analysis && (statusView || focus) && analysis.cur.failovers.map(fo => {
              // VIP holder arcs are informative in the baseline too; the
              // others only exist once something has failed
              if (!statusView && fo.kind !== 'vip') return null;
              const a = entityCenter(fo.from);
              const b = entityCenter(fo.to);
              if (!a || !b) return null;
              const dist = Math.hypot(b.x - a.x, b.y - a.y);
              if (dist < 1) return null;
              const bend = Math.max(30, dist * 0.25);
              const ctrl = {
                x: (a.x + b.x) / 2 - ((b.y - a.y) / dist) * bend,
                y: (a.y + b.y) / 2 + ((b.x - a.x) / dist) * bend
              };
              const start = fo.from.startsWith('n:') ? nodeEdgePoint(a, ctrl) : a;
              const end = fo.to.startsWith('n:') ? nodeEdgePoint(b, ctrl) : b;
              const labelPt = {
                x: 0.25 * start.x + 0.5 * ctrl.x + 0.25 * end.x,
                y: 0.25 * start.y + 0.5 * ctrl.y + 0.25 * end.y
              };
              const text = fo.kind === 'vip' ? 'VIP' : fo.kind === 'standby' ? 'promoted' : 'failover';
              const dimmed = focus && !(focus.ents.has(fo.from) || focus.ents.has(fo.to));
              const color = STATUS_COLORS.degraded;
              return (
                <g
                  key={`fo-${fo.from}-${fo.to}`}
                  pointerEvents="none"
                  opacity={dimmed ? 0.12 : 1}
                  style={{ transition: 'opacity 200ms' }}
                >
                  <path
                    d={`M${start.x} ${start.y} Q${ctrl.x} ${ctrl.y} ${end.x} ${end.y}`}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    strokeDasharray="7,5"
                    className={statusView ? 'nx-march' : undefined}
                    markerEnd={`url(#arrow-arrow-${color.replace('#', '')})`}
                  />
                  <rect
                    x={labelPt.x - (text.length * 3 + 6)}
                    y={labelPt.y - 8}
                    width={text.length * 6 + 12}
                    height="16"
                    rx="8"
                    fill="#0f172a"
                    stroke={color}
                    strokeWidth="1"
                  />
                  <text
                    x={labelPt.x}
                    y={labelPt.y + 3.5}
                    fill={color}
                    fontSize="10"
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {text}
                  </text>
                </g>
              );
            })}

            {/* Temporary connection line */}
            {connectingFrom && (() => {
              let x1, y1;
              if (connectingFrom.kind === 'zone') {
                const z = zones.find(zz => zz.id === connectingFrom.id);
                if (!z || z.cells.length === 0) return null;
                // Match the final line: run from the zone's center (snapped
                // into the blob) and trim at the silhouette crossing
                let sx = 0, sy = 0;
                z.cells.forEach(c => {
                  const p = axialToPixel(c.q, c.r);
                  sx += p.x;
                  sy += p.y;
                });
                let cx = sx / z.cells.length, cy = sy / z.cells.length;
                const cc = pixelToAxial(cx, cy);
                if (!z.cells.some(c => c.q === cc.q && c.r === cc.r)) {
                  let bd = Infinity;
                  z.cells.forEach(c => {
                    const p = axialToPixel(c.q, c.r);
                    const d = Math.hypot(p.x - cx, p.y - cy);
                    if (d < bd) { bd = d; cx = p.x; cy = p.y; }
                  });
                }
                x1 = cx; y1 = cy;
                const t = zoneEntryT(z, mousePos, { x: cx, y: cy });
                if (t !== null && t > 0) {
                  x1 = mousePos.x + (cx - mousePos.x) * t;
                  y1 = mousePos.y + (cy - mousePos.y) * t;
                }
              } else {
                const start = axialToPixel(connectingFrom.q, connectingFrom.r);
                x1 = start.x; y1 = start.y;
                const dist = Math.hypot(mousePos.x - start.x, mousePos.y - start.y);
                // Start from the hexagon edge once the cursor has left it
                if (dist > HEX_SIZE) {
                  const angle = Math.atan2(mousePos.y - start.y, mousePos.x - start.x);
                  const trim = hexBoundaryDistance(HEX_SIZE, angle);
                  x1 = start.x + Math.cos(angle) * trim;
                  y1 = start.y + Math.sin(angle) * trim;
                }
              }
              return (
                <line
                  x1={x1}
                  y1={y1}
                  x2={mousePos.x}
                  y2={mousePos.y}
                  stroke="#f59e0b"
                  strokeWidth="2"
                  strokeDasharray="5,5"
                  pointerEvents="none"
                />
              );
            })()}

            {/* Nodes */}
            {nodes.map(node => {
              const pos = axialToPixel(node.q, node.r);
              const Icon = AVAILABLE_ICONS.find(i => i.id === node.iconId)?.icon || Server;
              const isSelected = selectedNodeIds.includes(node.id);
              const isConnectingSource = connectingFrom?.id === node.id;
              const isConnectingTarget = connectingFrom && hoveredNode === node.id && connectingFrom.id !== node.id;
              const hasNested = hasNestedDiagram(node.id);

              // Determine stroke style
              let strokeColor = node.color;
              let strokeWidth = 2;
              let strokeDash = null;
              if (isSelected) {
                strokeColor = '#fbbf24';
                strokeWidth = 4;
              } else if (isConnectingSource) {
                strokeColor = '#f59e0b';
                strokeWidth = 4;
              } else if (isConnectingTarget) {
                strokeColor = '#22c55e';
                strokeWidth = 4;
              }

              // Simulation status + isolation focus
              const nk = nodeKey(node.id);
              const ns = entityStatus(nk);
              const isFailedNode = !!ns?.failed;
              const isDownNode = ns?.status === 'down';
              if (ns && ns.status !== 'healthy') {
                strokeColor = STATUS_COLORS[ns.status];
                strokeWidth = isFailedNode ? 4 : 3;
                strokeDash = isDownNode && !isFailedNode ? '6,4' : null;
              }
              const flowState = focusFlowState(nk);
              let groupOpacity = 1;
              if (focus && !focus.ents.has(nk)) groupOpacity = 0.15;
              else if (focus && !statusView && flowState === 'standby') groupOpacity = 0.6;
              else if (focus && !statusView && flowState === 'stranded') groupOpacity = 0.4;
              const isTraceOrigin = focus?.tracing === nk;
              const isSimHover = simMode && hoveredNode === node.id;
              const isVipNode = node.role === 'vip';
              const NodeIcon = isFailedNode ? PowerOff : Icon;

              return (
                <g
                  key={node.id}
                  className="node-element"
                  transform={`translate(${pos.x}, ${pos.y})`}
                  opacity={groupOpacity}
                  onMouseDown={(e) => handleNodeMouseDown(e, node)}
                  onClick={(e) => handleNodeClick(e, node)}
                  onDoubleClick={(e) => handleNodeDoubleClick(e, node)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (simMode) return;
                    setSelectedNodeIds([node.id]);
                    openNodeEditor(node);
                  }}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: simMode ? 'pointer' : 'move', transition: 'opacity 200ms' }}
                >
                  {/* Trace origin / simulation hover ring */}
                  {(isTraceOrigin || isSimHover) && (
                    <polygon
                      className="ui-overlay"
                      points={getHexagonPoints(0, 0, HEX_SIZE + 6)}
                      fill="none"
                      stroke={isSimHover ? '#e2e8f0' : '#fbbf24'}
                      strokeWidth="1.5"
                      strokeDasharray="4,3"
                      opacity="0.8"
                      pointerEvents="none"
                    />
                  )}
                  <polygon
                    points={getHexagonPoints(0, 0, HEX_SIZE)}
                    fill={isFailedNode ? '#1e293b' : node.color}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={strokeDash}
                    opacity={isDownNode && !isFailedNode ? 0.45 : 0.9}
                  />
                  {/* Nested indicator */}
                  {hasNested && (
                    <circle
                      cx={HEX_SIZE * 0.6}
                      cy={-HEX_SIZE * 0.6}
                      r="8"
                      fill="#3b82f6"
                      stroke="white"
                      strokeWidth="2"
                    />
                  )}
                  <foreignObject
                    x={-HEX_SIZE * 0.5}
                    y={-HEX_SIZE * 0.5}
                    width={HEX_SIZE}
                    height={HEX_SIZE}
                    pointerEvents="none"
                    opacity={isDownNode && !isFailedNode ? 0.6 : 1}
                  >
                    <div className="w-full h-full flex items-center justify-center">
                      <NodeIcon size={24} color={isFailedNode ? STATUS_COLORS.down : 'white'} />
                    </div>
                  </foreignObject>
                  {/* Floating VIP tag */}
                  {isVipNode && (
                    <g transform={`translate(0, ${HEX_SIZE * 0.62})`} pointerEvents="none">
                      <rect x="-12" y="-6" width="24" height="12" rx="6" fill="#0f172a" stroke="#f59e0b" strokeWidth="1" />
                      <text y="3" fill="#fbbf24" fontSize="8" fontWeight="700" textAnchor="middle">VIP</text>
                    </g>
                  )}
                  {/* Simulation status badge */}
                  {ns && (simMode || ns.status !== 'healthy') && (
                    ns.status === 'healthy' ? (
                      <circle
                        cx={-HEX_SIZE * 0.6}
                        cy={-HEX_SIZE * 0.6}
                        r="4"
                        fill={STATUS_COLORS.healthy}
                        stroke="#0f172a"
                        strokeWidth="1.5"
                        pointerEvents="none"
                      />
                    ) : (
                      <g
                        transform={`translate(${-HEX_SIZE * 0.6}, ${-HEX_SIZE * 0.6})`}
                        pointerEvents="none"
                      >
                        {isFailedNode && (
                          <circle className="nx-pulse ui-overlay" r="8" fill="none" stroke={STATUS_COLORS.down} strokeWidth="2" />
                        )}
                        <circle r="8" fill={STATUS_COLORS[ns.status]} stroke="#0f172a" strokeWidth="1.5" />
                        <text y="3.5" fill="#0f172a" fontSize="10" fontWeight="800" textAnchor="middle">
                          {ns.status === 'down' ? '×' : '!'}
                        </text>
                      </g>
                    )
                  )}
                  {/* Live check result */}
                  {liveNodeStatus.has(node.id) && (() => {
                    const ls = liveNodeStatus.get(node.id);
                    const color = LIVE_COLORS[ls.status];
                    return (
                      <g transform={`translate(${-HEX_SIZE * 0.6}, ${HEX_SIZE * 0.6})`} pointerEvents="none">
                        {ls.status === 'down' && (
                          <circle className="nx-pulse ui-overlay" r="6" fill="none" stroke={color} strokeWidth="2" />
                        )}
                        <circle r="6" fill="#0f172a" stroke={ls.suspect ? STATUS_COLORS.degraded : color} strokeWidth="2" />
                        <circle r="3" fill={color} />
                      </g>
                    );
                  })()}
                  {/* Covered by a failover peer */}
                  {ns?.coveredBy && (
                    <g transform={`translate(${HEX_SIZE * 0.6}, ${HEX_SIZE * 0.6})`} pointerEvents="none">
                      <circle r="8" fill="#0f172a" stroke={STATUS_COLORS.degraded} strokeWidth="1.5" />
                      <text y="3.5" fill={STATUS_COLORS.degraded} fontSize="11" fontWeight="700" textAnchor="middle">↻</text>
                    </g>
                  )}
                  <text
                    y={HEX_SIZE + 15}
                    fill={isDownNode ? '#fca5a5' : 'white'}
                    fontSize="12"
                    textAnchor="middle"
                    fontWeight="500"
                    textDecoration={isFailedNode ? 'line-through' : undefined}
                    pointerEvents="none"
                  >
                    {node.label}
                  </text>
                </g>
              );
            })}

            {/* Marquee selection box */}
            {marquee && (
              <rect
                x={Math.min(marquee.start.x, marquee.end.x)}
                y={Math.min(marquee.start.y, marquee.end.y)}
                width={Math.abs(marquee.end.x - marquee.start.x)}
                height={Math.abs(marquee.end.y - marquee.start.y)}
                fill="#3b82f6"
                fillOpacity="0.08"
                stroke="#3b82f6"
                strokeWidth="1"
                strokeDasharray="6,4"
                pointerEvents="none"
              />
            )}

            {/* Zone resize handle — corner for rectangles, radius for hex/circular */}
            {selectedZone && !isCreatingZone && !simMode && (() => {
              const zone = zones.find(z => z.id === selectedZone.id);
              if (!zone || zone.cells.length === 0) return null;
              const shape = inferZoneShape(zone);
              let handlePos, anchor;
              if (shape === 'rectangle') {
                const qs = zone.cells.map(c => c.q);
                const rs = zone.cells.map(c => c.r);
                anchor = { q: Math.min(...qs), r: Math.min(...rs) };
                handlePos = axialToPixel(Math.max(...qs), Math.max(...rs));
              } else {
                const center = zoneCenterCell(zone);
                const radius = Math.max(1, Math.max(...zone.cells.map(c => hexDistance(center.q, center.r, c.q, c.r))));
                anchor = center;
                handlePos = axialToPixel(center.q + radius, center.r);
              }
              return (
                <g
                  className="ui-overlay"
                  transform={`translate(${handlePos.x}, ${handlePos.y})`}
                  onMouseDown={(e) => {
                    // Left-drag resizes; middle-drag moves the zone
                    if (e.button === 1) {
                      startZoneDrag(e, zone);
                      return;
                    }
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    e.preventDefault();
                    setResizingZone({ id: zone.id, shape, anchor });
                  }}
                  style={{ cursor: 'nwse-resize' }}
                >
                  <circle r="9" fill="#0f172a" stroke={zone.color} strokeWidth="2" />
                  <path
                    d="M -3.5 3.5 L 3.5 -3.5 M -3.5 3.5 L -3.5 0.5 M -3.5 3.5 L -0.5 3.5 M 3.5 -3.5 L 3.5 -0.5 M 3.5 -3.5 L 0.5 -3.5"
                    stroke={zone.color}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    fill="none"
                  />
                </g>
              );
            })()}

            <defs>
              <pattern id="nx-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                <rect width="8" height="8" fill="#ef4444" opacity="0.08" />
                <line x1="0" y1="0" x2="0" y2="8" stroke="#ef4444" strokeWidth="2.5" opacity="0.55" />
              </pattern>
              {/* Legacy id used by the temporary connect line */}
              <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <polygon points="0 0, 10 3, 0 6" fill="#64748b" />
              </marker>
              {/* Connection pointer styles, one set per color in use;
                  auto-start-reverse flips them correctly as markerStart */}
              {[...new Set([
                ...connections.map(c => c.color || '#64748b'),
                ...channels.map(ch => ch.color),
                STATUS_COLORS.down,
                STATUS_COLORS.degraded
              ])].map(color => {
                const key = color.replace('#', '');
                return (
                  <React.Fragment key={color}>
                    <marker id={`arrow-arrow-${key}`} markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto-start-reverse">
                      <polygon points="0 0, 10 3, 0 6" fill={color} />
                    </marker>
                    <marker id={`arrow-open-${key}`} markerWidth="12" markerHeight="10" refX="9" refY="4" orient="auto-start-reverse">
                      <path d="M1 1 L9 4 L1 7" fill="none" stroke={color} strokeWidth="1.5" />
                    </marker>
                    <marker id={`arrow-circle-${key}`} markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse">
                      <circle cx="4" cy="4" r="3" fill={color} />
                    </marker>
                    <marker id={`arrow-diamond-${key}`} markerWidth="12" markerHeight="8" refX="10" refY="4" orient="auto-start-reverse">
                      <path d="M2 4 L6 1 L10 4 L6 7 Z" fill={color} />
                    </marker>
                  </React.Fragment>
                );
              })}
            </defs>
          </g>
        </svg>
        )}
      </div>
    </div>

    {/* Node Creator Modal */}
      {showNodeCreator && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">
                {editingNode ? 'Edit Node' : 'Create New Node'}
              </h2>
              <button
                onClick={() => {
                  setShowNodeCreator(false);
                  resetNodeForm();
                }}
                className="text-slate-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Label *</label>
                <input
                  type="text"
                  value={newNodeData.label}
                  onChange={(e) => setNewNodeData({ ...newNodeData, label: e.target.value })}
                  placeholder="e.g., API Gateway"
                  className="w-full px-3 py-2 bg-slate-700 rounded border border-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={newNodeData.description}
                  onChange={(e) => setNewNodeData({ ...newNodeData, description: e.target.value })}
                  placeholder="Optional description of this component"
                  rows="3"
                  className="w-full px-3 py-2 bg-slate-700 rounded border border-slate-600 focus:border-blue-500 focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Icon</label>
                <div className="max-h-40 overflow-y-auto bg-slate-900 rounded p-2 scrollbar-thin">
                  <div className="grid grid-cols-8 gap-2">
                    {AVAILABLE_ICONS.map(iconData => {
                      const Icon = iconData.icon;
                      return (
                        <button
                          key={iconData.id}
                          onClick={() => setNewNodeData({ ...newNodeData, iconId: iconData.id })}
                          className={`p-3 rounded transition-all ${
                            newNodeData.iconId === iconData.id
                              ? 'bg-blue-600 ring-2 ring-blue-400'
                              : 'bg-slate-700 hover:bg-slate-600'
                          }`}
                          title={iconData.label}
                        >
                          <Icon size={20} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Color</label>
                <div className="grid grid-cols-10 gap-2">
                  {COLOR_PALETTE.map(color => (
                    <button
                      key={color}
                      onClick={() => setNewNodeData({ ...newNodeData, color })}
                      className={`w-10 h-10 rounded transition-all ${
                        newNodeData.color === color
                          ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-800'
                          : ''
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Axis3d size={14} className="text-sky-400" />
                    3D model
                  </label>
                  {cleanModelOverride(newNodeData.model3d) && (
                    <button
                      onClick={() => setNewNodeData({ ...newNodeData, model3d: undefined })}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"
                      title="Use the icon’s model at normal size"
                    >
                      <RotateCcw size={12} /> Reset
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
                  <React.Suspense fallback={<div className="rounded bg-slate-900" style={{ height: 176 }} />}>
                    <ModelPreview
                      node={{ iconId: newNodeData.iconId, color: newNodeData.color, model3d: cleanModelOverride(newNodeData.model3d) }}
                      height={176}
                    />
                  </React.Suspense>
                  <div className="space-y-3 min-w-0">
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: 'icon', label: 'Match icon', help: 'Follows the icon above' },
                        { id: 'builtin', label: 'Built-in', help: 'Any of the 3D models' },
                        { id: 'custom', label: 'Custom file', help: '.glb / .gltf or a URL' },
                        { id: 'none', label: 'None', help: 'Just the hexagon' }
                      ].map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => pickModelSource(opt.id)}
                          className={`text-left px-2.5 py-1.5 rounded transition-all ${
                            nodeModelSource === opt.id ? 'bg-blue-600/30 ring-2 ring-blue-400' : 'bg-slate-700 hover:bg-slate-600'
                          }`}
                        >
                          <span className="block text-xs font-medium">{opt.label}</span>
                          <span className="block text-[11px] text-slate-400">{opt.help}</span>
                        </button>
                      ))}
                    </div>
                    {nodeModelSource !== 'none' && (
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block text-xs text-slate-400">
                          <span className="flex justify-between mb-1">Scale <span className="text-slate-200">{(newNodeData.model3d?.scale ?? 1).toFixed(2)}×</span></span>
                          <input
                            type="range"
                            min={MODEL_SCALE_MIN}
                            max={MODEL_SCALE_MAX}
                            step="0.05"
                            value={newNodeData.model3d?.scale ?? 1}
                            onChange={(e) => setNodeModel({ scale: parseFloat(e.target.value) })}
                            className="w-full accent-blue-500"
                          />
                        </label>
                        <label className="block text-xs text-slate-400">
                          <span className="flex justify-between mb-1">Rotation <span className="text-slate-200">{Math.round(newNodeData.model3d?.rotation ?? 0)}°</span></span>
                          <input
                            type="range"
                            min="0"
                            max="345"
                            step="15"
                            value={newNodeData.model3d?.rotation ?? 0}
                            onChange={(e) => setNodeModel({ rotation: parseInt(e.target.value, 10) })}
                            className="w-full accent-blue-500"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>

                {nodeModelSource === 'builtin' && (
                  <div className="mt-2 max-h-44 overflow-y-auto bg-slate-900 rounded p-2 scrollbar-thin">
                    <React.Suspense fallback={<div className="h-20" />}>
                      <ModelGrid
                        items={AVAILABLE_ICONS.filter(ic => MODEL_IDS.includes(ic.id))}
                        color={newNodeData.color}
                        value={newNodeData.model3d?.builtin}
                        onPick={(id) => setNodeModel({ source: 'builtin', builtin: id })}
                      />
                    </React.Suspense>
                  </div>
                )}

                {nodeModelSource === 'custom' && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => modelFileInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-slate-700 hover:bg-slate-600 shrink-0"
                      >
                        <Upload size={13} /> Choose file…
                      </button>
                      <input
                        ref={modelFileInputRef}
                        type="file"
                        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                        onChange={handleModelFile}
                        className="hidden"
                      />
                      <span className="text-xs text-slate-500">or</span>
                      <input
                        type="url"
                        value={newNodeData.model3d?.url?.startsWith('data:') ? '' : (newNodeData.model3d?.url || '')}
                        onChange={(e) => setNodeModel({ source: 'custom', url: e.target.value, name: undefined })}
                        placeholder="https://example.com/models/router.glb"
                        className="flex-1 min-w-0 px-2 py-1.5 bg-slate-700 rounded border border-slate-600 focus:border-blue-500 focus:outline-none text-xs font-mono"
                      />
                    </div>
                    {newNodeData.model3d?.url?.startsWith('data:') && (
                      <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-slate-900 text-xs">
                        <Package size={13} className="text-sky-400 shrink-0" />
                        <span className="truncate text-slate-200">{newNodeData.model3d.name || 'Embedded model'}</span>
                        <span className="text-slate-500 shrink-0">{Math.round(newNodeData.model3d.url.length * 0.75 / 1024)} KB, saved in the diagram</span>
                        <button
                          onClick={() => setNodeModel({ url: undefined, name: undefined })}
                          className="ml-auto text-slate-400 hover:text-white shrink-0"
                          title="Remove the file"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    )}
                    {newNodeData.model3d?.url?.startsWith('data:') && newNodeData.model3d.url.length > 4 * 1024 * 1024 * 4 / 3 && (
                      <p className="text-xs text-amber-400">Large models make the diagram file big and slow to save — consider hosting it and using a URL.</p>
                    )}
                    <p className="text-[11px] text-slate-500">
                      glTF 2.0: a <span className="text-slate-300">.glb</span>, or a <span className="text-slate-300">.gltf</span> with its buffers and textures embedded. Files are stored inside the diagram; URLs must allow cross-origin loading. Models are scaled to fit the hexagon.
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Resilience role</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'standard', label: 'Standard', help: 'A real component with its own capacity.' },
                    { id: 'vip', label: 'Floating VIP', help: 'A virtual address held by one failover peer at a time. Link it to its holders with Peer → Failover links.' }
                  ].map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setNewNodeData({ ...newNodeData, role: opt.id })}
                      className={`text-left px-3 py-2 rounded transition-all ${
                        (newNodeData.role || 'standard') === opt.id
                          ? 'bg-blue-600/30 ring-2 ring-blue-400'
                          : 'bg-slate-700 hover:bg-slate-600'
                      }`}
                    >
                      <span className="block text-sm font-medium">{opt.label}</span>
                      <span className="block text-xs text-slate-400">{opt.help}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Activity size={14} className="text-emerald-400" />
                    Monitoring
                  </label>
                  <button
                    onClick={() => setNewNodeData({
                      ...newNodeData,
                      endpoints: [...(newNodeData.endpoints || []), { id: genId(), address: '', check: 'icmp' }]
                    })}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600"
                  >
                    <Plus size={12} /> Add address
                  </button>
                </div>
                <p className="text-xs text-slate-400 mb-2">
                  Real IP addresses or hostnames of this component. Turn on <span className="text-slate-200">Live</span> in the toolbar to check them — outages show on the canvas and in the traffic impact.
                </p>
                <div className="space-y-2">
                  {(newNodeData.endpoints || []).map((ep, i) => {
                    const ct = checkType(ep.check);
                    const addrError = ep.address ? validateAddress(ep.address) : null;
                    const test = endpointTests[ep.id];
                    const setEp = (patch) => setNewNodeData({
                      ...newNodeData,
                      endpoints: newNodeData.endpoints.map((e, j) => (j === i ? { ...e, ...patch } : e))
                    });
                    return (
                      <div key={ep.id} className="p-2 rounded bg-slate-900/60 border border-slate-700">
                        <div className="flex gap-2">
                          <select
                            value={ep.check}
                            onChange={(e) => setEp({ check: e.target.value, port: undefined })}
                            className="px-2 py-1.5 bg-slate-700 rounded border border-slate-600 text-sm"
                            title="How to check it"
                          >
                            {CHECK_TYPES.map(c => (
                              <option key={c.id} value={c.id}>
                                {c.long}{c.agentOnly && monitorSettings.source === 'browser' ? ' (agent)' : ''}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={ep.address}
                            onChange={(e) => setEp({ address: e.target.value })}
                            placeholder="10.0.0.12 or db1.internal"
                            spellCheck={false}
                            className={`flex-1 min-w-0 px-2 py-1.5 bg-slate-700 rounded border font-mono text-sm focus:outline-none ${
                              addrError ? 'border-red-500' : 'border-slate-600 focus:border-blue-500'
                            }`}
                          />
                          {ct.port && (
                            <input
                              type="number"
                              min="1"
                              max="65535"
                              value={ep.port ?? ''}
                              onChange={(e) => setEp({ port: e.target.value })}
                              placeholder={String(ct.defaultPort)}
                              className="w-20 px-2 py-1.5 bg-slate-700 rounded border border-slate-600 text-sm focus:outline-none focus:border-blue-500"
                              title="Port"
                            />
                          )}
                          <button
                            onClick={() => setNewNodeData({
                              ...newNodeData,
                              endpoints: newNodeData.endpoints.filter((_, j) => j !== i)
                            })}
                            className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-700"
                            title="Remove"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        {ct.path && (
                          <div className="flex items-center gap-2 mt-2">
                            <input
                              type="text"
                              value={ep.path ?? ''}
                              onChange={(e) => setEp({ path: e.target.value })}
                              placeholder="/ (path to request, e.g. /health)"
                              spellCheck={false}
                              className="flex-1 px-2 py-1 bg-slate-700 rounded border border-slate-600 font-mono text-xs focus:outline-none focus:border-blue-500"
                            />
                            {ct.id === 'https' && (
                              <label className="flex items-center gap-1 text-xs text-slate-400" title="Accept self-signed / internal certificates (agent only)">
                                <input type="checkbox" checked={!!ep.insecure} onChange={(e) => setEp({ insecure: e.target.checked })} />
                                Any cert
                              </label>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1.5 text-xs">
                          {addrError ? (
                            <span className="text-red-400">{addrError}</span>
                          ) : (
                            <span className="text-slate-500 font-mono truncate">{ep.address ? endpointLabel(ep) : ''}</span>
                          )}
                          <span className="ml-auto flex items-center gap-2 shrink-0">
                            {test && !test.pending && (
                              <span
                                className="max-w-[14rem] truncate"
                                style={{ color: test.up ? LIVE_COLORS.up : test.up === false ? LIVE_COLORS.down : LIVE_COLORS.partial }}
                                title={test.error || test.detail}
                              >
                                {test.up ? `● Up · ${Math.round(test.latencyMs ?? 0)} ms` : `● ${test.error || 'Down'}`}
                              </span>
                            )}
                            <button
                              onClick={() => testEndpoint(ep)}
                              disabled={!ep.address || !!addrError || test?.pending}
                              className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                            >
                              {test?.pending ? 'Testing…' : 'Test'}
                            </button>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={createOrUpdateNode}
                  disabled={!newNodeData.label.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded transition-colors"
                >
                  {editingNode ? 'Update Node' : 'Create Node'}
                </button>
                <button
                  onClick={() => {
                    setShowNodeCreator(false);
                    resetNodeForm();
                  }}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Zone Creator Modal */}
      {showZoneCreator && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar-thin">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">
                {editingZone ? 'Edit Zone' : 'Create Zone'}
              </h2>
              <button
                onClick={() => {
                  setShowZoneCreator(false);
                  setEditingZone(null);
                  cancelZoneCreation();
                }}
                className="text-slate-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Zone Name</label>
                <input
                  type="text"
                  value={newZoneData.label}
                  onChange={(e) => setNewZoneData({ ...newZoneData, label: e.target.value })}
                  placeholder="e.g., Frontend Services"
                  className="w-full px-3 py-2 bg-slate-700 rounded border border-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Color</label>
                <div className="grid grid-cols-8 gap-2">
                  {ZONE_COLORS.map(({ color, label }) => (
                    <button
                      key={color}
                      onClick={() => setNewZoneData({ ...newZoneData, color })}
                      className={`w-10 h-10 rounded transition-all ${
                        newZoneData.color === color
                          ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-800'
                          : ''
                      }`}
                      style={{ backgroundColor: color }}
                      title={label}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Label Position</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {[
                    { id: 'center', label: 'Center' },
                    { id: 'top', label: 'Top' },
                    { id: 'bottom', label: 'Bottom' },
                    { id: 'left', label: 'Left' },
                    { id: 'right', label: 'Right' }
                  ].map(side => (
                    <button
                      key={side.id}
                      onClick={() => setNewZoneData({ ...newZoneData, labelSide: side.id })}
                      className={`px-3 py-1.5 rounded text-sm transition-all ${
                        newZoneData.labelSide === side.id
                          ? 'bg-emerald-600 ring-2 ring-emerald-400'
                          : 'bg-slate-700 hover:bg-slate-600'
                      }`}
                    >
                      {side.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {[
                    { id: 'inside', label: 'Inside' },
                    { id: 'outside', label: 'Outside' }
                  ].map(place => (
                    <button
                      key={place.id}
                      onClick={() => setNewZoneData({ ...newZoneData, labelPlacement: place.id })}
                      disabled={newZoneData.labelSide === 'center'}
                      className={`px-3 py-1.5 rounded text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                        newZoneData.labelPlacement === place.id && newZoneData.labelSide !== 'center'
                          ? 'bg-emerald-600 ring-2 ring-emerald-400'
                          : 'bg-slate-700 hover:bg-slate-600'
                      }`}
                    >
                      {place.label}
                    </button>
                  ))}
                </div>
              </div>

              {(() => {
                const policy = newZoneData.policy || getZonePolicy({});
                const setPolicy = (patch) => setNewZoneData({ ...newZoneData, policy: { ...policy, ...patch } });
                const zoneCells = new Set((editingZone ? newZoneData.cells : selectedZoneCells).map(c => `${c.q},${c.r}`));
                const members = nodes.filter(n => zoneCells.has(`${n.q},${n.r}`));
                return (
                  <div>
                    <label className="block text-sm font-medium mb-1">Availability policy</label>
                    <p className="text-xs text-slate-400 mb-2">
                      How the {members.length} node{members.length === 1 ? '' : 's'} on this zone back each other up — used by the outage simulation.
                    </p>
                    <div className="space-y-1">
                      {ZONE_POLICIES.map(pol => (
                        <button
                          key={pol.id}
                          onClick={() => setPolicy({ mode: pol.id })}
                          className={`w-full text-left px-3 py-1.5 rounded transition-all ${
                            policy.mode === pol.id
                              ? 'bg-emerald-600/25 ring-2 ring-emerald-400'
                              : 'bg-slate-700 hover:bg-slate-600'
                          }`}
                        >
                          <span className="block text-sm font-medium">{pol.label}</span>
                          <span className="block text-xs text-slate-400">{pol.help}</span>
                        </button>
                      ))}
                    </div>
                    {policy.mode === 'min' && (
                      <label className="flex items-center gap-2 mt-2 text-sm">
                        Minimum healthy members
                        <input
                          type="number"
                          min="1"
                          max={Math.max(1, members.length)}
                          value={policy.min}
                          onChange={(e) => setPolicy({ min: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                          className="w-16 px-2 py-1 bg-slate-700 rounded border border-slate-600 focus:border-emerald-500 focus:outline-none"
                        />
                        <span className="text-xs text-slate-400">of {members.length}</span>
                      </label>
                    )}
                    {policy.mode === 'failover' && (
                      <label className="flex items-center gap-2 mt-2 text-sm">
                        Primary
                        <select
                          value={policy.primaryId ?? ''}
                          onChange={(e) => setPolicy({ primaryId: e.target.value === '' ? null : Number(e.target.value) })}
                          className="flex-1 px-2 py-1 bg-slate-700 rounded border border-slate-600 text-sm"
                        >
                          <option value="">First member{members[0] ? ` (${members[0].label})` : ''}</option>
                          {members.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                );
              })()}

              <p className="text-sm text-slate-400">
                {editingZone ? `${editingZone.cells.length} cells selected` : `${selectedZoneCells.length} cells selected`}
              </p>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={createOrUpdateZone}
                  className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded transition-colors"
                >
                  {editingZone ? 'Update Zone' : 'Create Zone'}
                </button>
                <button
                  onClick={() => {
                    setShowZoneCreator(false);
                    setEditingZone(null);
                    cancelZoneCreation();
                  }}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Monitoring settings */}
      {showMonitorSettings && (() => {
        const st = monitorSettings;
        const set = (patch) => setMonitorSettings({ ...st, ...patch });
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onMouseDown={() => setShowMonitorSettings(false)}>
            <div className="bg-slate-800 rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin" onMouseDown={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Activity size={20} className="text-emerald-400" />
                  Live monitoring
                </h2>
                <button onClick={() => setShowMonitorSettings(false)} className="text-slate-400 hover:text-white">
                  <X size={22} />
                </button>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                These settings stay in this browser. The addresses to check are part of the diagram (node editor → Monitoring).
              </p>

              <label className="block text-sm font-medium mb-2">Check from</label>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { id: 'agent', label: 'Monitor agent', help: 'Ping, TCP ports, HTTP(S). Run the small Nodex agent on a machine that can reach your hosts.' },
                  { id: 'browser', label: 'This browser', help: 'No setup, HTTP(S) only — browsers can’t ping or test raw ports.' }
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => { set({ source: opt.id }); setMonitorHealth(null); }}
                    className={`text-left px-3 py-2 rounded transition-all ${
                      st.source === opt.id ? 'bg-emerald-600/25 ring-2 ring-emerald-400' : 'bg-slate-700 hover:bg-slate-600'
                    }`}
                  >
                    <span className="block text-sm font-medium">{opt.label}</span>
                    <span className="block text-xs text-slate-400">{opt.help}</span>
                  </button>
                ))}
              </div>

              {st.source === 'agent' && (
                <div className="space-y-3 mb-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Agent URL</label>
                    <input
                      type="text"
                      value={st.agentUrl}
                      onChange={(e) => { set({ agentUrl: e.target.value }); setMonitorHealth(null); }}
                      spellCheck={false}
                      className="w-full px-3 py-2 bg-slate-700 rounded border border-slate-600 font-mono text-sm focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Token <span className="text-slate-500 font-normal">(if the agent sets NODEX_MONITOR_TOKEN)</span></label>
                    <input
                      type="password"
                      value={st.token}
                      onChange={(e) => { set({ token: e.target.value }); setMonitorHealth(null); }}
                      autoComplete="off"
                      className="w-full px-3 py-2 bg-slate-700 rounded border border-slate-600 font-mono text-sm focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        setMonitorHealth({ pending: true });
                        setMonitorHealth(await agentHealth(monitorSettingsRef.current));
                      }}
                      className="px-3 py-1.5 rounded text-sm bg-slate-700 hover:bg-slate-600"
                    >
                      Test connection
                    </button>
                    {monitorHealth?.pending && <span className="text-xs text-slate-400">Connecting…</span>}
                    {monitorHealth && !monitorHealth.pending && (
                      monitorHealth.ok ? (
                        <span className="text-xs text-emerald-400">
                          ● Connected · v{monitorHealth.version} · {monitorHealth.checks?.join(', ')}
                          {monitorHealth.allowlist ? ' · allowlist on' : ''}
                        </span>
                      ) : (
                        <span className="text-xs text-red-400">● {monitorHealth.error}</span>
                      )
                    )}
                  </div>
                  {monitorHealth?.ok && !monitorHealth.checks?.includes('icmp') && (
                    <p className="text-xs text-amber-300">The agent has no ping available — ping checks will show as “can’t check”. Use TCP or HTTP checks, or install ping on the agent host.</p>
                  )}
                  <div className="p-3 rounded bg-slate-900/70 text-xs text-slate-300 space-y-1">
                    <p className="font-medium text-slate-200">Run the agent</p>
                    <p>From the Nodex folder: <code className="px-1 bg-slate-800 rounded">npm run monitor</code> (listens on localhost:7070)</p>
                    <p>Or with Docker: <code className="px-1 bg-slate-800 rounded">docker compose up -d</code> (starts it next to Nodex)</p>
                    <p className="text-slate-400">Restrict what it may probe with <code className="px-1 bg-slate-800 rounded">NODEX_MONITOR_ALLOW=10.0.0.0/8</code> and require <code className="px-1 bg-slate-800 rounded">NODEX_MONITOR_TOKEN</code> if anyone else can reach it.</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <label className="text-sm">
                  <span className="block font-medium mb-1">Every (s)</span>
                  <input
                    type="number"
                    min="5"
                    max="3600"
                    value={st.intervalSec}
                    onChange={(e) => set({ intervalSec: Math.max(5, parseInt(e.target.value, 10) || 15) })}
                    className="w-full px-2 py-1.5 bg-slate-700 rounded border border-slate-600 focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="text-sm">
                  <span className="block font-medium mb-1">Timeout (ms)</span>
                  <input
                    type="number"
                    min="500"
                    max="10000"
                    step="500"
                    value={st.timeoutMs}
                    onChange={(e) => set({ timeoutMs: Math.min(10000, Math.max(500, parseInt(e.target.value, 10) || 3000)) })}
                    className="w-full px-2 py-1.5 bg-slate-700 rounded border border-slate-600 focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="text-sm" title="Consecutive failed checks before an address counts as down">
                  <span className="block font-medium mb-1">Down after</span>
                  <select
                    value={st.failAfter}
                    onChange={(e) => set({ failAfter: parseInt(e.target.value, 10) })}
                    className="w-full px-2 py-1.5 bg-slate-700 rounded border border-slate-600"
                  >
                    {[1, 2, 3, 5].map(n => <option key={n} value={n}>{n} failed check{n > 1 ? 's' : ''}</option>)}
                  </select>
                </label>
              </div>

              <div className="flex gap-3 pt-5">
                <button
                  onClick={() => {
                    setShowMonitorSettings(false);
                    toggleLive(true);
                  }}
                  className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded transition-colors"
                >
                  {liveEnabled ? 'Done' : 'Start monitoring'}
                </button>
                {liveEnabled && (
                  <button
                    onClick={() => { toggleLive(false); setShowMonitorSettings(false); }}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Connection Editor Drawer — edits apply live (undo covers mistakes) */}
      {showConnectionEditor && editingConnection && (
        <div className="fixed right-0 top-0 bottom-0 w-96 bg-slate-800 border-l border-slate-700 z-50 p-6 overflow-y-auto scrollbar-thin shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Edit Connection</h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => deleteConnection(editingConnection.id)}
                className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
                title="Delete Connection"
              >
                <Trash2 size={18} />
              </button>
              <button
                onClick={() => {
                  setShowConnectionEditor(false);
                  setEditingConnection(null);
                }}
                className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Label</label>
              <input
                type="text"
                value={editingConnection.label || ''}
                onChange={(e) => updateEditingConnection({ label: e.target.value })}
                placeholder="e.g., HTTP, API, Data Flow"
                className="w-full px-3 py-2 bg-slate-700 rounded border border-slate-600 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Link type</label>
              <div className="flex gap-2 mb-2">
                {[
                  { id: 'traffic', label: 'Traffic' },
                  { id: 'peer', label: 'Peer / cluster' }
                ].map(k => (
                  <button
                    key={k.id}
                    onClick={() => updateEditingConnection(k.id === 'peer'
                      ? { kind: 'peer', peerMode: editingConnection.peerMode || 'failover' }
                      : { kind: undefined })}
                    className={`flex-1 px-3 py-2 rounded text-sm transition-all ${
                      (editingConnection.kind || 'traffic') === k.id
                        ? 'bg-blue-600 ring-2 ring-blue-400'
                        : 'bg-slate-700 hover:bg-slate-600'
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              {editingConnection.kind === 'peer' ? (
                <div className="space-y-1">
                  {PEER_MODES.map(m => (
                    <button
                      key={m.id}
                      onClick={() => updateEditingConnection({ peerMode: m.id })}
                      className={`w-full text-left px-3 py-1.5 rounded transition-all ${
                        (editingConnection.peerMode || 'failover') === m.id
                          ? 'bg-blue-600/25 ring-2 ring-blue-400'
                          : 'bg-slate-700 hover:bg-slate-600'
                      }`}
                    >
                      <span className="block text-sm font-medium">{m.label}</span>
                      <span className="block text-xs text-slate-400">{m.help}</span>
                    </button>
                  ))}
                  <p className="text-xs text-slate-400 pt-1">
                    Peer links carry no traffic. Every entity linked by them forms one cluster.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!editingConnection.required}
                      onChange={(e) => updateEditingConnection({ required: e.target.checked || undefined })}
                      className="mt-1"
                    />
                    <span>
                      Required dependency
                      <span className="block text-xs text-slate-400">
                        The source can’t work without the target — if the target goes down, so does the source.
                      </span>
                    </span>
                  </label>
                  <button
                    onClick={() => reverseConnection(editingConnection)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-sm bg-slate-700 hover:bg-slate-600 transition-colors"
                    title="Swap source and target"
                  >
                    <ArrowLeftRight size={14} />
                    Reverse direction
                  </button>
                  <p className="text-xs text-slate-400">
                    Traffic flows from → to (toward the arrowhead).
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Color</label>
              <div className="grid grid-cols-8 gap-2">
                <button
                  onClick={() => updateEditingConnection({ color: null })}
                  className={`w-8 h-8 rounded transition-all ${
                    !editingConnection.color ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-800' : ''
                  }`}
                  style={{ backgroundColor: '#64748b' }}
                  title="Default"
                />
                {COLOR_PALETTE.map(color => (
                  <button
                    key={color}
                    onClick={() => updateEditingConnection({ color })}
                    className={`w-8 h-8 rounded transition-all ${
                      editingConnection.color === color ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-800' : ''
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            {channels.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-2">Channels</label>
                <div className="flex flex-wrap gap-2">
                  {channels.map(ch => {
                    const active = (editingConnection.channelIds || []).includes(ch.id);
                    return (
                      <button
                        key={ch.id}
                        onClick={() => {
                          const ids = editingConnection.channelIds || [];
                          updateEditingConnection({
                            channelIds: active ? ids.filter(i => i !== ch.id) : [...ids, ch.id]
                          });
                        }}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-all border ${
                          active
                            ? 'bg-slate-600 border-white/60'
                            : 'bg-slate-700 border-transparent hover:bg-slate-600'
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ch.color }} />
                        {ch.name}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Subscribed channels render as side-by-side strands; the same channel keeps its color across connections.
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-2">Route</label>
              <div className="flex gap-2">
                {[
                  { id: 'direct', label: 'Direct' },
                  { id: 'angled', label: 'Angled' }
                ].map(rt => (
                  <button
                    key={rt.id}
                    onClick={() => updateEditingConnection({ routing: rt.id })}
                    className={`flex-1 px-3 py-2 rounded text-sm transition-all ${
                      (editingConnection.routing || 'direct') === rt.id
                        ? 'bg-blue-600 ring-2 ring-blue-400'
                        : 'bg-slate-700 hover:bg-slate-600'
                    }`}
                  >
                    {rt.label}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const POINTER_STYLES = [
                { id: 'none', label: 'None' },
                { id: 'arrow', label: 'Arrow' },
                { id: 'open', label: 'Open' },
                { id: 'circle', label: 'Circle' },
                { id: 'diamond', label: 'Diamond' }
              ];
              const current = getConnEndStyles(editingConnection);
              // Always write both fields so the legacy arrowHead/arrowStyle
              // fallback stops applying once either end has been edited
              const setEnd = (which, id) =>
                updateEditingConnection({
                  startStyle: which === 'start' ? id : current.start,
                  endStyle: which === 'end' ? id : current.end
                });
              return (
                <>
                  {['start', 'end'].map(which => (
                    <div key={which}>
                      <label className="block text-sm font-medium mb-2">
                        {which === 'start' ? 'Start Pointer (from)' : 'End Pointer (to)'}
                      </label>
                      <div className="flex gap-1">
                        {POINTER_STYLES.map(st => (
                          <button
                            key={st.id}
                            onClick={() => setEnd(which, st.id)}
                            className={`flex-1 px-1 py-2 rounded text-xs transition-all ${
                              current[which] === st.id
                                ? 'bg-blue-600 ring-2 ring-blue-400'
                                : 'bg-slate-700 hover:bg-slate-600'
                            }`}
                          >
                            {st.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              );
            })()}

            <div>
              <label className="block text-sm font-medium mb-2">Icon (optional)</label>
              <div className="max-h-32 overflow-y-auto bg-slate-900 rounded p-2 scrollbar-thin">
                <div className="grid grid-cols-8 gap-2">
                  <button
                    onClick={() => updateEditingConnection({ iconId: null })}
                    className={`p-2 rounded transition-all ${
                      !editingConnection.iconId
                        ? 'bg-blue-600 ring-2 ring-blue-400'
                        : 'bg-slate-700 hover:bg-slate-600'
                    }`}
                    title="No icon"
                  >
                    <X size={16} />
                  </button>
                  {AVAILABLE_ICONS.map(iconData => {
                    const Icon = iconData.icon;
                    return (
                      <button
                        key={iconData.id}
                        onClick={() => updateEditingConnection({ iconId: iconData.id })}
                        className={`p-2 rounded transition-all ${
                          editingConnection.iconId === iconData.id
                            ? 'bg-blue-600 ring-2 ring-blue-400'
                            : 'bg-slate-700 hover:bg-slate-600'
                        }`}
                        title={iconData.label}
                      >
                        <Icon size={16} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Label Rotation: {editingConnection.rotation || 0}°</label>
              <div className="flex flex-wrap gap-2">
                {[0, 15, 30, 45, 60, 75, 90, -15, -30, -45, -60, -75, -90].map(angle => (
                  <button
                    key={angle}
                    onClick={() => updateEditingConnection({ rotation: angle })}
                    className={`px-3 py-1 rounded text-sm transition-all ${
                      (editingConnection.rotation || 0) === angle
                        ? 'bg-blue-600 ring-2 ring-blue-400'
                        : 'bg-slate-700 hover:bg-slate-600'
                    }`}
                  >
                    {angle}°
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Line Style</label>
              <div className="flex flex-wrap gap-2">
                {LINE_TYPES.map(lt => (
                  <button
                    key={lt.id}
                    onClick={() => updateEditingConnection({ lineType: lt.id })}
                    className={`px-3 py-2 rounded text-sm transition-all flex items-center gap-2 ${
                      (editingConnection.lineType || 'solid') === lt.id
                        ? 'bg-blue-600 ring-2 ring-blue-400'
                        : 'bg-slate-700 hover:bg-slate-600'
                    }`}
                  >
                    <svg width="40" height="10">
                      <line
                        x1="0"
                        y1="5"
                        x2="40"
                        y2="5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeDasharray={lt.dasharray || undefined}
                      />
                    </svg>
                    <span>{lt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => {
                  setShowConnectionEditor(false);
                  setEditingConnection(null);
                }}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
              >
                Done
              </button>
              <button
                onClick={() => {
                  deleteConnection(editingConnection.id);
                  setShowConnectionEditor(false);
                  setEditingConnection(null);
                }}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 rounded transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
