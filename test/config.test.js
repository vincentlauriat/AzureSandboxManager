'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../src/config');

const VALID = {
  SANDBOX_TOKEN: 'token',
  AZURE_SUBSCRIPTION_ID: '00000000-0000-0000-0000-000000000000',
  AZURE_RESOURCE_GROUP: 'rg-example',
};

test('a complete configuration loads with its defaults', () => {
  const config = load({ ...VALID });
  assert.equal(config.collectIntervalMinutes, 10);
  assert.equal(config.port, 8080);
  assert.equal(config.snapshotDir, '/home/azure-sandbox-manager');
  assert.equal(config.selfSiteName, null);
});

test('each missing required variable is named', () => {
  for (const key of Object.keys(VALID)) {
    const incomplete = { ...VALID };
    delete incomplete[key];
    assert.throws(() => load(incomplete), new RegExp(key));
  }
});

test('a non-numeric interval is refused rather than silently defaulted', () => {
  assert.throws(() => load({ ...VALID, COLLECT_INTERVAL_MINUTES: 'ten' }), /must be an integer/);
});

test('the App Service site name is picked up when present', () => {
  const config = load({ ...VALID, WEBSITE_SITE_NAME: 'my-app' });
  assert.equal(config.selfSiteName, 'my-app');
});

test('loading does not leak into the real process environment', () => {
  const before = process.env.SANDBOX_TOKEN;
  load({ ...VALID });
  assert.equal(process.env.SANDBOX_TOKEN, before);
});
