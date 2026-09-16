'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runCollector } = require('../src/collect');
const { ArmAccessError } = require('../src/arm');

test('a successful collector reports ok with its data', async () => {
  const result = await runCollector(async () => [1, 2, 3]);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data, [1, 2, 3]);
  assert.equal(result.message, null);
});

test('an authorisation failure reports denied, not error', async () => {
  const result = await runCollector(async () => {
    throw new ArmAccessError('AuthorizationFailed', { status: 403, code: 'AuthorizationFailed' });
  });
  assert.equal(result.status, 'denied');
  assert.equal(result.data, null);
  assert.match(result.message, /AuthorizationFailed/);
});

test('a not-found is treated as denied', async () => {
  // ARM answers 404 for an identity with no assignment at all, not 403.
  const result = await runCollector(async () => {
    throw new ArmAccessError('Subscription not found', { status: 404 });
  });
  assert.equal(result.status, 'denied');
});

test('an unexpected failure reports error', async () => {
  const result = await runCollector(async () => {
    throw new Error('socket hang up');
  });
  assert.equal(result.status, 'error');
  assert.match(result.message, /socket hang up/);
});

test('one collector failing does not affect another', async () => {
  const [bad, good] = await Promise.all([
    runCollector(async () => {
      throw new ArmAccessError('denied', { status: 403 });
    }),
    runCollector(async () => 'still here'),
  ]);
  assert.equal(bad.status, 'denied');
  assert.equal(good.status, 'ok');
  assert.equal(good.data, 'still here');
});
