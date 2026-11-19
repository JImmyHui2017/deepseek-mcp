import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse as parseJsonc } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { parseDocument } from 'yaml';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const execFileAsync = promisify(execFile);
const normalize = value => JSON.parse(JSON.stringify(value));
const parseYaml = text => {
  const document = parseDocument(text, { logLevel: 'silent' });
  if (document.errors.length) throw new Error('YAML parsing failed.');
  return document.toJS();
};

try {
  const report = JSON.parse(await readFile(new URL('../registration-report.json', import.meta.url), 'utf8'));
  for (const target of report.servers) {
    const beforeText = await readFile(target.backup, 'utf8');
    const afterText = await readFile(target.path, 'utf8');
    const parser = target.agent === 'Codex' ? parseToml : /Hermes|Harness/.test(target.agent) ? parseYaml : parseJsonc;
    const before = normalize(parser(beforeText));
    const after = normalize(parser(afterText));
    if (target.agent.includes('Harness')) {
      const scrubLaunch = value => {
        if (!value || typeof value !== 'object') return false;
        if (value.id === 'mcp-deepseek-search' || (value.name === '@deepseek-ai/dsh-mcp-client' && value.config?.serverName === 'deepseek-search')) {
          delete value.config.command;
          delete value.config.args;
          return true;
        }
        return Object.values(value).map(scrubLaunch).some(Boolean);
      };
      const existing = scrubLaunch(before);
      const block = after.findIndex(entry => entry.insert?.some(plugin => plugin.id === 'mcp-deepseek-search'));
      if (existing) {
        assert.ok(scrubLaunch(after));
      } else {
        assert.ok(block >= 0);
        after.splice(block, 1);
      }
    } else {
      const configuration = target.agent === 'Codex' || target.agent === 'Hermes' ? after.mcp_servers : target.agent === 'OpenCode' ? after.mcp.servers || after.mcp : after.mcpServers;
      const originalConfiguration = target.agent === 'Codex' || target.agent === 'Hermes' ? before.mcp_servers : target.agent === 'OpenCode' ? before.mcp?.servers || before.mcp : before.mcpServers;
      assert.ok(configuration['deepseek-search']);
      if (originalConfiguration?.['deepseek-search']) {
        delete configuration['deepseek-search'].command;
        delete originalConfiguration['deepseek-search'].command;
        if (target.agent !== 'OpenCode') {
          delete configuration['deepseek-search'].args;
          delete originalConfiguration['deepseek-search'].args;
        }
      } else {
        delete configuration['deepseek-search'];
      }
      if (target.agent === 'Hermes' && !before.mcp_servers) delete after.mcp_servers;
    }
    assert.deepEqual(after, before, `${target.agent}: unrelated configuration changed.`);
    console.log(`${target.agent}: registration is valid; original settings preserved.`);
  }
  const dshCli = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  if (existsSync(dshCli)) {
    const { stdout } = await execFileAsync(process.execPath, [dshCli, 'web', '--dump-config'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
    const configuration = parseYaml(stdout);
    const locate = value => {
      if (!value || typeof value !== 'object') return null;
      if (value.id === 'mcp-deepseek-search') return value;
      for (const child of Object.values(value)) {
        const found = locate(child);
        if (found) return found;
      }
      return null;
    };
    const plugin = locate(configuration);
    assert.ok(plugin, 'Harness composed profile is missing the DeepSeek MCP plugin.');
    assert.equal(plugin.config.transport, 'stdio');
    assert.equal(plugin.config.serverName, 'deepseek-search');
    console.log('DeepSeek Harness: the composed web profile includes the shared stdio MCP service.');
  }
} catch (error) {
  console.error(`Registration verification failed: ${error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'See the local configuration and registration report.'}`);
  process.exitCode = 1;
}
