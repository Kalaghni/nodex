import React, { useState, useRef, useEffect } from 'react';
import { Database, Server, Cloud, Zap, Box, Globe, Lock, HardDrive, Cpu, Network, Shield, Wifi, Code, Container, FileText, Users, Settings, Activity, Mail, Phone, CheckCircle, XCircle, AlertCircle, Plus, Edit2, X, ChevronRight, Hexagon, Trash2, Save, FolderOpen, Download, FilePlus, ZoomIn, ZoomOut, Maximize, Undo, Redo, Copy, Clipboard, Grid, Eye, EyeOff, Home, Building, Factory, Warehouse, ShoppingCart, CreditCard, DollarSign, PieChart, BarChart, LineChart, TrendingUp, Clock, Calendar, Bell, MessageSquare, Send, Upload, Link, Layers, Package, Archive, Folder, Search, Filter, Terminal, GitBranch, Github, Smartphone, Tablet, Monitor, Printer, Camera, Mic, Video, Play, Pause, Square, Circle, Triangle, Star, Heart, ThumbsUp, ThumbsDown, Flag, Bookmark, Tag, Hash, AtSign, MapPin, Navigation, Compass, Map, Truck, Plane, Ship, Train, Car, Bike, Footprints, Key, Unlock, UserCheck, UserX, UserPlus, User, Bot, Cog, Wrench, Hammer, Lightbulb, Flame, Droplet, Wind, Sun, Moon, CloudRain, Snowflake, Thermometer } from 'lucide-react';

// Hexagon grid calculations
const HEX_SIZE = 40;

// Monotonic id generator — Date.now() alone can collide when two items are
// created within the same millisecond (e.g. paste twice, import + new tab)
let __nextId = Date.now();
const genId = () => __nextId++;

const getHexagonPoints = (x, y, size) => {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    points.push([
      x + size * Math.cos(angle),
      y + size * Math.sin(angle)
    ]);
  }
  return points.map(p => p.join(',')).join(' ');
};

const axialToPixel = (q, r) => {
  const x = HEX_SIZE * (3 / 2 * q);
  const y = HEX_SIZE * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
  return { x, y };
};

const pixelToAxial = (x, y) => {
  const q = (2 / 3 * x) / HEX_SIZE;
  const r = (-1 / 3 * x + Math.sqrt(3) / 3 * y) / HEX_SIZE;
  return axialRound(q, r);
};

const axialRound = (q, r) => {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);

  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);

  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  }

  return { q: rq, r: rr };
};

// Hex distance using cube coordinates
const hexDistance = (q1, r1, q2, r2) => {
  // Convert to cube coordinates and get max of absolute differences
  const x1 = q1, z1 = r1, y1 = -q1 - r1;
  const x2 = q2, z2 = r2, y2 = -q2 - r2;
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
};

// Distance from a flat-top hexagon's center to its boundary along `angle`.
// Vertices sit at multiples of 60°, so within each 60° sector the boundary is
// a straight edge whose apothem is size·√3/2.
const hexBoundaryDistance = (size, angle) => {
  const sector = Math.PI / 3;
  let a = angle % sector;
  if (a < 0) a += sector;
  return (size * Math.sqrt(3) / 2) / Math.cos(a - sector / 2);
};

// Trim a segment between two hex centers so it starts/ends at the hexagon
// boundaries instead of the centers (keeps arrowheads visible at the edge).
const trimSegmentToHexEdges = (from, to, size) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return null;
  const angle = Math.atan2(dy, dx);
  let fromTrim = hexBoundaryDistance(size, angle);
  let toTrim = hexBoundaryDistance(size, angle + Math.PI);
  // Adjacent hexes touch — keep at least a sliver of line so markers don't NaN
  const totalTrim = fromTrim + toTrim;
  if (dist - totalTrim < 4) {
    const scale = Math.max(0, dist - 4) / totalTrim;
    fromTrim *= scale;
    toTrim *= scale;
  }
  const ux = dx / dist;
  const uy = dy / dist;
  return {
    from: { x: from.x + ux * fromTrim, y: from.y + uy * fromTrim },
    to: { x: to.x - ux * toTrim, y: to.y - uy * toTrim },
    ux,
    uy
  };
};

// Walk hex rings around a center cell, out to `radius`
const buildHexRingCells = (cq, cr, radius) => {
  const cells = [{ q: cq, r: cr }];
  const directions = [
    { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 },
    { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }
  ];
  for (let ring = 1; ring <= radius; ring++) {
    let q = cq + directions[4].q * ring;
    let r = cr + directions[4].r * ring;
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < ring; step++) {
        cells.push({ q, r });
        q += directions[side].q;
        r += directions[side].r;
      }
    }
  }
  return cells;
};

// Round region: cells whose center lies within a Euclidean pixel radius —
// unlike buildHexRingCells this produces a circle, not a bigger hexagon
const buildCircularCells = (cq, cr, hexRadius) => {
  const center = axialToPixel(cq, cr);
  const pixelRadius = (hexRadius + 0.5) * HEX_SIZE * Math.sqrt(3) / 2 * 1.15;
  const cells = [];
  const range = hexRadius + 2;
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = -range; dr <= range; dr++) {
      const q = cq + dq;
      const r = cr + dr;
      const pos = axialToPixel(q, r);
      if (Math.hypot(pos.x - center.x, pos.y - center.y) <= pixelRadius) {
        cells.push({ q, r });
      }
    }
  }
  return cells;
};

const AVAILABLE_ICONS = [
  // Infrastructure
  { id: 'server', icon: Server, label: 'Server' },
  { id: 'database', icon: Database, label: 'Database' },
  { id: 'cloud', icon: Cloud, label: 'Cloud' },
  { id: 'storage', icon: HardDrive, label: 'Storage' },
  { id: 'compute', icon: Cpu, label: 'Compute' },
  { id: 'network', icon: Network, label: 'Network' },
  { id: 'container', icon: Container, label: 'Container' },
  { id: 'terminal', icon: Terminal, label: 'Terminal' },
  { id: 'git', icon: GitBranch, label: 'Git' },
  { id: 'github', icon: Github, label: 'GitHub' },
  // Services & APIs
  { id: 'api', icon: Zap, label: 'API' },
  { id: 'service', icon: Box, label: 'Service' },
  { id: 'web', icon: Globe, label: 'Web' },
  { id: 'code', icon: Code, label: 'Code' },
  { id: 'layers', icon: Layers, label: 'Layers' },
  { id: 'package', icon: Package, label: 'Package' },
  { id: 'link', icon: Link, label: 'Link' },
  { id: 'bot', icon: Bot, label: 'Bot/AI' },
  // Security
  { id: 'security', icon: Lock, label: 'Security' },
  { id: 'shield', icon: Shield, label: 'Shield' },
  { id: 'key', icon: Key, label: 'Key' },
  { id: 'unlock', icon: Unlock, label: 'Unlock' },
  // Communication
  { id: 'wifi', icon: Wifi, label: 'WiFi' },
  { id: 'mail', icon: Mail, label: 'Mail' },
  { id: 'phone', icon: Phone, label: 'Phone' },
  { id: 'message', icon: MessageSquare, label: 'Message' },
  { id: 'send', icon: Send, label: 'Send' },
  { id: 'bell', icon: Bell, label: 'Notification' },
  // Documents & Data
  { id: 'document', icon: FileText, label: 'Document' },
  { id: 'folder', icon: Folder, label: 'Folder' },
  { id: 'archive', icon: Archive, label: 'Archive' },
  { id: 'upload', icon: Upload, label: 'Upload' },
  { id: 'download', icon: Download, label: 'Download' },
  // Users
  { id: 'users', icon: Users, label: 'Users' },
  { id: 'user', icon: User, label: 'User' },
  { id: 'usercheck', icon: UserCheck, label: 'User Check' },
  { id: 'userplus', icon: UserPlus, label: 'User Plus' },
  // Business
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'building', icon: Building, label: 'Building' },
  { id: 'factory', icon: Factory, label: 'Factory' },
  { id: 'warehouse', icon: Warehouse, label: 'Warehouse' },
  { id: 'cart', icon: ShoppingCart, label: 'Cart' },
  { id: 'credit', icon: CreditCard, label: 'Payment' },
  { id: 'dollar', icon: DollarSign, label: 'Money' },
  // Analytics
  { id: 'activity', icon: Activity, label: 'Activity' },
  { id: 'piechart', icon: PieChart, label: 'Pie Chart' },
  { id: 'barchart', icon: BarChart, label: 'Bar Chart' },
  { id: 'linechart', icon: LineChart, label: 'Line Chart' },
  { id: 'trending', icon: TrendingUp, label: 'Trending' },
  // Tools & Settings
  { id: 'settings', icon: Settings, label: 'Settings' },
  { id: 'cog', icon: Cog, label: 'Cog' },
  { id: 'wrench', icon: Wrench, label: 'Wrench' },
  { id: 'hammer', icon: Hammer, label: 'Hammer' },
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'filter', icon: Filter, label: 'Filter' },
  // Devices
  { id: 'smartphone', icon: Smartphone, label: 'Mobile' },
  { id: 'tablet', icon: Tablet, label: 'Tablet' },
  { id: 'monitor', icon: Monitor, label: 'Monitor' },
  { id: 'printer', icon: Printer, label: 'Printer' },
  { id: 'camera', icon: Camera, label: 'Camera' },
  // Time
  { id: 'clock', icon: Clock, label: 'Clock' },
  { id: 'calendar', icon: Calendar, label: 'Calendar' },
  // Status
  { id: 'check', icon: CheckCircle, label: 'Check' },
  { id: 'error', icon: XCircle, label: 'Error' },
  { id: 'warning', icon: AlertCircle, label: 'Warning' },
  { id: 'star', icon: Star, label: 'Star' },
  { id: 'flag', icon: Flag, label: 'Flag' },
  { id: 'lightbulb', icon: Lightbulb, label: 'Idea' },
  // Media
  { id: 'play', icon: Play, label: 'Play' },
  { id: 'pause', icon: Pause, label: 'Pause' },
  { id: 'mic', icon: Mic, label: 'Microphone' },
  { id: 'video', icon: Video, label: 'Video' },
  // Location
  { id: 'mappin', icon: MapPin, label: 'Location' },
  { id: 'map', icon: Map, label: 'Map' },
  { id: 'compass', icon: Compass, label: 'Compass' },
  // Transport
  { id: 'truck', icon: Truck, label: 'Truck' },
  { id: 'plane', icon: Plane, label: 'Plane' },
  { id: 'ship', icon: Ship, label: 'Ship' },
  // Shapes
  { id: 'hexagon', icon: Hexagon, label: 'Hexagon' },
  { id: 'circle', icon: Circle, label: 'Circle' },
  { id: 'square', icon: Square, label: 'Square' },
  { id: 'triangle', icon: Triangle, label: 'Triangle' },
  // Nature
  { id: 'flame', icon: Flame, label: 'Fire' },
  { id: 'droplet', icon: Droplet, label: 'Water' },
  { id: 'sun', icon: Sun, label: 'Sun' },
  { id: 'moon', icon: Moon, label: 'Moon' }
];

