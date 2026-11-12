// Which 3D model a node shows.
//
// By default a node's model follows its icon (every icon has a built-in
// model of the same id). A node can override that with `node.model3d`:
//
//   { builtin: '<model id>' | 'none' }   another built-in model, or none
//   { url, name? }                        a glTF / GLB file — http(s) URL,
//                                         relative path, or embedded data: URL
//   scale?: number, rotation?: degrees    applied to whichever model shows
//
// All fields are optional and the whole object is omitted when nothing is
// overridden, so diagrams without 3D settings save exactly as before.

import { hasBuiltinModel, NO_MODEL } from './modelIds.js';

export const MODEL_SCALE_MIN = 0.25;
export const MODEL_SCALE_MAX = 4;

const clampScale = (s) => Math.min(MODEL_SCALE_MAX, Math.max(MODEL_SCALE_MIN, s));
const normRotation = (deg) => ((Math.round(deg) % 360) + 360) % 360;

// http(s), relative paths and embedded data: URLs — never javascript: etc.
export const isAllowedModelUrl = (url) => {
  if (typeof url !== 'string' || !url.trim()) return false;
  const u = url.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(u);
  if (!scheme) return true;
  return ['http', 'https', 'data', 'blob'].includes(scheme[1].toLowerCase());
};

export const resolveModelSpec = (node) => {
  const o = node?.model3d || {};
  const scale = Number.isFinite(o.scale) ? clampScale(o.scale) : 1;
  const rotation = Number.isFinite(o.rotation) ? normRotation(o.rotation) : 0;
  const iconModel = hasBuiltinModel(node?.iconId) ? node.iconId : 'server';
  if (o.url && isAllowedModelUrl(o.url)) {
    return { kind: 'gltf', url: o.url, name: o.name, fallbackId: iconModel, scale, rotation };
  }
  if (o.builtin === NO_MODEL) return { kind: 'none', scale, rotation };
  const id = o.builtin && hasBuiltinModel(o.builtin) ? o.builtin : iconModel;
  return { kind: 'builtin', id, scale, rotation };
};

// Normalize an override for saving; undefined when it changes nothing
export const cleanModelOverride = (o) => {
  if (!o) return undefined;
  const out = {};
  const url = typeof o.url === 'string' ? o.url.trim() : '';
  if (url && isAllowedModelUrl(url)) {
    out.url = url;
    if (o.name) out.name = String(o.name);
  } else if (o.builtin && (o.builtin === NO_MODEL || hasBuiltinModel(o.builtin))) {
    out.builtin = o.builtin;
  }
  const scale = Number(o.scale);
  if (Number.isFinite(scale) && Math.abs(scale - 1) > 1e-3) out.scale = clampScale(Math.round(scale * 100) / 100);
  const rot = Number(o.rotation);
  if (Number.isFinite(rot) && normRotation(rot) !== 0) out.rotation = normRotation(rot);
  return Object.keys(out).length ? out : undefined;
};

// Stable signature for caching built model instances
export const modelSignature = (node) => {
  const s = resolveModelSpec(node);
  const what = s.kind === 'gltf' ? `gltf:${s.url.length}:${s.url.slice(0, 64)}:${s.url.slice(-64)}` : s.kind === 'none' ? 'none' : s.id;
  return `${what}|${node.color}|${s.scale}|${s.rotation}`;
};

// Read a picked file as a data: URL so it can live inside the diagram file
export const readModelFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    let url = reader.result;
    // Browsers report .glb as application/octet-stream or nothing at all
    if (/\.glb$/i.test(file.name)) url = url.replace(/^data:[^;,]*/, 'data:model/gltf-binary');
    else if (/\.gltf$/i.test(file.name)) url = url.replace(/^data:[^;,]*/, 'data:model/gltf+json');
    resolve(url);
  };
  reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
  reader.readAsDataURL(file);
});
