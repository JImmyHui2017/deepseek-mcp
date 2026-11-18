import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'deepseek-live-check', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))],
  env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')),
  stderr: 'pipe',
});

try {
  await client.connect(transport);
  const status = await client.callTool({ name: 'deepseek_status', arguments: {} });
  const configuration = status.structuredContent;
  if (!configuration.configured) throw new Error(configuration.message);
  const search = await client.callTool({ name: 'deepseek_search', arguments: {
    query: 'DeepSeek site:deepseek.com', count: 1, need_content: false,
  } }, undefined, { timeout: 55000 });
  if (search.isError) throw new Error(search.structuredContent.error.message);
  console.log(`Search OK: ${search.structuredContent.result_count} result(s).`);
  const page = await client.callTool({ name: 'deepseek_fetch', arguments: {
    url: 'https://api-docs.deepseek.com/zh-cn/guides/search', max_chars: 500,
  } }, undefined, { timeout: 55000 });
  if (page.isError) throw new Error(page.structuredContent.error.message);
  console.log(`Fetch OK: ${page.structuredContent.content_length} content characters.`);
  console.log('Live verification passed through the MCP protocol. Up to two successful API requests were billed (currently CNY 0.01 total).');
} catch (error) {
  console.error(`Live check failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
