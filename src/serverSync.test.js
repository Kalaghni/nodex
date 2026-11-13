import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSSE, maxIdIn, saveServerDoc, ServerError } from './serverSync.js';

test('parseSSE splits complete events and keeps the unfinished tail', () => {
  const { events, rest } = parseSSE('retry: 3000\n: connected\n\nevent: document\ndata: {"id":"a"}\n\nevent: doc');
  assert.deepEqual(events, [{ event: 'document', data: '{"id":"a"}' }]);
  assert.equal(rest, 'event: doc');
  const more = parseSSE(rest + 'ument\r\ndata: {"id":"b"}\r\n\r\n');
  assert.deepEqual(more.events, [{ event: 'document', data: '{"id":"b"}' }]);
  assert.equal(more.rest, '');
});

test('maxIdIn looks at nodes, connections and zones on every level', () => {
  assert.equal(maxIdIn({
    root: { nodes: [{ id: 5 }], connections: [{ id: 9 }], zones: [] },
    'root/5': { nodes: [{ id: 12 }], connections: [], zones: [{ id: 7 }] }
  }), 12);
  assert.equal(maxIdIn(null), 0);
});

test('a conflicting save surfaces as a 409 with the current revision', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers['If-Match'], '"old"');
    assert.equal(init.headers.Authorization, 'Bearer t');
    return new Response(JSON.stringify({ error: 'changed', revision: 'new' }), { status: 409 });
  };
  try {
    await assert.rejects(
      saveServerDoc({ url: 'http://x/', token: 't' }, 'doc', { diagrams: {} }, 'old'),
      (err) => err instanceof ServerError && err.status === 409 && err.revision === 'new'
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
