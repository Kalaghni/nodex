// Procedural 3D models — one per node icon.
//
// Every icon in the 2D palette has a model here under the same id, built
// from three.js primitives (no assets to download). Builders work in a
// loose ~1 unit box standing on y = 0, facing +z (toward the default
// camera); `buildModel` then normalizes every model to the same footprint
// so builders don't have to be precise about size.
//
// Colors follow the 2D look: a light shell (the icons are white on the
// colored hexagon) with the node's color used for accents and glows.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const TAU = Math.PI * 2;
const WHITE = new THREE.Color('#ffffff');

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

// A fresh set of materials per model instance, so one node can be faded or
// tinted (simulation, isolation) without touching any other node
export const createPalette = (color = '#3b82f6') => {
  const base = new THREE.Color(color);
  const light = base.clone().lerp(WHITE, 0.45);
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.05, ...o });
  const glow = (c, intensity = 1.4) => std(c, { emissive: new THREE.Color(c), emissiveIntensity: intensity, roughness: 0.35 });
  return {
    body: std('#e2e8f0', { roughness: 0.4 }),
    white: std('#f8fafc', { roughness: 0.35 }),
    accent: std(base, { roughness: 0.38, metalness: 0.15 }),
    accentDark: std(base.clone().multiplyScalar(0.5)),
    dark: std('#1e293b', { roughness: 0.55 }),
    mid: std('#64748b'),
    metal: std('#cbd5e1', { metalness: 0.85, roughness: 0.25 }),
    gold: std('#fbbf24', { metalness: 0.8, roughness: 0.28 }),
    wood: std('#a16207', { roughness: 0.75 }),
    glow: glow(light, 1.1),
    screen: std('#0b1220', { emissive: light, emissiveIntensity: 0.85, roughness: 0.2 }),
    glass: std('#bfdbfe', { transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1, depthWrite: false }),
    green: glow('#22c55e', 1.0),
    red: glow('#ef4444', 1.0),
    amber: glow('#f59e0b', 1.0),
    yellow: glow('#fde047', 1.3),
    orange: glow('#f97316', 1.2),
    sky: std('#38bdf8', { roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 })
  };
};

// ---------------------------------------------------------------------------
// Builder toolkit
// ---------------------------------------------------------------------------

const place = (mesh, x = 0, y = 0, z = 0, o = {}) => {
  mesh.position.set(x, y, z);
  if (o.rot) mesh.rotation.set(o.rot[0] || 0, o.rot[1] || 0, o.rot[2] || 0);
  if (o.scale) {
    if (Array.isArray(o.scale)) mesh.scale.set(...o.scale);
    else mesh.scale.setScalar(o.scale);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

// 2D outline helpers (XY plane)
export const polyShape = (pts) => {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  s.closePath();
  return s;
};

const roundedRectShape = (w, h, r) => {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
};

const circlePath = (r, cx = 0, cy = 0, Cls = THREE.Path) => {
  const p = new Cls();
  p.absarc(cx, cy, r, 0, TAU, true);
  return p;
};

const starShape = (points, rOuter, rInner) => {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 === 0 ? rOuter : rInner;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return polyShape(pts);
};

const gearShape = (teeth, rOuter, rRoot, holeR) => {
  const s = new THREE.Shape();
  const step = TAU / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [
      [rRoot, a],
      [rOuter, a + step * 0.15],
      [rOuter, a + step * 0.45],
      [rRoot, a + step * 0.6]
    ];
    pts.forEach(([r, ang], j) => {
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (i === 0 && j === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    });
    s.absarc(0, 0, rRoot, a + step * 0.6, a + step, false);
  }
  if (holeR) s.holes.push(circlePath(holeR));
  return s;
};

const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);

class ModelBuilder {
  constructor(palette) {
    this.p = palette;
    this.group = new THREE.Group();
  }

  add(mesh) {
    this.group.add(mesh);
    return mesh;
  }

  mesh(geo, mat, x, y, z, o) {
    return this.add(place(new THREE.Mesh(geo, mat), x, y, z, o));
  }

  box(w, h, d, mat, x = 0, y = 0, z = 0, o = {}) {
    return this.mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, o);
  }

  rbox(w, h, d, r, mat, x = 0, y = 0, z = 0, o = {}) {
    const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    return this.mesh(new RoundedBoxGeometry(w, h, d, 3, Math.max(rr, 0.001)), mat, x, y, z, o);
  }

  cyl(rTop, rBot, h, mat, x = 0, y = 0, z = 0, o = {}) {
    const geo = new THREE.CylinderGeometry(rTop, rBot, h, o.seg || 32, 1, !!o.open, o.thetaStart || 0, o.thetaLength ?? TAU);
    return this.mesh(geo, mat, x, y, z, o);
  }

  sphere(r, mat, x = 0, y = 0, z = 0, o = {}) {
    const geo = new THREE.SphereGeometry(r, o.seg || 28, Math.max(8, Math.round((o.seg || 28) * 0.7)));
    return this.mesh(geo, mat, x, y, z, o);
  }

  torus(R, r, mat, x = 0, y = 0, z = 0, o = {}) {
    const geo = new THREE.TorusGeometry(R, r, 12, o.seg || 40, o.arc ?? TAU);
    return this.mesh(geo, mat, x, y, z, o);
  }

  cone(r, h, mat, x = 0, y = 0, z = 0, o = {}) {
    return this.mesh(new THREE.ConeGeometry(r, h, o.seg || 28), mat, x, y, z, o);
  }

  // Shape in the XY plane, extruded `depth` along z and centered on it
  extrude(shape, depth, mat, x = 0, y = 0, z = 0, o = {}) {
    const bevel = o.bevel ?? Math.min(0.02, depth / 4);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: o.curveSegments || 24
    });
    geo.translate(0, 0, -depth / 2);
    return this.mesh(geo, mat, x, y, z, o);
  }

  // Profile [[radius, height], ...] revolved around y
  lathe(profile, mat, x = 0, y = 0, z = 0, o = {}) {
    // Bottom-to-top profiles give outward-facing triangles
    if (profile[0][1] > profile[profile.length - 1][1]) profile = [...profile].reverse();
    const geo = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), o.seg || 36);
    return this.mesh(geo, mat, x, y, z, o);
  }

  tube(points, radius, mat, o = {}) {
    const curve = o.straight
      ? new THREE.CurvePath()
      : new THREE.CatmullRomCurve3(points.map(v3), !!o.closed, 'catmullrom', o.tension ?? 0.5);
    if (o.straight) {
      for (let i = 0; i < points.length - 1; i++) curve.add(new THREE.LineCurve3(v3(points[i]), v3(points[i + 1])));
    }
    const geo = new THREE.TubeGeometry(curve, o.segments || Math.max(16, points.length * 12), radius, 10, !!o.closed);
    const m = this.mesh(geo, mat, 0, 0, 0, {});
    // Round caps on open polylines
    if (o.caps !== false && !o.closed) {
      this.sphere(radius, mat, ...points[0], { seg: 10 });
      this.sphere(radius, mat, ...points[points.length - 1], { seg: 10 });
      if (o.straight) points.slice(1, -1).forEach(pt => this.sphere(radius, mat, ...pt, { seg: 10 }));
    }
    return m;
  }

  // A thick polyline made of straight bars (for glyph-like models)
  bars(points, thickness, depth, mat, z = 0) {
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[i + 1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ang = Math.atan2(y2 - y1, x2 - x1);
      this.rbox(len + thickness, thickness, depth, thickness * 0.45, mat, (x1 + x2) / 2, (y1 + y2) / 2, z, { rot: [0, 0, ang] });
    }
  }

  // Low plinth for glyph models that would otherwise float on one point
  plinth(r = 0.42, h = 0.06, mat = this.p.dark) {
    return this.cyl(r, r * 1.05, h, mat, 0, h / 2, 0, { seg: 40 });
  }
}

