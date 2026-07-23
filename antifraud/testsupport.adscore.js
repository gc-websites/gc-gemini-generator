// antifraud/testsupport.adscore.js
//
// Test-only builder of Adscore v5_0201J signatures (AES-256-GCM + JSON). Written
// independently from the parser, straight from the wire-format spec, so the two
// cross-check each other. Not a *.test.js file — node --test must not pick it up.
import crypto from 'node:crypto';

export const TEST_KEY = Buffer.alloc(32, 7);
export const TEST_KEY_B64 = TEST_KEY.toString('base64');

export function buildV5Signature({
  zoneId = 400039,
  payload = {},
  key = TEST_KEY,
  method = 0x0201,
  structType = 'J',
  version = 5,
} = {}) {
  const plaintext = Buffer.concat([
    Buffer.from(structType, 'utf8'),
    Buffer.from(JSON.stringify(payload), 'utf8'),
  ]);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const methodBuf = Buffer.alloc(2);
  methodBuf.writeUInt16LE(method, 0);
  const encrypted = Buffer.concat([methodBuf, iv, tag, ciphertext]);
  const header = Buffer.alloc(11);
  header.writeUInt8(version, 0);
  header.writeUInt16BE(encrypted.length, 1);
  header.writeBigUInt64BE(BigInt(zoneId), 3);
  return Buffer.concat([header, encrypted]).toString('base64url');
}
