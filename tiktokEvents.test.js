import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTikTokEventBody, sendTikTokEvent } from './tiktokEvents.js';

test('builds a minimal web event with ttclid/ip/ua and a dedup event_id', () => {
  const body = buildTikTokEventBody({
    pixelId: 'PIX', event: 'CompletePayment', eventId: 'abc',
    eventTimeSec: 1700000000, url: 'https://x/y', referrer: 'https://r',
    ip: '1.2.3.4', userAgent: 'UA', ttclid: 'TT',
  });
  assert.equal(body.event_source, 'web');
  assert.equal(body.event_source_id, 'PIX');
  assert.equal(body.data.length, 1);
  const d = body.data[0];
  assert.equal(d.event, 'CompletePayment');
  assert.equal(d.event_id, 'abc');
  assert.equal(d.event_time, 1700000000);
  assert.deepEqual(d.user, { ttclid: 'TT', ip: '1.2.3.4', user_agent: 'UA' });
  assert.equal(d.page.url, 'https://x/y');
  assert.deepEqual(d.properties, {});
});

test('omits value unless numeric, and pairs it with currency', () => {
  const noVal = buildTikTokEventBody({ pixelId: 'P', event: 'E', eventId: '1', eventTimeSec: 1, value: '' });
  assert.equal('value' in noVal.data[0].properties, false);

  const withVal = buildTikTokEventBody({ pixelId: 'P', event: 'E', eventId: '1', eventTimeSec: 1, value: '2.5' });
  assert.equal(withVal.data[0].properties.value, 2.5);
  assert.equal(withVal.data[0].properties.currency, 'USD');

  const withCur = buildTikTokEventBody({ pixelId: 'P', event: 'E', eventId: '1', eventTimeSec: 1, value: '3', currency: 'EUR' });
  assert.equal(withCur.data[0].properties.currency, 'EUR');
});

test('adds test_event_code only when provided', () => {
  const a = buildTikTokEventBody({ pixelId: 'P', event: 'E', eventId: '1', eventTimeSec: 1 });
  assert.equal('test_event_code' in a, false);

  const b = buildTikTokEventBody({ pixelId: 'P', event: 'E', eventId: '1', eventTimeSec: 1, testEventCode: 'TEST123' });
  assert.equal(b.test_event_code, 'TEST123');
});

// --- Normalized return shape (drives the tt-conversion log status) ---

test('sendTikTokEvent returns status=skipped when not configured (no network)', async () => {
  const r = await sendTikTokEvent({ event: 'E', eventId: '1' }, {});
  assert.equal(r.status, 'skipped');
  assert.equal(r.skipped, 'not_configured');
  assert.equal(r.requestBody, null);
});

test('sendTikTokEvent returns status=skipped when event is missing', async () => {
  const r = await sendTikTokEvent({}, { token: 'T', pixelId: 'PIX' });
  assert.equal(r.status, 'skipped');
  assert.equal(r.skipped, 'missing_event');
});
