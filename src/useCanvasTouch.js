import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { pinchView, touchPair } from './touchGeometry.js';
import { installCanvasTouchClickGuard } from './touchClickGuard.js';

// Translate touch into the editor's existing mouse gestures so dragging, undo,
// zone creation, selection and connection editing share one implementation.
// The 3D renderer owns its own pointer input and is deliberately left alone.
export function useCanvasTouch({ canvasRef, view3d, zoomStateRef, setZoom, setViewOffset, drawing, simMode, cancel }) {
  const optionsRef = useRef(null);
  optionsRef.current = { drawing, simMode, cancel };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || view3d) return;
    const pointers = new Map();
    let gesture = null;
    let lastTap = null;
    const removeClickGuard = installCanvasTouchClickGuard(canvas);
    const mouse = (target, type, point, button = 0) => target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, clientX: point.x, clientY: point.y,
      button, buttons: type === 'mouseup' || type === 'click' || type === 'dblclick' ? 0 : button === 1 ? 4 : 1
    }));
    const localPair = () => {
      const rect = canvas.getBoundingClientRect();
      return touchPair([...pointers.values()].slice(0, 2).map(p => ({ x: p.x - rect.left, y: p.y - rect.top })));
    };
    const endDrag = () => {
      if (gesture?.dragging) mouse(window, 'mouseup', gesture.last, gesture.button);
    };
    const stop = () => {
      pointers.clear();
      gesture = null;
      lastTap = null;
      optionsRef.current.cancel();
    };
    const down = (event) => {
      if (event.pointerType !== 'touch') return;
      if (pointers.size >= 2) { event.preventDefault(); return; }
      // Never swallow a tap on HTML controls floating above the SVG canvas.
      if (!pointers.size && !event.target.closest('svg.nx-canvas')) {
        return;
      }
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      const point = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, point);
      if (pointers.size === 1) {
        gesture = { target: event.target, start: point, last: point, dragging: false, multi: false };
      } else if (pointers.size === 2) {
        endDrag();
        gesture = { multi: true, pair: localPair(), view: zoomStateRef.current };
        lastTap = null;
      }
    };
    const move = (event) => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      const point = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, point);
      if (pointers.size >= 2) {
        const view = pinchView(gesture.view, gesture.pair, localPair());
        zoomStateRef.current = view;
        setZoom(view.zoom);
        setViewOffset(view.offset);
        return;
      }
      // Lifting one finger after a pinch must never turn into a node drag/tap.
      if (gesture.multi) return;
      gesture.last = point;
      if (!gesture.dragging && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) >= 8) {
        const { drawing: isDrawing, simMode: simulating } = optionsRef.current;
        const onNode = gesture.target.closest('.node-element');
        gesture.button = !simulating && (onNode || isDrawing) ? 0 : 1;
        // Empty-canvas drags pan; a touch beginning on a node moves that node.
        const target = gesture.button === 1 ? canvas : gesture.target;
        flushSync(() => mouse(target, 'mousedown', gesture.start, gesture.button));
        gesture.dragging = true;
        lastTap = null;
      }
      if (gesture.dragging) mouse(canvas, 'mousemove', point, gesture.button);
    };
    const up = (event) => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      pointers.delete(event.pointerId);
      if (gesture.multi) {
        if (!pointers.size) gesture = null;
        return;
      }
      if (gesture.dragging) {
        endDrag();
      } else {
        const { target, start } = gesture;
        flushSync(() => mouse(target, 'mousedown', start));
        mouse(window, 'mouseup', start);
        mouse(target, 'click', start);
        const item = target.closest('.node-element') || target;
        const now = performance.now();
        if (lastTap?.item === item && now - lastTap.time < 350) {
          mouse(target, 'dblclick', start);
          lastTap = null;
        } else lastTap = { item, time: now };
      }
      gesture = null;
    };
    const cancelPointer = (event) => { if (pointers.has(event.pointerId)) stop(); };
    canvas.addEventListener('pointerdown', down, { passive: false });
    canvas.addEventListener('pointermove', move, { passive: false });
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancelPointer);
    canvas.addEventListener('lostpointercapture', cancelPointer);
    window.addEventListener('blur', stop);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancelPointer);
      canvas.removeEventListener('lostpointercapture', cancelPointer);
      removeClickGuard();
      window.removeEventListener('blur', stop);
      if (pointers.size) optionsRef.current.cancel();
    };
  }, [view3d, canvasRef, zoomStateRef, setZoom, setViewOffset]);
}
