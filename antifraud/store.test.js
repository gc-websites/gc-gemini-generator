// antifraud/store.test.js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { hit, bumpNonce, __reset } from './store.js';

beforeEach(() => __reset());

test('hit increments per key', () => {
  assert.equal(hit('ip:1.2.3.4'), 1);
  assert.equal(hit('ip:1.2.3.4'), 2);
  assert.equal(hit('ip:9.9.9.9'), 1);
});

test('bumpNonce increments per nonce and is independent per key', () => {
  assert.equal(bumpNonce('n-1'), 1);
  assert.equal(bumpNonce('n-1'), 2);
  assert.equal(bumpNonce('n-1'), 3);
  assert.equal(bumpNonce('n-2'), 1);
});
