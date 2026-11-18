import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const decryptScript = fileURLToPath(new URL('../scripts/read-key.ps1', import.meta.url));

export function configPath(environment = process.env) {
  return environment.DEEPSEEK_MCP_CONFIG || join(
    environment.APPDATA || (process.platform === 'win32' ? join(homedir(), 'AppData', 'Roaming') : join(homedir(), '.config')),
    'deepseek-search-mcp',
    'config.json',
  );
}

export function createKeyProvider({ environment = process.env, decrypt } = {}) {
  let cachedVersion;
  let cachedKey;
  const path = configPath(environment);
  const decryptKey = decrypt || (async () => {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', decryptScript, '-ConfigPath', path,
    ], {
      windowsHide: true, timeout: 15000, maxBuffer: 16384,
      env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath')),
    });
    return stdout.trim();
  });

  return async function getKey() {
    const environmentKey = environment.DEEPSEEK_API_KEY?.trim();
    if (environmentKey) return environmentKey;
    let metadata;
    try {
      metadata = await stat(path);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('DeepSeek API key is not configured. Run configure.cmd, or set DEEPSEEK_API_KEY in the MCP process environment.');
      }
      throw new Error('Cannot read the DeepSeek key configuration.');
    }
    const version = `${metadata.mtimeMs}:${metadata.size}`;
    if (version === cachedVersion && cachedKey) return cachedKey;
    try {
      const configuration = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
      if (configuration.version !== 1 || typeof configuration.api_key_dpapi !== 'string' || !configuration.api_key_dpapi) {
        throw new Error('Invalid key configuration');
      }
      const key = await decryptKey();
      if (!key || /[\r\n]/.test(key)) throw new Error('Invalid decrypted key');
      cachedKey = key;
      cachedVersion = version;
      return key;
    } catch {
      throw new Error('Cannot decrypt the DeepSeek key for this Windows user. Run configure.cmd again, or set DEEPSEEK_API_KEY.');
    }
  };
}

export async function keyStatus(getKey, environment = process.env) {
  try {
    await getKey();
    return {
      configured: true,
      source: environment.DEEPSEEK_API_KEY?.trim() ? 'DEEPSEEK_API_KEY' : 'Windows DPAPI configuration',
      configuration_path: configPath(environment),
      upstream_verified: false,
    };
  } catch (error) {
    return { configured: false, configuration_path: configPath(environment), message: error.message, upstream_verified: false };
  }
}
