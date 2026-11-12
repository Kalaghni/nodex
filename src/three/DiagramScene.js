// Imperative three.js renderer for the 3D view of one diagram level.
//
// The 2D canvas stays the source of truth: this class only mirrors the
// current diagram (nodes, zones, connections, channels) plus the view
// state Nodex computes for it (selection, isolation focus, simulation and
// live status). React calls `setData` every render; work is skipped by
// comparing per-item signatures, so only what changed is rebuilt.
//
// World units: one hex cell has circumradius 1 (2D pixels / HEX_SIZE),
// 2D x → world x, 2D y → world z, y is up.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { buildModel, fitObject } from './models.js';
import { resolveModelSpec, modelSignature } from './modelSpec.js';
import { loadGltf, instantiateGltf, disposeObject } from './gltf.js';

const DEG = Math.PI / 180;
const SQRT3 = Math.sqrt(3);

const PED_R = 0.9;         // pedestal circumradius (cells are 1)
const PED_H = 0.2;         // pedestal height before bevel
const PED_BEVEL = 0.03;
const PED_TOP = PED_H + PED_BEVEL;
const MODEL_SIZE = 1.1;    // base model scale on top of the pedestal
const CONN_Y = 0.12;       // connection height above the ground
const ZONE_Y = 0.012;
const ZONE_WALL_H = 0.14;

const BG = new THREE.Color('#0f172a');
const GROUND = new THREE.Color('#0b1222');

const STATUS = { healthy: '#22c55e', degraded: '#f59e0b', down: '#ef4444' };

// ---------------------------------------------------------------------------
// Shared geometry
// ---------------------------------------------------------------------------

const hexShape = (r) => {
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    if (i === 0) s.moveTo(r * Math.cos(a), r * Math.sin(a));
    else s.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  s.closePath();
  return s;
};

const hexRingShape = (rOuter, rInner) => {
  const s = hexShape(rOuter);
  const hole = new THREE.Path();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    if (i === 0) hole.moveTo(rInner * Math.cos(a), rInner * Math.sin(a));
    else hole.lineTo(rInner * Math.cos(a), rInner * Math.sin(a));
  }
  hole.closePath();
  s.holes.push(hole);
  return s;
};

// Shape in XY extruded along z, laid flat: z → +y, shape y → −z (the hex
// is symmetric, so the flat-top orientation matches the 2D grid)
const flatExtrude = (shape, depth, bevel = 0) => {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6
  });
  g.rotateX(-Math.PI / 2);
  g.userData.shared = true;
  return g;
};

const GEO = {
  pedestal: flatExtrude(hexShape(PED_R - PED_BEVEL), PED_H, PED_BEVEL),
  inset: (() => {
    const g = new THREE.ShapeGeometry(hexShape(PED_R * 0.8));
    g.rotateX(-Math.PI / 2);
    g.userData.shared = true;
    return g;
  })(),
  selectRing: flatExtrude(hexRingShape(1.04, 0.96), 0.03),
  statusRing: flatExtrude(hexRingShape(1.14, 1.07), 0.03),
  hoverRing: flatExtrude(hexRingShape(1.0, 0.95), 0.02),
  zoneTile: flatExtrude(hexShape(0.995), 0.02),
  dot: (() => { const g = new THREE.SphereGeometry(0.09, 16, 12); g.userData.shared = true; return g; })(),
  packet: (() => { const g = new THREE.SphereGeometry(0.055, 10, 8); g.userData.shared = true; return g; })(),
  arrow: (() => { const g = new THREE.ConeGeometry(0.1, 0.26, 16); g.translate(0, -0.13, 0); g.userData.shared = true; return g; })(),
  ball: (() => { const g = new THREE.SphereGeometry(0.075, 14, 10); g.userData.shared = true; return g; })(),
  diamond: (() => { const g = new THREE.OctahedronGeometry(0.11); g.scale(0.7, 0.7, 1.3); g.userData.shared = true; return g; })()
};

const HEX_EDGE_DIRS = [
  // neighbor offset (dq, dr) → index of the edge's first vertex (angles
  // in 2D pixel space, i · 60°), matching the 2D zone outline
  { dq: 1, dr: 0, vi: 0 },
  { dq: 0, dr: 1, vi: 1 },
  { dq: -1, dr: 1, vi: 2 },
  { dq: -1, dr: 0, vi: 3 },
  { dq: 0, dr: -1, vi: 4 },
  { dq: 1, dr: -1, vi: 5 }
];

// ---------------------------------------------------------------------------
// Material looks (fade / grey-out) applied without rebuilding
// ---------------------------------------------------------------------------

