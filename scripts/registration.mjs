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

function launchSettings(existing, entry, combinedCommand = false) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing) || existing.url || (existing.type && existing.type !== 'local') || (existing.transport && existing.transport !== 'stdio')) {
    throw new Error('The existing entry is not a local stdio server; update it manually.');
  }
  return combinedCommand ? { ...existing, command: entry.command } : { ...existing, command: entry.command, args: entry.args };
}

function updateTomlLaunch(text, entry, expected) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => /^\s*\[mcp_servers\.(?:deepseek-search|"deepseek-search"|'deepseek-search')\]\s*(?:#.*)?$/.test(line));
  if (start < 0) throw new Error('Cannot safely locate the existing Codex table; update it manually.');
  let end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
  if (end < 0) end = lines.length;
  for (const field of ['command', 'args']) {
    const index = lines.findIndex((line, position) => position > start && position < end && new RegExp(`^\\s*(?:${field}|"${field}"|'${field}')\\s*=`).test(line));
    const replacement = `${field} = ${JSON.stringify(entry[field])}`;
    if (index < 0) {
      lines.splice(end++, 0, replacement);
      continue;
    }
    let last = index;
    for (;;) {
      try { parseToml(lines.slice(index, last + 1).join('\n')); break; } catch {
        last += 1;
        if (last >= end) throw new Error('Cannot safely replace the existing Codex launch settings.');
      }
    }
    lines.splice(index, last - index + 1, replacement);
    end -= last - index;
  }
  const updated = lines.join(text.includes('\r\n') ? '\r\n' : '\n');
  if (JSON.stringify(parseToml(updated).mcp_servers[serverName]) !== JSON.stringify(expected)) {
    throw new Error('Updated Codex configuration did not round-trip.');
  }
  return updated;
}

export function renderRegistration(format, original, entry, { updateExisting = false } = {}) {
  const text = original.replace(/^\uFEFF/, '');
  if (format === 'harness') {
    const document = parseDocument(text, { logLevel: 'silent' });
    if (document.errors.length || !Array.isArray(document.toJS())) throw new Error('Existing Harness patch must be a YAML sequence.');
    const findPlugins = (value, path = []) => {
      if (!value || typeof value !== 'object') return [];
      if (value.id === entry.id || (value.name === entry.name && value.config?.serverName === serverName)) return [path];
      return Object.entries(value).flatMap(([key, child]) => findPlugins(child, [...path, Array.isArray(value) ? Number(key) : key]));
    };
    const plugins = findPlugins(document.toJS());
    if (plugins.length) {
      if (!updateExisting) throw new Error('A DeepSeek MCP entry already exists.');
      if (plugins.length !== 1) throw new Error('Multiple DeepSeek Harness entries exist; resolve the duplicate entries manually.');
      const path = [...plugins[0], 'config'];
      const existing = document.getIn(path).toJSON();
      launchSettings(existing, entry.config);
      document.setIn([...path, 'command'], entry.config.command);
      document.setIn([...path, 'args'], entry.config.args);
      return document.toString({ lineWidth: 0 });
    }
    const updated = `${text.trimEnd()}\n${stringifyYaml([{ insert: [entry] }], { lineWidth: 0 })}`;
    if (parseDocument(updated, { logLevel: 'silent' }).errors.length) throw new Error('Generated Harness patch has parse errors.');
    return updated;
  }
  if (format === 'codex') {
    const configuration = parseToml(text);
    const existing = configuration.mcp_servers?.[serverName];
    if (existing) {
      if (!updateExisting) throw new Error('A DeepSeek MCP entry already exists.');
      return updateTomlLaunch(text, entry, launchSettings(existing, entry));
    }
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
    const path = ['mcp_servers', serverName];
    const existing = document.getIn(path);
    if (existing) {
      if (!updateExisting) throw new Error('A DeepSeek MCP entry already exists.');
      launchSettings(existing.toJSON(), entry);
      document.setIn([...path, 'command'], entry.command);
      document.setIn([...path, 'args'], entry.args);
    } else {
      document.setIn(path, entry);
    }
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
  const options = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' } };
  if (existing) {
    if (!updateExisting) throw new Error('A DeepSeek MCP entry already exists.');
    const combinedCommand = format === 'opencode' || format === 'opencode2';
    launchSettings(existing, entry, combinedCommand);
    let updated = applyEdits(text, modify(text, [...configurationPath, 'command'], entry.command, options));
    if (!combinedCommand) updated = applyEdits(updated, modify(updated, [...configurationPath, 'args'], entry.args, options));
    return updated;
  }
  return applyEdits(text, modify(text, configurationPath, entry, options));
}
