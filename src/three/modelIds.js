// Ids of the built-in 3D models — one per node icon, same id. Kept free of
// three.js imports so the app can reason about models without loading the
// 3D engine; models.test.js checks this list against the builders.

export const MODEL_IDS = [
  'server', 'database', 'cloud', 'storage', 'compute', 'network', 'container', 'terminal', 'git',
  'github', 'api', 'service', 'web', 'code', 'layers', 'package', 'link', 'bot', 'security',
  'shield', 'key', 'unlock', 'wifi', 'mail', 'phone', 'message', 'send', 'bell', 'document',
  'folder', 'archive', 'upload', 'download', 'users', 'user', 'usercheck', 'userplus', 'home',
  'building', 'factory', 'warehouse', 'cart', 'credit', 'dollar', 'activity', 'piechart',
  'barchart', 'linechart', 'trending', 'settings', 'cog', 'wrench', 'hammer', 'search', 'filter',
  'smartphone', 'tablet', 'monitor', 'printer', 'camera', 'clock', 'calendar', 'check', 'error',
  'warning', 'star', 'flag', 'lightbulb', 'play', 'pause', 'mic', 'video', 'mappin', 'map',
  'compass', 'truck', 'plane', 'ship', 'hexagon', 'circle', 'square', 'triangle', 'flame',
  'droplet', 'sun', 'moon'
];

const MODEL_ID_SET = new Set(MODEL_IDS);
export const hasBuiltinModel = (id) => MODEL_ID_SET.has(id);

// Pedestal-only option for nodes that should show just their hexagon
export const NO_MODEL = 'none';
