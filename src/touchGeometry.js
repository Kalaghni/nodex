// Two-finger navigation preserves the world point under the initial midpoint,
// including when a pinch reaches the editor's zoom limits or becomes a pan.
export function touchPair(points) {
  const [a, b] = points;
  return {
    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    distance: Math.hypot(a.x - b.x, a.y - b.y)
  };
}

export function pinchView(view, start, current) {
  const zoom = Math.max(0.3, Math.min(3, view.zoom * current.distance / Math.max(1, start.distance)));
  const ratio = zoom / view.zoom;
  return {
    zoom,
    offset: {
      x: current.center.x - (start.center.x - view.offset.x) * ratio,
      y: current.center.y - (start.center.y - view.offset.y) * ratio
    }
  };
}
