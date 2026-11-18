import { parse as parseJsonc, modify, applyEdits } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { parseDocument, stringify as stringifyYaml } from 'yaml';

export const serverName = 'deepseek-search';

export function buildEntries(command, entrypoint) {
  const args = [entrypoint];
  return {
    generic: { command, args },
    codex: { command, args, startup_timeout_sec: 30, tool_timeout_sec: 60, enabled: true },
    hermes: { command, args, enabled: true, timeout: 60, connect_timeout: 30, supports_parallel_tool_calls: true, tools: { resources: false, prompts: false } },
    opencode: { type: 'local', command: [command, ...args], enabled: true, timeout: 60000 },
    opencode2: { type: 'local', command: [command, ...args], disabled: false, timeout: { catalog: 30000, execution: 60000 } },
    harness: { id: 'mcp-deepseek-search', name: '@deepseek-ai/dsh-mcp-client', config: {
      serverName, transport: 'stdio', command, args, toolCallTimeoutMs: 60000, startupTimeoutMs: 30000,
    } },
  };
}

export function renderRegistration(format, original, entry) {
  const text = original.replace(/^\uFEFF/, '');
  if (format === 'harness') {
    const document = parseDocument(text, { logLevel: 'silent' });
    if (document.errors.length || !Array.isArray(document.toJS())) throw new Error('Existing Harness patch must be a YAML sequence.');
    const containsServer = value => {
      if (!value || typeof value !== 'object') return false;
      if (value.id === entry.id || value.serverName === serverName) return true;
      return Object.values(value).some(containsServer);
    };
    if (containsServer(document.toJS())) throw new Error('A DeepSeek MCP entry already exists.');
    const updated = `${text.trimEnd()}\n${stringifyYaml([{ insert: [entry] }], { lineWidth: 0 })}`;
    if (parseDocument(updated, { logLevel: 'silent' }).errors.length) throw new Error('Generated Harness patch has parse errors.');
    return updated;
  }
  if (format === 'codex') {
    const configuration = parseToml(text);
    if (configuration.mcp_servers?.[serverName]) throw new Error('A DeepSeek MCP entry already exists.');
    const block = `\n[mcp_servers.${serverName}]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\nstartup_timeout_sec = 30\ntool_timeout_sec = 60\nenabled = true\n`;
    const updated = `${text.trimEnd()}\n${block}`;
    const parsed = parseToml(updated);
    if (JSON.stringify(parsed.mcp_servers[serverName]) !== JSON.stringify(entry)) {
      throw new Error('Generated Codex configuration did not round-trip.');
    }
    return updated;
  }
  if (format === 'hermes') {
    const document = parseDocument(text);
    if (document.errors.length) throw new Error('Existing Hermes YAML has parse errors.');
    if (document.getIn(['mcp_servers', serverName])) throw new Error('A DeepSeek MCP entry already exists.');
    document.setIn(['mcp_servers', serverName], entry);
    const updated = document.toString({ lineWidth: 0 });
    const checked = parseDocument(updated);
    if (checked.errors.length) throw new Error('Generated Hermes YAML has parse errors.');
    return updated;
  }
  const errors = [];
  const configuration = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length || !configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
    throw new Error('Existing JSON configuration has parse errors.');
  }
  const configurationPath = format === 'opencode2' ? ['mcp', 'servers', serverName] : [format === 'opencode' ? 'mcp' : 'mcpServers', serverName];
  const existing = configurationPath.reduce((value, key) => value?.[key], configuration);
  if (existing) throw new Error('A DeepSeek MCP entry already exists.');
  return applyEdits(text, modify(text, configurationPath, entry, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' },
  }));
}
