// antifraud/adscore.js
//
// Adscore signature verification — a self-contained port of the v5_0201J branch
// (AES-256-GCM + JSON) of the official parser (github.com/Adscore/nodejs-common,
// MIT). Ported rather than depended on: the npm package cannot be require()d on
// current Node (its `locutus/php/network` import is broken by locutus' exports
// map), and our zone is pinned to exactly this one algorithm, chosen because it
// needs nothing beyond node:crypto.
//
// Wire format (signature5.js of the official lib is the reference):
//   base64url(signature) →
//     [0]      version  uint8   must be 5
//     [1..2]   length   uint16 BE  — byte length of the encrypted payload
//     [3..10]  zone_id  uint64 BE
//     [11...]  encrypted payload:
//       [0..1]   method uint16 LE — 0x0201 = aes-256-gcm
//       [2..13]  IV (12 B)
//       [14..29] GCM auth tag (16 B)
//       [30...]  ciphertext
//   plaintext = 'J' + JSON → { result, 'b.ua', 'ipv4.ip', 'ipv4.v', 'ipv6.ip', ... }
//
// Decryption does not depend on the visitor's IP/UA (v5 property). The strict
// verify step (IP prefix + exact UA match, same rules as the official lib) can
// still fail for webview traffic whose egress IP shifted between Adscore's
// measurement and our beacon — in that case the verdict is kept with strict:false
// instead of being discarded.

import crypto from 'node:crypto';

export const ADSCORE_VERDICTS = {
  0: { verdict: 'ok', name: 'Clean' },
  3: { verdict: 'junk', name: 'Potentially unwanted' },
  6: { verdict: 'proxy', name: 'Proxy' },
  9: { verdict: 'bot', name: 'Bot' },
};

const METHOD_AES_256_GCM = 0x0201;
const HEADER_LENGTH = 11;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function b64urlDecode(s) {
  const normalized = String(s).trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const buf = Buffer.from(padded, 'base64');
  if (buf.length === 0) return null;
  return buf;
}

// Dotted-quad or RFC-4291 textual IPv6 → raw bytes (4 or 16). Null when unparseable.
export function ipToBytes(ip) {
  if (typeof ip !== 'string' || !ip) return null;
  const clean = ip.split('%')[0];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) {
    const parts = clean.split('.').map(Number);
    if (parts.some((p) => p > 255)) return null;
    return Buffer.from(parts);
  }
  if (!clean.includes(':')) return null;
  let head = clean;
  let tail = '';
  const dc = clean.indexOf('::');
  if (dc !== -1) {
    head = clean.slice(0, dc);
    tail = clean.slice(dc + 2);
    if (tail.includes('::')) return null;
  }
  const expand = (part) => {
    if (!part) return [];
    const groups = [];
    for (const g of part.split(':')) {
      if (g.includes('.')) {
        const v4 = ipToBytes(g);
        if (!v4 || v4.length !== 4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        groups.push(parseInt(g, 16));
      }
    }
    return groups;
  };
  const h = expand(head);
  const t = expand(tail);
  if (h === null || t === null) return null;
  const missing = 8 - h.length - t.length;
  if (missing < 0 || (dc === -1 && missing !== 0)) return null;
  const groups = [...h, ...Array(missing).fill(0), ...t];
  const buf = Buffer.alloc(16);
  groups.forEach((g, i) => buf.writeUInt16BE(g, i * 2));
  return buf;
}

export class AdscoreError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.reason = reason;
  }
}

