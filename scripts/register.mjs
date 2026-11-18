import { copyFile, readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parse as parseJsonc } from 'jsonc-parser';
import { stringify as stringifyYaml } from 'yaml';
import { buildEntries, renderRegistration, serverName } from './registration.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const entrypoint = join(root, 'src', 'index.mjs');
const entries = buildEntries(process.execPath, entrypoint);
const hermesHome = process.env.HERMES_HOME || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'hermes') : join(homedir(), '.hermes'));
const targets = [
  { agent: 'Codex', path: join(homedir(), '.codex', 'config.toml'), format: 'codex', entry: entries.codex },
  { agent: 'Claude Code', path: join(homedir(), '.claude.json'), format: 'claude', entry: entries.generic },
  { agent: 'Hermes', path: join(hermesHome, 'config.yaml'), format: 'hermes', entry: entries.hermes },
  { agent: 'DeepSeek Harness (all profiles)', path: join(homedir(), '.dsh', 'cordis.patch.yml'), format: 'harness', entry: entries.harness },
  { agent: 'OpenCode', path: join(homedir(), '.config', 'opencode', 'opencode.jsonc'), format: 'opencode', entry: entries.opencode },
  { agent: 'Cursor', path: join(homedir(), '.cursor', 'mcp.json'), format: 'generic', entry: entries.generic },
  { agent: 'Gemini CLI', path: join(homedir(), '.gemini', 'settings.json'), format: 'generic', entry: { ...entries.generic, timeout: 60000 } },
];
const apply = process.argv.includes('--apply');
const changed = [];
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

async function atomicWrite(path, text) {
  const temporary = `${path}.deepseek-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

try {
  let previousServers = [];
  try {
    previousServers = JSON.parse(await readFile(join(root, 'registration-report.json'), 'utf8')).servers || [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot read the existing registration report.');
  }
  for (const target of targets) {
    let before;
    try { before = await readFile(target.path, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') { console.log(`${target.agent}: no existing configuration; skipped.`); continue; }
      throw new Error(`${target.agent}: cannot read its configuration.`);
    }
    if (target.format === 'opencode' && parseJsonc(before)?.mcp?.servers) {
      target.format = 'opencode2';
      target.entry = entries.opencode2;
    }
    let after;
    try { after = renderRegistration(target.format, before, target.entry); } catch (error) {
      if (error.message === 'A DeepSeek MCP entry already exists.') {
        console.log(`${target.agent}: entry exists; left unchanged. Verify its path if this installation moved.`);
        continue;
      }
      throw new Error(`${target.agent}: ${error.message}`);
    }
    if (!apply) { console.log(`${target.agent}: would add ${serverName} to ${target.path}`); continue; }
    if (await readFile(target.path, 'utf8') !== before) throw new Error(`${target.agent}: configuration changed while preparing; rerun registration.`);
    const backup = `${target.path}.deepseek-backup-${timestamp}`;
    await copyFile(target.path, backup);
    await atomicWrite(target.path, after);
    changed.push({ ...target, before, after, backup });
    console.log(`${target.agent}: registered; backup ${backup}`);
  }
  const examplesDirectory = join(root, 'client-configs');
  if (apply) {
    await mkdir(examplesDirectory, { recursive: true });
    await writeFile(join(examplesDirectory, 'standard-mcp.json'), `${JSON.stringify({ mcpServers: { [serverName]: entries.generic } }, null, 2)}\n`);
    await writeFile(join(examplesDirectory, 'opencode-mcp.json'), `${JSON.stringify({ mcp: { [serverName]: entries.opencode } }, null, 2)}\n`);
    await writeFile(join(examplesDirectory, 'opencode2-mcp.json'), `${JSON.stringify({ mcp: { servers: { [serverName]: entries.opencode2 } } }, null, 2)}\n`);
    await writeFile(join(examplesDirectory, 'harness.patch.yml'), stringifyYaml([{ insert: [entries.harness] }], { lineWidth: 0 }));
    const registrations = new Map(previousServers.map(entry => [entry.path, entry]));
    for (const { agent, path, backup } of changed) registrations.set(path, { agent, path, backup });
    await writeFile(join(root, 'registration-report.json'), `${JSON.stringify({ registered_at: new Date().toISOString(), servers: [...registrations.values()], entrypoint }, null, 2)}\n`);
  } else {
    console.log('Dry run only. Pass --apply to register and save client examples.');
  }
} catch (error) {
  console.error(`Registration failed: ${error.message}`);
  for (const target of changed.reverse()) {
    if (await readFile(target.path, 'utf8') === target.after) {
      await atomicWrite(target.path, target.before);
      console.error(`${target.agent}: restored its original configuration.`);
    } else {
      console.error(`${target.agent}: changed since registration; restore from ${target.backup} if needed.`);
    }
  }
  process.exitCode = 1;
}
