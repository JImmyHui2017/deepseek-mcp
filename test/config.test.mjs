import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createKeyProvider, keyStatus } from '../src/config.mjs';

const execFileAsync = promisify(execFile);

test('environment key overrides config, while status never returns a key', async () => {
  const environment = { DEEPSEEK_API_KEY: 'fake-private-test-key', DEEPSEEK_MCP_CONFIG: 'absent.json' };
  const getKey = createKeyProvider({ environment });
  assert.equal(await getKey(), 'fake-private-test-key');
  const status = await keyStatus(getKey, environment);
  assert.equal(status.configured, true);
  assert.equal(status.upstream_verified, false);
  assert.equal(JSON.stringify(status).includes('fake-private-test-key'), false);
});

test('DPAPI configuration decrypts for the current Windows user and reloads after replacement', { skip: process.platform !== 'win32' }, async testContext => {
  const directory = await mkdtemp(join(tmpdir(), 'deepseek-mcp-test-'));
  const path = join(directory, 'config.json');
  testContext.after(async () => { await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; }); await rmdir(directory); });
  const encrypt = async value => {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      '$secret = ConvertTo-SecureString -String $env:DEEPSEEK_FAKE_TEST_KEY -AsPlainText -Force; ConvertFrom-SecureString -SecureString $secret',
    ], { windowsHide: true, env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath')), DEEPSEEK_FAKE_TEST_KEY: value } });
    await writeFile(path, JSON.stringify({ version: 1, api_key_dpapi: stdout.trim() }));
  };
  await encrypt('fake-test-one');
  const getKey = createKeyProvider({ environment: { DEEPSEEK_MCP_CONFIG: path } });
  assert.equal(await getKey(), 'fake-test-one');
  assert.equal(await getKey(), 'fake-test-one');
  await encrypt('fake-test-key-number-two');
  assert.equal(await getKey(), 'fake-test-key-number-two');
  const status = await keyStatus(getKey, { DEEPSEEK_MCP_CONFIG: path });
  assert.equal(status.configured, true);
  assert.equal(JSON.stringify(status).includes('fake-test'), false);
  await writeFile(path, '{invalid json');
  await assert.rejects(getKey(), /Cannot decrypt/);
});