// ---------------------------------------------------------------------------
// Reusable sub-assemblies
// ---------------------------------------------------------------------------

const person = (b, x, z, s = 1, bodyMat = b.p.body, headMat = b.p.body) => {
  const prof = [[0, 0], [0.3, 0], [0.3, 0.22], [0.27, 0.34], [0.18, 0.43], [0.06, 0.46], [0, 0.46]]
    .map(([r, h]) => [r * s, h * s]);
  b.lathe(prof, bodyMat, x, 0, z);
  b.sphere(0.17 * s, headMat, x, 0.66 * s, z);
};

const badge = (b, kind, x, y, z) => {
  const p = b.p;
  b.cyl(0.17, 0.17, 0.06, kind === 'check' ? p.green : p.accent, x, y, z, { rot: [Math.PI / 2, 0, 0] });
  if (kind === 'check') {
    b.bars([[-0.08, 0], [-0.02, -0.06], [0.09, 0.07]].map(([a, c]) => [x + a, y + c]), 0.035, 0.03, p.white, z + 0.04);
  } else {
    b.box(0.18, 0.04, 0.03, p.white, x, y, z + 0.04);
    b.box(0.04, 0.18, 0.03, p.white, x, y, z + 0.04);
  }
};

const arrowGlyph = (b, dir, mat, y0 = 0.35) => {
  // vertical arrow over a tray
  const up = dir === 'up';
  b.cyl(0.07, 0.07, 0.38, mat, 0, y0 + 0.28, 0, { seg: 20 });
  b.cone(0.17, 0.2, mat, 0, up ? y0 + 0.55 : y0 + 0.02, 0, { rot: up ? [0, 0, 0] : [Math.PI, 0, 0] });
};

const tray = (b) => {
  const p = b.p;
  b.rbox(0.9, 0.08, 0.5, 0.03, p.body, 0, 0.04, 0);
  b.rbox(0.08, 0.22, 0.5, 0.03, p.body, -0.41, 0.15, 0);
  b.rbox(0.08, 0.22, 0.5, 0.03, p.body, 0.41, 0.15, 0);
};

const circleSign = (b, mat = b.p.accent) => {
  b.cyl(0.42, 0.42, 0.1, mat, 0, 0.5, 0, { rot: [Math.PI / 2, 0, 0], seg: 48 });
  b.torus(0.42, 0.04, b.p.white, 0, 0.5, 0, { seg: 48 });
  b.box(0.12, 0.05, 0.12, b.p.dark, 0, 0.04, 0);
  b.cyl(0.03, 0.03, 0.06, b.p.dark, 0, 0.07, 0);
};

const wheel = (b, x, y, z, r = 0.1, w = 0.08) => {
  b.cyl(r, r, w, b.p.dark, x, y, z, { rot: [Math.PI / 2, 0, 0], seg: 20 });
  b.cyl(r * 0.45, r * 0.45, w + 0.01, b.p.metal, x, y, z, { rot: [Math.PI / 2, 0, 0], seg: 16 });
};

const gear = (b, teeth, rOuter, mat, x, y, z, o = {}) =>
  b.extrude(gearShape(teeth, rOuter, rOuter * 0.8, rOuter * 0.32), o.depth || 0.14, mat, x, y, z, { bevel: 0.01, ...o });

// ---------------------------------------------------------------------------
// Model builders, keyed by icon id
// ---------------------------------------------------------------------------

