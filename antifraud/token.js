// antifraud/token.js
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function hmac(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest();
}

export function signToken(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(hmac(body, secret));
  return `v1.${body}.${sig}`;
}

export function verifyToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return { valid: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return { valid: false, reason: 'malformed' };
  const [, body, sig] = parts;
  const expected = hmac(body, secret);
  let given;
  try { given = Buffer.from(sig, 'base64url'); } catch { return { valid: false, reason: 'malformed' }; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { valid: false, reason: 'bad_signature' };
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { return { valid: false, reason: 'malformed' }; }
  if (payload.exp != null && now > Number(payload.exp) * 1000) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, payload };
}
