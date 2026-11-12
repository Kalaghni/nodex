// Custom glTF / GLB models for per-node overrides.
//
// Each URL is fetched and parsed once; every node using it gets a clone
// with its own materials (so fading one node never fades another) while
// geometry stays shared with the cached template.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const cache = new Map(); // url → Promise<THREE.Object3D>
const MAX_CACHE = 24;

export const loadGltf = (url) => {
  if (cache.has(url)) {
    const p = cache.get(url);
    // Refresh LRU position
    cache.delete(url);
    cache.set(url, p);
    return p;
  }
  const p = new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const root = gltf.scene || gltf.scenes?.[0];
        if (!root) {
          reject(new Error('The file has no scene'));
          return;
        }
        root.traverse(o => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            o.userData.sharedGeometry = true;
          }
        });
        resolve(root);
      },
      undefined,
      (err) => reject(new Error(friendlyError(err)))
    );
  });
  // A failed load shouldn't stick — the user may fix the URL or the server
  p.catch(() => cache.delete(url));
  cache.set(url, p);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return p;
};

const friendlyError = (err) => {
  const msg = err?.message || String(err || 'Could not load model');
  if (/DRACO/i.test(msg)) return 'Draco-compressed models aren’t supported — export without Draco compression';
  if (/KTX2|basis/i.test(msg)) return 'KTX2 textures aren’t supported — export with PNG/JPEG textures';
  if (/Failed to fetch|NetworkError|404|CORS/i.test(msg)) return `Couldn’t download the model (${msg})`;
  return msg;
};

// Clone a cached template with per-instance materials
export const instantiateGltf = (template) => {
  const obj = template.clone(true);
  obj.traverse(o => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
    o.userData.sharedGeometry = true;
  });
  return obj;
};

export const disposeObject = (obj) => {
  obj.traverse(o => {
    if (o.isMesh || o.isLine || o.isPoints) {
      if (!o.userData.sharedGeometry && !o.geometry?.userData?.shared) o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => m && !m.userData?.shared && m.dispose());
    }
  });
};
