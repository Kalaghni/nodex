// The Nodex MCP toolkit: tools for reading, editing and analysing Nodex
// diagrams, over any store (FileStore for a folder of diagram files,
// RemoteStore for a running Nodex backend). Used by both the stdio server
// (server/stdio.js) and the backend's /mcp endpoint (server/server.js).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ICON_IDS, POINTER_STYLES, LINE_TYPES, PEER_MODE_IDS, ZONE_MODES, LABEL_SIDES, CHECKS,
  DocError, addNodes, updateNodes, removeNodes, addConnections, updateConnections,
  removeConnections, upsertZone, removeZones, upsertChannel, removeChannels,
  outline, describeDiagram
} from './core/document.js';
import { analyzeDiagram } from './core/analyze.js';
import { NotFoundError, ConflictError, updateDocument } from './store.js';

export const VERSION = '1.0.0';

export const INSTRUCTIONS = `Nodex draws architecture diagrams on a hexagonal grid: nodes (hexagons with an icon), connections between nodes and zones, coloured zones (regions of cells), and channels (named traffic flows carried by connections). Any node can open into its own nested diagram.

- Documents are addressed by id (list_documents). Inside a document, "path" picks the diagram level: omit it for the top level, or give node ids/labels such as "josh-docker" or "root/127/nginx". Adding something to a node's path creates its nested diagram.
- Nodes, zones and channels can be referred to by id or exact label; prefix "zone:" or "node:" when a label is shared. Connections are referred to by id.
- Positions are { col, row } on a visual grid (one column = 60 px, one row = 69 px). Keep nodes on even columns so rows line up, and leave at least 4 columns between nodes in a row and 2-3 rows between rows so labels don't collide. Omit positions to let Nodex place nodes in a row, or use "near" + "direction".
- Put channels on connections (connect / update_connections) to make flows traceable; then analyze simulates failures and reports per-flow impact and single points of failure.
- Batch your edits: every editing tool takes a list, and each call is saved as one revision that open editors pick up live.`;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const documentId = z.string().describe('Document id from list_documents');
const pathArg = z.union([z.string(), z.array(z.string())]).optional()
  .describe('Diagram level: omit for the top level; node ids or labels for nested levels, e.g. "josh-docker" or "root/127"');
const ref = z.union([z.string(), z.number().int()]);
const position = z.union([
  z.object({ col: z.number().int(), row: z.number().int() }).strict(),
  z.object({ q: z.number().int(), r: z.number().int() }).strict()
]).describe('{ col, row } on the visual grid (or raw axial { q, r })');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('#rrggbb');
const icon = z.enum(ICON_IDS);
const endpoint = z.object({
  address: z.string().describe('IP address or hostname'),
  check: z.enum(CHECKS).default('icmp').describe('icmp = ping, tcp = port open, http/https = responds'),
  port: z.number().int().min(1).max(65535).optional(),
  path: z.string().startsWith('/').optional().describe('HTTP(S) path, e.g. /health'),
  insecure: z.boolean().optional().describe('HTTPS: accept self-signed certificates')
}).strict();

const nodeFields = {
  label: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  icon: icon.optional().describe('Icon (default server)'),
  color: color.optional(),
  role: z.enum(['standard', 'vip']).optional().describe('vip = floating virtual IP held by one failover peer at a time'),
  endpoints: z.array(endpoint).max(16).optional().describe('Real addresses checked by live monitoring'),
  link: z.union([z.string(), z.array(z.string())]).optional()
    .describe('Make this node a link that opens another diagram level of this document instead of its own nested diagram')
};

const connectionFields = {
  label: z.string().max(200).optional(),
  channels: z.array(ref).optional().describe('Channel names or ids this connection carries (unknown names are created)'),
  kind: z.enum(['traffic', 'dependency', 'peer']).optional()
    .describe('traffic (default): carries requests from → to. dependency: from fails when to is unavailable (cache, auth, database). peer: cluster link (failover, quorum, replication) that carries no traffic'),
  peerMode: z.enum(PEER_MODE_IDS).optional().describe('For peer links: failover (keepalived/VRRP), quorum (Galera/etcd), both (Patroni), replica'),
  line: z.enum(LINE_TYPES).optional(),
  startPointer: z.enum(POINTER_STYLES).optional(),
  endPointer: z.enum(POINTER_STYLES).optional().describe('Default arrow (none for peer links)'),
  routing: z.enum(['direct', 'angled']).optional(),
  color: color.nullable().optional(),
  icon: icon.nullable().optional().describe('Icon drawn on the line')
};

