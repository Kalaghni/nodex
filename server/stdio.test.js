// The stdio entry point as an MCP client would launch it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('stdio server edits diagram files in --dir', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nodex-stdio-'));
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(here, 'stdio.js'), '--dir', dir],
    stderr: 'ignore'
  }));
  try {
    const created = await client.callTool({ name: 'create_document', arguments: { name: 'Stdio' } });
    assert.ok(!created.isError, created.content[0].text);
    await client.callTool({ name: 'add_nodes', arguments: { document: 'stdio', nodes: [{ label: 'hello' }] } });
    const saved = JSON.parse(await fs.readFile(path.join(dir, 'stdio.json'), 'utf8'));
    assert.equal(saved.diagrams.root.nodes[0].label, 'hello');
  } finally {
    await client.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
