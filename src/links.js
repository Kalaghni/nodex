// Node links. A link points a node at any diagram — in its own tab or
// another open tab — stored as { tab: <tab uid>, path: ['root', '12', ...] }.
// (Older saves stored a bare path array, meaning "this tab".) Opening a
// linked node navigates to the link target instead of into the node's own
// nested diagram, so a linked node can't have children — and a linked
// node's own diagram is never a link target.

const isPath = (p) =>
  Array.isArray(p) && p.length > 0 && p[0] === 'root' &&
  p.every(s => typeof s === 'string' && s !== '');

// { tab, path } with tab null for "the tab the node is in", or null if
// `link` isn't a link
export const normalizeLink = (link) => {
  if (isPath(link)) return { tab: null, path: link };
  if (link && typeof link === 'object' && isPath(link.path)) {
    return { tab: typeof link.tab === 'string' && link.tab ? link.tab : null, path: link.path };
  }
  return null;
};

export const isLink = (link) => normalizeLink(link) !== null;

const findNode = (diagrams, parentPath, seg) =>
  diagrams[parentPath.join('/')]?.nodes?.find(n => String(n.id) === seg);

// Every segment after 'root' must be a node in the diagram above it, and
// none of them linked (a linked node's own diagram is unreachable)
export const pathResolves = (diagrams, path) => {
  if (!isPath(path) || !diagrams) return false;
  for (let i = 1; i < path.length; i++) {
    const node = findNode(diagrams, path.slice(0, i), path[i]);
    if (!node || isLink(node.link)) return false;
  }
  return true;
};

// The tab and path a link leads to, or null when it's broken
export const resolveLink = (tabs, fromTab, link) => {
  const l = normalizeLink(link);
  if (!l) return null;
  const tab = l.tab ? tabs.find(t => t.uid === l.tab) : fromTab;
  if (!tab || !pathResolves(tab.diagrams, l.path)) return null;
  return { tab, path: l.path };
};

// Every diagram a link can point at: root, plus the nested diagram of every
// unlinked node, depth-first. `exclude` (a path) and everything under it is
// left out — a node can't link to its own nested diagram.
export const diagramPaths = (diagrams, exclude = null) => {
  const excludeKey = exclude ? exclude.join('/') : null;
  const out = [];
  const walk = (path) => {
    const key = path.join('/');
    if (excludeKey && (key === excludeKey || key.startsWith(excludeKey + '/'))) return;
    out.push(path);
    (diagrams?.[key]?.nodes || []).forEach(n => {
      if (!isLink(n.link)) walk([...path, String(n.id)]);
    });
  };
  walk(['root']);
  return out;
};

export const pathLabels = (diagrams, path) => path.map((seg, i) => {
  if (i === 0) return 'Root';
  return findNode(diagrams, path.slice(0, i), seg)?.label || `Node ${seg}`;
});

export const pathLabel = (diagrams, path) => pathLabels(diagrams, path).join(' / ');

// "Root / API" in the same tab, "Other tab › Root / API" in another
export const linkLabel = (tabs, fromTab, link) => {
  const l = normalizeLink(link);
  if (!l) return '';
  const r = resolveLink(tabs, fromTab, link);
  if (!r) return 'Broken link';
  const label = pathLabel(r.tab.diagrams, r.path);
  return r.tab === fromTab ? label : `${r.tab.name} › ${label}`;
};

export const samePath = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((s, i) => s === b[i]);

// Whether a node's nested diagram has anything in it
export const hasChildren = (diagrams, path, nodeId) => {
  const d = diagrams[[...path, String(nodeId)].join('/')];
  return !!d && ((d.nodes?.length || 0) > 0 || (d.zones?.length || 0) > 0);
};

// Rewrite link tab uids (oldUid → newUid) across a diagrams map — used when
// a loaded tab's uid clashes with an open tab and has to be replaced
export const remapLinkTabs = (diagrams, uidMap) => {
  if (!diagrams || Object.keys(uidMap).length === 0) return diagrams;
  const out = {};
  Object.entries(diagrams).forEach(([key, d]) => {
    const nodes = d?.nodes;
    if (!Array.isArray(nodes) || !nodes.some(n => n?.link?.tab && uidMap[n.link.tab])) {
      out[key] = d;
      return;
    }
    out[key] = {
      ...d,
      nodes: nodes.map(n => (n?.link?.tab && uidMap[n.link.tab]
        ? { ...n, link: { ...n.link, tab: uidMap[n.link.tab] } }
        : n))
    };
  });
  return out;
};

export const newTabUid = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
