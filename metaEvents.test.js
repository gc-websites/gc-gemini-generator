import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetaEventBody, sendMetaEvent } from './metaEvents.js';

test('builds a minimal website event with ip/ua/fbc/fbp and a dedup event_id', () => {
  const body = buildMetaEventBody({
    event: 'Purchase', eventId: 'abc', eventTimeSec: 1700000000,
    url: 'https://x/y', ip: '1.2.3.4', userAgent: 'UA',
    fbc: 'fb.1.1700000000.CLICK', fbp: 'fb.1.1700000000.999',
  });
  assert.equal(body.data.length, 1);
  const d = body.data[0];
  assert.equal(d.event_name, 'Purchase');
  assert.equal(d.event_id, 'abc');
  assert.equal(d.event_time, 1700000000);
  assert.equal(d.action_source, 'website');
  assert.equal(d.event_source_url, 'https://x/y');
  assert.deepEqual(d.user_data, {
    client_ip_address: '1.2.3.4',
    client_user_agent: 'UA',
    fbc: 'fb.1.1700000000.CLICK',
    fbp: 'fb.1.1700000000.999',
  });
  assert.equal('custom_data' in d, false);
});

test('builds fbc from raw fbclid when no _fbc cookie is available', () => {
  const body = buildMetaEventBody({ event: 'E', eventId: '1', eventTimeSec: 1, fbclid: 'XYZ' });
  const fbc = body.data[0].user_data.fbc;
  assert.match(fbc, /^fb\.1\.\d+\.XYZ$/);
});

test('prefers the _fbc cookie over rebuilding from fbclid', () => {
  const body = buildMetaEventBody({ event: 'E', eventId: '1', eventTimeSec: 1, fbc: 'fb.1.5.COOKIE', fbclid: 'RAW' });
  assert.equal(body.data[0].user_data.fbc, 'fb.1.5.COOKIE');
});

test('omits value unless numeric, and pairs it with currency', () => {
  const noVal = buildMetaEventBody({ event: 'E', eventId: '1', eventTimeSec: 1, value: '' });
  assert.equal('custom_data' in noVal.data[0], false);

  const withVal = buildMetaEventBody({ event: 'E', eventId: '1', eventTimeSec: 1, value: '2.5' });
  assert.equal(withVal.data[0].custom_data.value, 2.5);
  assert.equal(withVal.data[0].custom_data.currency, 'USD');

  const withCur = buildMetaEventBody({ event: 'E', eventId: '1', eventTimeSec: 1, value: '3', currency: 'EUR' });
  assert.equal(withCur.data[0].custom_data.currency, 'EUR');
});

test('adds test_event_code only when provided', () => {
  const a = buildMetaEventBody({ event: 'E', eventId: '1', eventTimeSec: 1 });
  assert.equal('test_event_code' in a, false);
  const b = buildMetaEventBody({ event: 'E', eventId: '1', eventTimeSec: 1, testEventCode: 'TEST42' });
  assert.equal(b.test_event_code, 'TEST42');
});

test('sendMetaEvent skips when token/pixel missing or event incomplete', async () => {
  const noCfg = await sendMetaEvent({ event: 'E', eventId: '1' }, {});
  assert.equal(noCfg.status, 'skipped');
  assert.equal(noCfg.skipped, 'not_configured');

  const noEvent = await sendMetaEvent({ event: '', eventId: '1' }, { token: 'T', pixelId: 'P' });
  assert.equal(noEvent.status, 'skipped');
  assert.equal(noEvent.skipped, 'missing_event');
});
