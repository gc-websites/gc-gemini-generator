// antifraud/store.test.js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { hit, seenNonce, __reset } from './store.js';

beforeEach(() => __reset());

test('hit increments per key', () => {
  assert.equal(hit('ip:1.2.3.4'), 1);
  assert.equal(hit('ip:1.2.3.4'), 2);
  assert.equal(hit('ip:9.9.9.9'), 1);
});

test('seenNonce is false the first time, true afterwards', () => {
  assert.equal(seenNonce('n-1'), false);
  assert.equal(seenNonce('n-1'), true);
  assert.equal(seenNonce('n-2'), false);
});