const eachMaterial = (obj, fn) => {
  obj.traverse(o => {
    if (!o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(fn);
  });
};

const applyLook = (obj, { opacity = 1, grey = false } = {}) => {
  eachMaterial(obj, (m) => {
    if (m.userData.noLook) return;
    if (!m.userData.base) {
      m.userData.base = {
        color: m.color ? m.color.clone() : null,
        emissive: m.emissive ? m.emissive.clone() : null,
        opacity: m.opacity,
        transparent: m.transparent,
        depthWrite: m.depthWrite
      };
    }
    const b = m.userData.base;
    if (b.color) {
      m.color.copy(b.color);
      if (grey) {
        const l = b.color.r * 0.3 + b.color.g * 0.59 + b.color.b * 0.11;
        m.color.setRGB(l * 0.55 + 0.08, l * 0.55 + 0.09, l * 0.55 + 0.12);
      }
    }
    if (b.emissive) m.emissive.copy(grey ? new THREE.Color(0) : b.emissive);
    const transparent = b.transparent || opacity < 0.999;
    if (transparent !== m.transparent) {
      m.transparent = transparent;
      m.needsUpdate = true;
    }
    m.opacity = b.opacity * opacity;
    m.depthWrite = opacity < 0.999 ? false : b.depthWrite;
  });
};

// Fade for materials whose colors are managed directly
const setFade = (m, opacity) => {
  const transparent = opacity < 0.999;
  if (m.transparent !== transparent) {
    m.transparent = transparent;
    m.needsUpdate = true;
  }
  m.opacity = opacity;
  m.depthWrite = !transparent;
};

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const makeLabel = (text, style = {}) => {
  const el = document.createElement('div');
  el.textContent = text;
  const { size = 12, weight = 500, ...rest } = style;
  style = rest;
  Object.assign(el.style, {
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontWeight: String(weight),
    fontSize: `calc(var(--nx-ls, 1) * ${size}px)`,
    lineHeight: '1.35',
    color: '#e2e8f0',
    padding: '1px 6px',
    borderRadius: '4px',
    background: 'rgba(15, 23, 42, 0.72)',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    userSelect: 'none',
    transition: 'opacity 200ms',
    ...style
  });
  const obj = new CSS2DObject(el);
  obj.userData.isLabel = true;
  return obj;
};

const setLabelOpacity = (label, opacity) => {
  if (label) label.element.style.opacity = String(opacity);
};

// Offset a 2- or 3-point polyline sideways (XZ plane) — the 3D twin of the
// 2D channel-strand offset
const offsetPolyline = (pts, offset) => {
  if (offset === 0) return pts;
  const perp = (a, b) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: -dz / len, z: dx / len };
  };
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const nPrev = i > 0 ? perp(pts[i - 1], pts[i]) : null;
    const nNext = i < pts.length - 1 ? perp(pts[i], pts[i + 1]) : null;
    const nx = (nPrev?.x || 0) + (nNext?.x || 0);
    const nz = (nPrev?.z || 0) + (nNext?.z || 0);
    out.push(new THREE.Vector3(pts[i].x + nx * offset, pts[i].y, pts[i].z + nz * offset));
  }
  return out;
};

const DASHES = {
  solid: null,
  dashed: [0.2, 0.1],
  dotted: [0.05, 0.1],
  'dash-dot': [0.2, 0.12],
  'long-dash': [0.4, 0.2]
};

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

export class DiagramScene {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.cb = callbacks;
    this.nodes = new Map();      // id → node entry
    this.conns = new Map();      // id → connection entry
    this.zoneEntries = new Map(); // id → zone entry
    this.lineMaterials = new Set();
    this.packets = [];
    this.pulses = [];
    this.tween = null;
    this.fitKey = undefined;
    this.boundsSig = '';
    this.disposed = false;

    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.outline = 'none';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const labels = new CSS2DRenderer();
    labels.setSize(w, h);
    Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.appendChild(labels.domElement);
    this.labelRenderer = labels;

