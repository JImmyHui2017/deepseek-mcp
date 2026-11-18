import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, Gate } from '../src/api.mjs';

test('search uses the fixed official endpoint and passes only supplied API parameters', async () => {
  const calls = [];
  const api = createApi({ getKey: async () => 'fake-test-key', fetchImpl: async (...args) => {
    calls.push(args);
    return Response.json({ results: [] });
  } });
  const result = await api('search', { query: '测试', need_content: true });
  assert.deepEqual(result, { data: { results: [] }, attempts: 1 });
  assert.equal(calls[0][0], 'https://api.deepseek.com/v1/tools/search');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer fake-test-key');
  assert.equal(calls[0][1].redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0][1].body), { query: '测试', need_content: true });
});

test('401, 402 and 404 are not retried or allowed to echo upstream secrets', async () => {
  for (const status of [401, 402, 404]) {
    let calls = 0;
    const api = createApi({ getKey: async () => 'fake-test-key', fetchImpl: async () => {
      calls += 1;
      return Response.json({ error: { message: 'Your key fake-test-key failed' } }, { status });
    } });
    await assert.rejects(api('fetch', { url: 'https://example.com' }), error => error.status === status && !error.message.includes('fake-test-key'));
    assert.equal(calls, 1);
  }
});

test('429 and server errors retry once, respecting Retry-After and the total deadline', async () => {
  let calls = 0;
  const waits = [];
  const api = createApi({ getKey: async () => 'test-key', sleep: async duration => waits.push(duration), fetchImpl: async () => {
    calls += 1;
    if (calls === 1) return Response.json({}, { status: 429, headers: { 'Retry-After': '1' } });
    return Response.json({ content: 'OK' });
  } });
  const result = await api('fetch', { url: 'https://example.com' });
  assert.equal(result.attempts, 2);
  assert.deepEqual(waits, [1000]);
  let failedCalls = 0;
  const failing = createApi({ getKey: async () => 'test-key', sleep: async () => {}, fetchImpl: async () => {
    failedCalls += 1;
    return Response.json({}, { status: 503 });
  } });
  await assert.rejects(failing('search', { query: 'x' }), error => error.status === 503 && error.attempts === 2);
  assert.equal(failedCalls, 2);
});

test('ambiguous network failures and malformed successful responses do not retry', async () => {
  for (const fetchImpl of [async () => { throw new Error('network contains secret'); }, async () => new Response('invalid JSON'), async () => Response.json({})]) {
    let calls = 0;
    const api = createApi({ getKey: async () => 'test-key', fetchImpl: async (...args) => { calls += 1; return fetchImpl(...args); } });
    await assert.rejects(api('search', { query: 'x' }), error => ['network_error', 'invalid_response'].includes(error.code) && !error.message.includes('secret'));
    assert.equal(calls, 1);
  }
});

test('caller cancellation reaches the upstream request and releases its queue slot', async () => {
  const controller = new AbortController();
  const api = createApi({ getKey: async () => 'test-key', fetchImpl: async (url, { signal }) => {
    controller.abort();
    signal.throwIfAborted();
  } });
  await assert.rejects(api('search', { query: 'x' }, controller.signal), error => error.code === 'cancelled');
  const gate = new Gate(1);
  const order = [];
  let release;
  const first = gate.run(async () => { await new Promise(resolve => { release = resolve; }); order.push('first'); });
  const cancelled = new AbortController();
  const second = gate.run(async () => order.push('second'), cancelled.signal);
  cancelled.abort();
  await assert.rejects(second);
  const third = gate.run(async () => order.push('third'));
  release();
  await Promise.all([first, third]);
  assert.deepEqual(order, ['first', 'third']);
});

test('a total timeout aborts body reading and returns a safe error', async () => {
  const api = createApi({ getKey: async () => 'test-key', timeoutMs: 20, fetchImpl: async (url, { signal }) => {
    return { ok: true, json: () => new Promise((resolve, reject) => {
      const keepAlive = setTimeout(() => resolve({ results: [] }), 1000);
      signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(signal.reason); }, { once: true });
    }) };
  } });
  await assert.rejects(api('search', { query: 'x' }), error => error.code === 'timeout');
});
