'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { probeApps, probeOne } = require('../src/probe');

const apps = [
  { name: 'alpha', url: 'https://alpha.example' },
  { name: 'beta', url: 'https://beta.example' },
  { name: 'self', url: 'https://self.example' },
];

test('the manager excludes itself from its own probes', async () => {
  const probed = [];
  const fetchImpl = async (url) => {
    probed.push(url);
    return { status: 200 };
  };
  const results = await probeApps(apps, { selfSiteName: 'self', fetchImpl });

  assert.deepEqual(results.map((r) => r.app), ['alpha', 'beta']);
  assert.equal(probed.includes('https://self.example'), false);
});

test('apps without a URL are skipped', async () => {
  const results = await probeApps([{ name: 'nourl', url: null }], { fetchImpl: async () => ({ status: 200 }) });
  assert.deepEqual(results, []);
});

test('an HTTP status and latency are recorded', async () => {
  const result = await probeOne(apps[0], { fetchImpl: async () => ({ status: 503 }), now: mockClock([0, 120]) });
  assert.equal(result.httpStatus, 503);
  assert.equal(result.latencyMs, 120);
  assert.equal(result.error, null);
});

test('a timeout is recorded as information, not a crash', async () => {
  const fetchImpl = async (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });

  const result = await probeOne(apps[0], { fetchImpl, timeoutMs: 10 });
  assert.equal(result.error, 'timeout');
  assert.equal(result.httpStatus, null);
});

test('a network failure is recorded with its message', async () => {
  const result = await probeOne(apps[0], {
    fetchImpl: async () => {
      throw new Error('ENOTFOUND');
    },
  });
  assert.equal(result.httpStatus, null);
  assert.match(result.error, /ENOTFOUND/);
});

function mockClock(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}
