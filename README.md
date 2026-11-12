# Nodex

Architecture diagramming on a hexagonal grid. Nodex is a single-page React app for sketching systems as hexagon nodes, connections, and colored zones — with nesting, multi-tab documents, and files that live on your device.

![](public/favicon.svg)

## Features

### Canvas
- **Infinite hex grid** that expands as you pan, zoom (scroll wheel), and place content
- **Nodes**: hexagons with an icon (90+ built in), color, label, and description
- **Nested diagrams**: every node can contain its own child diagram — double-click (or Shift+Click, or "Open Diagram") to descend, breadcrumbs to climb back up
- **Node links**: instead of a child diagram, a node can link to any diagram — anywhere in its own tab (Root, an ancestor, a sibling's nested diagram, …) or in another open tab. Set it under *Link* in the node editor. Opening a linked node (double-click, Shift+Click, "Follow Link") jumps to that diagram, switching tabs if needed. A linked node can't have children, a node that already has children can't be linked until they're removed, and a linked node's own diagram is never a link target. Tabs carry a saved id, so links between tabs survive save/load as long as both are open (a link to a tab that isn't open shows as broken). Linked nodes show a purple link badge
- **Zones**: colored regions in three shapes — rectangle, hexagon, and circular — with a name label you can place on any side (or center), inside or outside the boundary
  - Middle-drag a selected zone to move it; nodes sitting on it come along
  - Drag the round handle to resize (corner for rectangles, radius for hex/circular)

### Connections
- Right-click a node **or zone** to start a connection; click another node or zone to finish — node→node, node→zone, and zone→zone all work
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

### Traffic channel isolation
- **Trace bar** floating over the canvas: click channels to isolate one or more flows; hover a chip to preview a channel on its own. Channel rows in the sidebar toggle isolation the same way
- Everything the isolated flows pass through stays lit — nodes, connections, and the zones they enter — while unrelated infrastructure fades back. On connections shared by several channels, only the isolated strands stay bright
- Active strands animate in the **direction traffic flows**; failover peers that aren't carrying traffic show as *standby* (dashed), and channel links that never complete a route show as *stranded*
- **Hover a node** to narrow the view to just the paths that pass through it
- The sidebar shows an **end-to-end trace** per isolated channel: entry points → hops → destinations, stage by stage (click a hop to center on it)

### Outage simulation
- Toggle **Simulate** in the toolbar, then click nodes, connections, or whole zones to fail them (click again to restore). It's a what-if view — the diagram, undo history, and saved files are never touched; scenarios are kept per tab and nesting level
- Every component is rated **healthy**, **degraded**, or **unavailable**, distinguishing injected failures (power-off icon) from collateral damage (dashed red). Hover anything for the reason
- **Per-flow impact**: each channel reports healthy / degraded / down with explanations — *“edge-lb1 failed over to edge-lb2”*, *“web (2) down → rerouted via web (1)”*, *“Can’t reach wordpress_prod”*. Entry points whose traffic can't get through are marked *cut off*; destinations nothing reaches any more are marked *unreachable*
- Amber **failover arcs** show who took over for whom (failover peer, floating VIP holder, promoted standby)
- **Single-point-of-failure scan**: lists every component whose failure — on top of the current ones — would take a flow down; click one to simulate it
- Combine with isolation to watch one flow re-route around failures in real time

### Live monitoring
- Attach **real addresses** to a node (edit the node — select it and press **E** — → *Monitoring*): IP or hostname plus a check — **Ping**, **TCP port open**, **HTTP** or **HTTPS** (with a path, e.g. `/health`). A node can have several; *Test* checks one on the spot
- Toggle **Live** in the toolbar: every address is checked on an interval and each node gets a live dot — green up, amber partly up (some of its addresses fail), red down, grey can't check. Hover a node for per-address latency and errors; the sidebar lists what's failing and the recent check history of the selected node
- **Real outages flow into the impact analysis**: a node that's really down is treated like a failure — dependents, failovers, and every affected traffic channel light up exactly as in a simulation. *Explore impact & what-ifs* opens the simulation starting from the live state, so you can ask "and if this fails too?"
- An address only counts as down after *N* consecutive failed checks (default 2, configurable) so a single lost packet isn't an outage; recovery shows immediately. If the agent itself can't be reached, nothing is marked down — Nodex says the agent is unreachable instead

