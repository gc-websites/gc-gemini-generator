// antifraud/token.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from './token.js';

const SECRET = 'test-secret-key';

test('signToken returns a v1 three-part token', () => {
  const t = signToken({ sid: 'abc', steps: ['cap1'], exp: 9999999999 }, SECRET);
  assert.match(t, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('verifyToken accepts a freshly signed token and returns the payload', () => {
  const t = signToken({ sid: 'abc', steps: ['cap1'], exp: 9999999999 }, SECRET);
  const r = verifyToken(t, SECRET, 1000);
  assert.equal(r.valid, true);
  assert.equal(r.payload.sid, 'abc');
  assert.deepEqual(r.payload.steps, ['cap1']);
});

test('verifyToken rejects a tampered payload', () => {
  const t = signToken({ sid: 'abc', steps: ['cap1'], exp: 9999999999 }, SECRET);
  const [v, body, sig] = t.split('.');
  const forged = [v, Buffer.from('{"sid":"evil","steps":["cap1","cap2"]}').toString('base64url'), sig].join('.');
  assert.equal(verifyToken(forged, SECRET, 1000).valid, false);
});

test('verifyToken rejects a wrong secret', () => {
  const t = signToken({ sid: 'abc', exp: 9999999999 }, SECRET);
  assert.equal(verifyToken(t, 'other-secret', 1000).valid, false);
});

test('verifyToken rejects an expired token (exp in seconds vs now in ms)', () => {
  const t = signToken({ sid: 'abc', exp: 100 }, SECRET); // exp = 100s
  const r = verifyToken(t, SECRET, 200 * 1000);          // now = 200s
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'expired');
});

test('verifyToken rejects malformed input', () => {
  assert.equal(verifyToken('garbage', SECRET).valid, false);
  assert.equal(verifyToken('v1.only-two', SECRET).valid, false);
});
