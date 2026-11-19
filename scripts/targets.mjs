import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function getTargets(entries, { home = homedir(), environment = process.env, platform = process.platform } = {}) {
  const configHome = environment.XDG_CONFIG_HOME || join(home, '.config');
  const hermesHome = environment.HERMES_HOME || (platform === 'win32' ? join(environment.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'hermes') : join(home, '.hermes'));
  const opencodeHome = join(configHome, 'opencode');
  // OpenCode supports either JSON or JSONC. Prefer the JSONC file when both exist.
  const opencodePath = existsSync(join(opencodeHome, 'opencode.jsonc')) ? join(opencodeHome, 'opencode.jsonc') : join(opencodeHome, 'opencode.json');
  return [
    { agent: 'Codex', path: join(environment.CODEX_HOME || join(home, '.codex'), 'config.toml'), format: 'codex', entry: entries.codex },
    { agent: 'Claude Code', path: join(home, '.claude.json'), format: 'claude', entry: entries.generic },
    { agent: 'Hermes', path: join(hermesHome, 'config.yaml'), format: 'hermes', entry: entries.hermes },
    { agent: 'DeepSeek Harness (all profiles)', path: join(environment.DSH_HOME || join(home, '.dsh'), 'cordis.patch.yml'), format: 'harness', entry: entries.harness },
    { agent: 'OpenCode', path: opencodePath, format: 'opencode', entry: entries.opencode },
    { agent: 'Cursor', path: join(home, '.cursor', 'mcp.json'), format: 'generic', entry: entries.generic },
    { agent: 'Gemini CLI', path: join(home, '.gemini', 'settings.json'), format: 'generic', entry: { ...entries.generic, timeout: 60000 } },
  ];
}
