// Hex-grid geometry shared by the MCP toolkit - the same flat-top axial
// layout the editor draws (src/Nodex.jsx), without any React.
//
// Nodes and zone cells are stored in axial coordinates { q, r }. Axial rows
// slant (q + 1 moves right AND half a row down), so tools also speak "offset"
// coordinates { col, row }: col = q, and row is a true visual row. Nodes on
// even columns share a baseline; odd columns sit half a row lower.

export const HEX_SIZE = 40;

export const axialToPixel = (q, r) => ({
  x: HEX_SIZE * (3 / 2 * q),
  y: HEX_SIZE * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r)
});

// even-q offset ↔ axial
export const offsetToAxial = (col, row) => ({ q: col, r: row - (col - (col & 1)) / 2 });
export const axialToOffset = (q, r) => ({ col: q, row: r + (q - (q & 1)) / 2 });

export const hexDistance = (a, b) =>
  (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;

const DIRECTIONS = [
  { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 },
  { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }
];

// Cells exactly `radius` steps from a center
export const hexRing = (center, radius) => {
  if (radius === 0) return [{ q: center.q, r: center.r }];
  const cells = [];
  let q = center.q + DIRECTIONS[4].q * radius;
  let r = center.r + DIRECTIONS[4].r * radius;
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      cells.push({ q, r });
      q += DIRECTIONS[side].q;
      r += DIRECTIONS[side].r;
    }
  }
  return cells;
};

// Filled hexagon - same cells as the editor's hex-shaped zone
export const hexagonCells = (center, radius) => {
  const cells = [];
  for (let k = 0; k <= radius; k++) cells.push(...hexRing(center, k));
  return cells;
};

// Round region - same rule as the editor's circular zone
export const circleCells = (center, radius) => {
  const c = axialToPixel(center.q, center.r);
  const pixelRadius = (radius + 0.5) * HEX_SIZE * Math.sqrt(3) / 2 * 1.15;
  const cells = [];
  const range = radius + 2;
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = -range; dr <= range; dr++) {
      const q = center.q + dq;
      const r = center.r + dr;
      const p = axialToPixel(q, r);
      if (Math.hypot(p.x - c.x, p.y - c.y) <= pixelRadius) cells.push({ q, r });
    }
  }
  return cells;
};

// Visual rectangle: every cell between two offset corners. (The editor's own
// rectangle tool spans an axial range, which draws as a parallelogram.)
export const rectangleCells = (a, b) => {
  const cells = [];
  for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col++) {
    for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++) {
      cells.push(offsetToAxial(col, row));
    }
  }
  return cells;
};

export const cellKey = (c) => `${c.q},${c.r}`;
