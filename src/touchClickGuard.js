// A touch can synchronously open a dialog before the browser delivers its
// compatibility click. Catch that click above both the canvas and the dialog.
export function installCanvasTouchClickGuard(canvas, root = window) {
  let handledTouch = false;

  const pointerDown = (event) => {
    handledTouch = event.pointerType === 'touch'
      && !!event.target?.closest?.('svg.nx-canvas')
      && canvas.contains(event.target);
  };
  const preventCompatibilityClick = (event) => {
    const nativeTouchClick = event.pointerType === 'touch'
      || event.sourceCapabilities?.firesTouchEvents
      // Older browsers can send a trusted MouseEvent without touch metadata.
      // A new mouse/pen pointerdown clears handledTouch; keyboard clicks have
      // detail 0, and the editor's synthesized mouse events are not trusted.
      || (event.isTrusted && event.detail > 0);
    if (handledTouch && nativeTouchClick) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const reset = () => { handledTouch = false; };

  const capture = { capture: true };
  root.addEventListener('pointerdown', pointerDown, capture);
  root.addEventListener('click', preventCompatibilityClick, capture);
  root.addEventListener('dblclick', preventCompatibilityClick, capture);
  root.addEventListener('blur', reset);
  return () => {
    root.removeEventListener('pointerdown', pointerDown, capture);
    root.removeEventListener('click', preventCompatibilityClick, capture);
    root.removeEventListener('dblclick', preventCompatibilityClick, capture);
    root.removeEventListener('blur', reset);
  };
}