const area = z.object({
  shape: z.enum(['rectangle', 'hexagon', 'circle']).default('rectangle'),
  around: z.array(ref).optional().describe('Fit the zone around these nodes'),
  padding: z.number().int().min(0).max(10).optional().describe('Cells of margin around "around" nodes (default 1)'),
  from: z.object({ col: z.number().int(), row: z.number().int() }).optional().describe('Rectangle corner'),
  to: z.object({ col: z.number().int(), row: z.number().int() }).optional().describe('Opposite rectangle corner'),
  center: position.optional().describe('Hexagon/circle center'),
  radius: z.number().int().min(0).max(60).optional()
}).strict();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const reply = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });

const fail = (err) => {
  const known = err instanceof DocError || err instanceof NotFoundError || err instanceof ConflictError;
  return {
    isError: true,
    content: [{ type: 'text', text: known ? err.message : `Unexpected error: ${err.message}` }]
  };
};

const tool = (fn) => async (args) => {
  try {
    return reply(await fn(args));
  } catch (err) {
    return fail(err);
  }
};

const READ = { readOnlyHint: true, openWorldHint: false };
const EDIT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const REMOVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const registerNodexTools = (server, store, { source = 'mcp' } = {}) => {
  // Every edit: load → change → save against the revision it read
  const edit = (id, mutate) => updateDocument(store, id, mutate, { source })
    .then(({ revision, result, unchanged }) => ({ document: id, revision, ...(unchanged ? { unchanged: true } : {}), ...result }));

  server.registerTool('list_documents', {
    title: 'List diagrams',
    description: 'List the Nodex diagram documents available, newest first.',
    annotations: READ
  }, tool(async () => ({ documents: await store.list() })));

  server.registerTool('create_document', {
    title: 'Create a diagram',
    description: 'Create a new, empty diagram document and return its id.',
    inputSchema: { name: z.string().min(1).max(200) },
    annotations: EDIT
  }, tool(async ({ name }) => {
    const created = await store.create(name, null, { source });
    return { document: created.id, name, revision: created.revision };
  }));

  server.registerTool('rename_document', {
    title: 'Rename a diagram',
    description: 'Change a document\'s display name (its id stays the same).',
    inputSchema: { document: documentId, name: z.string().min(1).max(200) },
    annotations: EDIT
  }, tool(({ document, name }) => edit(document, (doc) => { doc.name = name; return { name }; })));

  server.registerTool('get_document', {
    title: 'Outline a diagram',
    description: 'Outline a document: every diagram level (top level and nested node diagrams) with its path and counts. Use get_diagram to read one level in full.',
    inputSchema: { document: documentId },
    annotations: READ
  }, tool(async ({ document }) => {
    const { doc, revision, updatedAt } = await store.get(document);
    return { document, name: doc.name, revision, updatedAt, levels: outline(doc) };
  }));

  server.registerTool('get_diagram', {
    title: 'Read a diagram level',
    description: 'Read one diagram level in full: nodes (with grid positions), connections, zones (with their member nodes) and channels.',
    inputSchema: { document: documentId, path: pathArg },
    annotations: READ
  }, tool(async ({ document, path }) => {
    const { doc, revision } = await store.get(document);
    return { document, revision, ...describeDiagram(doc, path) };
  }));

  server.registerTool('add_nodes', {
    title: 'Add nodes',
    description: 'Add nodes to a diagram level. Give each a position, or "near" another node (+ direction), or nothing to append them in a row to the right of the existing content.',
    inputSchema: {
      document: documentId,
      path: pathArg,
      nodes: z.array(z.object({
        ...nodeFields,
        position: position.optional(),
        near: ref.optional().describe('Place next to this node'),
        direction: z.enum(['right', 'left', 'above', 'below']).optional().describe('Side of "near" to use (default right)')
      }).strict()).min(1).max(200)
    },
    annotations: EDIT
  }, tool(({ document, path, nodes }) => edit(document, (doc) => addNodes(doc, path, nodes))));

  server.registerTool('update_nodes', {
    title: 'Edit nodes',
    description: 'Change nodes: label, description, icon, colour, role, monitored endpoints (replaces the list), link (null removes it) or position.',
    inputSchema: {
      document: documentId,
      path: pathArg,
      updates: z.array(z.object({
        node: ref.describe('Node id or label'),
        ...Object.fromEntries(Object.entries(nodeFields).map(([k, v]) => [k, v.optional()])),
        link: nodeFields.link.nullable(),
        position: position.optional()
      }).strict()).min(1).max(200)
    },
    annotations: EDIT
  }, tool(({ document, path, updates }) => edit(document, (doc) => updateNodes(doc, path, updates))));

  server.registerTool('remove_nodes', {
    title: 'Remove nodes',
    description: 'Remove nodes, along with their connections and their nested diagrams.',
    inputSchema: { document: documentId, path: pathArg, nodes: z.array(ref).min(1).max(200) },
    annotations: REMOVE
  }, tool(({ document, path, nodes }) => edit(document, (doc) => removeNodes(doc, path, nodes))));

  server.registerTool('connect', {
    title: 'Add connections',
    description: 'Connect nodes and/or zones on one diagram level. Traffic flows from → to.',
    inputSchema: {
      document: documentId,
      path: pathArg,
      connections: z.array(z.object({
        from: ref.describe('Node or zone (id or label; "zone:" prefix for zones)'),
        to: ref,
        ...connectionFields
      }).strict()).min(1).max(500)
    },
    annotations: EDIT
  }, tool(({ document, path, connections }) => edit(document, (doc) => addConnections(doc, path, connections))));

  server.registerTool('update_connections', {
    title: 'Edit connections',
    description: 'Change connections by id: label, channels (replaces the list), kind, line style, pointers, routing, colour, or reverse their direction.',
    inputSchema: {
      document: documentId,
      path: pathArg,
      updates: z.array(z.object({
        connection: ref.describe('Connection id'),
        reverse: z.boolean().optional().describe('Swap from and to'),
        ...connectionFields
      }).strict()).min(1).max(500)
    },
    annotations: EDIT
  }, tool(({ document, path, updates }) => edit(document, (doc) => updateConnections(doc, path, updates))));

  server.registerTool('remove_connections', {
    title: 'Remove connections',
    description: 'Remove connections by id.',
    inputSchema: { document: documentId, path: pathArg, connections: z.array(ref).min(1).max(500) },
    annotations: REMOVE
  }, tool(({ document, path, connections }) => edit(document, (doc) => removeConnections(doc, path, connections))));

  server.registerTool('upsert_zone', {
    title: 'Add or edit a zone',
    description: 'Create a zone (omit "zone") or change one. Nodes on a zone\'s cells are its members; the policy says when the zone counts as available in simulations.',
    inputSchema: {
      document: documentId,
      path: pathArg,
      zone: ref.optional().describe('Existing zone to edit (id or label)'),
      label: z.string().min(1).max(200).optional(),
      color: color.optional(),
      area: area.optional().describe('Required for a new zone; replaces the cells of an existing one'),
      labelSide: z.enum(LABEL_SIDES).optional(),
      labelPlacement: z.enum(['inside', 'outside']).optional(),
      policy: z.object({
        mode: z.enum(ZONE_MODES).optional().describe('pool = any member up; failover = active/standby; quorum = majority; min = at least N; all = every member'),
        min: z.number().int().min(1).optional(),
        primary: ref.optional().describe('Active member for failover mode')
      }).strict().optional()
    },
    annotations: EDIT
  }, tool(({ document, path, ...spec }) => edit(document, (doc) => upsertZone(doc, path, spec))));

  server.registerTool('remove_zones', {
    title: 'Remove zones',
    description: 'Remove zones (their member nodes stay) and any connections to them.',
    inputSchema: { document: documentId, path: pathArg, zones: z.array(ref).min(1).max(100) },
    annotations: REMOVE
  }, tool(({ document, path, zones }) => edit(document, (doc) => removeZones(doc, path, zones))));

  server.registerTool('upsert_channel', {
    title: 'Add or edit a channel',
    description: 'Create a channel (a named, coloured traffic flow) or rename / recolour one.',
    inputSchema: {
      document: documentId,
      path: pathArg,
      channel: ref.optional().describe('Existing channel to edit (id or name)'),
      name: z.string().min(1).max(100).optional(),
      color: color.optional()
    },
    annotations: EDIT
  }, tool(({ document, path, ...spec }) => edit(document, (doc) => upsertChannel(doc, path, spec))));

  server.registerTool('remove_channels', {
    title: 'Remove channels',
    description: 'Remove channels and take them off every connection.',
    inputSchema: { document: documentId, path: pathArg, channels: z.array(ref).min(1).max(100) },
    annotations: REMOVE
  }, tool(({ document, path, channels }) => edit(document, (doc) => removeChannels(doc, path, channels))));

  server.registerTool('analyze', {
    title: 'Simulate outages',
    description: 'Run Nodex\'s availability analysis on one diagram level: per-channel flow status and hop-by-hop stages, every degraded or unavailable component with the reason, and single points of failure. Pass "fail" to simulate failures (nodes, zones, or "connection:<id>"). Nothing is saved.',
    inputSchema: {
      document: documentId,
      path: pathArg,
      fail: z.array(ref).max(100).optional().describe('Components to fail'),
      singlePointsOfFailure: z.boolean().optional().describe('Also scan for single points of failure (default true)')
    },
    annotations: READ
  }, tool(async ({ document, path, fail: failures = [], singlePointsOfFailure = true }) => {
    const { doc, revision } = await store.get(document);
    return { document, revision, ...analyzeDiagram(doc, path, { fail: failures, singlePointsOfFailure }) };
  }));

  return server;
};

export const createNodexMcpServer = (store, opts = {}) => {
  const server = new McpServer(
    { name: 'nodex', title: 'Nodex', version: VERSION },
    { instructions: INSTRUCTIONS }
  );
  return registerNodexTools(server, store, opts);
};