const COLOR_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4',
  '#ec4899', '#ef4444', '#84cc16', '#6366f1', '#14b8a6',
  '#f97316', '#a855f7', '#22c55e', '#eab308', '#64748b'
];

const ZONE_COLORS = [
  { color: '#3b82f6', label: 'Blue' },
  { color: '#10b981', label: 'Green' },
  { color: '#f59e0b', label: 'Amber' },
  { color: '#8b5cf6', label: 'Purple' },
  { color: '#ec4899', label: 'Pink' },
  { color: '#ef4444', label: 'Red' },
  { color: '#06b6d4', label: 'Cyan' },
  { color: '#64748b', label: 'Gray' }
];

const LINE_TYPES = [
  { id: 'solid', label: 'Solid', dasharray: null },
  { id: 'dashed', label: 'Dashed', dasharray: '8,4' },
  { id: 'dotted', label: 'Dotted', dasharray: '2,4' },
  { id: 'dash-dot', label: 'Dash-Dot', dasharray: '8,4,2,4' },
  { id: 'long-dash', label: 'Long Dash', dasharray: '16,8' }
];

// Create initial empty diagram state
const createEmptyDiagram = () => ({
  nodes: [],
  connections: [],
  zones: []
});

// Create a new tab
const createTab = (name = 'Untitled', diagrams = null, fileHandle = null) => ({
  id: genId(),
  name,
  diagrams: diagrams || { root: createEmptyDiagram() },
  currentPath: ['root'],
  fileHandle
});

