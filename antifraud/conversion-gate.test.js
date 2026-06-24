// antifraud/conversion-gate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken } from './token.js';
import { shouldForwardConversion } from './index.js';

const SECRET = 'conv-secret';
const now = Math.floor(Date.now() / 1000);
const cleanBoth = signToken({ sid: 'x', steps: ['cap1', 'cap2'], score: 90, exp: now + 600, nonce: 'c1' }, SECRET);
const cap1only = signToken({ sid: 'x', steps: ['cap1'], score: 90, exp: now + 600, nonce: 'c2' }, SECRET);

test('observe mode (enforce=false) always forwards', () => {
  assert.equal(shouldForwardConversion({ afToken: undefined, enforce: false, secret: SECRET }), true);
  assert.equal(shouldForwardConversion({ afToken: 'garbage', enforce: false, secret: SECRET }), true);
});

test('enforce mode forwards only a clean cap1+cap2 token', () => {
  assert.equal(shouldForwardConversion({ afToken: cleanBoth, enforce: true, secret: SECRET }), true);
  assert.equal(shouldForwardConversion({ afToken: cap1only, enforce: true, secret: SECRET }), false);
  assert.equal(shouldForwardConversion({ afToken: undefined, enforce: true, secret: SECRET }), false);
});
