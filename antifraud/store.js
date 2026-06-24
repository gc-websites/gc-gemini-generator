// antifraud/store.js
import { LRUCache } from 'lru-cache';

// Rolling per-key hit counters (60s TTL) for velocity.
let counters = new LRUCache({ max: 50_000, ttl: 60_000 });
// Used-nonce set (TTL slightly above token TTL of 30m) for replay defense.
let nonces = new LRUCache({ max: 200_000, ttl: 31 * 60_000 });

export function hit(key) {
  const n = (counters.get(key) || 0) + 1;
  counters.set(key, n);
  return n;
}

export function seenNonce(nonce) {
  if (nonces.has(nonce)) return true;
  nonces.set(nonce, 1);
  return false;
}

export function __reset() {
  counters = new LRUCache({ max: 50_000, ttl: 60_000 });
  nonces = new LRUCache({ max: 200_000, ttl: 31 * 60_000 });
}
