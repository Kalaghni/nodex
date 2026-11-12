import test from 'node:test';
import assert from 'node:assert/strict';
import { installCanvasTouchClickGuard } from './touchClickGuard.js';

function setup() {
  const root = new EventTarget();
  const svg = { closest: () => svg };
  const control = { closest: () => null };
  const otherCanvas = { closest: () => otherCanvas };
  const canvas = { contains: target => target === svg };
  const cleanup = installCanvasTouchClickGuard(canvas, root);
  const dispatch = (type, target, properties = {}) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    // Model the event arriving at the root capture listener. Its target can
    // move from the SVG to a dialog mounted during the touch's pointerup.
    Object.defineProperties(event, Object.fromEntries(
      Object.entries({ target, ...properties }).map(([key, value]) => [key, { value }])
    ));
    root.dispatchEvent(event);
    return event;
  };
  return { root, svg, control, otherCanvas, dispatch, cleanup };
}

test('the canvas opening touch cannot activate a newly mounted dialog control', () => {
  const { root, svg, control, dispatch } = setup();
  let activations = 0;
  root.addEventListener('click', () => { activations++; });

  dispatch('pointerdown', svg, { pointerType: 'touch' });
  const click = dispatch('click', control, { pointerType: 'touch', detail: 1 });

  assert.equal(click.defaultPrevented, true);
  assert.equal(activations, 0);
});

test('a subsequent intentional tap on the dialog control is allowed', () => {
  const { root, svg, control, dispatch } = setup();
  let activations = 0;
  root.addEventListener('click', () => { activations++; });

  dispatch('pointerdown', svg, { pointerType: 'touch' });
  dispatch('click', control, { pointerType: 'touch' });
  dispatch('pointerdown', control, { pointerType: 'touch' });
  const click = dispatch('click', control, { pointerType: 'touch' });

  assert.equal(click.defaultPrevented, false);
  assert.equal(activations, 1);
});

test('editor-synthesized mouse clicks and keyboard activation are preserved', () => {
  const { svg, control, dispatch } = setup();
  dispatch('pointerdown', svg, { pointerType: 'touch' });

  assert.equal(dispatch('click', svg, { detail: 1 }).defaultPrevented, false);
  assert.equal(dispatch('dblclick', svg, { detail: 2 }).defaultPrevented, false);
  assert.equal(dispatch('click', control, { detail: 0 }).defaultPrevented, false);
});

test('mouse, pen, and touches outside this canvas do not inherit suppression', () => {
  const { svg, control, otherCanvas, dispatch } = setup();
  for (const [target, pointerType] of [[control, 'mouse'], [svg, 'pen'], [otherCanvas, 'touch']]) {
    dispatch('pointerdown', svg, { pointerType: 'touch' });
    dispatch('pointerdown', target, { pointerType });
    assert.equal(dispatch('click', target, { pointerType }).defaultPrevented, false);
  }
});

test('legacy touch compatibility clicks and double-clicks are consumed', () => {
  const { svg, control, dispatch } = setup();
  dispatch('pointerdown', svg, { pointerType: 'touch' });
  const touchSource = { sourceCapabilities: { firesTouchEvents: true }, detail: 1 };

  assert.equal(dispatch('click', control, touchSource).defaultPrevented, true);
  assert.equal(dispatch('dblclick', control, touchSource).defaultPrevented, true);
});

test('blur resets the guard and cleanup removes its event listeners', () => {
  const { svg, control, dispatch, cleanup } = setup();
  dispatch('pointerdown', svg, { pointerType: 'touch' });
  dispatch('blur', control);
  assert.equal(dispatch('click', control, { pointerType: 'touch' }).defaultPrevented, false);

  dispatch('pointerdown', svg, { pointerType: 'touch' });
  cleanup();
  assert.equal(dispatch('click', control, { pointerType: 'touch' }).defaultPrevented, false);
});
