// antifraud/store.js
import { LRUCache } from 'lru-cache';

// Rolling per-key hit counters (60s TTL) for velocity.
let counters = new LRUCache({ max: 50_000, ttl: 60_000 });
// Used-nonce set (TTL slightly above token TTL of 30m) for replay defense.
let nonces = new LRUCache({ max: 200_000, ttl: 31 * 60_000 });
// Adscore verdict per session (sid → {result, verdict, strict}) — written by
// /af/adscore, consulted by /af/gate under enforcement. Same TTL as tokens.
let adscoreVerdicts = new LRUCache({ max: 100_000, ttl: 31 * 60_000 });

export function hit(key) {
  const n = (counters.get(key) || 0) + 1;
  counters.set(key, n);
  return n;
}

export function bumpNonce(nonce) {
  const n = (nonces.get(nonce) || 0) + 1;
  nonces.set(nonce, n);
  return n;
}

export function setAdscoreVerdict(sid, v) {
  adscoreVerdicts.set(sid, v);
}

export function getAdscoreVerdict(sid) {
  return adscoreVerdicts.get(sid) || null;
}

export function __reset() {
  counters = new LRUCache({ max: 50_000, ttl: 60_000 });
  nonces = new LRUCache({ max: 200_000, ttl: 31 * 60_000 });
  adscoreVerdicts = new LRUCache({ max: 100_000, ttl: 31 * 60_000 });
}
