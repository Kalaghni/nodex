import React, { useState, useRef, useEffect } from 'react';
import { Database, Server, Cloud, Zap, Box, Globe, Lock, HardDrive, Cpu, Network, Shield, Wifi, Code, Container, FileText, Users, Settings, Activity, Mail, Phone, CheckCircle, XCircle, AlertCircle, Plus, Edit2, X, ChevronRight, Hexagon, Trash2, Save, FolderOpen, Download, FilePlus, ZoomIn, ZoomOut, Maximize, Undo, Redo, Copy, Clipboard, Grid, Eye, EyeOff, Home, Building, Factory, Warehouse, ShoppingCart, CreditCard, DollarSign, PieChart, BarChart, LineChart, TrendingUp, Clock, Calendar, Bell, MessageSquare, Send, Upload, Link, Layers, Package, Archive, Folder, Search, Filter, Terminal, GitBranch, Github, Smartphone, Tablet, Monitor, Printer, Camera, Mic, Video, Play, Pause, Square, Circle, Triangle, Star, Heart, ThumbsUp, ThumbsDown, Flag, Bookmark, Tag, Hash, AtSign, MapPin, Navigation, Compass, Map, Truck, Plane, Ship, Train, Car, Bike, Footprints, Key, Unlock, UserCheck, UserX, UserPlus, User, Bot, Cog, Wrench, Hammer, Lightbulb, Flame, Droplet, Wind, Sun, Moon, CloudRain, Snowflake, Thermometer, History } from 'lucide-react';

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

