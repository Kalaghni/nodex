# Nodex

Architecture diagramming on a hexagonal grid. Nodex is a single-page React app for sketching systems as hexagon nodes, connections, and colored zones — with nesting, multi-tab documents, and files that live on your device.

![](public/favicon.svg)

## Features

### Canvas
- **Infinite hex grid** that expands as you pan, zoom (scroll wheel), and place content
- **Nodes**: hexagons with an icon (90+ built in), color, label, and description
- **Nested diagrams**: every node can contain its own child diagram — Shift+Click (or "Open Diagram") to descend, breadcrumbs to climb back up
- **Zones**: colored regions in three shapes — rectangle, hexagon, and circular — with a name label you can place on any side (or center), inside or outside the boundary
  - Middle-drag a selected zone to move it; nodes sitting on it come along
  - Drag the round handle to resize (corner for rectangles, radius for hex/circular)

### Connections
- Double-click a node **or zone** to start a connection; click another node or zone to finish — node→node, node→zone, and zone→zone all work
- Mid-connection, click an **empty cell** to create a new node pre-wired to the source
- Lines terminate at hexagon edges; a zone connection lies exactly on the line between the two centers, trimmed where it crosses each zone's outline
- Per-connection options, edited in a live side drawer:
  - **Route**: direct or angled (right-angle elbow)
  - **Pointer per end**: none / arrow / open / circle / diamond
  - **Line style**: solid, dashed, dotted, dash-dot, long dash
  - **Color** per connection — line, label, icon, and pointers tint together
  - **Label + icon** with rotation; line gaps are cut to the label's exact footprint — including where *other* connections cross a label
- **Bulk connection editing**: Ctrl+Click lines (or marquee over them) to select many, then apply color/style/route/pointers to all at once from the sidebar
- **Channels**: named, colored flows defined per diagram. Connections subscribe to any subset and render one parallel strand per channel — so a flow can **split and converge** across the graph (e.g. public + internal traffic share the ingress line, split at the load balancer, and re-converge at the destination) while keeping its color everywhere. Managed in the sidebar; toggled per connection in the drawer or across a whole selection

### Editing
- **Multi-select**: marquee (drag on empty canvas), Ctrl+Click to toggle, Ctrl+A for all
- **Group drag** preserves relative layout; **bulk delete** removes nodes, their connections, and nested diagrams
- **Copy/paste/duplicate** is group-aware and keeps connections between copied nodes; pasted labels ending in a number get bumped (`Server 2` → `Server 3`)
- **Undo/redo** per tab (a whole drag is one step)

### Files
- **Tabs** — each tab is an independent diagram document
- **Work directly on device files** (File System Access API): Open links the file to the tab, Save writes straight back to it. Falls back to download/upload in browsers without the API
- **Projects**: save every tab into a single `nodex-project.json`; opening one restores all tabs
- **Autosave** toggle: changes are debounced and written to every linked file
- **Open Recent**: last 10 opened/saved files, reopenable in one click (file handles persisted in IndexedDB)
- **Drag & drop** a `.json` anywhere on the page to open it
- Unsaved changes trigger a leave-page warning
- **Export** the full diagram (not just the viewport) as standalone **SVG** or 2× **PNG**

## File formats

Plain JSON, two flavors, auto-detected on open:

| Format | Shape |
|--------|-------|
| Diagram | `{ "version": 1, "name", "diagrams", "currentPath" }` |
| Project | `{ "version": 2, "type": "nodex-project", "tabs": [{ "name", "diagrams", "currentPath" }] }` |

`diagrams` is a flat map keyed by nesting path (`"root"`, `"root/<nodeId>"`, …), each entry holding `nodes`, `connections`, and `zones`.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Drag empty canvas | Box-select nodes |
| Ctrl+Click node | Add/remove from selection |
| Ctrl+A | Select all nodes |
| Ctrl+C / Ctrl+V | Copy / paste selection |
| Ctrl+D | Duplicate selection |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+S | Save tab |
| Ctrl+Shift+S | Save project (all tabs) |
| Double-click node/zone | Start a connection |
| Right-click node | Edit the node |
| Shift+Click node | Open nested diagram |
| Delete / Backspace | Remove selection |
| Scroll | Zoom |
| Shift+Drag / Middle-drag | Pan |
| Middle-drag on selected zone | Move zone |
| Esc | Cancel / close |

## Development

```bash
npm install
npm run dev        # Vite dev server (port 3030)
npm run build      # production build to dist/
```

Stack: React 18, Vite 5, Tailwind CSS 3, [lucide-react](https://lucide.dev) icons. The whole app lives in `src/Nodex.jsx`.

## Deployment

### Docker

```bash
docker build -t nodex .
docker run -p 8080:80 nodex
```

Then open http://localhost:8080.

### Docker Compose

```bash
docker-compose up -d
```

## Browser support

Best in Chromium browsers (Chrome, Edge): on-device file linking, autosave, and Open Recent use the File System Access API. Firefox and Safari fall back to classic download/upload for saving and opening; everything else works everywhere.

## License

MIT
