import { copyFile, readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parse as parseJsonc } from 'jsonc-parser';
import { stringify as stringifyYaml } from 'yaml';
import { buildEntries, renderRegistration, serverName } from './registration.mjs';
import { getTargets } from './targets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const entrypoint = join(root, 'src', 'index.mjs');
const entries = buildEntries(process.execPath, entrypoint);
const targets = getTargets(entries);
const apply = process.argv.includes('--apply');
const updateExisting = process.argv.includes('--update');
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
    try { after = renderRegistration(target.format, before, target.entry, { updateExisting }); } catch (error) {
      if (error.message === 'A DeepSeek MCP entry already exists.') {
        console.log(`${target.agent}: entry exists. Run with --update to refresh its Node and source paths after moving this installation.`);
        continue;
      }
      throw new Error(`${target.agent}: ${error.message}`);
    }
    if (after === before) { console.log(`${target.agent}: already up to date.`); continue; }
    if (!apply) { console.log(`${target.agent}: would ${updateExisting ? 'add/update' : 'add'} ${serverName} in ${target.path}`); continue; }
    if (await readFile(target.path, 'utf8') !== before) throw new Error(`${target.agent}: configuration changed while preparing; rerun registration.`);
    const backup = `${target.path}.deepseek-backup-${timestamp}`;
    await copyFile(target.path, backup);
    await atomicWrite(target.path, after);
    changed.push({ ...target, before, after, backup });
    console.log(`${target.agent}: registered; backup ${backup}`);
  }
  const examplesDirectory = join(root, 'local-client-configs');
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
