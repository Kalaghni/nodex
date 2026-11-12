import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { DiagramScene } from './DiagramScene.js';

// React shell around DiagramScene: owns its lifetime, forwards data every
// render (the scene diffs it), and draws the hover tooltip.
const Scene3D = forwardRef(function Scene3D(props, ref) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [hover, setHover] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let scene;
    try {
      scene = new DiagramScene(containerRef.current, {
        onClick: (hit, e) => propsRef.current.onPick?.(hit, e),
        onContextMenu: (hit, e) => propsRef.current.onContextPick?.(hit, e),
        onDoubleClick: (hit, e) => propsRef.current.onDoublePick?.(hit, e),
        onHover: (hit, pos) => {
          setHover(hit ? { ...hit, x: pos?.clientX, y: pos?.clientY } : null);
          propsRef.current.onHover?.(hit);
        },
        onHoverMove: (pos) => setHover(h => (h ? { ...h, x: pos.clientX, y: pos.clientY } : h)),
        onModelStatus: (nodeId, err) => propsRef.current.onModelStatus?.(nodeId, err)
      });
    } catch (err) {
      setError(err.message || 'WebGL is not available');
      return undefined;
    }
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const p = propsRef.current;
    s.setData({
      nodes: p.nodes,
      zones: p.zones,
      connections: p.connections,
      connGeoms: p.connGeoms,
      zoneLabels: p.zoneLabels,
      visuals: p.visuals,
      axialToPixel: p.axialToPixel,
      hexSize: p.hexSize,
      fitKey: p.fitKey
    });
  });

  useImperativeHandle(ref, () => ({
    fit: () => sceneRef.current?.fit(true),
    topView: () => sceneRef.current?.topView(),
    screenshot: (scale) => sceneRef.current?.screenshot(scale)
  }), []);

  const rect = containerRef.current?.getBoundingClientRect();
  const tip = hover && rect && props.describe ? props.describe(hover) : null;

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="px-4 py-3 rounded-lg bg-slate-800 border border-slate-600 text-sm text-slate-200 max-w-sm text-center">
            The 3D view needs WebGL, which isn’t available in this browser.
            <div className="text-xs text-slate-400 mt-1">{error}</div>
          </div>
        </div>
      )}
      {tip && (
        <div
          className="absolute z-30 max-w-xs px-3 py-2 rounded-lg bg-slate-900/95 border border-slate-600 shadow-2xl text-xs pointer-events-none"
          style={{
            left: Math.min(hover.x - rect.left + 16, rect.width - 300),
            top: Math.min(hover.y - rect.top + 16, rect.height - 120)
          }}
        >
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-slate-500 uppercase tracking-wide text-[10px]">{tip.kind}</span>
            <span className="font-semibold text-slate-100 truncate">{tip.title}</span>
          </div>
          {tip.lines?.map((l, i) => (
            <p key={i} className="text-slate-300" style={l.color ? { color: l.color } : undefined}>{l.text}</p>
          ))}
        </div>
      )}
    </div>
  );
});

export default Scene3D;
