// antifraud/score.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSignals } from './score.js';

test('clean mobile webview human scores high', () => {
  const { score } = scoreSignals({
    ua: 'Mozilla/5.0 (iPhone) ... musical_ly_2023 BytedanceWebview',
    signals: { timeToInteractMs: 2500, pointerEvents: 0, touchEvents: 6, scroll: 40, honeypot: '', jsProof: true, screenW: 390, screenH: 844 },
    velocity: 1,
  });
  assert.ok(score >= 70, `expected >=70, got ${score}`);
});

test('headless UA with no interaction scores low', () => {
  const { score, reasons } = scoreSignals({
    ua: 'Mozilla/5.0 (X11; Linux) HeadlessChrome/120',
    signals: { timeToInteractMs: 50, pointerEvents: 0, touchEvents: 0, scroll: 0, honeypot: '', jsProof: false },
    velocity: 1,
  });
  assert.ok(score < 40, `expected <40, got ${score}`);
  assert.ok(reasons.includes('headless_ua'));
});

test('filled honeypot is a hard down-signal', () => {
  const { score, reasons } = scoreSignals({ ua: 'Mozilla/5.0 (iPhone)', signals: { honeypot: 'bot@x.com', jsProof: true } });
  assert.ok(reasons.includes('honeypot_filled'));
  assert.ok(score < 40);
});

test('high velocity from one source lowers score', () => {
  const low = scoreSignals({ ua: 'Mozilla/5.0 (iPhone)', signals: { jsProof: true }, velocity: 50 });
  const ok = scoreSignals({ ua: 'Mozilla/5.0 (iPhone)', signals: { jsProof: true }, velocity: 1 });
  assert.ok(low.score < ok.score);
  assert.ok(low.reasons.includes('high_velocity'));
});

test('score is always clamped to 0..100', () => {
  const { score } = scoreSignals({ ua: '', signals: { honeypot: 'x', jsProof: false }, velocity: 999 });
  assert.ok(score >= 0 && score <= 100);
});
