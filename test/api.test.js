'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenMatches } = require('../src/api');

test('the correct token is accepted', () => {
  assert.equal(tokenMatches('s3cret-value', 's3cret-value'), true);
});

test('a wrong token of the same length is rejected', () => {
  assert.equal(tokenMatches('s3cret-valuX', 's3cret-value'), false);
});

test('a token sharing a prefix is rejected', () => {
  // Guards against a comparison that short-circuits on the first difference.
  assert.equal(tokenMatches('s3cret', 's3cret-value'), false);
});

test('a longer token is rejected without throwing', () => {
  // timingSafeEqual throws on length mismatch; hashing first avoids that.
  assert.equal(tokenMatches('s3cret-value-and-more', 's3cret-value'), false);
});

test('an empty or absent token is rejected', () => {
  assert.equal(tokenMatches('', 's3cret-value'), false);
  assert.equal(tokenMatches(undefined, 's3cret-value'), false);
  assert.equal(tokenMatches(null, 's3cret-value'), false);
});

test('a non-string header value is rejected', () => {
  assert.equal(tokenMatches(['a', 'b'], 's3cret-value'), false);
});

// --- Batch 0: the changes route publishes a severity -------------------------------

const { createHandler } = require('../src/api');

function fakeResponse() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.writeHead = (status, headers) => { res.statusCode = status; Object.assign(res.headers, headers ?? {}); };
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.end = (body) => { res.body = body ?? ''; };
  return res;
}

function handlerWith(events) {
  return createHandler({
    config: { token: 's3cret' },
    store: { latest: async () => null },
    log: { read: async () => events },
    runCollection: async () => ({ collectedAt: '2026-09-17T08:00:00.000Z' }),
    now: () => Date.parse('2026-09-17T08:00:00.000Z'),
  });
}

test('the changes route publishes a severity per event', async () => {
  const handle = handlerWith([
    { at: '2026-09-17T08:00:00.000Z', type: 'collector_access_lost', subject: 'governance', detail: {}, collector: 'governance' },
    { at: '2026-09-17T07:50:00.000Z', type: 'probe_status_changed', subject: 'api', detail: {}, collector: 'probes' },
  ]);
  const res = fakeResponse();
  await handle({ url: '/api/v1/changes', method: 'GET', headers: { 'x-sandbox-token': 's3cret' } }, res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.events[0].severity, 'critical');
  assert.equal(body.events[1].severity, 'informational');
});

test('the changes route still refuses a wrong token', async () => {
  const handle = handlerWith([]);
  const res = fakeResponse();
  await handle({ url: '/api/v1/changes', method: 'GET', headers: { 'x-sandbox-token': 'wrong' } }, res);
  assert.equal(res.statusCode, 401);
});
