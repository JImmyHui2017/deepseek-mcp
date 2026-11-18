import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.mjs';

async function connect(testContext, api) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ api, getKey: async () => 'fake-key' });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  testContext.after(async () => { await client.close(); await server.close(); });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

test('MCP tools list, schemas, Unicode limits and result content budget work through the protocol', async testContext => {
  const calls = [];
  const client = await connect(testContext, async (...args) => {
    calls.push(args);
    return { data: { results: [
      { title: 'First', url: 'https://example.com/first', content: '😀甲乙丙丁' },
      { title: 'Second', url: 'https://example.com/second', content: 'abcde' },
    ] }, attempts: 1 };
  });
  const list = await client.listTools();
  assert.deepEqual(list.tools.map(tool => tool.name), ['deepseek_search', 'deepseek_fetch', 'deepseek_status']);
  const result = await client.callTool({ name: 'deepseek_search', arguments: { query: '😀'.repeat(128), max_content_chars: 4, max_total_content_chars: 6 } });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.results[0].content, '😀甲乙丙');
  assert.equal(result.structuredContent.results[1].content, 'ab');
  assert.equal(result.structuredContent.results[0].content_length, 5);
  assert.equal(result.structuredContent.results[0].truncated, true);
  assert.equal(calls[0][1].need_content, true);
  assert.equal(calls[0][1].count, 5);
  assert.equal('max_content_chars' in calls[0][1], false);
  const invalid = await client.callTool({ name: 'deepseek_search', arguments: { query: '😀'.repeat(129) } });
  assert.equal(invalid.isError, true);
  const whitespace = await client.callTool({ name: 'deepseek_search', arguments: { query: '   ' } });
  assert.equal(whitespace.isError, true);
  assert.equal(calls.length, 1);
});

test('fetch validates URL credentials, returns content windows and preserves Markdown escape sequences', async testContext => {
  let calls = 0;
  const client = await connect(testContext, async () => { calls += 1; return { data: { title: 'Doc', content: '0123😀5678\\n' }, attempts: 1 }; });
  for (const url of ['file:///C:/private.txt', 'https://name:password@example.com']) {
    const result = await client.callTool({ name: 'deepseek_fetch', arguments: { url } });
    assert.equal(result.isError, true);
  }
  assert.equal(calls, 0);
  const page = await client.callTool({ name: 'deepseek_fetch', arguments: { url: 'https://example.com', start_char: 4, max_chars: 3 } });
  assert.equal(page.structuredContent.content, '😀56');
  assert.equal(page.structuredContent.next_start_char, 7);
  const full = await client.callTool({ name: 'deepseek_fetch', arguments: { url: 'https://example.com' } });
  assert.equal(full.structuredContent.content.endsWith('\\n'), true);
});

test('server starts and answers status over real stdio without a configured key', async testContext => {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'));
  delete environment.DEEPSEEK_API_KEY;
  environment.DEEPSEEK_MCP_CONFIG = fileURLToPath(new URL('./absent-key-configuration.json', import.meta.url));
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))], env: environment, stderr: 'pipe' });
  const client = new Client({ name: 'stdio-smoke', version: '1.0.0' });
  testContext.after(async () => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 3);
  const status = await client.callTool({ name: 'deepseek_status', arguments: {} });
  assert.equal(status.structuredContent.configured, false);
  const search = await client.callTool({ name: 'deepseek_search', arguments: { query: 'test' } });
  assert.equal(search.isError, true);
  assert.equal(search.structuredContent.error.code, 'configuration_error');
});
