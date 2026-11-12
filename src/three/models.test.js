import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MODEL_IDS, BUILTIN_MODEL_IDS, buildModel, hasBuiltinModel } from './models.js';
import { resolveModelSpec, cleanModelOverride } from './modelSpec.js';

// Icon ids straight from the 2D palette, so a new icon without a 3D model
// fails here instead of silently falling back to the server model
const iconIds = () => {
  const src = readFileSync(new URL('../Nodex.jsx', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const AVAILABLE_ICONS = ['), src.indexOf('const COLOR_PALETTE'));
  return [...block.matchAll(/\{ id: '([^']+)', icon:/g)].map(m => m[1]);
};

test('every node icon has a built-in 3D model', () => {
  const ids = iconIds();
  assert.ok(ids.length > 80);
  const missing = ids.filter(id => !hasBuiltinModel(id));
  assert.deepEqual(missing, []);
});

test('the three.js-free model id list matches the builders', () => {
  assert.deepEqual([...MODEL_IDS].sort(), [...BUILTIN_MODEL_IDS].sort());
});

test('every built-in model builds, stands on the ground and fits its cell', () => {
  for (const id of MODEL_IDS) {
    const obj = buildModel(id, '#3b82f6');
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    assert.ok(!box.isEmpty(), id);
    assert.ok(Math.abs(box.min.y) < 1e-6, `${id} floor ${box.min.y}`);
    assert.ok(size.x <= 1.1 + 1e-6 && size.z <= 1.1 + 1e-6 && size.y <= 1.15 + 1e-6, `${id} size ${size.toArray()}`);
    assert.ok(Math.max(size.x, size.z) > 1.1 - 1e-3 || size.y > 1.15 - 1e-3, `${id} fills its box`);
    let meshes = 0;
    obj.traverse(o => {
      if (!o.isMesh) return;
      meshes++;
      const pos = o.geometry.attributes.position.array;
      assert.ok(pos.every(Number.isFinite), `${id} has non-finite vertices`);
    });
    assert.ok(meshes > 0, id);
  }
});

test('models get their own materials per instance', () => {
  const a = buildModel('server', '#ff0000');
  const b = buildModel('server', '#ff0000');
  const mats = (o) => { const s = new Set(); o.traverse(m => m.isMesh && s.add(m.material)); return s; };
  const ma = mats(a);
  for (const m of mats(b)) assert.ok(!ma.has(m));
});

test('model spec: icon by default, per-node overrides win', () => {
  assert.deepEqual(resolveModelSpec({ iconId: 'database' }), { kind: 'builtin', id: 'database', scale: 1, rotation: 0 });
  assert.deepEqual(resolveModelSpec({ iconId: 'nope' }), { kind: 'builtin', id: 'server', scale: 1, rotation: 0 });
  assert.deepEqual(resolveModelSpec({ iconId: 'database', model3d: { builtin: 'cloud', scale: 1.5, rotation: 90 } }),
    { kind: 'builtin', id: 'cloud', scale: 1.5, rotation: 90 });
  assert.deepEqual(resolveModelSpec({ iconId: 'database', model3d: { builtin: 'none' } }),
    { kind: 'none', scale: 1, rotation: 0 });
  assert.deepEqual(resolveModelSpec({ iconId: 'database', model3d: { url: 'https://x/y.glb', name: 'y.glb' } }),
    { kind: 'gltf', url: 'https://x/y.glb', name: 'y.glb', fallbackId: 'database', scale: 1, rotation: 0 });
});

test('model override cleaning drops defaults so files stay unchanged', () => {
  assert.equal(cleanModelOverride(undefined), undefined);
  assert.equal(cleanModelOverride({}), undefined);
  assert.equal(cleanModelOverride({ scale: 1, rotation: 0 }), undefined);
  assert.deepEqual(cleanModelOverride({ scale: 2, rotation: 360 }), { scale: 2 });
  assert.deepEqual(cleanModelOverride({ builtin: 'cloud', rotation: -90 }), { builtin: 'cloud', rotation: 270 });
  assert.deepEqual(cleanModelOverride({ builtin: 'bogus' }), undefined);
  assert.deepEqual(cleanModelOverride({ url: '  https://a/b.glb ', name: 'b.glb', builtin: 'cloud' }), { url: 'https://a/b.glb', name: 'b.glb' });
  assert.deepEqual(cleanModelOverride({ url: 'javascript:alert(1)' }), undefined);
  assert.deepEqual(cleanModelOverride({ scale: 99 }), { scale: 4 });
});
