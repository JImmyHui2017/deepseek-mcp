import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const harnessSdk = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@modelcontextprotocol', 'client', 'dist');

test('the installed DeepSeek Harness MCP client SDK connects to this standard stdio server', { skip: !existsSync(join(harnessSdk, 'index.mjs')) }, async testContext => {
  const { Client } = await import(pathToFileURL(join(harnessSdk, 'index.mjs')).href);
  const { StdioClientTransport } = await import(pathToFileURL(join(harnessSdk, 'stdio.mjs')).href);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => typeof value === 'string' && name.toUpperCase() !== 'DEEPSEEK_API_KEY'));
  environment.DEEPSEEK_MCP_CONFIG = fileURLToPath(new URL('./absent-harness-key.json', import.meta.url));
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))], env: environment, stderr: 'pipe' });
  const client = new Client({ name: 'harness-sdk-compatibility', version: '1.0.0' });
  testContext.after(async () => client.close());
  await client.connect(transport);
  const list = await client.listTools();
  assert.equal(list.tools.length, 3);
  const status = await client.callTool({ name: 'deepseek_status', arguments: {} });
  assert.equal(status.structuredContent.configured, false);
  assert.equal(JSON.parse(status.content[0].text).configured, false);
});
