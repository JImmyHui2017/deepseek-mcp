import test from 'node:test';
import assert from 'node:assert/strict';
import { parse as parseToml } from 'smol-toml';
import { parse as parseJsonc } from 'jsonc-parser';
import { parse as parseYaml } from 'yaml';
import { buildEntries, renderRegistration } from '../scripts/registration.mjs';

const entries = buildEntries('C:\\Program Files\\nodejs\\node.exe', 'C:\\My Project\\src\\index.mjs');

test('Codex TOML registration preserves existing settings and round-trips Windows paths', () => {
  const original = 'model = "example"\n[mcp_servers.other]\ncommand = "other"\n';
  const updated = renderRegistration('codex', original, entries.codex);
  const parsed = parseToml(updated);
  assert.equal(parsed.model, 'example');
  assert.equal(parsed.mcp_servers.other.command, 'other');
  assert.deepEqual({ ...parsed.mcp_servers['deepseek-search'] }, entries.codex);
  assert.throws(() => renderRegistration('codex', updated, entries.codex), /already exists/);
});

test('JSONC registration preserves comments and other MCP entries', () => {
  for (const format of ['claude', 'opencode']) {
    const root = format === 'opencode' ? 'mcp' : 'mcpServers';
    const original = `{\n// retain this\n"model":"example", "${root}": {"other":{"command":"other"},},\n}`;
    const entry = format === 'opencode' ? entries.opencode : entries.generic;
    const updated = renderRegistration(format, original, entry);
    assert.match(updated, /retain this/);
    assert.equal(parseJsonc(updated)[root].other.command, 'other');
    assert.deepEqual(parseJsonc(updated)[root]['deepseek-search'], entry);
    assert.throws(() => renderRegistration(format, updated, entry), /already exists/);
  }
});

test('Hermes YAML registration preserves existing config values and comments', () => {
  const original = '# keep this\nmodel:\n  default: example\nmcp_servers:\n  other:\n    command: other\n';
  const updated = renderRegistration('hermes', original, entries.hermes);
  assert.match(updated, /keep this/);
  assert.equal(parseYaml(updated).model.default, 'example');
  assert.equal(parseYaml(updated).mcp_servers.other.command, 'other');
  assert.deepEqual(parseYaml(updated).mcp_servers['deepseek-search'], entries.hermes);
  assert.throws(() => renderRegistration('hermes', updated, entries.hermes), /already exists/);
});

test('OpenCode 2 registration uses mcp.servers, disabled and separate timeouts', () => {
  const original = '{"mcp":{"servers":{"other":{"type":"local","command":["other"]}}}}';
  const updated = renderRegistration('opencode2', original, entries.opencode2);
  const parsed = parseJsonc(updated);
  assert.equal(parsed.mcp.servers.other.type, 'local');
  assert.deepEqual(parsed.mcp.servers['deepseek-search'], entries.opencode2);
  assert.equal(parsed.mcp['deepseek-search'], undefined);
});

test('Harness global patch appends a standard stdio plugin and retains existing JS-tagged YAML verbatim', () => {
  const original = '- id: original\n  config:\n    expression: !!js process.env.EXAMPLE\n';
  const updated = renderRegistration('harness', original, entries.harness);
  assert.equal(updated.startsWith(original), true);
  assert.match(updated, /transport: stdio/);
  assert.match(updated, /serverName: deepseek-search/);
  assert.throws(() => renderRegistration('harness', updated, entries.harness), /already exists/);
});