**Where checks run.** Browsers can't ping or open raw TCP connections, so checks go through a small, dependency-free **monitor agent** (`monitor/server.js`) running somewhere that can reach your hosts:

```bash
npm run monitor                     # http://localhost:7070
```

or with Docker (`docker compose up -d` starts it next to Nodex, published on localhost only). Point Nodex at it from the ⚙ next to *Live*; *Test connection* confirms it and lists the checks it supports. Without an agent, choose **This browser** in the settings: HTTP(S) checks only, and an `https://` page can't check `http://` addresses.

The agent probes whatever it's asked to, so lock it down when anyone else can reach it:

| Variable | Default | |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `7070` | Listen address — localhost only by default |
| `NODEX_MONITOR_TOKEN` | — | Require `Authorization: Bearer <token>` (enter the same token in Nodex) |
| `NODEX_MONITOR_ALLOW` | — | Comma-separated CIDRs (`10.0.0.0/8,192.168.1.0/24`); hostnames are resolved first and every address must match |
| `NODEX_MONITOR_ORIGIN` | `*` | CORS origin allowed to call the agent |

Ping uses the system `ping` binary (no shell; the Docker image runs it as an unprivileged user). Where no `ping` is available, ping checks show as *can't check* — use a TCP or HTTP check instead.

### 3D view
- Switch **2D / 3D** in the toolbar to see the current diagram level as a 3D scene: every node stands on a raised hexagon with a **3D model of its icon**, zones become translucent floors with low walls, and connections (with their channel strands, arrowheads and labels) run between them
- **Every icon has a matching 3D model** (all 86, built procedurally — nothing to download), tinted with the node's color
- **Per-node override** (edit the node → *3D model*, with a live turntable preview):
  - *Match icon* (default) · any other *Built-in* model (thumbnail gallery) · a *Custom file* — a glTF 2.0 `.glb` / self-contained `.gltf`, embedded in the diagram, or a URL · *None* (just the hexagon)
  - **Scale** (0.25–4×) and **rotation** apply to whichever model is shown; custom models are fitted to the cell automatically, and while one loads (or if it fails) the icon's model stands in
- Everything else carries over: selection, isolation fading and animated traffic packets, simulation and live status (failed models grey out with a pulsing red ring), nested diagrams
- Controls: drag to orbit, right / Shift-drag to pan, scroll to zoom at the cursor; click to select (or fail/restore while simulating), right-click to edit, Shift+Click to open a nested diagram, double-click to focus a node. *Top* looks straight down, ⛶ fits the view, and *PNG* exports the 3D view
- Drawing zones and links happens on the grid, so starting either switches back to 2D. three.js loads only when the 3D view or the model editor is first opened

### Availability semantics
The simulation understands redundancy through a few optional properties:

| Where | Setting | Meaning |
|-------|---------|---------|
| Zone | **Redundant pool** (default) | Load-balanced replicas — up while any member is up |
| Zone | **Active / standby** | One active member (pick the primary); a standby is promoted when it fails |
| Zone | **Quorum** | Needs a strict majority; members stop serving when quorum is lost |
| Zone | **At least N** / **All required** | Minimum capacity / no redundancy |
| Connection | **Traffic** (default) | Carries requests from → to (toward the arrowhead; *Reverse direction* flips it) |
| Connection | **Required dependency** | The source fails when the target is unavailable (cache, auth, …) |
| Connection | **Peer → Failover** | keepalived / VRRP: peers take over a failed member's address and role |
| Connection | **Peer → Quorum** | Galera / etcd / Raft: members need a majority — network partitions included |
| Connection | **Peer → Failover + quorum** | Patroni, Swarm managers: leader election inside a consensus cluster |
| Node | **Floating VIP** role | A virtual address with no capacity of its own, held by one failover peer at a time |

Nodes on a zone's cells are its members, and traffic aimed at a zone is spread across them. A node that can no longer forward any of its channel traffic (an LB with no healthy backends) becomes unavailable too. Unclassified links without channels — monitoring, management — never cascade failures.

Try it with [`examples/ha-web-stack.json`](examples/ha-web-stack.json): edge LBs with keepalived, a MaxScale VIP trio in front of a Galera quorum, a Patroni cluster, and four traffic channels.

