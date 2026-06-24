// antifraud/log.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAfLogRow } from './index.js';

test('buildAfLogRow maps a decision to a click-event payload', () => {
  const row = buildAfLogRow({ sid: 's', step: 'cap1', score: 82, reasons: ['inapp_webview', 'js_proof_ok'], band: 'clean', ip: '1.2.3.4' });
  assert.equal(row.data.session_id, 's');
  assert.equal(row.data.event_type, 'af_decision');
  assert.equal(row.data.funnel_step, 'af_cap1');
  assert.equal(row.data.meta.score, 82);
  assert.equal(row.data.meta.band, 'clean');
  assert.deepEqual(row.data.meta.reasons, ['inapp_webview', 'js_proof_ok']);
});