// Parses + decrypts a v5_0201J signature. keyForZone(zoneId) → Buffer(32).
export function decodeV5(signature, keyForZone) {
  const raw = typeof signature === 'string' ? b64urlDecode(signature) : null;
  if (!raw) throw new AdscoreError('bad_base64');
  if (raw.length <= HEADER_LENGTH) throw new AdscoreError('malformed');
  const version = raw.readUInt8(0);
  if (version !== 5) throw new AdscoreError('bad_version', `signature version ${version}`);
  const length = raw.readUInt16BE(1);
  const zoneId = Number(raw.readBigUInt64BE(3));
  const encrypted = raw.subarray(HEADER_LENGTH, HEADER_LENGTH + length);
  if (encrypted.length < length || encrypted.length < 2 + IV_LENGTH + TAG_LENGTH) {
    throw new AdscoreError('truncated');
  }
  const method = encrypted.readUInt16LE(0);
  if (method !== METHOD_AES_256_GCM) {
    throw new AdscoreError('unsupported_method', `crypt method 0x${method.toString(16)}`);
  }
  const key = keyForZone(zoneId);
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new AdscoreError('bad_key');
  const iv = encrypted.subarray(2, 2 + IV_LENGTH);
  const tag = encrypted.subarray(2 + IV_LENGTH, 2 + IV_LENGTH + TAG_LENGTH);
  const ciphertext = encrypted.subarray(2 + IV_LENGTH + TAG_LENGTH);
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new AdscoreError('decrypt_failed');
  }
  if (plaintext.length < 2) throw new AdscoreError('empty_payload');
  const structType = String.fromCharCode(plaintext[0]);
  if (structType !== 'J') {
    throw new AdscoreError('unsupported_struct', `struct type ${structType}`);
  }
  let payload;
  try {
    payload = JSON.parse(plaintext.subarray(1).toString('utf8'));
  } catch {
    throw new AdscoreError('payload_parse_failed');
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new AdscoreError('payload_parse_failed');
  }
  return { zoneId, payload };
}

// Official verify(): some request IP matches the payload IP prefix AND the UA
// is bit-exact. Returns null on pass, a reason string on failure.
export function strictVerifyReason(payload, ipAddresses, userAgent) {
  let ipOk = false;
  for (const ip of ipAddresses || []) {
    const bytes = ipToBytes(ip);
    if (!bytes) continue;
    const v4 = payload['ipv4.ip'] ? ipToBytes(String(payload['ipv4.ip'])) : null;
    const v6 = payload['ipv6.ip'] ? ipToBytes(String(payload['ipv6.ip'])) : null;
    const n4 = Number(payload['ipv4.v'] ?? 4);
    const n6 = Number(payload['ipv6.v'] ?? 16);
    if (
      (v4 && bytes.length >= n4 && v4.length >= n4 && bytes.subarray(0, n4).equals(v4.subarray(0, n4))) ||
      (v6 && bytes.length >= n6 && v6.length >= n6 && bytes.subarray(0, n6).equals(v6.subarray(0, n6)))
    ) {
      ipOk = true;
      break;
    }
  }
  if (!ipOk) return 'ip_mismatch';
  if (payload['b.ua'] === undefined || payload['b.ua'] === null) return 'no_ua';
  if (String(payload['b.ua']) !== String(userAgent ?? '')) return 'ua_mismatch';
  return null;
}

const envZoneId = () => Number(process.env.ADSCORE_ZONE_ID) || 0;
const envKey = () => {
  const b64 = process.env.ADSCORE_RESPONSE_KEY || '';
  if (!b64) return null;
  const key = Buffer.from(b64, 'base64');
  return key.length === 32 ? key : null;
};

// One-call API for the route: decode with the configured zone key, judge, and
// strict-verify against the beacon request's IP/UA. Never throws.
export function inspectSignature({ signature, ips, ua }) {
  const key = envKey();
  if (!key) return { ok: false, reason: 'unconfigured' };
  let decoded;
  try {
    decoded = decodeV5(signature, () => key);
  } catch (e) {
    return { ok: false, reason: e instanceof AdscoreError ? e.reason : 'decode_failed' };
  }
  const { zoneId, payload } = decoded;
  const result = Number(payload.result);
  if (!Number.isFinite(result)) return { ok: false, reason: 'no_result' };
  const judged = ADSCORE_VERDICTS[result] || { verdict: `unknown_${result}`, name: 'Unknown' };
  const strictReason = strictVerifyReason(payload, ips, ua);
  return {
    ok: true,
    zoneId,
    zoneMatch: envZoneId() ? zoneId === envZoneId() : null,
    result,
    verdict: judged.verdict,
    name: judged.name,
    strict: strictReason === null,
    strictReason,
    subId: payload.sub_id !== undefined ? String(payload.sub_id) : null,
  };
}
