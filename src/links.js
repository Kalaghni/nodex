// Node links. A link points a node at a diagram up the tree — the diagram
// the node sits in or one of its ancestors — stored as that diagram's path
// (['root', '12', ...]). Opening a linked node navigates to the link target
// instead of into the node's own nested diagram, so a linked node can't
// have children.

export const isLinkPath = (link) =>
  Array.isArray(link) && link.length > 0 && link[0] === 'root' &&
  link.every(s => typeof s === 'string' && s !== '');

// Every segment after 'root' must be a node in the diagram above it
export const pathResolves = (diagrams, path) => {
  if (!isLinkPath(path)) return false;
  for (let i = 1; i < path.length; i++) {
    const parent = diagrams[path.slice(0, i).join('/')];
    if (!parent?.nodes?.some(n => String(n.id) === path[i])) return false;
  }
  return true;
};

// Diagrams a node in `path` can link to: root down to `path` itself,
// nearest first
export const linkTargets = (path) => path.map((_, i) => path.slice(0, i + 1)).reverse();

export const pathLabels = (diagrams, path) => path.map((seg, i) => {
  if (i === 0) return 'Root';
  const parent = diagrams[path.slice(0, i).join('/')];
  return parent?.nodes?.find(n => String(n.id) === seg)?.label || `Node ${seg}`;
});

export const pathLabel = (diagrams, path) => pathLabels(diagrams, path).join(' / ');

export const samePath = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((s, i) => s === b[i]);

// Whether a node's nested diagram has anything in it
export const hasChildren = (diagrams, path, nodeId) => {
  const d = diagrams[[...path, String(nodeId)].join('/')];
  return !!d && ((d.nodes?.length || 0) > 0 || (d.zones?.length || 0) > 0);
};