const BUILDERS = {
  // ---- Infrastructure ----
  server: (b, p) => {
    b.rbox(0.62, 1.0, 0.6, 0.04, p.body, 0, 0.5, 0);
    [0.22, 0.5, 0.78].forEach(y => {
      b.rbox(0.54, 0.22, 0.04, 0.02, p.dark, 0, y, 0.29);
      b.sphere(0.025, p.green, -0.2, y, 0.32);
      b.sphere(0.025, p.accent, -0.12, y, 0.32);
      [0.04, 0.1, 0.16].forEach(x => b.box(0.02, 0.12, 0.02, p.mid, x, y, 0.31));
    });
  },
  database: (b, p) => {
    [0, 1, 2].forEach(i => {
      const y = 0.17 + i * 0.32;
      b.cyl(0.4, 0.4, 0.26, p.body, 0, y, 0, { seg: 48 });
      b.torus(0.4, 0.02, p.accent, 0, y + 0.13, 0, { rot: [Math.PI / 2, 0, 0], seg: 48 });
    });
    b.cyl(0.3, 0.3, 0.01, p.accent, 0, 0.95, 0, { seg: 48 });
  },
  cloud: (b, p) => {
    [[0, 0.42, 0, 0.3], [-0.28, 0.3, 0.02, 0.22], [0.3, 0.3, 0, 0.24], [0.12, 0.55, -0.04, 0.22], [-0.12, 0.28, 0.12, 0.2], [0.1, 0.26, 0.14, 0.2]]
      .forEach(([x, y, z, r]) => b.sphere(r, p.body, x, y, z));
    b.cyl(0.45, 0.45, 0.04, p.accent, 0, 0.1, 0, { scale: [1.1, 1, 0.6] });
  },
  storage: (b, p) => {
    b.rbox(0.9, 0.3, 0.6, 0.06, p.body, 0, 0.15, 0);
    b.rbox(0.7, 0.04, 0.42, 0.02, p.dark, 0, 0.31, 0);
    b.cyl(0.17, 0.17, 0.02, p.metal, -0.12, 0.33, 0, { seg: 40 });
    b.box(0.3, 0.02, 0.04, p.metal, 0.12, 0.34, 0.06, { rot: [0, 0.6, 0] });
    b.sphere(0.03, p.green, 0.32, 0.15, 0.3);
    b.sphere(0.03, p.accent, 0.22, 0.15, 0.3);
  },
  compute: (b, p) => {
    b.rbox(0.72, 0.1, 0.72, 0.03, p.dark, 0, 0.12, 0);
    b.rbox(0.4, 0.06, 0.4, 0.02, p.accent, 0, 0.2, 0);
    b.box(0.26, 0.02, 0.26, p.metal, 0, 0.24, 0);
    [-0.24, -0.08, 0.08, 0.24].forEach(t => {
      b.box(0.05, 0.03, 0.18, p.metal, t, 0.08, 0.42);
      b.box(0.05, 0.03, 0.18, p.metal, t, 0.08, -0.42);
      b.box(0.18, 0.03, 0.05, p.metal, 0.42, 0.08, t);
      b.box(0.18, 0.03, 0.05, p.metal, -0.42, 0.08, t);
    });
    [[-0.08, 0.08], [0.08, -0.08]].forEach(([x, z]) => b.box(0.04, 0.01, 0.04, p.glow, x, 0.255, z));
  },
  network: (b, p) => {
    b.rbox(0.32, 0.24, 0.32, 0.04, p.accent, 0, 0.9, 0);
    b.rbox(0.32, 0.24, 0.32, 0.04, p.body, -0.36, 0.12, 0);
    b.rbox(0.32, 0.24, 0.32, 0.04, p.body, 0.36, 0.12, 0);
    b.tube([[0, 0.78, 0], [0, 0.52, 0], [-0.36, 0.52, 0], [-0.36, 0.24, 0]], 0.035, p.metal, { straight: true });
    b.tube([[0, 0.52, 0], [0.36, 0.52, 0], [0.36, 0.24, 0]], 0.035, p.metal, { straight: true });
  },
  container: (b, p) => {
    b.box(0.95, 0.42, 0.44, p.accent, 0, 0.21, 0);
    for (let i = -4; i <= 4; i++) {
      b.box(0.035, 0.38, 0.47, p.accentDark, i * 0.1, 0.21, 0);
    }
    b.box(0.97, 0.03, 0.46, p.body, 0, 0.43, 0);
    b.box(0.97, 0.03, 0.46, p.body, 0, 0.015, 0);
    [-0.06, 0.06].forEach(z => b.box(0.02, 0.36, 0.02, p.metal, 0.49, 0.21, z));
  },
  terminal: (b, p) => {
    b.rbox(0.92, 0.66, 0.1, 0.05, p.body, 0, 0.45, 0);
    b.rbox(0.82, 0.56, 0.02, 0.02, p.screen, 0, 0.45, 0.05);
    b.bars([[-0.3, 0.6], [-0.16, 0.48], [-0.3, 0.36]], 0.05, 0.03, p.glow, 0.07);
    b.box(0.2, 0.05, 0.03, p.glow, 0.02, 0.34, 0.07);
    b.box(0.24, 0.12, 0.2, p.body, 0, 0.06, 0);
  },
  git: (b, p) => {
    b.plinth();
    b.tube([[-0.2, 0.18, 0], [-0.2, 0.95, 0]], 0.045, p.body, { straight: true, caps: false });
    b.tube([[-0.2, 0.32, 0], [-0.15, 0.55, 0], [0.22, 0.58, 0], [0.22, 0.82, 0]], 0.045, p.body, { caps: false });
    b.sphere(0.1, p.accent, -0.2, 0.18, 0);
    b.sphere(0.1, p.accent, -0.2, 0.95, 0);
    b.sphere(0.1, p.glow, 0.22, 0.85, 0);
  },
  github: (b, p) => {
    // A friendly cat head with a code-branch tail
    b.sphere(0.36, p.body, 0, 0.42, 0, { scale: [1, 0.92, 0.9] });
    b.cone(0.13, 0.22, p.body, -0.22, 0.72, 0, { rot: [0, 0, 0.35] });
    b.cone(0.13, 0.22, p.body, 0.22, 0.72, 0, { rot: [0, 0, -0.35] });
    b.sphere(0.25, p.dark, 0, 0.4, 0.11, { scale: [1, 0.78, 0.6] });
    b.sphere(0.045, p.glow, -0.09, 0.44, 0.27);
    b.sphere(0.045, p.glow, 0.09, 0.44, 0.27);
    b.tube([[0.3, 0.12, -0.1], [0.5, 0.1, -0.05], [0.55, 0.3, 0], [0.42, 0.4, 0.04]], 0.04, p.accent);
  },

  // ---- Services & APIs ----
  api: (b, p) => {
    b.plinth();
    const bolt = polyShape([[0.08, 0.5], [-0.24, 0.0], [-0.02, 0.0], [-0.1, -0.5], [0.24, 0.06], [0.02, 0.06]]);
    b.extrude(bolt, 0.14, p.yellow, 0, 0.58, 0);
  },
  service: (b, p) => {
    b.rbox(0.66, 0.66, 0.66, 0.05, p.body, 0, 0.36, 0, { rot: [0, Math.PI / 4, 0] });
    b.box(0.67, 0.02, 0.67, p.accent, 0, 0.69, 0, { rot: [0, Math.PI / 4, 0] });
    b.box(0.02, 0.67, 0.68, p.accent, 0, 0.36, 0, { rot: [0, Math.PI / 4, 0] });
  },
  web: (b, p) => {
    b.sphere(0.4, p.accent, 0, 0.48, 0, { seg: 40 });
    b.torus(0.405, 0.018, p.white, 0, 0.48, 0, { rot: [Math.PI / 2, 0, 0], seg: 60 });
    [0, Math.PI / 3, -Math.PI / 3].forEach(a => b.torus(0.405, 0.018, p.white, 0, 0.48, 0, { rot: [0, a, 0], seg: 60 }));
    [0.2, -0.2].forEach(y => {
      const r = Math.sqrt(0.405 ** 2 - y ** 2);
      b.torus(r, 0.016, p.white, 0, 0.48 + y, 0, { rot: [Math.PI / 2, 0, 0], seg: 50 });
    });
    b.cyl(0.03, 0.03, 0.1, p.metal, 0, 0.04, 0);
  },
  code: (b, p) => {
    b.plinth();
    b.bars([[-0.18, 0.78], [-0.4, 0.55], [-0.18, 0.32]], 0.08, 0.1, p.body);
    b.bars([[0.18, 0.78], [0.4, 0.55], [0.18, 0.32]], 0.08, 0.1, p.body);
    b.bars([[0.07, 0.86], [-0.07, 0.24]], 0.07, 0.1, p.accent);
  },
  layers: (b, p) => {
    [p.accentDark, p.accent, p.body].forEach((mat, i) => {
      b.rbox(0.62, 0.07, 0.62, 0.03, mat, 0, 0.1 + i * 0.22, 0, { rot: [0, Math.PI / 4, 0] });
    });
  },
  package: (b, p) => {
    b.box(0.7, 0.55, 0.6, p.wood, 0, 0.28, 0);
    b.box(0.71, 0.56, 0.12, p.body, 0, 0.28, 0);
    b.box(0.12, 0.56, 0.61, p.body, 0, 0.28, 0);
    b.box(0.2, 0.01, 0.14, p.accent, 0.22, 0.56, 0.18);
  },
  link: (b, p) => {
    b.torus(0.22, 0.06, p.metal, -0.15, 0.5, 0, { rot: [0, 0, Math.PI / 4], scale: [1.4, 0.8, 1] });
    b.torus(0.22, 0.06, p.accent, 0.15, 0.5, 0, { rot: [Math.PI / 2, Math.PI / 4, 0], scale: [1.4, 0.8, 1] });
    b.plinth(0.3);
  },
  bot: (b, p) => {
    b.rbox(0.6, 0.48, 0.5, 0.1, p.body, 0, 0.42, 0);
    b.rbox(0.48, 0.24, 0.02, 0.06, p.screen, 0, 0.44, 0.25);
    b.sphere(0.05, p.glow, -0.1, 0.45, 0.27);
    b.sphere(0.05, p.glow, 0.1, 0.45, 0.27);
    b.cyl(0.015, 0.015, 0.18, p.metal, 0, 0.75, 0);
    b.sphere(0.05, p.accent, 0, 0.86, 0);
    b.cyl(0.07, 0.07, 0.08, p.accent, -0.33, 0.42, 0, { rot: [0, 0, Math.PI / 2] });
    b.cyl(0.07, 0.07, 0.08, p.accent, 0.33, 0.42, 0, { rot: [0, 0, Math.PI / 2] });
    b.cyl(0.14, 0.18, 0.18, p.mid, 0, 0.09, 0);
  },

  // ---- Security ----
  security: (b, p) => {
    b.rbox(0.62, 0.5, 0.3, 0.06, p.gold, 0, 0.25, 0);
    b.torus(0.2, 0.05, p.metal, 0, 0.5, 0, { arc: Math.PI });
    b.cyl(0.05, 0.05, 0.06, p.metal, -0.2, 0.5, 0, { seg: 12 });
    b.cyl(0.05, 0.05, 0.06, p.metal, 0.2, 0.5, 0, { seg: 12 });
    b.cyl(0.05, 0.05, 0.04, p.dark, 0, 0.29, 0.15, { rot: [Math.PI / 2, 0, 0] });
    b.box(0.03, 0.1, 0.03, p.dark, 0, 0.22, 0.15);
  },
  shield: (b, p) => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.5);
    s.quadraticCurveTo(0.2, 0.4, 0.38, 0.4);
    s.lineTo(0.38, 0.05);
    s.quadraticCurveTo(0.34, -0.3, 0, -0.5);
    s.quadraticCurveTo(-0.34, -0.3, -0.38, 0.05);
    s.lineTo(-0.38, 0.4);
    s.quadraticCurveTo(-0.2, 0.4, 0, 0.5);
    b.extrude(s, 0.12, p.body, 0, 0.56, 0);
    b.extrude(s, 0.04, p.accent, 0, 0.56, 0.08, { scale: [0.72, 0.72, 1] });
    b.plinth(0.3);
  },
  key: (b, p) => {
    b.torus(0.17, 0.06, p.gold, -0.24, 0.55, 0);
    b.cyl(0.05, 0.05, 0.6, p.gold, 0.18, 0.55, 0, { rot: [0, 0, Math.PI / 2] });
    b.box(0.06, 0.16, 0.06, p.gold, 0.36, 0.47, 0);
    b.box(0.06, 0.12, 0.06, p.gold, 0.24, 0.49, 0);
    b.plinth(0.32);
    b.cyl(0.02, 0.02, 0.3, p.metal, -0.24, 0.24, 0);
  },
  unlock: (b, p) => {
    b.rbox(0.62, 0.5, 0.3, 0.06, p.gold, 0, 0.25, 0);
    b.torus(0.2, 0.05, p.metal, 0, 0.68, 0, { arc: Math.PI, rot: [0, 0.6, 0] });
    b.cyl(0.05, 0.05, 0.2, p.metal, 0.2 * Math.cos(0.6), 0.58, -0.2 * Math.sin(0.6), { seg: 12 });
    b.cyl(0.05, 0.05, 0.08, p.metal, -0.2 * Math.cos(0.6), 0.64, 0.2 * Math.sin(0.6), { seg: 12 });
    b.cyl(0.05, 0.05, 0.04, p.dark, 0, 0.29, 0.15, { rot: [Math.PI / 2, 0, 0] });
    b.box(0.03, 0.1, 0.03, p.dark, 0, 0.22, 0.15);
  },

  // ---- Communication ----
  wifi: (b, p) => {
    b.plinth();
    [0.16, 0.32, 0.48].forEach((r, i) => b.torus(r, 0.045, i === 2 ? p.accent : p.body, 0, 0.18, 0, { arc: Math.PI / 2, rot: [0, 0, Math.PI / 4] }));
    b.sphere(0.07, p.glow, 0, 0.18, 0);
  },
  mail: (b, p) => {
    b.rbox(0.9, 0.6, 0.12, 0.03, p.body, 0, 0.36, 0);
    const flap = polyShape([[-0.43, 0.27], [0.43, 0.27], [0, -0.05]]);
    b.extrude(flap, 0.02, p.accent, 0, 0.36, 0.07, { bevel: 0.005 });
    b.bars([[-0.42, 0.1], [-0.1, 0.38]], 0.02, 0.01, p.mid, 0.07);
    b.bars([[0.42, 0.1], [0.1, 0.38]], 0.02, 0.01, p.mid, 0.07);
    b.box(0.12, 0.06, 0.12, p.dark, 0, 0.03, 0);
  },
  phone: (b, p) => {
    b.rbox(0.7, 0.24, 0.5, 0.08, p.body, 0, 0.12, 0);
    b.rbox(0.32, 0.02, 0.24, 0.01, p.dark, 0, 0.25, 0.08);
    for (let i = 0; i < 9; i++) b.cyl(0.025, 0.025, 0.02, p.mid, -0.08 + (i % 3) * 0.08, 0.27, 0.0 + Math.floor(i / 3) * 0.07);
    b.tube([[-0.36, 0.38, -0.12], [-0.2, 0.46, -0.12], [0.2, 0.46, -0.12], [0.36, 0.38, -0.12]], 0.05, p.accent);
    b.cyl(0.1, 0.08, 0.12, p.accent, -0.36, 0.33, -0.12, { rot: [0, 0, 0.4] });
    b.cyl(0.1, 0.08, 0.12, p.accent, 0.36, 0.33, -0.12, { rot: [0, 0, -0.4] });
  },
  message: (b, p) => {
    b.rbox(0.86, 0.56, 0.18, 0.12, p.body, 0, 0.6, 0);
    const tail = polyShape([[-0.25, 0.0], [-0.05, 0.0], [-0.3, -0.18]]);
    b.extrude(tail, 0.14, p.body, 0, 0.34, 0, { bevel: 0.01 });
    [-0.2, 0, 0.2].forEach(x => b.sphere(0.055, p.accent, x, 0.6, 0.1));
    b.plinth(0.25);
  },
  send: (b, p) => {
    const geo = new THREE.BufferGeometry();
    const N = [0, 0.45, -0.55], L = [-0.48, 0.42, 0.42], R = [0.48, 0.42, 0.42], C = [0, 0.4, 0.42], K = [0, 0.18, 0.38];
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...N, ...L, ...C, ...N, ...C, ...R, ...N, ...K, ...C], 3));
    geo.computeVertexNormals();
    const mat = p.white.clone();
    mat.side = THREE.DoubleSide;
    b.mesh(geo, mat, 0, 0.1, 0, { rot: [0.25, 0.5, 0] });
    b.tube([[0.1, 0.12, 0.6], [0.35, 0.2, 0.45], [0.2, 0.3, 0.2]], 0.015, p.accent, { caps: false });
  },
  bell: (b, p) => {
    b.lathe([[0, 0.92], [0.06, 0.92], [0.18, 0.84], [0.24, 0.6], [0.28, 0.36], [0.42, 0.2], [0.42, 0.16], [0, 0.16]], p.gold, 0, 0, 0, { seg: 40 });
    b.torus(0.06, 0.02, p.gold, 0, 0.97, 0);
    b.sphere(0.08, p.metal, 0, 0.1, 0);
  },

  // ---- Documents & Data ----
  document: (b, p) => {
    const s = polyShape([[-0.3, -0.42], [0.3, -0.42], [0.3, 0.26], [0.14, 0.42], [-0.3, 0.42]]);
    b.extrude(s, 0.05, p.white, 0, 0.5, 0, { bevel: 0.01 });
    b.extrude(polyShape([[0.14, 0.26], [0.3, 0.26], [0.14, 0.42]]), 0.02, p.mid, 0, 0.5, 0.035, { bevel: 0 });
    [0.18, 0.06, -0.06, -0.18].forEach((y, i) => b.box(i === 3 ? 0.3 : 0.44, 0.04, 0.02, i === 0 ? p.accent : p.mid, i === 3 ? -0.07 : 0, 0.5 + y, 0.035));
    b.box(0.3, 0.06, 0.16, p.dark, 0, 0.03, 0);
  },
  folder: (b, p) => {
    b.box(0.9, 0.06, 0.6, p.accentDark, 0, 0.03, 0);
    b.rbox(0.9, 0.5, 0.06, 0.02, p.accentDark, 0, 0.3, -0.27);
    b.rbox(0.34, 0.08, 0.06, 0.02, p.accentDark, -0.26, 0.58, -0.27);
    [0.1, 0.18].forEach((z, i) => b.box(0.78, 0.44, 0.015, i ? p.white : p.body, 0, 0.28, -0.22 + z * 0.3));
    b.rbox(0.9, 0.44, 0.05, 0.02, p.accent, 0, 0.24, 0.0, { rot: [-0.45, 0, 0] });
  },
  archive: (b, p) => {
    b.box(0.8, 0.5, 0.56, p.body, 0, 0.25, 0);
    b.rbox(0.88, 0.14, 0.62, 0.03, p.accent, 0, 0.55, 0);
    b.rbox(0.26, 0.06, 0.02, 0.02, p.dark, 0, 0.34, 0.285);
    b.box(0.3, 0.16, 0.01, p.white, 0, 0.18, 0.282);
  },
  upload: (b, p) => {
    tray(b);
    arrowGlyph(b, 'up', b.p.accent);
  },
  download: (b, p) => {
    tray(b);
    arrowGlyph(b, 'down', b.p.accent, 0.22);
  },

  // ---- Users ----
  users: (b, p) => {
    person(b, 0.24, -0.18, 0.95, p.accent, p.accent);
    person(b, -0.12, 0.12, 1.1, p.body, p.body);
  },
  user: (b, p) => {
    person(b, 0, 0, 1.25);
    b.box(0.12, 0.06, 0.02, p.accent, 0.14, 0.38, 0.33);
  },
  usercheck: (b, p) => {
    person(b, -0.1, 0, 1.15);
    badge(b, 'check', 0.3, 0.35, 0.3);
  },
  userplus: (b, p) => {
    person(b, -0.1, 0, 1.15);
    badge(b, 'plus', 0.3, 0.35, 0.3);
  },

  // ---- Business ----
  home: (b, p) => {
    b.box(0.66, 0.46, 0.56, p.body, 0, 0.23, 0);
    const roof = polyShape([[-0.42, 0], [0.42, 0], [0, 0.34]]);
    b.extrude(roof, 0.62, p.accent, 0, 0.46, 0, { bevel: 0.015 });
    b.box(0.1, 0.22, 0.1, p.accentDark, 0.2, 0.7, -0.1);
    b.box(0.14, 0.26, 0.02, p.wood, -0.12, 0.13, 0.285);
    b.box(0.14, 0.14, 0.02, p.glow, 0.16, 0.26, 0.285);
  },
  building: (b, p) => {
    b.box(0.5, 1.2, 0.5, p.body, 0, 0.6, 0);
    b.box(0.54, 0.05, 0.54, p.accent, 0, 1.2, 0);
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 3; col++) {
        const lit = (row * 3 + col) % 4 !== 1;
        b.box(0.1, 0.1, 0.02, lit ? p.glow : p.dark, -0.14 + col * 0.14, 0.25 + row * 0.16, 0.255);
        b.box(0.02, 0.1, 0.1, lit && col !== 1 ? p.glow : p.dark, 0.255, 0.25 + row * 0.16, -0.14 + col * 0.14);
      }
    }
    b.box(0.16, 0.16, 0.02, p.accentDark, 0, 0.08, 0.255);
  },
  factory: (b, p) => {
    b.box(0.9, 0.34, 0.56, p.body, 0, 0.17, 0);
    for (let i = 0; i < 3; i++) {
      const tooth = polyShape([[0, 0], [0.3, 0], [0.3, 0.2]]);
      b.extrude(tooth, 0.56, p.accent, -0.45 + i * 0.3, 0.34, 0, { bevel: 0 });
    }
    b.cyl(0.06, 0.07, 0.5, p.mid, -0.3, 0.6, -0.15);
    b.cyl(0.05, 0.06, 0.4, p.mid, -0.12, 0.55, -0.15);
    [-0.25, 0, 0.25].forEach(x => b.box(0.14, 0.1, 0.02, p.glow, x, 0.18, 0.285));
  },
  warehouse: (b, p) => {
    b.box(0.92, 0.32, 0.6, p.body, 0, 0.16, 0);
    b.cyl(0.3, 0.3, 0.92, p.accent, 0, 0.32, 0, { rot: [0, 0, Math.PI / 2], thetaStart: 0, thetaLength: Math.PI, scale: [0.6, 1, 1] });
    b.box(0.36, 0.26, 0.02, p.mid, 0, 0.13, 0.305);
    for (let i = 0; i < 5; i++) b.box(0.34, 0.01, 0.025, p.dark, 0, 0.03 + i * 0.05, 0.31);
  },
  cart: (b, p) => {
    const basket = polyShape([[-0.38, 0.4], [0.42, 0.4], [0.32, 0.0], [-0.3, 0.0]]);
    b.extrude(basket, 0.5, p.accent, 0, 0.2, 0, { bevel: 0.01 });
    b.extrude(polyShape([[-0.34, 0.38], [0.38, 0.38], [0.3, 0.03], [-0.28, 0.03]]), 0.44, p.dark, 0, 0.23, 0, { bevel: 0, scale: [1, 1, 1.01] });
    b.tube([[-0.5, 0.75, -0.2], [-0.42, 0.62, -0.2], [-0.42, 0.62, 0.2], [-0.5, 0.75, 0.2]], 0.025, p.metal, { straight: true });
    wheel(b, -0.22, 0.08, 0.22, 0.07, 0.05);
    wheel(b, 0.22, 0.08, 0.22, 0.07, 0.05);
    wheel(b, -0.22, 0.08, -0.22, 0.07, 0.05);
    wheel(b, 0.22, 0.08, -0.22, 0.07, 0.05);
    b.box(0.6, 0.03, 0.5, p.metal, 0, 0.17, 0);
  },
  credit: (b, p) => {
    b.rbox(0.9, 0.56, 0.05, 0.05, p.accent, 0, 0.42, 0, { rot: [-0.15, 0, 0] });
    b.box(0.9, 0.1, 0.01, p.dark, 0, 0.52, -0.035, { rot: [-0.15, 0, 0] });
    b.rbox(0.14, 0.1, 0.02, 0.02, p.gold, -0.24, 0.42, 0.03, { rot: [-0.15, 0, 0] });
    b.box(0.32, 0.03, 0.01, p.white, 0.12, 0.3, 0.045, { rot: [-0.15, 0, 0] });
    b.box(0.3, 0.06, 0.2, p.dark, 0, 0.03, 0);
  },
  dollar: (b, p) => {
    b.cyl(0.44, 0.44, 0.1, p.gold, 0, 0.48, 0, { rot: [Math.PI / 2, 0, 0], seg: 48 });
    b.torus(0.4, 0.025, p.gold, 0, 0.48, 0.05, { seg: 48 });
    const s = [[0.15, 0.18, 0.07], [0, 0.24, 0.07], [-0.15, 0.16, 0.07], [-0.1, 0.03, 0.07], [0.1, -0.03, 0.07], [0.15, -0.16, 0.07], [0, -0.24, 0.07], [-0.15, -0.18, 0.07]]
      .map(([x, y, z]) => [x, y + 0.48, z]);
    b.tube(s, 0.035, p.white);
    b.box(0.05, 0.62, 0.04, p.white, 0, 0.48, 0.07);
    b.box(0.2, 0.06, 0.2, p.dark, 0, 0.03, 0);
  },

  // ---- Analytics ----
  activity: (b, p) => {
    b.rbox(0.96, 0.62, 0.08, 0.05, p.dark, 0, 0.42, 0);
    b.tube([[-0.42, 0.42, 0.06], [-0.18, 0.42, 0.06], [-0.08, 0.66, 0.06], [0.06, 0.2, 0.06], [0.16, 0.42, 0.06], [0.42, 0.42, 0.06]], 0.03, p.green, { straight: true });
    b.box(0.3, 0.1, 0.2, p.mid, 0, 0.05, 0);
  },
  piechart: (b, p) => {
    const sector = (a0, a1) => {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.absarc(0, 0, 0.42, a0, a1, false);
      s.lineTo(0, 0);
      return s;
    };
    const cut = TAU * 0.72;
    b.extrude(sector(0, cut), 0.2, p.body, 0, 0.12, 0, { rot: [-Math.PI / 2, 0, 0], curveSegments: 48 });
    // The slice lifts and slides out along its bisector
    const mid = (cut + TAU) / 2;
    b.extrude(sector(cut, TAU), 0.2, p.accent, Math.cos(mid) * 0.08, 0.2, -Math.sin(mid) * 0.08, { rot: [-Math.PI / 2, 0, 0], curveSegments: 24 });
  },
  barchart: (b, p) => {
    b.box(0.92, 0.05, 0.4, p.dark, 0, 0.025, 0);
    [[0.35, p.body], [0.6, p.accent], [0.45, p.body], [0.85, p.accent]].forEach(([h, mat], i) => {
      b.box(0.16, h, 0.2, mat, -0.33 + i * 0.22, 0.05 + h / 2, 0);
    });
  },
  linechart: (b, p) => {
    b.box(0.92, 0.04, 0.5, p.dark, 0, 0.02, 0);
    b.box(0.04, 0.8, 0.04, p.mid, -0.44, 0.42, -0.23);
    const pts = [[-0.4, 0.15, 0], [-0.15, 0.4, 0], [0.05, 0.3, 0], [0.4, 0.75, 0]];
    b.tube(pts, 0.035, p.accent, { straight: true });
    pts.forEach(pt => b.sphere(0.06, p.glow, ...pt));
    pts.forEach(([x, y]) => b.cyl(0.008, 0.008, y, p.mid, x, y / 2, 0));
  },
  trending: (b, p) => {
    b.plinth(0.46);
    b.tube([[-0.42, 0.15, 0], [-0.12, 0.45, 0], [0.04, 0.32, 0], [0.32, 0.66, 0]], 0.05, p.accent, { straight: true });
    b.cone(0.12, 0.22, p.accent, 0.37, 0.73, 0, { rot: [0, 0, -Math.atan2(0.28, 0.34)] });
  },

  // ---- Tools & Settings ----
  settings: (b, p) => {
    gear(b, 8, 0.44, p.body, 0, 0.5, 0, { depth: 0.16 });
    b.cyl(0.12, 0.12, 0.2, p.accent, 0, 0.5, 0, { rot: [Math.PI / 2, 0, 0] });
    b.box(0.16, 0.06, 0.16, p.dark, 0, 0.03, 0);
  },
  cog: (b, p) => {
    gear(b, 10, 0.34, p.body, -0.14, 0.12, 0.05, { rot: [Math.PI / 2, 0, 0], depth: 0.12 });
    gear(b, 7, 0.24, p.accent, 0.26, 0.34, -0.18, { rot: [0, 0, 0.2], depth: 0.1 });
    b.cyl(0.03, 0.03, 0.34, p.metal, 0.26, 0.17, -0.18);
  },
  wrench: (b, p) => {
    const s = new THREE.Shape();
    s.moveTo(-0.06, -0.45);
    s.lineTo(0.06, -0.45);
    s.lineTo(0.06, 0.2);
    s.absarc(0, 0.32, 0.15, -Math.PI / 2 + 0.4, Math.PI / 2 - 0.6, false);
    s.lineTo(0.05, 0.38);
    s.lineTo(0.05, 0.3);
    s.lineTo(-0.05, 0.3);
    s.lineTo(-0.05, 0.38);
    s.absarc(0, 0.32, 0.15, Math.PI / 2 + 0.6, 3 * Math.PI / 2 - 0.4, false);
    s.lineTo(-0.06, -0.45);
    s.holes.push(circlePath(0.035, 0, -0.38));
    b.extrude(s, 0.08, p.metal, 0, 0.55, 0, { rot: [0, 0, -0.5] });
    b.plinth(0.3);
  },
  hammer: (b, p) => {
    b.cyl(0.045, 0.05, 0.8, p.wood, 0, 0.45, 0, { rot: [0, 0, 0.35] });
    b.rbox(0.42, 0.14, 0.14, 0.02, p.metal, -0.14, 0.82, 0, { rot: [0, 0, 0.35] });
    b.cyl(0.06, 0.07, 0.1, p.metal, -0.36, 0.73, 0, { rot: [0, 0, 0.35 + Math.PI / 2] });
    b.plinth(0.3);
  },
  search: (b, p) => {
    b.torus(0.24, 0.06, p.body, -0.08, 0.62, 0, { seg: 48 });
    b.cyl(0.24, 0.24, 0.03, p.glass, -0.08, 0.62, 0, { rot: [Math.PI / 2, 0, 0] });
    b.cyl(0.055, 0.065, 0.36, p.accent, 0.2, 0.28, 0, { rot: [0, 0, Math.PI / 4] });
    b.plinth(0.3);
  },
  filter: (b, p) => {
    b.lathe([[0, 0.12], [0.07, 0.12], [0.07, 0.38], [0.42, 0.82], [0.44, 0.88], [0, 0.88]], p.accent, 0, 0, 0, { seg: 40 });
    b.cyl(0.4, 0.4, 0.02, p.glass, 0, 0.86, 0, { seg: 40 });
    b.sphere(0.035, p.sky, 0, 0.06, 0);
  },

  // ---- Devices ----
  smartphone: (b, p) => {
    b.rbox(0.42, 0.86, 0.06, 0.06, p.dark, 0, 0.5, 0);
    b.rbox(0.36, 0.72, 0.01, 0.02, p.screen, 0, 0.51, 0.03);
    b.rbox(0.1, 0.02, 0.01, 0.01, p.mid, 0, 0.86, 0.035);
    b.box(0.24, 0.08, 0.2, p.mid, 0, 0.04, 0.02);
  },
  tablet: (b, p) => {
    b.rbox(0.86, 0.62, 0.05, 0.05, p.dark, 0, 0.42, 0, { rot: [-0.2, 0, 0] });
    b.rbox(0.76, 0.52, 0.01, 0.02, p.screen, 0, 0.42, 0.03, { rot: [-0.2, 0, 0] });
    b.box(0.5, 0.06, 0.3, p.mid, 0, 0.03, 0.02);
  },
  monitor: (b, p) => {
    b.rbox(0.96, 0.62, 0.06, 0.03, p.dark, 0, 0.62, 0);
    b.rbox(0.88, 0.52, 0.01, 0.01, p.screen, 0, 0.63, 0.035);
    b.box(0.08, 0.3, 0.06, p.mid, 0, 0.2, -0.03);
    b.rbox(0.4, 0.04, 0.26, 0.02, p.mid, 0, 0.02, 0);
  },
  printer: (b, p) => {
    b.rbox(0.86, 0.36, 0.56, 0.05, p.body, 0, 0.26, 0);
    b.box(0.6, 0.26, 0.02, p.white, 0, 0.56, -0.12, { rot: [-0.25, 0, 0] });
    b.box(0.66, 0.03, 0.3, p.mid, 0, 0.16, 0.38);
    b.box(0.54, 0.01, 0.26, p.white, 0, 0.18, 0.38);
    b.box(0.08, 0.04, 0.02, p.green, 0.32, 0.36, 0.285);
    b.box(0.86, 0.06, 0.56, p.accent, 0, 0.05, 0);
  },
  camera: (b, p) => {
    b.rbox(0.86, 0.5, 0.34, 0.06, p.dark, 0, 0.3, 0);
    b.rbox(0.26, 0.1, 0.2, 0.03, p.dark, -0.18, 0.58, 0);
    b.cyl(0.2, 0.2, 0.18, p.metal, 0.05, 0.3, 0.22, { rot: [Math.PI / 2, 0, 0] });
    b.cyl(0.14, 0.14, 0.02, p.screen, 0.05, 0.3, 0.32, { rot: [Math.PI / 2, 0, 0] });
    b.box(0.1, 0.06, 0.02, p.white, 0.3, 0.46, 0.17);
    b.cyl(0.04, 0.04, 0.04, p.accent, 0.3, 0.58, 0);
  },

  // ---- Time ----
  clock: (b, p) => {
    b.cyl(0.42, 0.42, 0.1, p.white, 0, 0.5, 0, { rot: [Math.PI / 2, 0, 0], seg: 48 });
    b.torus(0.42, 0.05, p.accent, 0, 0.5, 0, { seg: 48 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      b.box(0.02, i % 3 === 0 ? 0.08 : 0.04, 0.01, p.dark, Math.sin(a) * 0.32, 0.5 + Math.cos(a) * 0.32, 0.055, { rot: [0, 0, -a] });
    }
    b.box(0.03, 0.2, 0.015, p.dark, 0, 0.59, 0.065);
    b.box(0.03, 0.26, 0.015, p.dark, 0.1, 0.45, 0.07, { rot: [0, 0, 2.2] });
    b.sphere(0.03, p.accent, 0, 0.5, 0.07);
    b.box(0.16, 0.06, 0.12, p.dark, 0, 0.03, 0);
  },
  calendar: (b, p) => {
    b.rbox(0.8, 0.74, 0.12, 0.05, p.white, 0, 0.42, 0);
    b.rbox(0.8, 0.18, 0.13, 0.05, p.accent, 0, 0.72, 0);
    [-0.2, 0.2].forEach(x => b.cyl(0.03, 0.03, 0.16, p.metal, x, 0.82, 0));
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        b.box(0.12, 0.1, 0.01, r === 1 && c === 2 ? p.accent : p.body, -0.24 + c * 0.16, 0.5 - r * 0.15, 0.065);
      }
    }
  },

  // ---- Status ----
  check: (b, p) => {
    circleSign(b, p.green);
    b.bars([[-0.18, 0.5], [-0.04, 0.36], [0.2, 0.64]], 0.08, 0.06, p.white, 0.07);
  },
  error: (b, p) => {
    circleSign(b, p.red);
    b.bars([[-0.16, 0.34], [0.16, 0.66]], 0.08, 0.06, p.white, 0.07);
    b.bars([[-0.16, 0.66], [0.16, 0.34]], 0.08, 0.06, p.white, 0.07);
  },
  warning: (b, p) => {
    circleSign(b, p.amber);
    b.rbox(0.08, 0.28, 0.06, 0.03, p.white, 0, 0.58, 0.07);
    b.sphere(0.05, p.white, 0, 0.36, 0.07);
  },
  star: (b, p) => {
    b.extrude(starShape(5, 0.46, 0.2), 0.14, p.gold, 0, 0.52, 0, { bevel: 0.03 });
    b.plinth(0.22);
  },
  flag: (b, p) => {
    b.cyl(0.025, 0.025, 1.0, p.metal, -0.36, 0.5, 0);
    b.sphere(0.04, p.gold, -0.36, 1.02, 0);
    const geo = new THREE.PlaneGeometry(0.62, 0.4, 16, 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + 0.31;
      pos.setZ(i, Math.sin(x * 9) * 0.05 * x * 2);
    }
    geo.computeVertexNormals();
    const mat = p.accent.clone();
    mat.side = THREE.DoubleSide;
    b.mesh(geo, mat, -0.05, 0.78, 0);
    b.plinth(0.2);
  },
  lightbulb: (b, p) => {
    b.lathe([[0, 1.0], [0.14, 0.98], [0.28, 0.86], [0.31, 0.7], [0.24, 0.52], [0.14, 0.4], [0.13, 0.32], [0, 0.32]], p.yellow, 0, 0, 0, { seg: 40 });
    for (let i = 0; i < 3; i++) b.cyl(0.14, 0.14, 0.05, p.metal, 0, 0.29 - i * 0.06, 0);
    b.cyl(0.06, 0.1, 0.06, p.dark, 0, 0.1, 0);
  },

  // ---- Media ----
  play: (b, p) => {
    circleSign(b, p.accent);
    b.extrude(polyShape([[-0.1, -0.16], [0.18, 0], [-0.1, 0.16]]), 0.06, p.white, 0.02, 0.5, 0.07);
  },
  pause: (b, p) => {
    circleSign(b, p.accent);
    b.rbox(0.09, 0.32, 0.06, 0.03, p.white, -0.09, 0.5, 0.07);
    b.rbox(0.09, 0.32, 0.06, 0.03, p.white, 0.09, 0.5, 0.07);
  },
  mic: (b, p) => {
    b.cyl(0.17, 0.17, 0.32, p.dark, 0, 0.72, 0);
    b.sphere(0.17, p.dark, 0, 0.88, 0);
    b.sphere(0.17, p.dark, 0, 0.56, 0);
    for (let i = 0; i < 4; i++) b.torus(0.172, 0.008, p.metal, 0, 0.62 + i * 0.09, 0, { rot: [Math.PI / 2, 0, 0] });
    b.torus(0.24, 0.025, p.accent, 0, 0.62, 0, { arc: Math.PI, rot: [0, 0, Math.PI] });
    b.cyl(0.025, 0.025, 0.4, p.metal, 0, 0.2, 0);
    b.cyl(0.25, 0.27, 0.05, p.accent, 0, 0.025, 0);
  },
  video: (b, p) => {
    b.rbox(0.56, 0.4, 0.4, 0.06, p.dark, -0.12, 0.3, 0);
    b.cyl(0.2, 0.12, 0.24, p.accent, 0.28, 0.3, 0, { rot: [0, 0, -Math.PI / 2], seg: 4 });
    b.cyl(0.1, 0.1, 0.06, p.metal, -0.24, 0.56, 0, { rot: [Math.PI / 2, 0, 0] });
    b.cyl(0.1, 0.1, 0.06, p.metal, 0.02, 0.56, 0, { rot: [Math.PI / 2, 0, 0] });
    b.sphere(0.03, p.red, -0.3, 0.42, 0.2);
  },

  // ---- Location ----
  mappin: (b, p) => {
    b.lathe([[0, 0.08], [0.06, 0.2], [0.18, 0.46], [0.28, 0.66], [0.29, 0.78], [0.24, 0.92], [0.13, 0.99], [0, 1.01]], p.red, 0, 0, 0, { seg: 40 });
    b.sphere(0.1, p.white, 0, 0.76, 0.2);
    b.cyl(0.16, 0.2, 0.02, p.dark, 0, 0.01, 0);
  },
  map: (b, p) => {
    [[-0.3, 0.4, p.body], [0, -0.4, p.accent], [0.3, 0.4, p.body]].forEach(([x, a, mat]) => {
      b.box(0.31, 0.7, 0.02, mat, x, 0.38, 0, { rot: [0, a, 0] });
    });
    b.tube([[-0.36, 0.2, 0.08], [-0.15, 0.4, 0.06], [0.05, 0.36, 0.06], [0.3, 0.55, 0.08]], 0.012, p.red, { caps: false });
    b.sphere(0.045, p.red, 0.3, 0.57, 0.1);
  },
  compass: (b, p) => {
    b.cyl(0.44, 0.44, 0.1, p.body, 0, 0.05, 0, { seg: 48 });
    b.torus(0.44, 0.04, p.gold, 0, 0.1, 0, { rot: [Math.PI / 2, 0, 0], seg: 48 });
    b.cyl(0.4, 0.4, 0.02, p.dark, 0, 0.11, 0, { seg: 48 });
    b.cone(0.07, 0.34, p.red, 0, 0.16, -0.17, { rot: [-Math.PI / 2, 0, 0], seg: 4 });
    b.cone(0.07, 0.34, p.white, 0, 0.16, 0.17, { rot: [Math.PI / 2, 0, 0], seg: 4 });
    b.sphere(0.04, p.gold, 0, 0.17, 0);
    b.cyl(0.4, 0.4, 0.01, p.glass, 0, 0.22, 0, { seg: 48 });
  },

  // ---- Transport ----
  truck: (b, p) => {
    b.rbox(0.6, 0.42, 0.42, 0.03, p.body, -0.16, 0.36, 0);
    b.rbox(0.3, 0.3, 0.4, 0.05, p.accent, 0.3, 0.3, 0);
    b.box(0.12, 0.12, 0.36, p.screen, 0.38, 0.38, 0);
    b.box(0.92, 0.06, 0.38, p.dark, 0.02, 0.14, 0);
    [-0.3, -0.05, 0.32].forEach(x => {
      wheel(b, x, 0.1, 0.2);
      wheel(b, x, 0.1, -0.2);
    });
  },
  plane: (b, p) => {
    b.cyl(0.08, 0.08, 0.9, p.body, 0, 0.4, 0, { rot: [Math.PI / 2, 0, 0] });
    b.sphere(0.08, p.body, 0, 0.4, -0.45, { scale: [1, 1, 1.8] });
    b.cone(0.08, 0.2, p.body, 0, 0.42, 0.55, { rot: [Math.PI / 2, 0, 0] });
    b.extrude(polyShape([[-0.5, 0.05], [0.5, 0.05], [0.08, -0.15], [-0.08, -0.15]]), 0.025, p.accent, 0, 0.38, -0.02, { rot: [Math.PI / 2, 0, 0] });
    b.extrude(polyShape([[-0.2, 0.0], [0.2, 0.0], [0.04, -0.1], [-0.04, -0.1]]), 0.02, p.accent, 0, 0.42, 0.42, { rot: [Math.PI / 2, 0, 0] });
    b.extrude(polyShape([[0, 0], [0.14, 0], [0.03, 0.2], [0, 0.2]]), 0.02, p.accent, 0, 0.46, 0.42, { rot: [0, Math.PI / 2, 0] });
    [-0.22, 0.22].forEach(x => b.cyl(0.035, 0.035, 0.12, p.metal, x, 0.35, -0.08, { rot: [Math.PI / 2, 0, 0] }));
    b.cyl(0.015, 0.015, 0.3, p.metal, 0, 0.15, 0);
    b.cyl(0.14, 0.16, 0.03, p.dark, 0, 0.015, 0);
  },
  ship: (b, p) => {
    b.extrude(polyShape([[-0.5, 0.2], [0.5, 0.2], [0.36, 0], [-0.4, 0]]), 0.36, p.accent, 0, 0.0, 0, { bevel: 0.02 });
    b.box(0.92, 0.03, 0.34, p.body, 0, 0.21, 0);
    b.box(0.34, 0.2, 0.26, p.white, -0.1, 0.32, 0);
    [-0.2, -0.1, 0].forEach(x => b.box(0.05, 0.05, 0.01, p.dark, x, 0.35, 0.13));
    b.cyl(0.06, 0.07, 0.24, p.red, 0.18, 0.4, 0);
    b.box(0.2, 0.08, 0.2, p.white, -0.12, 0.46, 0);
  },

  // ---- Shapes ----
  hexagon: (b, p) => {
    b.cyl(0.42, 0.42, 0.5, p.accent, 0, 0.25, 0, { seg: 6, rot: [0, Math.PI / 6, 0] });
    b.cyl(0.36, 0.36, 0.02, p.body, 0, 0.51, 0, { seg: 6, rot: [0, Math.PI / 6, 0] });
  },
  circle: (b, p) => {
    b.sphere(0.42, p.accent, 0, 0.42, 0, { seg: 40 });
    b.torus(0.43, 0.025, p.body, 0, 0.42, 0, { rot: [Math.PI / 2, 0, 0], seg: 60 });
  },
  square: (b, p) => {
    b.rbox(0.66, 0.66, 0.66, 0.04, p.accent, 0, 0.33, 0);
  },
  triangle: (b, p) => {
    b.cone(0.5, 0.8, p.accent, 0, 0.4, 0, { seg: 3 });
  },

  // ---- Nature ----
  flame: (b, p) => {
    b.lathe([[0, 0.0], [0.28, 0.08], [0.36, 0.3], [0.3, 0.55], [0.15, 0.8], [0, 1.0]], p.orange, 0, 0, 0, { seg: 32 });
    b.lathe([[0, 0.02], [0.18, 0.08], [0.22, 0.25], [0.16, 0.45], [0, 0.66]], p.yellow, 0, 0, 0.12, { seg: 24 });
  },
  droplet: (b, p) => {
    b.lathe([[0, 0.02], [0.2, 0.06], [0.32, 0.2], [0.33, 0.36], [0.26, 0.52], [0.14, 0.72], [0, 0.98]], p.sky, 0, 0, 0, { seg: 40 });
    b.sphere(0.05, p.white, -0.12, 0.38, 0.24);
  },
  sun: (b, p) => {
    b.sphere(0.26, p.yellow, 0, 0.5, 0);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      b.cone(0.06, 0.16, p.amber, Math.cos(a) * 0.38, 0.5 + Math.sin(a) * 0.38, 0, { rot: [0, 0, a - Math.PI / 2] });
    }
    b.plinth(0.18);
  },
  moon: (b, p) => {
    const s = new THREE.Shape();
    s.absarc(0, 0, 0.42, Math.PI * 0.32, Math.PI * 1.68, false);
    s.absarc(0.2, 0, 0.36, Math.PI * 1.55, Math.PI * 0.45, true);
    b.extrude(s, 0.18, p.body, 0, 0.5, 0, { bevel: 0.04 });
    b.sphere(0.04, p.mid, -0.25, 0.6, 0.12);
    b.sphere(0.03, p.mid, -0.2, 0.36, 0.12);
    b.plinth(0.2);
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const BUILTIN_MODEL_IDS = Object.keys(BUILDERS);
export { MODEL_IDS, hasBuiltinModel, NO_MODEL } from './modelIds.js';

// Uniformly scale + recenter `obj` so it fits a box of `width` (x and z)
// by `height`, centered on the origin and standing on y = 0
export const fitObject = (obj, width = 1.1, height = 1.15) => {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return obj;
  const size = box.getSize(new THREE.Vector3());
  const s = Math.min(width / Math.max(size.x, size.z, 1e-6), height / Math.max(size.y, 1e-6));
  const center = box.getCenter(new THREE.Vector3());
  const wrap = new THREE.Group();
  obj.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  wrap.add(obj);
  wrap.scale.setScalar(s);
  return wrap;
};

// Built-in model for `id` (falls back to the server model), normalized
export const buildModel = (id, color) => {
  const b = new ModelBuilder(createPalette(color));
  (BUILDERS[id] || BUILDERS.server)(b, b.p);
  b.group.name = `model:${id}`;
  return fitObject(b.group);
};
