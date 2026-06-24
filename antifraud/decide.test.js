// antifraud/decide.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from './decide.js';

const BOTH = ['cap1', 'cap2'];

test('clean + both steps → ad allowed, no challenge, conversion forwarded', () => {
  const d = decide({ score: 85, steps: BOTH });
  assert.deepEqual(d, { band: 'clean', allowAd: true, challenge: false, forwardConversion: true });
});

test('mid band → challenge, ad not yet allowed', () => {
  const d = decide({ score: 50, steps: BOTH });
  assert.equal(d.band, 'mid');
  assert.equal(d.challenge, true);
  assert.equal(d.allowAd, false);
});

test('low band → nothing', () => {
  const d = decide({ score: 20, steps: BOTH });
  assert.deepEqual(d, { band: 'low', allowAd: false, challenge: false, forwardConversion: false });
});

test('clean score but only cap1 → no ad (needs both captchas)', () => {
  const d = decide({ score: 90, steps: ['cap1'] });
  assert.equal(d.allowAd, false);
  assert.equal(d.forwardConversion, false);
});

test('custom thresholds are honored', () => {
  const d = decide({ score: 65, steps: BOTH }, { CLEAN: 60, MID: 30, AD: 55 });
  assert.equal(d.band, 'clean');
  assert.equal(d.allowAd, true);
});

test('mid-band (60-69) with both captchas: ad allowed AND challenged (AD<CLEAN overlap)', () => {
  const d = decide({ score: 65, steps: BOTH });
  assert.equal(d.band, 'mid');
  assert.equal(d.allowAd, true);
  assert.equal(d.challenge, true);
  assert.equal(d.forwardConversion, true);
});
