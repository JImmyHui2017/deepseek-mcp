import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createKeyProvider } from './config.mjs';
import { createApi } from './api.mjs';
import { createServer } from './server.mjs';

const getKey = createKeyProvider();
const server = createServer({ getKey, api: createApi({ getKey }) });

try {
  await server.connect(new StdioServerTransport());
} catch {
  process.stderr.write('DeepSeek MCP could not start. Check Node.js and the installation.\n');
  process.exitCode = 1;
}