export default function Nodex() {
  // Tabs state
  const [tabs, setTabs] = useState([createTab('Untitled')]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  
  // Refs to avoid stale closures
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  
  // Get active tab
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  const diagrams = activeTab.diagrams;
  const currentPath = activeTab.currentPath;
  
  // Ref for currentPath
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  
  // Update active tab helper - use functional update to avoid stale closures
  const updateActiveTab = (updates) => {
    setTabs(prevTabs => prevTabs.map(t => t.id === activeTabIdRef.current ? { ...t, ...updates } : t));
  };
  
  // Set diagrams for active tab - use functional update for diagrams too
  const setDiagrams = (newDiagrams) => {
    setTabs(prevTabs => prevTabs.map(t => {
      if (t.id !== activeTabIdRef.current) return t;
      const updatedDiagrams = typeof newDiagrams === 'function' ? newDiagrams(t.diagrams) : newDiagrams;
      return { ...t, diagrams: updatedDiagrams };
    }));
  };
  
  // Set currentPath for active tab
  const setCurrentPath = (newPath) => {
    setTabs(prevTabs => prevTabs.map(t => {
      if (t.id !== activeTabIdRef.current) return t;
      const updatedPath = typeof newPath === 'function' ? newPath(t.currentPath) : newPath;
      return { ...t, currentPath: updatedPath };
    }));
  };
  
  // Current diagram data
  const currentDiagram = diagrams[currentPath.join('/')] || createEmptyDiagram();
  const nodes = currentDiagram.nodes;
  const connections = currentDiagram.connections;
  const zones = currentDiagram.zones;

  // Clipboard state for copy-paste
  const [clipboard, setClipboard] = useState(null);
  const clipboardRef = useRef(null);
  clipboardRef.current = clipboard;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // UI State
  const [showNodeCreator, setShowNodeCreator] = useState(false);
  const [showZoneCreator, setShowZoneCreator] = useState(false);
  const [editingNode, setEditingNode] = useState(null);
  const [editingZone, setEditingZone] = useState(null);
  const [newNodeData, setNewNodeData] = useState({
    label: '',
    description: '',
    iconId: 'server',
    color: '#3b82f6'
  });
  const [newZoneData, setNewZoneData] = useState({
    label: '',
    color: '#3b82f6',
    cells: []
  });
  const [draggingNode, setDraggingNode] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connectingFrom, setConnectingFrom] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedZone, setSelectedZone] = useState(null);
  
  // Refs for selected items to avoid stale closures
  const selectedNodeRef = useRef(null);
  selectedNodeRef.current = selectedNode;
  const selectedZoneRef = useRef(null);
  selectedZoneRef.current = selectedZone;
  
  const [hoveredConnection, setHoveredConnection] = useState(null);
  const [editingConnection, setEditingConnection] = useState(null);
  const [showConnectionEditor, setShowConnectionEditor] = useState(false);
  const [viewOffset, setViewOffset] = useState({ x: 400, y: 300 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [hoveredCell, setHoveredCell] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [isCreatingZone, setIsCreatingZone] = useState(false);
  const [zoneShape, setZoneShape] = useState('rectangle'); // 'rectangle', 'hexagon', or 'circular'
  const [zoneSelectionStart, setZoneSelectionStart] = useState(null);
  const [selectedZoneCells, setSelectedZoneCells] = useState([]);
  const [zoneRadius, setZoneRadius] = useState(2);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  // Autosave + project file link
  const [autosave, setAutosave] = useState(false);
  const [projectHandle, setProjectHandle] = useState(null);
  const projectHandleRef = useRef(null);
  projectHandleRef.current = projectHandle;

  // Update canvas size on mount and resize
  useEffect(() => {
    const updateSize = () => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        setCanvasSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Autosave: after any change settles for a second, write every linked
  // on-device file (project file and/or per-tab files). No-op until a file
  // has been linked via Save / Save Project.
  useEffect(() => {
    if (!autosave) return;
    const timer = setTimeout(async () => {
      try {
        if (projectHandleRef.current) {
          await writeToHandle(projectHandleRef.current, getProjectData());
        }
        for (const t of tabsRef.current) {
          if (t.fileHandle) {
            await writeToHandle(t.fileHandle, {
              version: 1,
              name: t.name,
              diagrams: t.diagrams,
              currentPath: t.currentPath
            });
          }
        }
      } catch (err) {
        console.warn('Autosave failed:', err);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [autosave, tabs]);

  // Calculate dynamic grid bounds to fill viewport and include content
  const getGridBounds = () => {
    // Calculate viewport bounds in hex coordinates
    const padding = 2;
    const topLeft = pixelToAxial(-viewOffset.x / zoom - HEX_SIZE * padding, -viewOffset.y / zoom - HEX_SIZE * padding);
    const bottomRight = pixelToAxial((canvasSize.width - viewOffset.x) / zoom + HEX_SIZE * padding, (canvasSize.height - viewOffset.y) / zoom + HEX_SIZE * padding);
    
    let minQ = Math.floor(topLeft.q) - padding;
    let maxQ = Math.ceil(bottomRight.q) + padding;
    let minR = Math.floor(topLeft.r) - padding;
    let maxR = Math.ceil(bottomRight.r) + padding;
    
    // Expand based on nodes
    nodes.forEach(n => {
      minQ = Math.min(minQ, n.q - 2);
      maxQ = Math.max(maxQ, n.q + 2);
      minR = Math.min(minR, n.r - 2);
      maxR = Math.max(maxR, n.r + 2);
    });
    
    // Expand based on zones
    zones.forEach(z => {
      z.cells.forEach(c => {
        minQ = Math.min(minQ, c.q - 2);
        maxQ = Math.max(maxQ, c.q + 2);
        minR = Math.min(minR, c.r - 2);
        maxR = Math.max(maxR, c.r + 2);
      });
    });
    
    // Expand based on current zone selection
    selectedZoneCells.forEach(c => {
      minQ = Math.min(minQ, c.q - 2);
      maxQ = Math.max(maxQ, c.q + 2);
      minR = Math.min(minR, c.r - 2);
      maxR = Math.max(maxR, c.r + 2);
    });
    
    // Expand based on dragging node
    if (draggingNode) {
      const node = nodes.find(n => n.id === draggingNode.id);
      if (node) {
        minQ = Math.min(minQ, node.q - 3);
        maxQ = Math.max(maxQ, node.q + 3);
        minR = Math.min(minR, node.r - 3);
        maxR = Math.max(maxR, node.r + 3);
      }
    }
    
    // Expand based on hovered cell
    if (hoveredCell) {
      minQ = Math.min(minQ, hoveredCell.q - 2);
      maxQ = Math.max(maxQ, hoveredCell.q + 2);
      minR = Math.min(minR, hoveredCell.r - 2);
      maxR = Math.max(maxR, hoveredCell.r + 2);
    }
    
    return { minQ, maxQ, minR, maxR };
  };

  const gridBounds = getGridBounds();

  // Tab management
  const addTab = (name = 'Untitled', diagrams = null, fileHandle = null) => {
    const newTab = createTab(name, diagrams, fileHandle);
    setTabs([...tabs, newTab]);
    setActiveTabId(newTab.id);
    setSelectedNode(null);
    setSelectedZone(null);
    setViewOffset({ x: 400, y: 300 });
    setZoom(1);
  };

  const closeTab = (tabId) => {
    if (tabs.length === 1) {
      // Don't close the last tab, just replace it with a fresh one
      const fresh = createTab('Untitled');
      setTabs([fresh]);
      setActiveTabId(fresh.id);
      return;
    }
    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);
    if (activeTabId === tabId) {
      setActiveTabId(newTabs[0].id);
    }
  };

  const renameTab = (tabId, newName) => {
    setTabs(tabs.map(t => t.id === tabId ? { ...t, name: newName } : t));
  };

  // File operations
  const FILE_PICKER_TYPES = [{
    description: 'Nodex diagram',
    accept: { 'application/json': ['.json'] }
  }];

  const getSaveData = () => {
    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current) || tabsRef.current[0];
    return {
      version: 1,
      name: tab.name,
      diagrams: tab.diagrams,
      currentPath: tab.currentPath
    };
  };

  const suggestedFileName = () => {
    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current) || tabsRef.current[0];
    return `${tab.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'nodex-diagram'}.json`;
  };

  const writeToHandle = async (handle, data) => {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  };

  const downloadJson = (data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedFileName();
    a.click();
    URL.revokeObjectURL(url);
  };

  // Save: writes back to the tab's on-device file when one is linked,
  // otherwise prompts for a location (File System Access API) and links it.
  // Falls back to a plain download in browsers without the API.
  const saveToFile = async () => {
    const data = getSaveData();
    const tab = tabsRef.current.find(t => t.id === activeTabIdRef.current);

    if (tab?.fileHandle) {
      try {
        await writeToHandle(tab.fileHandle, data);
        return;
      } catch (err) {
        if (err.name === 'AbortError' || err.name === 'NotAllowedError') return;
        // Handle went bad (file moved/deleted) — fall through to re-pick
      }
    }

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: suggestedFileName(),
          types: FILE_PICKER_TYPES
        });
        await writeToHandle(handle, data);
        setTabs(prevTabs => prevTabs.map(t =>
          t.id === activeTabIdRef.current ? { ...t, fileHandle: handle } : t
        ));
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    downloadJson(data);
  };

  // Project = every open tab in a single file
  const getProjectData = () => ({
    version: 2,
    type: 'nodex-project',
    tabs: tabsRef.current.map(t => ({
      name: t.name,
      diagrams: t.diagrams,
      currentPath: t.currentPath
    }))
  });

  const saveProject = async () => {
    const data = getProjectData();

    if (projectHandleRef.current) {
      try {
        await writeToHandle(projectHandleRef.current, data);
        return;
      } catch (err) {
        if (err.name === 'AbortError' || err.name === 'NotAllowedError') return;
        // Handle went bad — fall through to re-pick
      }
    }

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'nodex-project.json',
          types: FILE_PICKER_TYPES
        });
        await writeToHandle(handle, data);
        setProjectHandle(handle);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nodex-project.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // A workspace we can silently replace: one unlinked tab with nothing drawn
  const isPristineWorkspace = (tabList) =>
    tabList.length === 1 &&
    !tabList[0].fileHandle &&
    Object.values(tabList[0].diagrams).every(
      d => d.nodes.length === 0 && d.connections.length === 0 && d.zones.length === 0
    );

  const loadFileData = (data, fileName, fileHandle = null) => {
    // Project file: restore all tabs
    if (Array.isArray(data.tabs)) {
      const newTabs = data.tabs
        .filter(t => t && t.diagrams)
        .map(t => ({
          ...createTab(t.name || 'Untitled', t.diagrams),
          currentPath: Array.isArray(t.currentPath) && t.currentPath.length > 0 ? t.currentPath : ['root']
        }));
      if (newTabs.length === 0) {
        alert('Failed to load file: project contains no diagrams');
        return;
      }
      setTabs(prevTabs => isPristineWorkspace(prevTabs) ? newTabs : [...prevTabs, ...newTabs]);
      setActiveTabId(newTabs[0].id);
      setSelectedNode(null);
      setSelectedZone(null);
      setViewOffset({ x: 400, y: 300 });
      setZoom(1);
      if (fileHandle) setProjectHandle(fileHandle);
      return;
    }

    // Single-diagram file: open as a new tab
    if (data.diagrams) {
      const name = data.name || fileName?.replace('.json', '') || 'Imported';
      addTab(name, data.diagrams, fileHandle);
      // Update path after tab is created
      setTimeout(() => {
        setCurrentPath(data.currentPath || ['root']);
      }, 0);
    } else {
      alert('Failed to load file: not a Nodex diagram');
    }
  };

  // Open: uses the File System Access API when available so the tab stays
  // linked to the on-device file (Save then writes straight back to it)
  const openFromDevice = async () => {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: FILE_PICKER_TYPES,
          multiple: false
        });
        const file = await handle.getFile();
        const data = JSON.parse(await file.text());
        loadFileData(data, file.name, handle);
      } catch (err) {
        if (err.name !== 'AbortError') alert('Failed to load file: Invalid format');
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const openFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        loadFileData(data, file.name);
      } catch (err) {
        alert('Failed to load file: Invalid format');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Drag and drop file handling — only react to actual files being dragged
  // in; dragging selected text/nodes must not trigger the drop overlay
  const isFileDrag = (e) => {
    const types = e.dataTransfer?.types;
    return types && Array.from(types).includes('Files');
  };

  const handleFileDragOver = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleFileDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      alert('Please drop a .json file');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        loadFileData(data, file.name);
      } catch (err) {
        alert('Failed to load file: Invalid format');
      }
    };
    reader.readAsText(file);
  };

  // Bounding box (world coordinates) of everything in the current diagram —
  // exports must cover all content, not just what's scrolled into view
  const getContentBounds = () => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const include = (x, y, pad) => {
      minX = Math.min(minX, x - pad);
      maxX = Math.max(maxX, x + pad);
      minY = Math.min(minY, y - pad);
      maxY = Math.max(maxY, y + pad);
    };

    nodes.forEach(n => {
      const p = axialToPixel(n.q, n.r);
      include(p.x, p.y, HEX_SIZE);
      // Label below the hexagon — generous width since text size is unknown here
      include(p.x, p.y + HEX_SIZE + 22, 8 + n.label.length * 4);
    });
    zones.forEach(z => z.cells.forEach(c => {
      const p = axialToPixel(c.q, c.r);
      include(p.x, p.y, HEX_SIZE);
    }));

    if (minX === Infinity) return null;
    const margin = 30;
    return {
      x: minX - margin,
      y: minY - margin,
      width: maxX - minX + margin * 2,
      height: maxY - minY + margin * 2
    };
  };

  // Clone the live SVG into a standalone document: proper namespace, sized to
  // the full content bounds, dark background baked in, and lucide icons
  // pulled out of their <foreignObject> wrappers (foreignObject HTML doesn't
  // render outside the app because it relies on Tailwind classes/XHTML)
  const prepareExportSvg = () => {
    const svgElement = canvasRef.current?.querySelector('svg');
    const bounds = getContentBounds();
    if (!svgElement || !bounds) return null;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const clone = svgElement.cloneNode(true);
    clone.setAttribute('xmlns', SVG_NS);
    clone.removeAttribute('class');
    clone.setAttribute('width', Math.ceil(bounds.width));
    clone.setAttribute('height', Math.ceil(bounds.height));
    clone.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
    clone.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');

    // Neutralize the pan/zoom transform — the viewBox does the framing now
    const rootGroup = clone.querySelector('g');
    if (rootGroup) rootGroup.removeAttribute('transform');

    // Background
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', bounds.x);
    bg.setAttribute('y', bounds.y);
    bg.setAttribute('width', bounds.width);
    bg.setAttribute('height', bounds.height);
    bg.setAttribute('fill', '#0f172a');
    clone.insertBefore(bg, clone.firstChild);

    // Replace each foreignObject with the lucide <svg> it wraps, centered in
    // the same box, so icons render in standalone SVG/PNG output
    clone.querySelectorAll('foreignObject').forEach(fo => {
      const innerSvg = fo.querySelector('svg');
      if (!innerSvg) {
        fo.remove();
        return;
      }
      const foX = parseFloat(fo.getAttribute('x')) || 0;
      const foY = parseFloat(fo.getAttribute('y')) || 0;
      const foW = parseFloat(fo.getAttribute('width')) || 0;
      const foH = parseFloat(fo.getAttribute('height')) || 0;
      const iconW = parseFloat(innerSvg.getAttribute('width')) || 24;
      const iconH = parseFloat(innerSvg.getAttribute('height')) || 24;
      const icon = innerSvg.cloneNode(true);
      icon.setAttribute('x', foX + (foW - iconW) / 2);
      icon.setAttribute('y', foY + (foH - iconH) / 2);
      icon.removeAttribute('class');
      fo.replaceWith(icon);
    });

    return {
      svgString: new XMLSerializer().serializeToString(clone),
      width: Math.ceil(bounds.width),
      height: Math.ceil(bounds.height)
    };
  };

  const exportFileName = (ext) =>
    `${activeTab.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'nodex-diagram'}.${ext}`;

  const exportAsSVG = () => {
    const prepared = prepareExportSvg();
    if (!prepared) {
      alert('Nothing to export — the diagram is empty');
      return;
    }
    const blob = new Blob([prepared.svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName('svg');
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAsPNG = () => {
    const prepared = prepareExportSvg();
    if (!prepared) {
      alert('Nothing to export — the diagram is empty');
      return;
    }

    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = prepared.width * scale;
    canvas.height = prepared.height * scale;
    const ctx = canvas.getContext('2d');

    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = exportFileName('png');
      a.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(prepared.svgString)));
  };

  const newDiagram = () => {
    addTab('Untitled');
  };

  // Copy-paste functionality — read through refs so the keyboard shortcut
  // handler (registered once) never operates on stale state
  const copyNode = () => {
    const node = selectedNodeRef.current;
    if (node) {
      setClipboard({ type: 'node', data: { ...node } });
    }
  };

  const pasteNode = () => {
    const clip = clipboardRef.current;
    if (!clip || clip.type !== 'node') return;

    const nodeData = clip.data;
    const currentNodes = nodesRef.current;

    // Find a non-overlapping position, spiralling outward ring by ring
    let newQ = nodeData.q + 1;
    let newR = nodeData.r;
    const directions = [
      { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 },
      { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }
    ];
    outer:
    for (let ring = 1; ring <= 10; ring++) {
      for (const dir of directions) {
        const q = nodeData.q + dir.q * ring;
        const r = nodeData.r + dir.r * ring;
        if (!currentNodes.some(n => n.q === q && n.r === r)) {
          newQ = q;
          newR = r;
          break outer;
        }
      }
    }

    const newNode = {
      ...nodeData,
      id: genId(),
      q: newQ,
      r: newR,
      label: `${nodeData.label} (copy)`
    };

    setNodes(prev => [...prev, newNode]);
    setSelectedNode(newNode);
  };

  // Zoom controls
  const zoomIn = () => setZoom(prev => Math.min(prev * 1.2, 3));
  const zoomOut = () => setZoom(prev => Math.max(prev / 1.2, 0.3));
  const resetView = () => {
    setZoom(1);
    setViewOffset({ x: canvasSize.width / 2, y: canvasSize.height / 2 });
  };

  // Helper to update current diagram — reads path via ref and previous state
  // via the functional updater so it's safe to call from event handlers and
  // keyboard shortcuts without capturing stale state
  const updateCurrentDiagram = (updates) => {
    const path = currentPathRef.current.join('/');
    setDiagrams(prev => {
      const diag = prev[path] || createEmptyDiagram();
      return { ...prev, [path]: { ...diag, ...updates } };
    });
  };

  const setDiagramField = (field, value) => {
    const path = currentPathRef.current.join('/');
    setDiagrams(prev => {
      const diag = prev[path] || createEmptyDiagram();
      const next = typeof value === 'function' ? value(diag[field]) : value;
      return { ...prev, [path]: { ...diag, [field]: next } };
    });
  };

  const setNodes = (newNodes) => setDiagramField('nodes', newNodes);
  const setConnections = (newConnections) => setDiagramField('connections', newConnections);
  const setZones = (newZones) => setDiagramField('zones', newZones);

  // Navigation
  const navigateToNode = (node) => {
    const newPath = [...currentPath, node.id.toString()];
    const pathKey = newPath.join('/');
    
    // Create diagram if it doesn't exist
    if (!diagrams[pathKey]) {
      setDiagrams(prev => ({
        ...prev,
        [pathKey]: createEmptyDiagram()
      }));
    }
    
    setCurrentPath(newPath);
    setSelectedNode(null);
    setSelectedZone(null);
    setViewOffset({ x: 400, y: 300 });
  };

  const navigateUp = (index) => {
    setCurrentPath(currentPath.slice(0, index + 1));
    setSelectedNode(null);
    setSelectedZone(null);
  };

  // Get breadcrumb labels
  const getBreadcrumbs = () => {
    const crumbs = [{ label: 'Root', index: 0 }];
    
    for (let i = 1; i < currentPath.length; i++) {
      const nodeId = parseInt(currentPath[i]);
      const parentPath = currentPath.slice(0, i).join('/');
      const parentDiagram = diagrams[parentPath];
      const node = parentDiagram?.nodes.find(n => n.id === nodeId);
      crumbs.push({
        label: node?.label || `Node ${nodeId}`,
        index: i
      });
    }
    
    return crumbs;
  };

  const resetNodeForm = () => {
    setNewNodeData({
      label: '',
      description: '',
      iconId: 'server',
      color: '#3b82f6'
    });
    setEditingNode(null);
  };

  const openNodeCreator = (q = null, r = null) => {
    resetNodeForm();
    setShowNodeCreator(true);
    if (q !== null && r !== null) {
      setNewNodeData(prev => ({ ...prev, presetCoords: { q, r } }));
    }
  };

  const openNodeEditor = (node) => {
    setNewNodeData({
      label: node.label,
      description: node.description || '',
      iconId: node.iconId,
      color: node.color
    });
    setEditingNode(node);
    setShowNodeCreator(true);
  };

  const createOrUpdateNode = () => {
    if (!newNodeData.label.trim()) return;

    if (editingNode) {
      setNodes(nodes.map(n => 
        n.id === editingNode.id 
          ? { ...n, label: newNodeData.label, description: newNodeData.description, iconId: newNodeData.iconId, color: newNodeData.color }
          : n
      ));
    } else {
      const coords = newNodeData.presetCoords || { q: 0, r: 0 };
      const newNode = {
        id: genId(),
        label: newNodeData.label,
        description: newNodeData.description,
        iconId: newNodeData.iconId,
        color: newNodeData.color,
        q: coords.q,
        r: coords.r
      };
      setNodes([...nodes, newNode]);
    }

    setShowNodeCreator(false);
    resetNodeForm();
  };

  // Zone functions
  const startZoneCreation = () => {
    setIsCreatingZone(true);
    setSelectedZoneCells([]);
    setZoneSelectionStart(null);
    setSelectedNode(null);
    setSelectedZone(null);
  };

  const cancelZoneCreation = () => {
    setIsCreatingZone(false);
    setSelectedZoneCells([]);
    setZoneSelectionStart(null);
  };

  const openZoneEditor = (zone) => {
    setNewZoneData({
      label: zone.label,
      color: zone.color,
      cells: zone.cells
    });
    setEditingZone(zone);
    setShowZoneCreator(true);
  };

  const finishZoneCreation = () => {
    if (selectedZoneCells.length > 0) {
      setNewZoneData({
        label: '',
        color: '#3b82f6',
        cells: selectedZoneCells
      });
      setShowZoneCreator(true);
    }
  };

  const createOrUpdateZone = () => {
    if (editingZone) {
      setZones(zones.map(z => 
        z.id === editingZone.id 
          ? { ...z, label: newZoneData.label, color: newZoneData.color, cells: newZoneData.cells }
          : z
      ));
    } else {
      const newZone = {
        id: genId(),
        label: newZoneData.label,
        color: newZoneData.color,
        cells: selectedZoneCells
      };
      setZones([...zones, newZone]);
    }

    setShowZoneCreator(false);
    setIsCreatingZone(false);
    setSelectedZoneCells([]);
    setNewZoneData({ label: '', color: '#3b82f6', cells: [] });
    setEditingZone(null);
  };

  const deleteZone = (zoneId) => {
    const pathKey = currentPathRef.current.join('/');
    setDiagrams(prev => {
      const currentDiag = prev[pathKey] || { nodes: [], connections: [], zones: [] };
      return {
        ...prev,
        [pathKey]: {
          ...currentDiag,
          zones: currentDiag.zones.filter(z => z.id !== zoneId)
        }
      };
    });
    setSelectedZone(null);
  };

  const handleCanvasMouseDown = (e) => {
    if (e.target.closest('.node-element')) return;

    if (e.button === 1 || (e.button === 0 && e.shiftKey && !isCreatingZone)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - viewOffset.x, y: e.clientY - viewOffset.y });
      e.preventDefault();
    } else if (isCreatingZone && e.button === 0) {
      const rect = canvasRef.current.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const worldX = (screenX - viewOffset.x) / zoom;
      const worldY = (screenY - viewOffset.y) / zoom;
      const { q, r } = pixelToAxial(worldX, worldY);
      
      setZoneSelectionStart({ q, r });
    } else {
      setSelectedNode(null);
      setSelectedZone(null);
      setConnectingFrom(null);
    }
  };

  const handleCanvasMouseMove = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldX = (screenX - viewOffset.x) / zoom;
    const worldY = (screenY - viewOffset.y) / zoom;
    
    setMousePos({ x: worldX, y: worldY });

    // Zone selection drag
    if (isCreatingZone && zoneSelectionStart) {
      const { q, r } = pixelToAxial(worldX, worldY);
      let cells = [];

      if (zoneShape === 'rectangle') {
        const minQ = Math.min(zoneSelectionStart.q, q);
        const maxQ = Math.max(zoneSelectionStart.q, q);
        const minR = Math.min(zoneSelectionStart.r, r);
        const maxR = Math.max(zoneSelectionStart.r, r);

        for (let qi = minQ; qi <= maxQ; qi++) {
          for (let ri = minR; ri <= maxR; ri++) {
            cells.push({ q: qi, r: ri });
          }
        }
      } else if (zoneShape === 'hexagon') {
        // Hex-shaped zone: first click = center, drag outward to set radius
        const cq = zoneSelectionStart.q;
        const cr = zoneSelectionStart.r;
        const radius = Math.max(1, hexDistance(cq, cr, q, r));
        setZoneRadius(radius);
        cells = buildHexRingCells(cq, cr, radius);
      } else if (zoneShape === 'circular') {
        // Round zone: first click = center, drag outward to set radius —
        // cells are picked by Euclidean distance so the result is a circle,
        // not a bigger hexagon
        const cq = zoneSelectionStart.q;
        const cr = zoneSelectionStart.r;
        const radius = Math.max(1, hexDistance(cq, cr, q, r));
        setZoneRadius(radius);
        cells = buildCircularCells(cq, cr, radius);
      }
      setSelectedZoneCells(cells);
    }

    // Check hover over empty cells (skip if hovering a connection)
    if (!draggingNode && !isPanning && !connectingFrom && !isCreatingZone && !hoveredConnection) {
      const { q, r } = pixelToAxial(worldX, worldY);
      const hasNode = nodes.some(n => n.q === q && n.r === r);
      
      if (!hasNode) {
        setHoveredCell({ q, r });
      } else {
        setHoveredCell(null);
      }
    } else {
      setHoveredCell(null);
    }

    if (isPanning) {
      setViewOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    } else if (draggingNode) {
      const { q, r } = pixelToAxial(worldX - dragOffset.x, worldY - dragOffset.y);
      setNodes(nodes.map(n => 
        n.id === draggingNode.id ? { ...n, q, r } : n
      ));
    }
  };

  const handleCanvasMouseLeave = () => {
    setHoveredCell(null);
    setHoveredConnection(null);
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
    setDraggingNode(null);
    
    if (isCreatingZone && zoneSelectionStart && selectedZoneCells.length > 0) {
      finishZoneCreation();
    }
    setZoneSelectionStart(null);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.min(Math.max(prev * delta, 0.3), 3));
  };

  const handleNodeMouseDown = (e, node) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Stop the browser starting a text selection — otherwise dragging a node
    // selects labels, and double-click selects the node's label text
    e.preventDefault();

    // Shift+click to navigate into nested diagram
    if (e.shiftKey) {
      navigateToNode(node);
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldX = (screenX - viewOffset.x) / zoom;
    const worldY = (screenY - viewOffset.y) / zoom;
    const nodePos = axialToPixel(node.q, node.r);
    
    setDragOffset({
      x: worldX - nodePos.x,
      y: worldY - nodePos.y
    });
    setDraggingNode(node);
    setSelectedNode(node);
    setSelectedZone(null);
    setHoveredCell(null);
  };

  const handleNodeClick = (e, node) => {
    e.stopPropagation();
    if (connectingFrom) {
      if (connectingFrom.id !== node.id) {
        const connectionExists = connections.some(
          c => (c.from === connectingFrom.id && c.to === node.id) ||
               (c.from === node.id && c.to === connectingFrom.id)
        );
        if (!connectionExists) {
          const newConnection = {
            id: genId(),
            from: connectingFrom.id, 
            to: node.id,
            label: '',
            iconId: null,
            rotation: 0,
            lineType: 'solid'
          };
          setConnections([...connections, newConnection]);
          // Open editor for new connection
          setEditingConnection(newConnection);
          setShowConnectionEditor(true);
        }
      }
      setConnectingFrom(null);
    }
  };

  const handleNodeDoubleClick = (e, node) => {
    e.stopPropagation();
    // Set initial mouse position to node position so the line doesn't jump to (0,0)
    const nodePos = axialToPixel(node.q, node.r);
    setMousePos({ x: nodePos.x, y: nodePos.y });
    setConnectingFrom(node);
  };

  const handleZoneClick = (e, zone) => {
    e.stopPropagation();
    setSelectedZone(zone);
    setSelectedNode(null);
  };

  const deleteSelectedNode = () => {
    const node = selectedNodeRef.current;
    if (!node) return;
    
    const pathKey = currentPathRef.current.join('/');
    const nestedPathKey = [...currentPathRef.current, node.id.toString()].join('/');
    
    setDiagrams(prev => {
      const currentDiag = prev[pathKey] || { nodes: [], connections: [], zones: [] };
      const newDiagrams = {
        ...prev,
        [pathKey]: {
          ...currentDiag,
          nodes: currentDiag.nodes.filter(n => n.id !== node.id),
          connections: currentDiag.connections.filter(c => c.from !== node.id && c.to !== node.id)
        }
      };
      delete newDiagrams[nestedPathKey];
      return newDiagrams;
    });
    
    setSelectedNode(null);
  };

  const deleteConnection = (connectionId) => {
    setConnections(connections.filter(c => c.id !== connectionId));
  };

  const clearAll = () => {
    updateCurrentDiagram(createEmptyDiagram());
    setSelectedNode(null);
    setSelectedZone(null);
    setConnectingFrom(null);
  };

  // Check if node has nested content
  const hasNestedDiagram = (nodeId) => {
    const pathKey = [...currentPath, nodeId.toString()].join('/');
    const diagram = diagrams[pathKey];
    return diagram && (diagram.nodes.length > 0 || diagram.zones.length > 0);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Save (Ctrl+S = active tab, Ctrl+Shift+S = whole project)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          saveProject();
        } else {
          saveToFile();
        }
        return;
      }
      // Copy-paste — skip when typing in a field
      const inField = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedNodeRef.current && !showNodeCreator && !showZoneCreator && !inField) {
        e.preventDefault();
        copyNode();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboardRef.current && !showNodeCreator && !showZoneCreator && !inField) {
        e.preventDefault();
        pasteNode();
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && !showNodeCreator && !showZoneCreator && !showConnectionEditor) {
        // Don't prevent default if we're in an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        if (selectedNodeRef.current) {
          deleteSelectedNode();
        } else if (selectedZoneRef.current) {
          deleteZone(selectedZoneRef.current.id);
        }
      }
      if (e.key === 'Escape') {
        setConnectingFrom(null);
        setSelectedNode(null);
        setSelectedZone(null);
        if (showNodeCreator) {
          setShowNodeCreator(false);
          resetNodeForm();
        }
        if (showZoneCreator) {
          setShowZoneCreator(false);
          setEditingZone(null);
        }
        if (showConnectionEditor) {
          setShowConnectionEditor(false);
          setEditingConnection(null);
        }
        if (isCreatingZone) {
          cancelZoneCreation();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showNodeCreator, showZoneCreator, showConnectionEditor, isCreatingZone, clipboard]);

  const gridHexagons = [];
  for (let q = gridBounds.minQ; q <= gridBounds.maxQ; q++) {
    for (let r = gridBounds.minR; r <= gridBounds.maxR; r++) {
      const { x, y } = axialToPixel(q, r);
      gridHexagons.push({ q, r, x, y });
    }
  }

  // Get zone for a cell
  const getZoneForCell = (q, r) => {
    return zones.find(z => z.cells.some(c => c.q === q && c.r === r));
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white">
      {/* Toolbar */}
      <div className="h-12 bg-slate-800 border-b border-slate-700 flex items-center px-2 gap-1 shrink-0">
        {/* File operations */}
        <div className="flex items-center gap-1 pr-2 border-r border-slate-600">
          <button
            onClick={newDiagram}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title="New Diagram"
          >
            <FilePlus size={18} />
          </button>
          <button
            onClick={openFromDevice}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title="Open File"
          >
            <FolderOpen size={18} />
          </button>
          <button
            onClick={saveToFile}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title={activeTab.fileHandle ? `Save to ${activeTab.fileHandle.name} (Ctrl+S)` : 'Save Tab (Ctrl+S)'}
          >
            <Save size={18} />
          </button>
          <button
            onClick={saveProject}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title={projectHandle ? `Save project to ${projectHandle.name} (Ctrl+Shift+S)` : 'Save Project — all tabs in one file (Ctrl+Shift+S)'}
          >
            <Archive size={18} />
          </button>
          <button
            onClick={() => setAutosave(a => !a)}
            className={`p-2 rounded transition-colors text-xs flex items-center gap-1 ${
              autosave
                ? 'bg-emerald-700 text-white hover:bg-emerald-600'
                : 'hover:bg-slate-700 text-slate-400'
            }`}
            title={autosave
              ? 'Autosave on — linked files are written automatically after each change'
              : 'Autosave off — click to enable (link a file with Save or Save Project first)'}
          >
            <Clock size={16} />
            <span>Auto</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={openFile}
            className="hidden"
          />
        </div>

        {/* Export */}
        <div className="flex items-center gap-1 pr-2 border-r border-slate-600">
          <button
            onClick={exportAsSVG}
            className="p-2 hover:bg-slate-700 rounded transition-colors text-xs flex items-center gap-1"
            title="Export as SVG"
          >
            <Download size={16} />
            <span>SVG</span>
          </button>
          <button
            onClick={exportAsPNG}
            className="p-2 hover:bg-slate-700 rounded transition-colors text-xs flex items-center gap-1"
            title="Export as PNG"
          >
            <Download size={16} />
            <span>PNG</span>
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1 pr-2 border-r border-slate-600">
          <button
            onClick={zoomOut}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title="Zoom Out"
          >
            <ZoomOut size={18} />
          </button>
          <span className="text-xs w-12 text-center">{(zoom * 100).toFixed(0)}%</span>
          <button
            onClick={zoomIn}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title="Zoom In"
          >
            <ZoomIn size={18} />
          </button>
          <button
            onClick={resetView}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title="Reset View"
          >
            <Maximize size={18} />
          </button>
        </div>

        {/* Edit operations */}
        <div className="flex items-center gap-1 pr-2 border-r border-slate-600">
          <button
            onClick={() => openNodeCreator()}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
            title="Add Node"
          >
            <Plus size={18} />
          </button>
          <button
            onClick={copyNode}
            disabled={!selectedNode}
            className="p-2 hover:bg-slate-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Copy Node (Ctrl+C)"
          >
            <Copy size={18} />
          </button>
          <button
            onClick={pasteNode}
            disabled={!clipboard}
            className="p-2 hover:bg-slate-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Paste Node (Ctrl+V)"
          >
            <Clipboard size={18} />
          </button>
          <button
            onClick={deleteSelectedNode}
            disabled={!selectedNode}
            className="p-2 hover:bg-slate-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Delete Selected"
          >
            <Trash2 size={18} />
          </button>
        </div>

        {/* Breadcrumb in toolbar */}
        {currentPath.length > 1 && (
          <div className="flex items-center gap-1 ml-2 text-sm">
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRight size={14} className="text-slate-500" />}
                <button
                  onClick={() => navigateUp(crumb.index)}
                  className={`px-2 py-1 rounded hover:bg-slate-700 transition-colors ${
                    i === breadcrumbs.length - 1 ? 'text-blue-400 font-medium' : 'text-slate-300'
                  }`}
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Status info on right */}
        <div className="ml-auto flex items-center gap-4 text-xs text-slate-400">
          <span>Nodes: {nodes.length}</span>
          <span>Connections: {connections.length}</span>
          <span>Zones: {zones.length}</span>
          {connectingFrom && (
            <span className="text-amber-400">Connecting from: {connectingFrom.label}</span>
          )}
          {clipboard && (
            <span className="text-green-400">Copied: {clipboard.data?.label}</span>
          )}
        </div>
      </div>

      {/* Tabs bar */}
      <div className="h-9 bg-slate-850 border-b border-slate-700 flex items-center px-1 gap-1 shrink-0 overflow-x-auto scrollbar-thin"
           style={{ backgroundColor: '#1a2332' }}>
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-t text-sm cursor-pointer group ${
              tab.id === activeTabId
                ? 'bg-slate-800 text-white'
                : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
            onClick={() => setActiveTabId(tab.id)}
          >
            <span
              className="max-w-32 truncate"
              title={tab.fileHandle ? `Linked to ${tab.fileHandle.name}` : tab.name}
              onDoubleClick={(e) => {
                e.stopPropagation();
                const newName = prompt('Rename tab:', tab.name);
                if (newName) renameTab(tab.id, newName);
              }}
            >
              {tab.fileHandle && <span className="text-emerald-400 mr-1">●</span>}
              {tab.name}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="ml-1 p-0.5 rounded hover:bg-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <button
          onClick={() => addTab('Untitled')}
          className="p-1.5 hover:bg-slate-700 rounded transition-colors text-slate-400 hover:text-white"
          title="New Tab"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 bg-slate-800 p-4 border-r border-slate-700 overflow-y-auto scrollbar-thin">
        <h2 className="text-xl font-bold mb-4">Nodex</h2>
        
        <button
          onClick={() => openNodeCreator()}
          className="w-full flex items-center justify-center gap-2 p-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors mb-2"
        >
          <Plus size={20} />
          Create Node
        </button>

        {!isCreatingZone ? (
          <div className="mb-6">
            <p className="text-xs text-slate-400 mb-2">Create Zone</p>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => {
                  setZoneShape('rectangle');
                  startZoneCreation();
                }}
                className="flex-1 flex items-center justify-center gap-1 p-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors text-sm"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="2" width="12" height="12" rx="1" />
                </svg>
                Rect
              </button>
              <button
                onClick={() => {
                  setZoneShape('hexagon');
                  startZoneCreation();
                }}
                className="flex-1 flex items-center justify-center gap-1 p-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors text-sm"
              >
                <Hexagon size={14} />
                Hex
              </button>
              <button
                onClick={() => {
                  setZoneShape('circular');
                  startZoneCreation();
                }}
                className="flex-1 flex items-center justify-center gap-1 p-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors text-sm"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="8" cy="8" r="6" />
                </svg>
                Circle
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={cancelZoneCreation}
            className="w-full flex items-center justify-center gap-2 p-3 bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors mb-6"
          >
            <X size={20} />
            Cancel Zone Selection
          </button>
        )}

        {isCreatingZone && (
          <div className="mb-4 p-3 bg-amber-900/30 border border-amber-600 rounded-lg text-sm">
            <p className="text-amber-200 font-medium mb-1">
              {zoneShape === 'rectangle' ? 'Rectangle' : zoneShape === 'hexagon' ? 'Hexagon' : 'Circular'} Zone Mode
            </p>
            <p className="text-amber-300/80 text-xs">
              {zoneShape === 'rectangle'
                ? 'Click and drag to select a rectangular area.'
                : zoneShape === 'hexagon'
                ? 'Click the center, drag outward — hex-shaped zone.'
                : 'Click the center, drag outward — round zone.'}
            </p>
            {(zoneShape === 'hexagon' || zoneShape === 'circular') && selectedZoneCells.length > 0 && (
              <p className="text-amber-200 text-xs mt-1">Size: {zoneRadius}</p>
            )}
          </div>
        )}

        <div className="mb-6 pt-4 border-t border-slate-700">
          <h3 className="text-sm font-semibold mb-3 text-slate-400">Shortcuts</h3>
          <ul className="text-xs space-y-1 text-slate-300">
            <li><kbd className="px-1 bg-slate-600 rounded">Ctrl+C</kbd> Copy node</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Ctrl+V</kbd> Paste node</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Ctrl+S</kbd> Save tab</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Ctrl+Shift+S</kbd> Save project</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Shift+Click</kbd> Open nested diagram</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Double-click</kbd> Start connecting</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Delete</kbd> Remove selected</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Scroll</kbd> Zoom in/out</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Shift+Drag</kbd> Pan canvas</li>
            <li><kbd className="px-1 bg-slate-600 rounded">Esc</kbd> Cancel action</li>
          </ul>
        </div>

        {selectedNode && (
          <div className="mb-4 p-4 bg-slate-700 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-semibold">Selected Node</h3>
              <button
                onClick={() => openNodeEditor(selectedNode)}
                className="text-blue-400 hover:text-blue-300"
              >
                <Edit2 size={16} />
              </button>
            </div>
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2">
                {React.createElement(
                  AVAILABLE_ICONS.find(i => i.id === selectedNode.iconId)?.icon || Server,
                  { size: 20, style: { color: selectedNode.color } }
                )}
                <p className="font-medium">{selectedNode.label}</p>
                {hasNestedDiagram(selectedNode.id) && (
                  <span className="text-xs bg-blue-600 px-1.5 py-0.5 rounded">Has children</span>
                )}
              </div>
              {selectedNode.description && (
                <p className="text-xs text-slate-300 mb-2">{selectedNode.description}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => navigateToNode(selectedNode)}
                className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors"
              >
                Open Diagram
              </button>
              <button
                onClick={deleteSelectedNode}
                className="px-3 py-1.5 bg-red-500 hover:bg-red-600 rounded text-sm transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        )}

        {selectedZone && (
          <div className="mb-4 p-4 bg-slate-700 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-sm font-semibold">Selected Zone</h3>
              <button
                onClick={() => openZoneEditor(selectedZone)}
                className="text-blue-400 hover:text-blue-300"
              >
                <Edit2 size={16} />
              </button>
            </div>
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2">
                <div 
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: selectedZone.color }}
                />
                <p className="font-medium">{selectedZone.label}</p>
              </div>
              <p className="text-xs text-slate-300">{selectedZone.cells.length} cells</p>
            </div>
            <button
              onClick={() => deleteZone(selectedZone.id)}
              className="w-full px-3 py-1.5 bg-red-500 hover:bg-red-600 rounded text-sm transition-colors"
            >
              Delete Zone
            </button>
          </div>
        )}

        {/* Zones List */}
        {zones.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold mb-2 text-slate-400">Zones</h3>
            <div className="space-y-1">
              {zones.map(zone => (
                <button
                  key={zone.id}
                  onClick={() => {
                    setSelectedZone(zone);
                    setSelectedNode(null);
                  }}
                  className={`w-full flex items-center gap-2 p-2 rounded text-left text-sm transition-colors ${
                    selectedZone?.id === zone.id ? 'bg-slate-600' : 'hover:bg-slate-700'
                  }`}
                >
                  <div 
                    className="w-3 h-3 rounded"
                    style={{ backgroundColor: zone.color }}
                  />
                  {zone.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {(nodes.length > 0 || zones.length > 0) && (
          <button
            onClick={clearAll}
            className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="flex-1 relative overflow-hidden select-none"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseLeave}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}
        style={{ 
          cursor: isPanning ? 'grabbing' : isCreatingZone ? 'crosshair' : connectingFrom ? 'crosshair' : 'default'
        }}
      >
        {/* File drop overlay */}
        {isDraggingFile && (
          <div className="absolute inset-0 bg-blue-500 bg-opacity-20 border-4 border-dashed border-blue-400 z-50 flex items-center justify-center">
            <div className="bg-slate-800 px-6 py-4 rounded-lg shadow-lg text-center">
              <FolderOpen size={48} className="mx-auto mb-2 text-blue-400" />
              <p className="text-lg font-medium">Drop .json file to open</p>
            </div>
          </div>
        )}
        <svg className="w-full h-full">
          <g transform={`translate(${viewOffset.x}, ${viewOffset.y}) scale(${zoom})`}>
            {/* Zone backgrounds */}
            {zones.map(zone => (
              <g key={`zone-${zone.id}`} onClick={(e) => handleZoneClick(e, zone)}>
                {zone.cells.map(cell => {
                  const pos = axialToPixel(cell.q, cell.r);
                  return (
                    <polygon
                      key={`zone-${zone.id}-${cell.q}-${cell.r}`}
                      points={getHexagonPoints(pos.x, pos.y, HEX_SIZE)}
                      fill={zone.color}
                      opacity={selectedZone?.id === zone.id ? 0.4 : 0.2}
                      stroke={zone.color}
                      strokeWidth={selectedZone?.id === zone.id ? 2 : 1}
                      className="cursor-pointer transition-opacity"
                    />
                  );
                })}
              </g>
            ))}

            {/* Zone labels */}
            {zones.map(zone => {
              if (zone.cells.length === 0) return null;
              const centerQ = zone.cells.reduce((sum, c) => sum + c.q, 0) / zone.cells.length;
              const centerR = zone.cells.reduce((sum, c) => sum + c.r, 0) / zone.cells.length;
              const pos = axialToPixel(centerQ, centerR);
              return (
                <text
                  key={`zone-label-${zone.id}`}
                  x={pos.x}
                  y={pos.y - HEX_SIZE * 0.8}
                  fill={zone.color}
                  fontSize="14"
                  fontWeight="bold"
                  textAnchor="middle"
                  pointerEvents="none"
                  style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}
                >
                  {zone.label}
                </text>
              );
            })}

            {/* Zone selection preview */}
            {selectedZoneCells.map(cell => {
              const pos = axialToPixel(cell.q, cell.r);
              return (
                <polygon
                  key={`selection-${cell.q}-${cell.r}`}
                  points={getHexagonPoints(pos.x, pos.y, HEX_SIZE)}
                  fill="#f59e0b"
                  opacity="0.3"
                  stroke="#f59e0b"
                  strokeWidth="2"
                />
              );
            })}

            {/* Grid hexagons */}
            {gridHexagons.map(({ q, r, x, y }) => (
              <polygon
                key={`${q},${r}`}
                points={getHexagonPoints(x, y, HEX_SIZE)}
                fill="none"
                stroke="#334155"
                strokeWidth="1"
                opacity="0.3"
              />
            ))}

            {/* Hovered cell with plus button */}
            {hoveredCell && !isCreatingZone && (
              <g 
                transform={`translate(${axialToPixel(hoveredCell.q, hoveredCell.r).x}, ${axialToPixel(hoveredCell.q, hoveredCell.r).y})`}
                onClick={(e) => {
                  e.stopPropagation();
                  openNodeCreator(hoveredCell.q, hoveredCell.r);
                  setHoveredCell(null);
                }}
                className="cursor-pointer"
              >
                <polygon
                  points={getHexagonPoints(0, 0, HEX_SIZE)}
                  fill="#3b82f6"
                  opacity="0.2"
                  stroke="#3b82f6"
                  strokeWidth="2"
                />
                <circle cx="0" cy="0" r="15" fill="#3b82f6" />
                <line x1="-8" y1="0" x2="8" y2="0" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="0" y1="-8" x2="0" y2="8" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              </g>
            )}

            {/* Connections */}
            {connections.map(conn => {
              const fromNode = nodes.find(n => n.id === conn.from);
              const toNode = nodes.find(n => n.id === conn.to);
              if (!fromNode || !toNode) return null;

              const fromCenter = axialToPixel(fromNode.q, fromNode.r);
              const toCenter = axialToPixel(toNode.q, toNode.r);
              // Trim to the hexagon boundaries so the arrowhead lands on the
              // node's edge instead of disappearing under the hexagon
              const trimmed = trimSegmentToHexEdges(fromCenter, toCenter, HEX_SIZE);
              if (!trimmed) return null;
              const fromPos = trimmed.from;
              const toPos = trimmed.to;
              const midX = (fromPos.x + toPos.x) / 2;
              const midY = (fromPos.y + toPos.y) / 2;
              const isHovered = hoveredConnection === conn.id;
              const labelRotation = conn.rotation || 0;
              const ConnIcon = conn.iconId ? AVAILABLE_ICONS.find(i => i.id === conn.iconId)?.icon : null;
              const lineTypeData = LINE_TYPES.find(lt => lt.id === (conn.lineType || 'solid'));
              const strokeDasharray = lineTypeData?.dasharray || null;

              // Calculate line segment gap for icon/label
              const lineLength = Math.hypot(toPos.x - fromPos.x, toPos.y - fromPos.y);
              const hasLabelOrIcon = (conn.label || ConnIcon) && lineLength > 30;
              const rawGap = hasLabelOrIcon ? (conn.label && ConnIcon ? 35 : conn.label ? 30 : 12) : 0;
              const gapSize = Math.min(rawGap, lineLength / 2 - 4);
              const dirX = trimmed.ux;
              const dirY = trimmed.uy;

              // Points for split line
              const gap1X = midX - dirX * gapSize;
              const gap1Y = midY - dirY * gapSize;
              const gap2X = midX + dirX * gapSize;
              const gap2Y = midY + dirY * gapSize;

              return (
                <g key={conn.id}>
                  {/* Wider invisible hit area for hover */}
                  <line
                    x1={fromPos.x}
                    y1={fromPos.y}
                    x2={toPos.x}
                    y2={toPos.y}
                    stroke="transparent"
                    strokeWidth="20"
                    className="cursor-pointer"
                    onMouseEnter={() => {
                      setHoveredConnection(conn.id);
                      setHoveredCell(null);
                    }}
                    onMouseLeave={() => setHoveredConnection(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingConnection(conn);
                      setShowConnectionEditor(true);
                    }}
                  />
                  {/* Visible line - split if has icon/label */}
                  {hasLabelOrIcon ? (
                    <>
                      <line
                        x1={fromPos.x}
                        y1={fromPos.y}
                        x2={gap1X}
                        y2={gap1Y}
                        stroke={isHovered ? '#94a3b8' : '#64748b'}
                        strokeWidth={isHovered ? 3 : 2}
                        strokeDasharray={strokeDasharray}
                        pointerEvents="none"
                      />
                      <line
                        x1={gap2X}
                        y1={gap2Y}
                        x2={toPos.x}
                        y2={toPos.y}
                        stroke={isHovered ? '#94a3b8' : '#64748b'}
                        strokeWidth={isHovered ? 3 : 2}
                        strokeDasharray={strokeDasharray}
                        markerEnd="url(#arrowhead)"
                        pointerEvents="none"
                      />
                    </>
                  ) : (
                    <line
                      x1={fromPos.x}
                      y1={fromPos.y}
                      x2={toPos.x}
                      y2={toPos.y}
                      stroke={isHovered ? '#94a3b8' : '#64748b'}
                      strokeWidth={isHovered ? 3 : 2}
                      strokeDasharray={strokeDasharray}
                      markerEnd="url(#arrowhead)"
                      pointerEvents="none"
                    />
                  )}
                  {/* Label and icon - hidden when hovered */}
                  {(conn.label || ConnIcon) && !isHovered && (
                    <g transform={`translate(${midX}, ${midY}) rotate(${labelRotation})`}>
                      {ConnIcon && (
                        <foreignObject
                          x={conn.label ? -28 : -10}
                          y="-8"
                          width="16"
                          height="16"
                          pointerEvents="none"
                        >
                          <div className="w-full h-full flex items-center justify-center">
                            <ConnIcon size={14} color="#94a3b8" />
                          </div>
                        </foreignObject>
                      )}
                      {conn.label && (
                        <text
                          x={ConnIcon ? 2 : 0}
                          y="0"
                          fill="#e2e8f0"
                          fontSize="11"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          pointerEvents="none"
                        >
                          {conn.label}
                        </text>
                      )}
                    </g>
                  )}
                  {/* Delete button - centered on line, only visible on hover */}
                  {isHovered && (
                    <>
                      <circle
                        cx={midX}
                        cy={midY}
                        r="12"
                        fill="transparent"
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredConnection(conn.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConnection(conn.id);
                        }}
                      />
                      <text
                        x={midX}
                        y={midY}
                        fill="#ef4444"
                        fontSize="18"
                        fontWeight="bold"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        pointerEvents="none"
                        style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}
                      >
                        ×
                      </text>
                    </>
                  )}
                </g>
              );
            })}

            {/* Temporary connection line */}
            {connectingFrom && (() => {
              const start = axialToPixel(connectingFrom.q, connectingFrom.r);
              const dist = Math.hypot(mousePos.x - start.x, mousePos.y - start.y);
              // Start from the hexagon edge once the cursor has left it
              let x1 = start.x, y1 = start.y;
              if (dist > HEX_SIZE) {
                const angle = Math.atan2(mousePos.y - start.y, mousePos.x - start.x);
                const trim = hexBoundaryDistance(HEX_SIZE, angle);
                x1 = start.x + Math.cos(angle) * trim;
                y1 = start.y + Math.sin(angle) * trim;
              }
              return (
                <line
                  x1={x1}
                  y1={y1}
                  x2={mousePos.x}
                  y2={mousePos.y}
                  stroke="#f59e0b"
                  strokeWidth="2"
                  strokeDasharray="5,5"
                />
              );
            })()}

            {/* Nodes */}
            {nodes.map(node => {
              const pos = axialToPixel(node.q, node.r);
              const Icon = AVAILABLE_ICONS.find(i => i.id === node.iconId)?.icon || Server;
              const isSelected = selectedNode?.id === node.id;
              const isConnectingSource = connectingFrom?.id === node.id;
              const isConnectingTarget = connectingFrom && hoveredNode === node.id && connectingFrom.id !== node.id;
              const hasNested = hasNestedDiagram(node.id);

              // Determine stroke style
              let strokeColor = node.color;
              let strokeWidth = 2;
              if (isSelected) {
                strokeColor = '#fbbf24';
                strokeWidth = 4;
              } else if (isConnectingSource) {
                strokeColor = '#f59e0b';
                strokeWidth = 4;
              } else if (isConnectingTarget) {
                strokeColor = '#22c55e';
                strokeWidth = 4;
              }

              return (
                <g
                  key={node.id}
                  className="node-element"
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onMouseDown={(e) => handleNodeMouseDown(e, node)}
                  onClick={(e) => handleNodeClick(e, node)}
                  onDoubleClick={(e) => handleNodeDoubleClick(e, node)}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: 'move' }}
                >
                  <polygon
                    points={getHexagonPoints(0, 0, HEX_SIZE)}
                    fill={node.color}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    opacity="0.9"
                  />
                  {/* Nested indicator */}
                  {hasNested && (
                    <circle
                      cx={HEX_SIZE * 0.6}
                      cy={-HEX_SIZE * 0.6}
                      r="8"
                      fill="#3b82f6"
                      stroke="white"
                      strokeWidth="2"
                    />
                  )}
                  <foreignObject
                    x={-HEX_SIZE * 0.5}
                    y={-HEX_SIZE * 0.5}
                    width={HEX_SIZE}
                    height={HEX_SIZE}
                    pointerEvents="none"
                  >
                    <div className="w-full h-full flex items-center justify-center">
                      <Icon size={24} color="white" />
                    </div>
                  </foreignObject>
                  <text
                    y={HEX_SIZE + 15}
                    fill="white"
                    fontSize="12"
                    textAnchor="middle"
                    fontWeight="500"
                    pointerEvents="none"
                  >
                    {node.label}
                  </text>
                </g>
              );
            })}

            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" fill="#64748b" />
              </marker>
            </defs>
          </g>
        </svg>
      </div>
    </div>

    {/* Node Creator Modal */}
      {showNodeCreator && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">
                {editingNode ? 'Edit Node' : 'Create New Node'}
              </h2>
              <button
                onClick={() => {
                  setShowNodeCreator(false);
                  resetNodeForm();
                }}
                className="text-slate-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Label *</label>
                <input
                  type="text"
                  value={newNodeData.label}
                  onChange={(e) => setNewNodeData({ ...newNodeData, label: e.target.value })}
                  placeholder="e.g., API Gateway"
                  className="w-full px-3 py-2 bg-slate-700 rounded border border-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  value={newNodeData.description}
                  onChange={(e) => setNewNodeData({ ...newNodeData, description: e.target.value })}
                  placeholder="Optional description of this component"
                  rows="3"
                  className="w-full px-3 py-2 bg-slate-700 rounded border border-slate-600 focus:border-blue-500 focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Icon</label>
                <div className="max-h-40 overflow-y-auto bg-slate-900 rounded p-2 scrollbar-thin">
                  <div className="grid grid-cols-8 gap-2">
                    {AVAILABLE_ICONS.map(iconData => {
                      const Icon = iconData.icon;
                      return (
                        <button
                          key={iconData.id}
                          onClick={() => setNewNodeData({ ...newNodeData, iconId: iconData.id })}
                          className={`p-3 rounded transition-all ${
                            newNodeData.iconId === iconData.id
                              ? 'bg-blue-600 ring-2 ring-blue-400'
                              : 'bg-slate-700 hover:bg-slate-600'
                          }`}
                          title={iconData.label}
                        >
                          <Icon size={20} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Color</label>
                <div className="grid grid-cols-10 gap-2">
                  {COLOR_PALETTE.map(color => (
                    <button
                      key={color}
                      onClick={() => setNewNodeData({ ...newNodeData, color })}
                      className={`w-10 h-10 rounded transition-all ${
                        newNodeData.color === color
                          ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-800'
                          : ''
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={createOrUpdateNode}
                  disabled={!newNodeData.label.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded transition-colors"
                >
                  {editingNode ? 'Update Node' : 'Create Node'}
                </button>
                <button
                  onClick={() => {
                    setShowNodeCreator(false);
                    resetNodeForm();
                  }}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Zone Creator Modal */}
      {showZoneCreator && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">
                {editingZone ? 'Edit Zone' : 'Create Zone'}
              </h2>
              <button
                onClick={() => {
                  setShowZoneCreator(false);
                  setEditingZone(null);
                  cancelZoneCreation();
                }}
                className="text-slate-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Zone Name</label>
                <input
                  type="text"
                  value={newZoneData.label}
                  onChange={(e) => setNewZoneData({ ...newZoneData, label: e.target.value })}
                  placeholder="e.g., Frontend Services"
                  className="w-full px-3 py-2 bg-slate-700 rounded border border-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Color</label>
                <div className="grid grid-cols-8 gap-2">
                  {ZONE_COLORS.map(({ color, label }) => (
                    <button
                      key={color}
                      onClick={() => setNewZoneData({ ...newZoneData, color })}
                      className={`w-10 h-10 rounded transition-all ${
                        newZoneData.color === color
                          ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-800'
                          : ''
                      }`}
                      style={{ backgroundColor: color }}
                      title={label}
                    />
                  ))}
                </div>
              </div>

              <p className="text-sm text-slate-400">
                {editingZone ? `${editingZone.cells.length} cells selected` : `${selectedZoneCells.length} cells selected`}
              </p>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={createOrUpdateZone}
                  className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded transition-colors"
                >
                  {editingZone ? 'Update Zone' : 'Create Zone'}
                </button>
                <button
                  onClick={() => {
                    setShowZoneCreator(false);
                    setEditingZone(null);
                    cancelZoneCreation();
                  }}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Connection Editor Modal */}
      {showConnectionEditor && editingConnection && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Edit Connection</h2>
              <button
                onClick={() => {
                  setShowConnectionEditor(false);
                  setEditingConnection(null);
                }}
                className="text-slate-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Label</label>
                <input
                  type="text"
                  value={editingConnection.label || ''}
                  onChange={(e) => setEditingConnection({ ...editingConnection, label: e.target.value })}
                  placeholder="e.g., HTTP, API, Data Flow"
                  className="w-full px-3 py-2 bg-slate-700 rounded border border-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Icon (optional)</label>
                <div className="max-h-32 overflow-y-auto bg-slate-900 rounded p-2 scrollbar-thin">
                  <div className="grid grid-cols-8 gap-2">
                    <button
                      onClick={() => setEditingConnection({ ...editingConnection, iconId: null })}
                      className={`p-2 rounded transition-all ${
                        !editingConnection.iconId
                          ? 'bg-blue-600 ring-2 ring-blue-400'
                          : 'bg-slate-700 hover:bg-slate-600'
                      }`}
                      title="No icon"
                    >
                      <X size={16} />
                    </button>
                    {AVAILABLE_ICONS.map(iconData => {
                      const Icon = iconData.icon;
                      return (
                        <button
                          key={iconData.id}
                          onClick={() => setEditingConnection({ ...editingConnection, iconId: iconData.id })}
                          className={`p-2 rounded transition-all ${
                            editingConnection.iconId === iconData.id
                              ? 'bg-blue-600 ring-2 ring-blue-400'
                              : 'bg-slate-700 hover:bg-slate-600'
                          }`}
                          title={iconData.label}
                        >
                          <Icon size={16} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Label Rotation: {editingConnection.rotation || 0}°</label>
                <div className="flex flex-wrap gap-2">
                  {[0, 15, 30, 45, 60, 75, 90, -15, -30, -45, -60, -75, -90].map(angle => (
                    <button
                      key={angle}
                      onClick={() => setEditingConnection({ ...editingConnection, rotation: angle })}
                      className={`px-3 py-1 rounded text-sm transition-all ${
                        (editingConnection.rotation || 0) === angle
                          ? 'bg-blue-600 ring-2 ring-blue-400'
                          : 'bg-slate-700 hover:bg-slate-600'
                      }`}
                    >
                      {angle}°
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Line Style</label>
                <div className="flex flex-wrap gap-2">
                  {LINE_TYPES.map(lt => (
                    <button
                      key={lt.id}
                      onClick={() => setEditingConnection({ ...editingConnection, lineType: lt.id })}
                      className={`px-3 py-2 rounded text-sm transition-all flex items-center gap-2 ${
                        (editingConnection.lineType || 'solid') === lt.id
                          ? 'bg-blue-600 ring-2 ring-blue-400'
                          : 'bg-slate-700 hover:bg-slate-600'
                      }`}
                    >
                      <svg width="40" height="10">
                        <line
                          x1="0"
                          y1="5"
                          x2="40"
                          y2="5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeDasharray={lt.dasharray || undefined}
                        />
                      </svg>
                      <span>{lt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setConnections(connections.map(c => 
                      c.id === editingConnection.id ? editingConnection : c
                    ));
                    setShowConnectionEditor(false);
                    setEditingConnection(null);
                  }}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                >
                  Save Connection
                </button>
                <button
                  onClick={() => {
                    setShowConnectionEditor(false);
                    setEditingConnection(null);
                  }}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
