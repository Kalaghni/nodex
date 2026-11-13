#!/usr/bin/env node
// Nodex MCP server over stdio - for Claude Code, Claude Desktop and other
// local MCP clients. No backend needed: by default it edits the diagram
// files in a folder (the same .json files the editor opens and saves).
//
//   node server/stdio.js --dir ~/diagrams
//   node server/stdio.js --server http://localhost:7071 --token <token>
//
// With --server it edits the documents of a running Nodex backend instead,
// so changes appear live in editors that have them open.
//
// Options (or environment variables)
//   --dir <path>       NODEX_DIR             folder of diagram files (default: current directory)
//   --server <url>     NODEX_SERVER_URL      use a Nodex backend instead of a folder
//   --token <token>    NODEX_SERVER_TOKEN    bearer token for --server
//
// Logs go to stderr - stdout carries the MCP protocol.

import path from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { FileStore, RemoteStore } from './store.js';
import { createNodexMcpServer, VERSION } from './tools.js';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    server: { type: 'string' },
    token: { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
});

if (values.help) {
  console.error('Usage: nodex-mcp [--dir <folder>] | [--server <url> [--token <token>]]');
  process.exit(0);
}

const serverUrl = values.server || process.env.NODEX_SERVER_URL;
let store;
if (serverUrl) {
  store = new RemoteStore(serverUrl, values.token || process.env.NODEX_SERVER_TOKEN || '');
  console.error(`nodex-mcp ${VERSION}: editing documents on ${serverUrl}`);
} else {
  const dir = path.resolve(values.dir || process.env.NODEX_DIR || '.');
  store = await new FileStore(dir).init();
  console.error(`nodex-mcp ${VERSION}: editing diagram files in ${dir}`);
}

const server = createNodexMcpServer(store, { source: 'mcp' });
await server.connect(new StdioServerTransport());