// Pointer style for each end of a connection: 'none' | 'arrow' | 'open' |
// 'circle' | 'diamond'. Falls back to the legacy arrowHead/arrowStyle pair
// (whose default was a filled arrow on the target end).
const getConnEndStyles = (conn) => {
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
    if (Math.abs(denom) < 1e-9) {
      if (num < 0) return null;
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

// Where the ray fromPt→anchorPt first enters the zone. Trimming against
// only the anchor cell put arrowheads inside the zone whenever the line
// crossed another cell first.
const zoneBoundaryPoint = (zone, fromPt, anchorPt) => {
  const bestT = zoneEntryT(zone, fromPt, anchorPt);
  if (bestT === null || bestT <= 0) return anchorPt;
  return {
    x: fromPt.x + (anchorPt.x - fromPt.x) * bestT,
    y: fromPt.y + (anchorPt.y - fromPt.y) * bestT
  };
};

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
  { id: 'map', icon: Map, label: 'Map' },
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

  // Clipboard state for copy-paste
  const [clipboard, setClipboard] = useState(null);
  const clipboardRef = useRef(null);
  clipboardRef.current = clipboard;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;

  // UI State
  const [showNodeCreator, setShowNodeCreator] = useState(false);
  const [showZoneCreator, setShowZoneCreator] = useState(false);
  const [editingNode, setEditingNode] = useState(null);
  const [editingZone, setEditingZone] = useState(null);
  const [newNodeData, setNewNodeData] = useState({
    label: '',
    description: '',
    iconId: 'server',
    color: '#3b82f6'
  });
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

  const getSaveData = () => {
    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current) || tabsRef.current[0];
    return {
      version: 1,
      name: tab.name,
      diagrams: tab.diagrams,
      currentPath: tab.currentPath
    };
  };

  const suggestedFileName = () => {
    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current) || tabsRef.current[0];
    return `${tab.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'nodex-diagram'}.json`;
  };

  const writeToHandle = async (handle, data) => {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  };

  const downloadJson = (data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedFileName();
    a.click();
    URL.revokeObjectURL(url);
  };

  // Save: writes back to the tab's on-device file when one is linked,
  // otherwise prompts for a location (File System Access API) and links it.
  // Falls back to a plain download in browsers without the API.
  const saveToFile = async () => {
    const data = getSaveData();
    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current);

    if (tab?.fileHandle) {
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
          suggestedName: suggestedFileName(),
          types: FILE_PICKER_TYPES
        });
        await writeToHandle(handle, data);
        setTabs(prevTabs => prevTabs.map(t =>
          t.id === activeTabIdRef.current ? { ...t, fileHandle: handle } : t
        ));
        dirtyRef.current = false;
        addRecent(handle.name, 'diagram', handle);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    downloadJson(data);
    dirtyRef.current = false;
  };

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
      if (fileHandle) setProjectHandle(fileHandle);
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
    const svgElement = canvasRef.current?.querySelector('svg');
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
      color: '#3b82f6'
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
      color: node.color
    });
    setEditingNode(node);
    setShowNodeCreator(true);
  };

  const createOrUpdateNode = () => {
    if (!newNodeData.label.trim()) return;

    if (editingNode) {
      setNodes(nodes.map(n => 
        n.id === editingNode.id 
          ? { ...n, label: newNodeData.label, description: newNodeData.description, iconId: newNodeData.iconId, color: newNodeData.color }
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
      labelPlacement: zone.labelPlacement || 'inside'
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
              labelPlacement: newZoneData.labelPlacement
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
        labelPlacement: newZoneData.labelPlacement
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
    // Set initial mouse position to node position so the line doesn't jump to (0,0)
    const nodePos = axialToPixel(node.q, node.r);
    setMousePos({ x: nodePos.x, y: nodePos.y });
    setConnectingFrom({ kind: 'node', id: node.id, label: node.label, q: node.q, r: node.r });
  };

  const handleZoneClick = (e, zone) => {
    e.stopPropagation();
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
    if (isCreatingZone) return;
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
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboardRef.current && !inModal && !inField) {
        e.preventDefault();
        pasteNode();
      }
      // Duplicate selection (also blocks the browser's bookmark dialog)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && !inModal && !inField) {
        e.preventDefault();
        if (selectedNodeIdsRef.current.length > 0) duplicateSelection();
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && !inModal) {
        // Don't prevent default if we're in an input field
        if (inField) return;
        e.preventDefault();
        if (selectedNodeIdsRef.current.length > 0 || selectedConnectionIdsRef.current.length > 0) {
          if (selectedNodeIdsRef.current.length > 0) deleteSelectedNodes();
          if (selectedConnectionIdsRef.current.length > 0) deleteSelectedConnections();
        } else if (selectedZoneRef.current) {
          deleteZone(selectedZoneRef.current.id);
        }
      }
      if (e.key === 'Escape') {
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
    // Endpoints can be nodes or zones. A zone endpoint anchors to its cell
    // nearest the other endpoint, which is a hex center — so all the node
    // trimming/routing logic below applies unchanged.
    const resolveCenter = (id, type) => {
      if (type === 'zone') {
        const z = zones.find(zz => zz.id === id);
        if (!z || z.cells.length === 0) return null;
        let sx = 0, sy = 0;
        z.cells.forEach(c => {
          const p = axialToPixel(c.q, c.r);
          sx += p.x;
          sy += p.y;
        });
        return { type: 'zone', zone: z, x: sx / z.cells.length, y: sy / z.cells.length };
      }
      const n = nodes.find(nn => nn.id === id);
      if (!n) return null;
      const p = axialToPixel(n.q, n.r);
      return { type: 'node', x: p.x, y: p.y };
    };
    const nearestCellTo = (ep, toward) => {
      if (ep.type !== 'zone') return { x: ep.x, y: ep.y };
      let best = { x: ep.x, y: ep.y };
      let bd = Infinity;
      ep.zone.cells.forEach(c => {
        const p = axialToPixel(c.q, c.r);
        const d = Math.hypot(p.x - toward.x, p.y - toward.y);
        if (d < bd) {
          bd = d;
          best = p;
        }
      });
      return best;
    };

    const epFrom = resolveCenter(conn.from, conn.fromType || 'node');
    const epTo = resolveCenter(conn.to, conn.toType || 'node');
    if (!epFrom || !epTo) return;

    // Anchors: zone-zone uses the closest PAIR of cells across both zones —
    // centroid-based anchors sent lines on long grazing diagonals when the
    // blobs were much closer elsewhere. Node-zone keeps nearest-to-node.
    let a, b;
    if (epFrom.type === 'zone' && epTo.type === 'zone') {
      let best = Infinity;
      epFrom.zone.cells.forEach(ca => {
        const pa = axialToPixel(ca.q, ca.r);
        epTo.zone.cells.forEach(cb => {
          const pb = axialToPixel(cb.q, cb.r);
          const d = (pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2;
          if (d < best) {
            best = d;
            a = pa;
            b = pb;
          }
        });
      });
    } else {
      a = nearestCellTo(epFrom, epTo);
      b = nearestCellTo(epTo, epFrom);
    }
    if (!a || !b || (a.x === b.x && a.y === b.y)) return;
    const routing = conn.routing || 'direct';
    let pts;

    if (routing === 'angled' && Math.abs(b.x - a.x) > HEX_SIZE && Math.abs(b.y - a.y) > HEX_SIZE) {
      const corner = { x: b.x, y: a.y };
      const start = epFrom.type === 'zone'
        ? zoneBoundaryPoint(epFrom.zone, corner, a)
        : nodeEdgePoint(a, corner);
      const end = epTo.type === 'zone'
        ? zoneBoundaryPoint(epTo.zone, corner, b)
        : nodeEdgePoint(b, corner);
      pts = [start, corner, end];
    } else if (epFrom.type === 'node' && epTo.type === 'node') {
      // Direct node-node — also the fallback when too aligned for an elbow
      const trimmed = trimSegmentToHexEdges(a, b, HEX_SIZE);
      if (!trimmed) return;
      pts = [trimmed.from, trimmed.to];
    } else {
      // Direct with a zone on at least one end: trim each zone end at the
      // blob's silhouette along the line, node ends at their hex edge
      const start = epFrom.type === 'zone'
        ? zoneBoundaryPoint(epFrom.zone, b, a)
        : nodeEdgePoint(a, b);
      const end = epTo.type === 'zone'
        ? zoneBoundaryPoint(epTo.zone, a, b)
        : nodeEdgePoint(b, a);
      if (Math.hypot(end.x - start.x, end.y - start.y) < 2) return;
      pts = [start, end];
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
            onClick={saveToFile}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title={activeTab.fileHandle ? `Save to ${activeTab.fileHandle.name} (Ctrl+S)` : 'Save Tab (Ctrl+S)'}
          >
            <Save size={18} />
          </button>
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
            className="p-2 hover:bg-slate-700 rounded transition-colors text-xs flex items-center gap-1"
            title="Export as SVG"
          >
            <Download size={16} />
            <span>SVG</span>
          </button>
          <button
            onClick={exportAsPNG}
            className="p-2 hover:bg-slate-700 rounded transition-colors text-xs flex items-center gap-1"
            title="Export as PNG"
          >
            <Download size={16} />
            <span>PNG</span>
          </button>
        </div>

        {/* Zoom controls */}
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

      <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 bg-slate-800 p-4 border-r border-slate-700 overflow-y-auto scrollbar-thin">
        <h2 className="text-xl font-bold mb-4">Nodex</h2>
        
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
          <h3 className="text-sm font-semibold mb-3 text-slate-400">Shortcuts</h3>
          <ul className="text-xs space-y-1 text-slate-300">
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
              <p className="text-xs text-slate-300">{selectedZone.cells.length} cells</p>
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
            {channels.map(ch => (
              <div key={ch.id} className="flex items-center gap-2 p-2 rounded hover:bg-slate-700 group text-sm">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: ch.color }} />
                <span className="flex-1 truncate">{ch.name}</span>
                <button
                  onClick={() => setChannelForm({ id: ch.id, name: ch.name, color: ch.color })}
                  className="opacity-0 group-hover:opacity-100 text-blue-400 hover:text-blue-300 transition-opacity"
                >
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={() => deleteChannel(ch.id)}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
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
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="flex-1 relative overflow-hidden select-none"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          cursor: isPanning || isDraggingZone ? 'grabbing' : isCreatingZone ? 'crosshair' : connectingFrom ? 'crosshair' : resizingZone ? 'nwse-resize' : 'default'
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
        <svg className="w-full h-full">
          <g transform={`translate(${viewOffset.x}, ${viewOffset.y}) scale(${zoom})`}>
            {/* Zone backgrounds */}
            {zones.map(zone => (
              (() => {
                const cellSet = new Set(zone.cells.map(c => `${c.q},${c.r}`));
                const isConnectTarget = connectingFrom && hoveredZone === zone.id &&
                  !(connectingFrom.kind === 'zone' && connectingFrom.id === zone.id);
                const isZoneSelected = selectedZone?.id === zone.id;
                // Neighbor direction → index of the hex vertex pair forming
                // the shared edge (flat-top: vertex i sits at 60°·i)
                const EDGE_DIRS = [
                  { dq: 1, dr: 0, vi: 0 },
                  { dq: 0, dr: 1, vi: 1 },
                  { dq: -1, dr: 1, vi: 2 },
                  { dq: -1, dr: 0, vi: 3 },
                  { dq: 0, dr: -1, vi: 4 },
                  { dq: 1, dr: -1, vi: 5 }
                ];
                return (
                  <g
                    key={`zone-${zone.id}`}
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
                          opacity={isConnectTarget ? 0.35 : isZoneSelected ? 0.4 : 0.2}
                          className="cursor-pointer transition-opacity"
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
                              stroke={isConnectTarget ? '#22c55e' : zone.color}
                              strokeWidth={isConnectTarget || isZoneSelected ? 2.5 : 1.5}
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
                  style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}
                >
                  {zone.label}
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
            {hoveredCell && !isCreatingZone && (
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
                <g key={conn.id}>
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
                    const strandColor = ch ? ch.color : (isHovered && !conn.color ? '#94a3b8' : lineColor);
                    const strandKey = (ch ? ch.color : lineColor).replace('#', '');
                    return pieces.map((piece, i) => {
                      const A = sPts[piece.segIdx];
                      const B = sPts[piece.segIdx + 1];
                      const p1 = { x: A.x + (B.x - A.x) * piece.s, y: A.y + (B.y - A.y) * piece.s };
                      const p2 = { x: A.x + (B.x - A.x) * piece.e, y: A.y + (B.y - A.y) * piece.e };
                      return (
                        <line
                          key={`${si}-${i}`}
                          x1={p1.x}
                          y1={p1.y}
                          x2={p2.x}
                          y2={p2.y}
                          stroke={strandColor}
                          strokeWidth={isHovered ? 3 : 2}
                          strokeDasharray={strokeDasharray}
                          markerStart={piece.atStart && endStyles.start !== 'none' ? `url(#arrow-${endStyles.start}-${strandKey})` : undefined}
                          markerEnd={piece.atEnd && endStyles.end !== 'none' ? `url(#arrow-${endStyles.end}-${strandKey})` : undefined}
                          pointerEvents="none"
                        />
                      );
                    });
                  })}
                  {/* Label and icon - hidden when hovered */}
                  {geom.box && !isHovered && (
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
                  {/* Delete button - centered on line, only visible on hover */}
                  {isHovered && (
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

            {/* Temporary connection line */}
            {connectingFrom && (() => {
              let start;
              if (connectingFrom.kind === 'zone') {
                const z = zones.find(zz => zz.id === connectingFrom.id);
                if (!z || z.cells.length === 0) return null;
                // Track the zone cell nearest the cursor, like the final line will
                let bd = Infinity;
                z.cells.forEach(c => {
                  const p = axialToPixel(c.q, c.r);
                  const d = Math.hypot(p.x - mousePos.x, p.y - mousePos.y);
                  if (d < bd) {
                    bd = d;
                    start = p;
                  }
                });
              } else {
                start = axialToPixel(connectingFrom.q, connectingFrom.r);
              }
              const dist = Math.hypot(mousePos.x - start.x, mousePos.y - start.y);
              // Start from the hexagon edge once the cursor has left it
              let x1 = start.x, y1 = start.y;
              if (dist > HEX_SIZE) {
                const angle = Math.atan2(mousePos.y - start.y, mousePos.x - start.x);
                const trim = hexBoundaryDistance(HEX_SIZE, angle);
                x1 = start.x + Math.cos(angle) * trim;
                y1 = start.y + Math.sin(angle) * trim;
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

              return (
                <g
                  key={node.id}
                  className="node-element"
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onMouseDown={(e) => handleNodeMouseDown(e, node)}
                  onClick={(e) => handleNodeClick(e, node)}
                  onDoubleClick={(e) => handleNodeDoubleClick(e, node)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedNodeIds([node.id]);
                    openNodeEditor(node);
                  }}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: 'move' }}
                >
                  <polygon
                    points={getHexagonPoints(0, 0, HEX_SIZE)}
                    fill={node.color}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    opacity="0.9"
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
                  >
                    <div className="w-full h-full flex items-center justify-center">
                      <Icon size={24} color="white" />
                    </div>
                  </foreignObject>
                  <text
                    y={HEX_SIZE + 15}
                    fill="white"
                    fontSize="12"
                    textAnchor="middle"
                    fontWeight="500"
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
            {selectedZone && !isCreatingZone && (() => {
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
              {/* Legacy id used by the temporary connect line */}
              <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <polygon points="0 0, 10 3, 0 6" fill="#64748b" />
              </marker>
              {/* Connection pointer styles, one set per color in use;
                  auto-start-reverse flips them correctly as markerStart */}
              {[...new Set([
                ...connections.map(c => c.color || '#64748b'),
                ...channels.map(ch => ch.color)
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
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
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