### Editing
- **Multi-select**: marquee (drag on empty canvas), Ctrl+Click to toggle, Ctrl+A for all
- **Group drag** preserves relative layout; **bulk delete** removes nodes, their connections, and nested diagrams
- **Copy/paste/duplicate** is group-aware and keeps connections between copied nodes; pasted labels ending in a number get bumped (`Server 2` → `Server 3`)
- **Undo/redo** per tab (a whole drag is one step)

### Files
- **Tabs** — each tab is an independent diagram document; right-click a tab for **Rename** and **Save Page** (Ctrl+S still saves the active tab)
- **Work directly on device files** (File System Access API): Open links the file to the tab, Save writes straight back to it. Falls back to download/upload in browsers without the API
- **Projects**: save every tab into a single `nodex-project.json`; opening one restores all tabs
- **Autosave** toggle: changes are debounced and written to every linked file — turns on automatically when you open a project or a recent file
- **Open Recent**: last 10 opened/saved files, reopenable in one click (file handles persisted in IndexedDB)
- **Drag & drop** a `.json` anywhere on the page to open it
- Unsaved changes trigger a leave-page warning
- **Export** the full diagram (not just the viewport) as standalone **SVG** or 2× **PNG**

## Phones and tablets

- The canvas fills the screen. **Tools** opens diagram settings, zones, channels, and the selected component; **Actions** opens file, export, view, undo, and monitoring controls.
- In 2D, drag empty canvas to pan, pinch to zoom, tap a node to select it, and drag a node to move it. Double-tap opens its nested diagram or follows its link.
- A selected node has **Edit**, **Open**, and **Connect** buttons at the bottom of the canvas. To connect, tap **Connect**, then another node or zone (or an empty cell to create a connected node).
- Choose a zone shape in **Tools**, then drag on the canvas to size it. Tabs have visible close and options buttons; the options menu includes Rename and Save Page.
- Dialogs scroll within the screen, and palettes adapt to the available width. In 3D, drag to orbit and use two fingers to pan and zoom.

## File formats

Plain JSON, two flavors, auto-detected on open:

| Format | Shape |
|--------|-------|
| Diagram | `{ "version": 1, "name", "diagrams", "currentPath" }` |
| Project | `{ "version": 2, "type": "nodex-project", "tabs": [{ "name", "diagrams", "currentPath" }] }` |

`diagrams` is a flat map keyed by nesting path (`"root"`, `"root/<nodeId>"`, …), each entry holding `nodes`, `connections`, `zones`, and `channels`.

Availability settings are optional fields, so older files load unchanged: `zone.policy = { mode, min, primaryId }`, `connection.kind = "peer"` with `connection.peerMode` (`failover` / `quorum` / `both` / `replica`), `connection.required`, and `node.role = "vip"`. 3D overrides are `node.model3d = { builtin? | url?, name?, scale?, rotation? }` (`builtin: "none"` hides the model; omitted entirely when the node uses its icon's model at normal size). Monitored addresses are `node.endpoints = [{ id, address, check, port?, path?, insecure? }]`; monitoring settings (agent URL, token, interval) stay in the browser, not in the file.

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
| Double-click node | Open the node (nested diagram, or its link target) |
| Right-click node/zone | Start a connection |
| E | Edit the selected node |
| Shift+Click node | Open the node (same as double-click) |
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
npm run monitor    # live-monitoring agent on localhost:7070
npm test           # analysis, monitoring, and agent tests (node's built-in runner)
```

Stack: React 18, Vite 5, Tailwind CSS 3, [lucide-react](https://lucide.dev) icons, [three.js](https://threejs.org) for the 3D view. The UI lives in `src/Nodex.jsx`; the availability / flow analysis behind isolation and simulation is a pure module in `src/analysis.js`, live-monitoring logic is in `src/monitor.js`, the probe agent is `monitor/server.js`, and the 3D view lives in `src/three/` — `models.js` (one procedural model per icon), `modelSpec.js` (per-node overrides), `DiagramScene.js` (the renderer) (each with a `.test.js` next to it where it has logic).

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

This starts Nodex on port 8080 and the monitor agent on `127.0.0.1:7070`. Set `NODEX_MONITOR_ALLOW` / `NODEX_MONITOR_TOKEN` in the environment (or a `.env` file) to restrict it.

## Browser support

Best in Chromium browsers (Chrome, Edge): on-device file linking, autosave, and Open Recent use the File System Access API. Firefox and Safari fall back to classic download/upload for saving and opening; everything else works everywhere.

## License

MIT
