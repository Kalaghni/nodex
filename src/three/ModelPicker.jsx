import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildModel, fitObject, MODEL_IDS } from './models.js';
import { resolveModelSpec } from './modelSpec.js';
import { loadGltf, instantiateGltf, disposeObject } from './gltf.js';

const DEG = Math.PI / 180;

const hexPedestal = (color) => {
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    if (i === 0) s.moveTo(0.87 * Math.cos(a), 0.87 * Math.sin(a));
    else s.lineTo(0.87 * Math.cos(a), 0.87 * Math.sin(a));
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.12 }));
};

const studio = (renderer) => {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight('#dbeafe', '#0f172a', 1.0));
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(-3, 6, 5);
  scene.add(key);
  return { scene, env };
};

// ---------------------------------------------------------------------------
// Thumbnails for the model grid — one shared offscreen renderer, a few
// models per frame so opening the editor never stalls
// ---------------------------------------------------------------------------

const thumbCache = new Map();
let thumbRig = null;

const getThumbRig = () => {
  if (thumbRig) return thumbRig;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(96, 96);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const { scene } = studio(renderer);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 2.1, 3.3);
  camera.lookAt(0, 0.5, 0);
  thumbRig = { renderer, scene, camera };
  return thumbRig;
};

const renderThumb = (id, color) => {
  const key = `${id}|${color}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const { renderer, scene, camera } = getThumbRig();
  const model = buildModel(id, color);
  model.rotation.y = -18 * DEG;
  scene.add(model);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(model);
  disposeObject(model);
  thumbCache.set(key, url);
  return url;
};

export const useModelThumbnails = (color, enabled = true) => {
  const [thumbs, setThumbs] = useState(() => {
    const m = {};
    MODEL_IDS.forEach(id => {
      const c = thumbCache.get(`${id}|${color}`);
      if (c) m[id] = c;
    });
    return m;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let frame;
    const todo = MODEL_IDS.slice();
    const acc = {};
    const step = () => {
      if (cancelled) return;
      const t0 = performance.now();
      while (todo.length && performance.now() - t0 < 12) {
        const id = todo.shift();
        try {
          acc[id] = renderThumb(id, color);
        } catch {
          // WebGL unavailable — the grid falls back to the 2D icons
          todo.length = 0;
        }
      }
      setThumbs(prev => ({ ...prev, ...acc }));
      if (todo.length) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [color, enabled]);
  return thumbs;
};

// ---------------------------------------------------------------------------
// Live, slowly turning preview of the model a node will show in 3D
// ---------------------------------------------------------------------------

export function ModelPreview({ node, height = 180 }) {
  const ref = useRef(null);
  const rigRef = useRef(null);
  const [status, setStatus] = useState({ loading: false, error: null });

  useEffect(() => {
    const el = ref.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setStatus({ loading: false, error: 'WebGL isn’t available — no preview' });
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.style.display = 'block';
    el.appendChild(renderer.domElement);
    const { scene, env } = studio(renderer);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 1.9, 3.4);
    camera.lookAt(0, 0.55, 0);
    const turntable = new THREE.Group();
    scene.add(turntable);
    const resize = () => {
      const w = el.clientWidth || 1;
      renderer.setSize(w, height);
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    let frame;
    const timer = new THREE.Timer();
    const loop = () => {
      frame = requestAnimationFrame(loop);
      timer.update();
      turntable.rotation.y += timer.getDelta() * 0.6;
      renderer.render(scene, camera);
    };
    loop();
    rigRef.current = { turntable };
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      turntable.children.forEach(disposeObject);
      env.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      rigRef.current = null;
    };
  }, [height]);

  const spec = resolveModelSpec(node);
  const specKey = JSON.stringify([spec, node.color]);
  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return undefined;
    let cancelled = false;
    const { turntable } = rig;
    const show = (model) => {
      turntable.children.slice().forEach(c => { turntable.remove(c); disposeObject(c); });
      turntable.add(hexPedestal(node.color || '#3b82f6'));
      if (model) {
        const holder = new THREE.Group();
        holder.position.y = 0.23;
        holder.rotation.y = -spec.rotation * DEG;
        holder.scale.setScalar(0.92 * spec.scale);
        holder.add(model);
        turntable.add(holder);
      }
    };
    if (spec.kind === 'none') {
      show(null);
      setStatus({ loading: false, error: null });
    } else if (spec.kind === 'builtin') {
      show(buildModel(spec.id, node.color));
      setStatus({ loading: false, error: null });
    } else {
      show(buildModel(spec.fallbackId, node.color));
      setStatus({ loading: true, error: null });
      loadGltf(spec.url).then(t => {
        if (cancelled) return;
        show(fitObject(instantiateGltf(t)));
        setStatus({ loading: false, error: null });
      }).catch(err => {
        if (!cancelled) setStatus({ loading: false, error: err.message });
      });
    }
    return () => { cancelled = true; };
  }, [specKey]);

  return (
    <div className="relative rounded bg-slate-900 overflow-hidden" style={{ height }}>
      <div ref={ref} className="absolute inset-0" />
      {status.loading && (
        <div className="absolute bottom-1 left-2 text-[11px] text-slate-400">Loading model…</div>
      )}
      {status.error && (
        <div className="absolute bottom-1 left-2 right-2 text-[11px] text-red-400 truncate" title={status.error}>
          {status.error} — showing the icon’s model
        </div>
      )}
    </div>
  );
}

// Grid of every built-in model, rendered as thumbnails in the node's color.
// `items` are { id, label, icon } (the 2D palette), so labels stay in one place.
export function ModelGrid({ items, color, value, onPick }) {
  const thumbs = useModelThumbnails(color);
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {items.map(ic => {
        const Icon = ic.icon;
        const thumb = thumbs[ic.id];
        const active = value === ic.id;
        return (
          <button
            key={ic.id}
            onClick={() => onPick(ic.id)}
            className={`aspect-square rounded flex items-center justify-center transition-all ${
              active ? 'bg-blue-600/40 ring-2 ring-blue-400' : 'bg-slate-800 hover:bg-slate-700'
            }`}
            title={ic.label}
          >
            {thumb
              ? <img src={thumb} alt={ic.label} className="w-full h-full object-contain" draggable={false} />
              : <Icon size={18} className="text-slate-500" />}
          </button>
        );
      })}
    </div>
  );
}

export default ModelPreview;
