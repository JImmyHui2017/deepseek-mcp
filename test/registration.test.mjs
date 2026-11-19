import test from 'node:test';
import assert from 'node:assert/strict';
import { parse as parseToml } from 'smol-toml';
import { parse as parseJsonc } from 'jsonc-parser';
import { parse as parseYaml } from 'yaml';
import { buildEntries, renderRegistration } from '../scripts/registration.mjs';
import { getTargets } from '../scripts/targets.mjs';
import { mkdtemp, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

test('moving from Windows paths to a Unicode POSIX directory refreshes only JSONC launch settings', () => {
  const relocated = buildEntries('/opt/node/bin/node', '/home/example/项目 copy/src/index.mjs');
  for (const format of ['claude', 'generic', 'opencode', 'opencode2']) {
    const root = format.startsWith('opencode') ? 'mcp' : 'mcpServers';
    const nested = format === 'opencode2';
    const oldEntry = { ...(entries[format] || entries.generic), env: { TEST_SETTING: 'retain-me' }, enabled: false, timeout: 91000 };
    const initial = { [root]: nested ? { servers: { 'deepseek-search': oldEntry, other: { command: 'keep' } } } : { 'deepseek-search': oldEntry, other: { command: 'keep' } } };
    const original = `// keep my comment\n${JSON.stringify(initial, null, 2)}`;
    const newEntry = relocated[format] || relocated.generic;
    const updated = renderRegistration(format, original, newEntry, { updateExisting: true });
    const parsed = parseJsonc(updated);
    const actual = (nested ? parsed[root].servers : parsed[root])['deepseek-search'];
    assert.deepEqual(actual, { ...oldEntry, command: newEntry.command, ...(format.startsWith('opencode') ? {} : { args: newEntry.args }) });
    assert.match(updated, /keep my comment/);
    assert.deepEqual((nested ? parsed[root].servers : parsed[root]).other, { command: 'keep' });
    assert.equal(renderRegistration(format, updated, newEntry, { updateExisting: true }), updated);
  }
});

test('Codex path refresh handles multiline args and preserves nested environment, comments and disabled state', () => {
  const original = `model = "keep"\n[mcp_servers."deepseek-search"] # keep\ncommand = "old-node"\n# retain\nargs = [\n  "old/path/src/index.mjs",\n]\nenabled = false\ntool_timeout_sec = 90\n[mcp_servers."deepseek-search".env]\nMY_SETTING = "keep"\n[mcp_servers.other]\ncommand = "other"\n`;
  const relocated = buildEntries('/usr/bin/node', '/tmp/项目 copy/src/index.mjs');
  const updated = renderRegistration('codex', original, relocated.codex, { updateExisting: true });
  const expected = parseToml(original);
  expected.mcp_servers['deepseek-search'].command = relocated.codex.command;
  expected.mcp_servers['deepseek-search'].args = relocated.codex.args;
  assert.deepEqual(parseToml(updated), expected);
  assert.match(updated, /# retain/);
  assert.equal(renderRegistration('codex', updated, relocated.codex, { updateExisting: true }), updated);
});

test('Hermes and Harness path refresh preserves plugin settings and JS-tagged expressions', () => {
  const relocated = buildEntries('/usr/bin/node', '/tmp/项目 copy/src/index.mjs');
  const hermes = 'model: keep\nmcp_servers:\n  deepseek-search:\n    command: old-node\n    args: [old-path]\n    env: {SETTING: keep}\n    enabled: false\n    timeout: 91\n';
  const updatedHermes = renderRegistration('hermes', hermes, relocated.hermes, { updateExisting: true });
  const expectedHermes = parseYaml(hermes);
  Object.assign(expectedHermes.mcp_servers['deepseek-search'], { command: relocated.hermes.command, args: relocated.hermes.args });
  assert.deepEqual(parseYaml(updatedHermes), expectedHermes);
  const harness = '- insert:\n    - id: mcp-deepseek-search\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: deepseek-search\n        transport: stdio\n        command: old-node\n        args: [old-path]\n        env:\n          SETTING: !!js process.env.TEST_SETTING\n        toolCallTimeoutMs: 91000\n';
  const updatedHarness = renderRegistration('harness', harness, relocated.harness, { updateExisting: true });
  assert.match(updatedHarness, /!!js process.env.TEST_SETTING/);
  assert.match(updatedHarness, /toolCallTimeoutMs: 91000/);
  assert.match(updatedHarness, /command: \/usr\/bin\/node/);
  assert.match(updatedHarness, /项目 copy/);
  assert.equal(renderRegistration('harness', updatedHarness, relocated.harness, { updateExisting: true }), updatedHarness);
});

test('path refresh refuses to replace a remote MCP entry', () => {
  const remote = '{"mcpServers":{"deepseek-search":{"url":"https://example.com/mcp"}}}';
  assert.throws(() => renderRegistration('generic', remote, entries.generic, { updateExisting: true }), /not a local stdio/);
});

test('client discovery respects custom homes, OS defaults and an OpenCode JSON configuration', async testContext => {
  const home = await mkdtemp(join(tmpdir(), 'deepseek-targets-'));
  const opencodeDirectory = join(home, 'xdg', 'opencode');
  await mkdir(opencodeDirectory, { recursive: true });
  const jsonPath = join(opencodeDirectory, 'opencode.json');
  const jsoncPath = join(opencodeDirectory, 'opencode.jsonc');
  testContext.after(async () => {
    await unlink(jsonPath);
    await unlink(jsoncPath);
    await rmdir(opencodeDirectory);
    await rmdir(join(home, 'xdg'));
    await rmdir(home);
  });
  await writeFile(jsonPath, '{}');
  const environment = {
    CODEX_HOME: join(home, 'codex'), HERMES_HOME: join(home, 'hermes'),
    DSH_HOME: join(home, 'dsh'), XDG_CONFIG_HOME: join(home, 'xdg'),
  };
  const targets = getTargets(entries, { home, environment, platform: 'linux' });
  assert.equal(targets.find(target => target.agent === 'Codex').path, join(environment.CODEX_HOME, 'config.toml'));
  assert.equal(targets.find(target => target.agent === 'Hermes').path, join(environment.HERMES_HOME, 'config.yaml'));
  assert.equal(targets.find(target => target.format === 'harness').path, join(environment.DSH_HOME, 'cordis.patch.yml'));
  assert.equal(targets.find(target => target.agent === 'OpenCode').path, jsonPath);
  await writeFile(jsoncPath, '{}');
  assert.equal(getTargets(entries, { home, environment }).find(target => target.agent === 'OpenCode').path, jsoncPath);
  const windowsDefault = getTargets(entries, { home, environment: {}, platform: 'win32' });
  assert.equal(windowsDefault.find(target => target.agent === 'Hermes').path, join(home, 'AppData', 'Local', 'hermes', 'config.yaml'));
});
