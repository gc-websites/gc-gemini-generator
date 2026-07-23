// antifraud/adscore.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeV5, inspectSignature, ipToBytes, AdscoreError } from './adscore.js';
import { buildV5Signature, TEST_KEY, TEST_KEY_B64 } from './testsupport.adscore.js';

process.env.ADSCORE_ZONE_ID = '400039';
process.env.ADSCORE_RESPONSE_KEY = TEST_KEY_B64;

const UA = 'Mozilla/5.0 (iPhone) musical_ly BytedanceWebview';
const cleanPayload = { result: 0, 'b.ua': UA, 'ipv4.ip': '203.0.113.7', sub_id: 'sid-1' };

test('decodeV5 round-trips a synthetic signature', () => {
  const sig = buildV5Signature({ payload: cleanPayload });
  const { zoneId, payload } = decodeV5(sig, () => TEST_KEY);
  assert.equal(zoneId, 400039);
  assert.deepEqual(payload, cleanPayload);
});

test('inspectSignature judges clean traffic with strict pass', () => {
  const sig = buildV5Signature({ payload: cleanPayload });
  const r = inspectSignature({ signature: sig, ips: ['203.0.113.7'], ua: UA });
  assert.equal(r.ok, true);
  assert.equal(r.verdict, 'ok');
  assert.equal(r.name, 'Clean');
  assert.equal(r.strict, true);
  assert.equal(r.strictReason, null);
  assert.equal(r.zoneMatch, true);
  assert.equal(r.subId, 'sid-1');
});

test('inspectSignature maps all four verdicts', () => {
  for (const [result, verdict] of [[0, 'ok'], [3, 'junk'], [6, 'proxy'], [9, 'bot']]) {
    const sig = buildV5Signature({ payload: { ...cleanPayload, result } });
    const r = inspectSignature({ signature: sig, ips: ['203.0.113.7'], ua: UA });
    assert.equal(r.verdict, verdict);
  }
});

test('IP mismatch keeps the verdict but drops strict', () => {
  const sig = buildV5Signature({ payload: cleanPayload });
  const r = inspectSignature({ signature: sig, ips: ['198.51.100.9'], ua: UA });
  assert.equal(r.ok, true);
  assert.equal(r.strict, false);
  assert.equal(r.strictReason, 'ip_mismatch');
  assert.equal(r.verdict, 'ok');
});

test('UA mismatch keeps the verdict but drops strict', () => {
  const sig = buildV5Signature({ payload: cleanPayload });
  const r = inspectSignature({ signature: sig, ips: ['203.0.113.7'], ua: 'other UA' });
  assert.equal(r.strict, false);
  assert.equal(r.strictReason, 'ua_mismatch');
});

test('ipv4.v prefix length is honored (bytes, like the official lib)', () => {
  const sig = buildV5Signature({ payload: { ...cleanPayload, 'ipv4.v': 2 } });
  const r = inspectSignature({ signature: sig, ips: ['203.0.200.200'], ua: UA });
  assert.equal(r.strict, true, 'first two bytes match → strict');
});

test('ipv6 addresses verify strictly', () => {
  const payload = { result: 0, 'b.ua': UA, 'ipv6.ip': '2001:db8::5' };
  const sig = buildV5Signature({ payload });
  const r = inspectSignature({ signature: sig, ips: ['2001:db8:0:0:0:0:0:5'], ua: UA });
  assert.equal(r.strict, true);
});

test('tampered ciphertext fails decryption', () => {
  const sig = buildV5Signature({ payload: cleanPayload });
  const raw = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/') + '==', 'base64');
  raw[raw.length - 1] ^= 0xff;
  const r = inspectSignature({ signature: raw.toString('base64url'), ips: ['203.0.113.7'], ua: UA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'decrypt_failed');
});

test('wrong key fails decryption', () => {
  const sig = buildV5Signature({ payload: cleanPayload, key: Buffer.alloc(32, 9) });
  const r = inspectSignature({ signature: sig, ips: ['203.0.113.7'], ua: UA });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'decrypt_failed');
});

test('unsupported version / method / struct are rejected with reasons', () => {
  assert.throws(() => decodeV5(buildV5Signature({ version: 4 }), () => TEST_KEY), (e) => e instanceof AdscoreError && e.reason === 'bad_version');
  assert.throws(() => decodeV5(buildV5Signature({ method: 0x0200 }), () => TEST_KEY), (e) => e.reason === 'unsupported_method');
  assert.throws(() => decodeV5(buildV5Signature({ structType: 'S' }), () => TEST_KEY), (e) => e.reason === 'unsupported_struct');
});

test('truncated and garbage input are rejected, not thrown through inspect', () => {
  const sig = buildV5Signature({ payload: cleanPayload });
  assert.equal(inspectSignature({ signature: sig.slice(0, 20), ips: [], ua: '' }).ok, false);
  assert.equal(inspectSignature({ signature: '!!!not-base64!!!', ips: [], ua: '' }).ok, false);
  assert.equal(inspectSignature({ signature: '', ips: [], ua: '' }).ok, false);
});

test('zone mismatch is flagged', () => {
  const sig = buildV5Signature({ zoneId: 111, payload: cleanPayload });
  const r = inspectSignature({ signature: sig, ips: ['203.0.113.7'], ua: UA });
  assert.equal(r.ok, true);
  assert.equal(r.zoneMatch, false);
});

test('unconfigured key reports unconfigured', () => {
  const saved = process.env.ADSCORE_RESPONSE_KEY;
  delete process.env.ADSCORE_RESPONSE_KEY;
  const r = inspectSignature({ signature: 'whatever', ips: [], ua: '' });
  assert.deepEqual(r, { ok: false, reason: 'unconfigured' });
  process.env.ADSCORE_RESPONSE_KEY = saved;
});

test('ipToBytes handles v4, v6, compressed and mapped forms', () => {
  assert.deepEqual([...ipToBytes('1.2.3.4')], [1, 2, 3, 4]);
  assert.equal(ipToBytes('2001:db8::1').length, 16);
  assert.deepEqual(ipToBytes('::ffff:1.2.3.4').subarray(12).toString('hex'), '01020304');
  assert.equal(ipToBytes('999.1.1.1'), null);
  assert.equal(ipToBytes('not-an-ip'), null);
  assert.equal(ipToBytes(''), null);
});