    // Scene, camera, lights
    const scene = new THREE.Scene();
    scene.background = BG;
    scene.fog = new THREE.Fog(BG, 40, 120);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = this.envTexture;
    scene.environmentIntensity = 0.45;
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 500);
    camera.position.set(0, 12, 14);
    this.camera = camera;

    scene.add(new THREE.HemisphereLight('#dbeafe', '#0f172a', 0.9));
    const sun = new THREE.DirectionalLight('#ffffff', 2.0);
    sun.position.set(-6, 14, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    // Layers
    this.root = new THREE.Group();
    this.gridGroup = new THREE.Group();
    this.zoneGroup = new THREE.Group();
    this.connGroup = new THREE.Group();
    this.nodeGroup = new THREE.Group();
    this.root.add(this.gridGroup, this.zoneGroup, this.connGroup, this.nodeGroup);
    scene.add(this.root);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.002;
    ground.receiveShadow = true;
    ground.userData.pick = { kind: 'ground' };
    this.ground = ground;
    scene.add(ground);

    // Controls: left orbit, right / middle / shift+left pan, wheel zoom
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = 85 * DEG;
    controls.minDistance = 2;
    controls.maxDistance = 200;
    controls.screenSpacePanning = false;
    controls.zoomToCursor = true;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    controls.addEventListener('start', () => { this.tween = null; });
    this.controls = controls;

    // Picking
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.down = null;
    this.hoverHit = null;
    this.pendingMove = null;
    const el = renderer.domElement;
    this.onPointerDown = (e) => {
      this.down = { x: e.clientX, y: e.clientY, button: e.button };
    };
    this.onPointerUp = (e) => {
      const d = this.down;
      this.down = null;
      if (!d || d.button !== e.button) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      const hit = this.pick(e);
      if (e.button === 0) this.cb.onClick?.(hit, e);
      else if (e.button === 2) this.cb.onContextMenu?.(hit, e);
    };
    this.onDblClick = (e) => {
      const hit = this.pick(e);
      if (hit?.kind === 'node') {
        const entry = this.nodes.get(hit.id);
        if (entry) this.flyTo(entry.group.position, 7);
      } else if (!hit) {
        this.fit(true);
      }
      this.cb.onDoubleClick?.(hit, e);
    };
    this.onPointerMove = (e) => {
      this.pendingMove = { clientX: e.clientX, clientY: e.clientY };
    };
    this.onPointerLeave = () => {
      this.pendingMove = null;
      this.setHover(null, null);
    };
    this.onContextMenu = (e) => e.preventDefault();
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('dblclick', this.onDblClick);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('contextmenu', this.onContextMenu);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.timer = new THREE.Timer();
    const loop = () => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  // ---- lifecycle ----

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.lineMaterials.forEach(m => m.resolution.set(w, h));
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('dblclick', this.onDblClick);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('contextmenu', this.onContextMenu);
    this.controls.dispose();
    [...this.nodes.keys()].forEach(id => this.removeNode(id));
    [...this.conns.keys()].forEach(id => this.removeConn(id));
    this.clearZones();
    this.clearGroup(this.gridGroup);
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.envTexture.dispose();
    this.renderer.dispose();
    el.remove();
    this.labelRenderer.domElement.remove();
  }

  clearGroup(group) {
    [...group.children].forEach(child => {
      group.remove(child);
      child.traverse(o => { if (o.userData.isLabel) o.element.remove(); });
      disposeObject(child);
    });
  }

  // ---- per-frame ----

  tick() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const t = this.timer.getElapsed();

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const k = 1 - Math.pow(1 - tw.t, 3);
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update();
    this.updateLabelScale();

    if (this.pendingMove) {
      const hit = this.pick(this.pendingMove);
      this.setHover(hit, this.pendingMove);
      this.pendingMove = null;
    }

    // Traffic packets riding the active channel strands
    this.packets.forEach(p => {
      p.u = (p.u + (dt * p.speed) / p.length) % 1;
      const u = p.reversed ? 1 - p.u : p.u;
      p.curve.getPointAt(u, p.mesh.position);
    });
    // Failed-component pulse
    this.pulses.forEach(m => {
      const s = 1 + 0.06 * (1 + Math.sin(t * 4));
      m.scale.set(s, 1, s);
      if (m.material) m.material.opacity = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 4));
    });

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  // Labels keep their size relative to the cells, like 2D text does when
  // zooming — readable up close, out of each other's way from afar
  updateLabelScale() {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const h = this.container.clientHeight || 1;
    const pxPerUnit = h / (2 * Math.tan((this.camera.fov * DEG) / 2) * dist);
    const scale = Math.round(Math.min(1.15, Math.max(0.5, (pxPerUnit * 0.3) / 12)) * 20) / 20;
    const hidden = pxPerUnit < 13;
    if (scale === this.labelScale && hidden === this.labelsHidden) return;
    this.labelScale = scale;
    this.labelsHidden = hidden;
    const st = this.labelRenderer.domElement.style;
    st.setProperty('--nx-ls', String(scale));
    st.visibility = hidden ? 'hidden' : 'visible';
  }

  // ---- picking ----

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [this.nodeGroup, this.connGroup, this.zoneGroup];
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.pick) o = o.parent;
      if (o?.userData.pick && o.visible !== false) return o.userData.pick;
    }
    return null;
  }

  setHover(hit, pos) {
    const prev = this.hoverHit;
    const same = (prev?.kind === hit?.kind && prev?.id === hit?.id);
    this.hoverHit = hit;
    this.renderer.domElement.style.cursor = hit ? 'pointer' : '';
    if (!same) this.cb.onHover?.(hit, pos);
    else if (hit && pos) this.cb.onHoverMove?.(pos);
  }

  // ---- camera ----

  contentBounds() {
    const box = new THREE.Box3();
    this.nodes.forEach(e => box.expandByPoint(e.group.position));
    this.zoneEntries.forEach(e => e.cells.forEach(p => box.expandByPoint(p)));
    if (box.isEmpty()) box.set(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 0, 3));
    box.expandByScalar(1.2);
    return box;
  }

  fit(animate = false) {
    const box = this.contentBounds();
    const center = box.getCenter(new THREE.Vector3());
    center.y = 0.5;
    const elevation = 42 * DEG;
    const dir = new THREE.Vector3(0, Math.sin(elevation), Math.cos(elevation));
    // Smallest distance at which every corner of the content box (models
    // included) projects inside the viewport, with a small margin
    const corners = [];
    [box.min.x, box.max.x].forEach(x => [0, 1.6].forEach(y => [box.min.z, box.max.z].forEach(z => corners.push(new THREE.Vector3(x, y, z)))));
    const cam = this.camera.clone();
    const fits = (dist) => {
      cam.position.copy(center).addScaledVector(dir, dist);
      cam.lookAt(center);
      cam.updateMatrixWorld(true);
      return corners.every(c => {
        const p = c.clone().project(cam);
        return p.z < 1 && Math.abs(p.x) <= 0.92 && Math.abs(p.y) <= 0.88;
      });
    };
    const search = () => {
      let lo = 2;
      let hi = 8;
      while (!fits(hi) && hi < 400) hi *= 1.6;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid; else lo = mid;
      }
      return Math.max(5, hi);
    };
    // Perspective makes the near edge of the box loom larger than the far
    // edge, so re-center on the projected bounds and search again
    let dist = search();
    for (let pass = 0; pass < 2; pass++) {
      fits(dist);
      let yMin = Infinity, yMax = -Infinity, xMin = Infinity, xMax = -Infinity;
      corners.forEach(c => {
        const p = c.clone().project(cam);
        yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y);
        xMin = Math.min(xMin, p.x); xMax = Math.max(xMax, p.x);
      });
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((xMin + xMax) / 2, (yMin + yMax) / 2), cam);
      const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5), new THREE.Vector3());
      if (!hit) break;
      center.x = hit.x;
      center.z = hit.z;
      dist = search();
    }
    const pos = center.clone().addScaledVector(dir, dist);
    this.moveCamera(pos, center, animate);
  }

  flyTo(point, distance = 7) {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const target = new THREE.Vector3(point.x, 0.4, point.z);
    this.moveCamera(target.clone().addScaledVector(dir, distance), target, true);
  }

  moveCamera(pos, target, animate) {
    if (!animate) {
      this.tween = null;
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.tween = {
      t: 0,
      duration: 0.55,
      fromPos: this.camera.position.clone(),
      toPos: pos,
      fromTarget: this.controls.target.clone(),
      toTarget: target
    };
  }

  // Straight-down view, keeping the current target
  topView() {
    const target = this.controls.target.clone();
    const dist = this.camera.position.distanceTo(target);
    this.moveCamera(target.clone().add(new THREE.Vector3(0, dist, 0.001)), target, true);
  }

  // ---- data ----

  setData(data) {
    const { nodes, zones, connections, connGeoms, zoneLabels, visuals, axialToPixel, hexSize, fitKey } = data;
    this.toWorld = (p) => ({ x: p.x / hexSize, z: p.y / hexSize });
    this.axialToWorld = (q, r) => this.toWorld(axialToPixel(q, r));
    this.visuals = visuals;

    this.syncZones(zones, zoneLabels, visuals);
    this.syncNodes(nodes, visuals);
    this.syncConnections(connections, connGeoms, visuals);
    this.syncGrid();

    if (fitKey !== this.fitKey) {
      const first = this.fitKey === undefined;
      this.fitKey = fitKey;
      this.fit(!first);
    }
  }

  // Ground, hex grid and shadow frustum follow the content bounds
  syncGrid() {
    const box = this.contentBounds();
    const pad = 6;
    const minX = Math.floor(box.min.x - pad);
    const maxX = Math.ceil(box.max.x + pad);
    const minZ = Math.floor(box.min.z - pad);
    const maxZ = Math.ceil(box.max.z + pad);
    const sig = `${minX},${maxX},${minZ},${maxZ}`;
    if (sig === this.boundsSig) return;
    this.boundsSig = sig;

    this.clearGroup(this.gridGroup);
    // Hex outlines for every cell whose center is in the padded rect
    const pos = [];
    const qMin = Math.floor(minX / 1.5) - 1;
    const qMax = Math.ceil(maxX / 1.5) + 1;
    for (let q = qMin; q <= qMax; q++) {
      const x = 1.5 * q;
      const rMin = Math.floor(minZ / SQRT3 - q / 2) - 1;
      const rMax = Math.ceil(maxZ / SQRT3 - q / 2) + 1;
      for (let r = rMin; r <= rMax; r++) {
        const z = SQRT3 * (r + q / 2);
        if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
        // three edges per cell are enough to draw the whole lattice once
        for (let i = 0; i < 3; i++) {
          const a1 = (Math.PI / 3) * i;
          const a2 = (Math.PI / 3) * (i + 1);
          pos.push(x + Math.cos(a1), 0.001, z + Math.sin(a1), x + Math.cos(a2), 0.001, z + Math.sin(a2));
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const grid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#334155', transparent: true, opacity: 0.35 }));
    this.gridGroup.add(grid);

    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ);
    this.ground.position.set(cx, -0.002, cz);
    this.ground.scale.set(span * 4, span * 4, 1);
    this.scene.fog.near = span * 1.2;
    this.scene.fog.far = span * 4 + 40;

    const sh = this.sun.shadow.camera;
    const half = span / 2 + 2;
    sh.left = -half;
    sh.right = half;
    sh.top = half;
    sh.bottom = -half;
    sh.near = 0.5;
    sh.far = span * 3 + 40;
    sh.updateProjectionMatrix();
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx - span * 0.5, span * 1.2 + 8, cz + span * 0.7);
  }

  // ---- zones ----

  clearZones() {
    this.zoneEntries.forEach(e => {
      this.zoneGroup.remove(e.group);
      e.group.traverse(o => { if (o.userData.isLabel) o.element.remove(); });
      disposeObject(e.group);
    });
    this.zoneEntries.clear();
  }

  syncZones(zones, zoneLabels, visuals) {
    const sig = JSON.stringify(zones.map(z => [z.id, z.color, z.label, z.cells, zoneLabels?.[z.id]]));
    if (sig !== this.zonesSig) {
      this.zonesSig = sig;
      this.clearZones();
      zones.forEach(zone => {
        if (!zone.cells?.length) return;
        this.zoneEntries.set(zone.id, this.buildZone(zone, zoneLabels?.[zone.id]));
      });
    }
    this.zoneEntries.forEach((entry, id) => {
      const v = visuals.zones.get(id) || {};
      const key = JSON.stringify(v);
      if (key === entry.visualKey) return;
      entry.visualKey = key;
      const outline = v.connectTarget ? '#22c55e' : v.status && v.status !== 'healthy' ? STATUS[v.status] : entry.color;
      const fade = v.dimmed ? 0.25 : 1;
      entry.tileMat.color.set(v.failed ? '#7f1d1d' : entry.color);
      entry.tileMat.opacity = (v.selected ? 0.42 : v.hovered ? 0.34 : v.status === 'down' ? 0.12 : 0.24) * fade;
      entry.wallMat.color.set(outline);
      entry.wallMat.opacity = (v.selected ? 0.5 : 0.28) * fade;
      entry.edgeMat.color.set(outline);
      entry.edgeMat.opacity = 0.95 * fade;
      entry.edgeMat.linewidth = v.selected || v.hovered ? 3 : 2;
      entry.edgeMat.dashed = v.status === 'down' && !v.failed;
      entry.edgeMat.needsUpdate = true;
      setLabelOpacity(entry.label, v.dimmed ? 0.25 : 1);
    });
  }

  buildZone(zone, labelPos) {
    const group = new THREE.Group();
    const cellSet = new Set(zone.cells.map(c => `${c.q},${c.r}`));
    const centers = zone.cells.map(c => this.axialToWorld(c.q, c.r));

    const tileMat = new THREE.MeshStandardMaterial({
      color: zone.color, transparent: true, opacity: 0.24, depthWrite: false, roughness: 0.9
    });
    const tiles = new THREE.InstancedMesh(GEO.zoneTile, tileMat, centers.length);
    const m = new THREE.Matrix4();
    centers.forEach((c, i) => {
      m.makeTranslation(c.x, ZONE_Y - 0.01, c.z);
      tiles.setMatrixAt(i, m);
    });
    tiles.instanceMatrix.needsUpdate = true;
    tiles.receiveShadow = true;
    tiles.renderOrder = -1;
    tiles.userData.pick = { kind: 'zone', id: zone.id };
    group.add(tiles);

    // Low translucent walls + a bright rim along the outer silhouette
    const wall = [];
    const rim = [];
    zone.cells.forEach((cell, i) => {
      const c = centers[i];
      HEX_EDGE_DIRS.forEach(d => {
        if (cellSet.has(`${cell.q + d.dq},${cell.r + d.dr}`)) return;
        const a1 = (Math.PI / 3) * d.vi;
        const a2 = (Math.PI / 3) * (d.vi + 1);
        const x1 = c.x + Math.cos(a1), z1 = c.z + Math.sin(a1);
        const x2 = c.x + Math.cos(a2), z2 = c.z + Math.sin(a2);
        wall.push(
          x1, 0, z1, x2, 0, z2, x2, ZONE_WALL_H, z2,
          x1, 0, z1, x2, ZONE_WALL_H, z2, x1, ZONE_WALL_H, z1
        );
        rim.push(x1, ZONE_WALL_H, z1, x2, ZONE_WALL_H, z2);
      });
    });
    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3));
    wallGeo.computeVertexNormals();
    const wallMat = new THREE.MeshBasicMaterial({
      color: zone.color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false
    });
    const walls = new THREE.Mesh(wallGeo, wallMat);
    walls.userData.pick = { kind: 'zone', id: zone.id };
    group.add(walls);

    const rimGeo = new LineSegmentsGeometry().setPositions(rim);
    const edgeMat = this.lineMaterial({ color: zone.color, linewidth: 2, dashSize: 0.18, gapSize: 0.12 });
    const edges = new LineSegments2(rimGeo, edgeMat);
    edges.computeLineDistances();
    group.add(edges);

    let label = null;
    if (zone.label && labelPos) {
      const p = this.toWorld(labelPos);
      label = makeLabel(zone.label, {
        color: zone.color,
        background: 'transparent',
        weight: 600,
        size: 13,
        textShadow: '0 1px 3px rgba(0,0,0,0.9)'
      });
      label.position.set(p.x, ZONE_WALL_H, p.z);
      if (labelPos.textAnchor === 'start') label.center.set(0, 0.5);
      if (labelPos.textAnchor === 'end') label.center.set(1, 0.5);
      group.add(label);
    }

    this.zoneGroup.add(group);
    return {
      group,
      color: zone.color,
      tileMat,
      wallMat,
      edgeMat,
      label,
      cells: centers.map(c => new THREE.Vector3(c.x, 0, c.z)),
      visualKey: null
    };
  }

  lineMaterial({ color, linewidth = 2, opacity = 1, dashed = false, dashSize = 0.2, gapSize = 0.1 }) {
    const m = new LineMaterial({
      color: new THREE.Color(color),
      linewidth,
      transparent: true,
      opacity,
      dashed,
      dashSize,
      gapSize,
      worldUnits: false
    });
    m.resolution.set(this.container.clientWidth || 1, this.container.clientHeight || 1);
    this.lineMaterials.add(m);
    m.addEventListener('dispose', () => this.lineMaterials.delete(m));
    return m;
  }

  // ---- nodes ----

  removeNode(id) {
    const e = this.nodes.get(id);
    if (!e) return;
    e.disposed = true;
    this.nodeGroup.remove(e.group);
    e.group.traverse(o => { if (o.userData.isLabel) o.element.remove(); });
    this.pulses = this.pulses.filter(p => p !== e.statusRing);
    disposeObject(e.group);
    this.nodes.delete(id);
  }

  syncNodes(nodes, visuals) {
    const seen = new Set();
    nodes.forEach(node => {
      seen.add(node.id);
      const sig = `${modelSignature(node)}|${node.label}|${node.role || ''}`;
      let e = this.nodes.get(node.id);
      if (e && e.sig !== sig) {
        this.removeNode(node.id);
        e = null;
      }
      if (!e) {
        e = this.buildNode(node);
        e.sig = sig;
        this.nodes.set(node.id, e);
      }
      const p = this.axialToWorld(node.q, node.r);
      e.group.position.set(p.x, 0, p.z);
      e.node = node;
    });
    [...this.nodes.keys()].forEach(id => { if (!seen.has(id)) this.removeNode(id); });

    this.nodes.forEach((e, id) => this.applyNodeVisual(e, visuals.nodes.get(id) || {}));
  }

  buildNode(node) {
    const group = new THREE.Group();
    group.userData.pick = { kind: 'node', id: node.id };
    const color = new THREE.Color(node.color || '#3b82f6');

    const pedMat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.12 });
    const pedestal = new THREE.Mesh(GEO.pedestal, pedMat);
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    group.add(pedestal);

    const insetMat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.72), roughness: 0.6, metalness: 0.05 });
    const inset = new THREE.Mesh(GEO.inset, insetMat);
    inset.position.y = PED_TOP + 0.002;
    inset.receiveShadow = true;
    group.add(inset);

    const holder = new THREE.Group();
    holder.position.y = PED_TOP;
    group.add(holder);

    const ring = (geo, mat, y) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.visible = false;
      group.add(m);
      return m;
    };
    const glowMat = (c, o = 1) => new THREE.MeshStandardMaterial({
      color: c, emissive: new THREE.Color(c), emissiveIntensity: 0.9, transparent: o < 1, opacity: o
    });
    const selectRing = ring(GEO.selectRing, glowMat('#fbbf24'), 0.006);
    const statusMat = glowMat('#ef4444', 0.9);
    statusMat.transparent = true;
    const statusRing = ring(GEO.statusRing, statusMat, 0.004);
    const hoverRing = ring(GEO.hoverRing, glowMat('#e2e8f0', 0.6), 0.008);
    selectRing.material.userData.noLook = true;
    statusMat.userData.noLook = true;
    hoverRing.material.userData.noLook = true;

    const dot = (c, x, z) => {
      const m = new THREE.Mesh(GEO.dot, glowMat(c));
      m.material.userData.noLook = true;
      m.position.set(x, PED_TOP + 0.09, z);
      m.visible = false;
      group.add(m);
      return m;
    };
    const liveDot = dot('#22c55e', -0.5, -0.42);
    const statusDot = dot('#22c55e', -0.5, -0.42);
    const nestedDot = dot('#3b82f6', 0.5, -0.42);

    const label = makeLabel(node.label || '');
    label.position.set(0, 0, 1.08);
    group.add(label);

    let vip = null;
    if (node.role === 'vip') {
      vip = makeLabel('VIP', {
        weight: 700,
        size: 9,
        color: '#fbbf24',
        border: '1px solid #f59e0b',
        borderRadius: '8px',
        background: '#0f172a',
        padding: '0 5px'
      });
      vip.position.set(0, PED_TOP, 0.72);
      group.add(vip);
    }

    this.nodeGroup.add(group);
    const entry = {
      group, pedestal, pedMat, insetMat, holder, selectRing, statusRing, hoverRing,
      liveDot, statusDot, nestedDot, label, vip, color, visualKey: null, model: null, modelError: null
    };
    this.setNodeModel(entry, node);
    return entry;
  }

  setNodeModel(entry, node) {
    const spec = resolveModelSpec(node);
    entry.holder.rotation.y = -spec.rotation * DEG;
    entry.holder.scale.setScalar(MODEL_SIZE * spec.scale);
    const put = (obj) => {
      if (entry.model) {
        entry.holder.remove(entry.model);
        disposeObject(entry.model);
      }
      entry.model = obj;
      if (obj) entry.holder.add(obj);
      entry.visualKey = null; // re-apply fade/grey to the new materials
    };
    if (spec.kind === 'none') {
      put(null);
    } else if (spec.kind === 'builtin') {
      put(buildModel(spec.id, node.color));
    } else {
      // Icon model stands in while the file loads (and if it fails)
      put(buildModel(spec.fallbackId, node.color));
      loadGltf(spec.url).then(template => {
        if (entry.disposed) return;
        put(fitObject(instantiateGltf(template)));
        entry.modelError = null;
        if (this.visuals) this.applyNodeVisual(entry, this.visuals.nodes.get(node.id) || {});
        this.cb.onModelStatus?.(node.id, null);
      }).catch(err => {
        if (entry.disposed) return;
        entry.modelError = err.message;
        this.cb.onModelStatus?.(node.id, err.message);
      });
    }
  }

  applyNodeVisual(e, v) {
    const key = JSON.stringify(v);
    if (key === e.visualKey) return;
    e.visualKey = key;
    const fade = v.dimmed ? 0.15 : v.standby ? 0.6 : v.stranded ? 0.4 : v.collateralDown ? 0.45 : 1;
    const grey = !!v.failed;

    e.pedMat.color.copy(v.failed ? new THREE.Color('#1e293b') : e.color);
    e.pedMat.emissive.copy(e.color).multiplyScalar(v.hovered && !v.failed ? 0.25 : 0);
    e.insetMat.color.copy(v.failed ? new THREE.Color('#0f172a') : e.color.clone().multiplyScalar(0.72));
    setFade(e.pedMat, fade);
    setFade(e.insetMat, fade);
    if (e.model) applyLook(e.model, { opacity: fade, grey });

    e.selectRing.visible = !!v.selected || !!v.connectTarget;
    e.selectRing.material.color.set(v.connectTarget ? '#22c55e' : '#fbbf24');
    e.selectRing.material.emissive.set(v.connectTarget ? '#22c55e' : '#fbbf24');
    e.hoverRing.visible = !!v.hovered || !!v.traceOrigin;
    e.hoverRing.material.color.set(v.traceOrigin ? '#fbbf24' : '#e2e8f0');

    const showStatus = v.status && v.status !== 'healthy';
    e.statusRing.visible = !!showStatus;
    if (showStatus) {
      e.statusRing.material.color.set(STATUS[v.status]);
      e.statusRing.material.emissive.set(STATUS[v.status]);
    }
    const pulsing = this.pulses.includes(e.statusRing);
    if (v.failed && !pulsing) this.pulses.push(e.statusRing);
    if (!v.failed && pulsing) {
      this.pulses = this.pulses.filter(p => p !== e.statusRing);
      e.statusRing.scale.set(1, 1, 1);
      e.statusRing.material.opacity = 0.9;
    }

    // Healthy-in-simulation dot and live dot share the corner; live wins
    e.liveDot.visible = !!v.live;
    if (v.live) {
      e.liveDot.material.color.set(v.live);
      e.liveDot.material.emissive.set(v.live);
    }
    e.statusDot.visible = !v.live && v.status === 'healthy' && !!v.showHealthy;
    // Linked nodes open their link target instead of a nested diagram
    e.nestedDot.visible = !!v.nested || !!v.linked;
    const nestedColor = v.linked ? '#8b5cf6' : '#3b82f6';
    e.nestedDot.material.color.set(nestedColor);
    e.nestedDot.material.emissive.set(nestedColor);

    setLabelOpacity(e.label, v.dimmed ? 0.25 : 1);
    if (e.label) {
      e.label.element.style.color = v.failed ? STATUS.down : v.selected ? '#fde68a' : '#e2e8f0';
    }
    setLabelOpacity(e.vip, v.dimmed ? 0.25 : 1);
  }

  // ---- connections ----

  removeConn(id) {
    const e = this.conns.get(id);
    if (!e) return;
    this.connGroup.remove(e.group);
    e.group.traverse(o => { if (o.userData.isLabel) o.element.remove(); });
    this.packets = this.packets.filter(p => p.conn !== id);
    disposeObject(e.group);
    this.conns.delete(id);
  }

  syncConnections(connections, connGeoms, visuals) {
    const seen = new Set();
    connections.forEach(conn => {
      const geom = connGeoms[conn.id];
      if (!geom) return;
      seen.add(conn.id);
      const v = visuals.conns.get(conn.id) || {};
      const sig = JSON.stringify([
        geom.pts.map(p => [Math.round(p.x * 10), Math.round(p.y * 10)]),
        conn.label, conn.color, conn.lineType, v
      ]);
      const e = this.conns.get(conn.id);
      if (e && e.sig === sig) return;
      if (e) this.removeConn(conn.id);
      const built = this.buildConnection(conn, geom, v);
      built.sig = sig;
      this.conns.set(conn.id, built);
    });
    [...this.conns.keys()].forEach(id => { if (!seen.has(id)) this.removeConn(id); });
  }

  buildConnection(conn, geom, v) {
    const group = new THREE.Group();
    const pts = geom.pts.map(p => {
      const w = this.toWorld(p);
      return new THREE.Vector3(w.x, CONN_Y, w.z);
    });
    const strands = v.strands?.length ? v.strands : [{ color: conn.color || '#64748b', dash: conn.lineType || 'solid', opacity: 1 }];
    const groupFade = v.dimmed ? 0.08 : 1;
    const spacing = 0.13;

    // Selection glow under the whole bundle
    if (v.selected) {
      const glow = new Line2(
        new LineGeometry().setPositions(pts.flatMap(p => [p.x, p.y - 0.01, p.z])),
        this.lineMaterial({ color: '#fbbf24', linewidth: 7 + (strands.length - 1) * 4, opacity: 0.35 })
      );
      group.add(glow);
    }

    strands.forEach((s, si) => {
      const offset = (si - (strands.length - 1) / 2) * spacing;
      const sPts = offsetPolyline(pts, offset);
      const dash = typeof s.dash === 'string' ? DASHES[s.dash] : s.dash;
      const opacity = (s.opacity ?? 1) * groupFade;
      const mat = this.lineMaterial({
        color: s.color,
        linewidth: v.hovered ? 3.5 : 2.5,
        opacity,
        dashed: !!dash,
        dashSize: dash?.[0] ?? 0.2,
        gapSize: dash?.[1] ?? 0.1
      });
      const line = new Line2(new LineGeometry().setPositions(sPts.flatMap(p => [p.x, p.y, p.z])), mat);
      line.computeLineDistances();
      group.add(line);

      // End markers
      const ends = [
        { style: v.endStyles?.start, at: sPts[0], from: sPts[1] },
        { style: v.endStyles?.end, at: sPts[sPts.length - 1], from: sPts[sPts.length - 2] }
      ];
      ends.forEach(({ style, at, from }) => {
        if (!style || style === 'none') return;
        const dir = at.clone().sub(from).normalize();
        const m = new THREE.MeshStandardMaterial({
          color: s.color, emissive: new THREE.Color(s.color), emissiveIntensity: 0.35,
          transparent: opacity < 1, opacity, wireframe: style === 'open'
        });
        const geo = style === 'circle' ? GEO.ball : style === 'diamond' ? GEO.diamond : GEO.arrow;
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.copy(at);
        if (style === 'diamond') {
          mesh.position.addScaledVector(dir, -0.14);
          mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
        } else if (style !== 'circle') {
          mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        }
        group.add(mesh);
      });

      // Packets travel the strand in the direction traffic flows
      if (s.animate && opacity > 0.3) {
        const path = new THREE.CurvePath();
        for (let i = 0; i < sPts.length - 1; i++) path.add(new THREE.LineCurve3(sPts[i], sPts[i + 1]));
        const length = path.getLength();
        const count = Math.max(1, Math.round(length / 1.6));
        for (let k = 0; k < count; k++) {
          const mesh = new THREE.Mesh(GEO.packet, new THREE.MeshStandardMaterial({
            color: s.color, emissive: new THREE.Color(s.color), emissiveIntensity: 1.6
          }));
          group.add(mesh);
          this.packets.push({
            conn: conn.id, mesh, curve: path, length, speed: 1.6, reversed: !!v.reversed, u: k / count
          });
        }
      }
    });

    // Invisible fat tube to make thin lines easy to hover / click
    const hitPath = new THREE.CurvePath();
    for (let i = 0; i < pts.length - 1; i++) hitPath.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    const hit = new THREE.Mesh(
      new THREE.TubeGeometry(hitPath, Math.max(2, pts.length * 4), 0.16 + strands.length * 0.04, 6, false),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
    );
    hit.userData.pick = { kind: 'conn', id: conn.id };
    group.add(hit);

    if (conn.label) {
      const mid = this.toWorld(geom.mid);
      const label = makeLabel(conn.label, {
        color: conn.color || '#e2e8f0',
        size: 11,
        border: `1px solid ${conn.color || '#475569'}`,
        opacity: String(groupFade < 1 ? 0.15 : 1)
      });
      label.position.set(mid.x, CONN_Y + 0.05, mid.z);
      group.add(label);
    }

    this.connGroup.add(group);
    return { group };
  }

  // ---- export ----

  // PNG of the current view, labels drawn in
  screenshot(scale = 2) {
    const r = this.renderer;
    const prevRatio = r.getPixelRatio();
    r.setPixelRatio(scale);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    r.setSize(w, h, false);
    this.lineMaterials.forEach(m => m.resolution.set(w * scale, h * scale));
    r.render(this.scene, this.camera);
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(r.domElement, 0, 0);
    // Labels: project each visible CSS2D label and draw it
    ctx.scale(scale, scale);
    ctx.textBaseline = 'middle';
    this.scene.traverseVisible(o => {
      if (!o.userData.isLabel || this.labelsHidden) return;
      const el = o.element;
      const op = parseFloat(el.style.opacity || '1');
      if (!el.textContent || op <= 0.05) return;
      const p = o.getWorldPosition(new THREE.Vector3()).project(this.camera);
      if (p.z > 1) return;
      const x = (p.x * 0.5 + 0.5) * w;
      const y = (-p.y * 0.5 + 0.5) * h;
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize) || 12;
      const pad = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? fs * 0.5 : 0;
      ctx.font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
      const tw = ctx.measureText(el.textContent).width;
      const boxW = tw + pad * 2;
      const left = x - boxW * o.center.x;
      ctx.globalAlpha = op;
      if (pad) {
        ctx.fillStyle = cs.backgroundColor;
        ctx.beginPath();
        ctx.roundRect(left, y - fs * 0.75, boxW, fs * 1.5, 4);
        ctx.fill();
      }
      ctx.fillStyle = cs.color || '#e2e8f0';
      ctx.fillText(el.textContent, left + pad, y);
      ctx.globalAlpha = 1;
    });
    r.setPixelRatio(prevRatio);
    r.setSize(w, h, false);
    this.lineMaterials.forEach(m => m.resolution.set(w, h));
    return canvas.toDataURL('image/png');
  }
}
