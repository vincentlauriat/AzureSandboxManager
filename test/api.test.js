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
