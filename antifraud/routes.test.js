// antifraud/routes.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import requestIp from 'request-ip';

process.env.AF_HMAC_SECRET = 'routes-test-secret';
process.env.AF_ENFORCE = 'true';
process.env.AF_NONCE_BUDGET = '2';
const { attachAntifraudRoutes } = await import('./index.js');

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use(requestIp.mw());
  attachAntifraudRoutes(app);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (iPhone) musical_ly BytedanceWebview' }, body: JSON.stringify(body) }).then((r) => r.json());

test('cap1 verify issues a token with steps=[cap1]', async () => {
  const r = await post('/af/verify', { sid: 's1', step: 'cap1', signals: { jsProof: true, timeToInteractMs: 1500, touchEvents: 4, scroll: 20 } });
  assert.ok(r.token);
  assert.ok(typeof r.score === 'number');
});

test('cap2 verify requires a valid cap1 prevToken', async () => {
  const a = await post('/af/verify', { sid: 's2', step: 'cap1', signals: { jsProof: true, touchEvents: 4 } });
  const b = await post('/af/verify', { sid: 's2', step: 'cap2', prevToken: a.token, signals: { jsProof: true, touchEvents: 4 } });
  assert.ok(b.token, 'cap2 with valid prevToken should issue a token');

  const bad = await post('/af/verify', { sid: 's2', step: 'cap2', prevToken: 'v1.bad.bad', signals: { jsProof: true } });
  assert.equal(bad.token, undefined);
  assert.equal(bad.error, 'cap1_required');
});

test('gate allows a clean cap1+cap2 token and denies a cap1-only token', async () => {
  const a = await post('/af/verify', { sid: 's3', step: 'cap1', signals: { jsProof: true, touchEvents: 5, timeToInteractMs: 2000, scroll: 30 } });
  const b = await post('/af/verify', { sid: 's3', step: 'cap2', prevToken: a.token, signals: { jsProof: true, touchEvents: 5, timeToInteractMs: 2000, scroll: 30 } });
  const gateBoth = await post('/af/gate', { token: b.token });
  assert.equal(gateBoth.allow, true);

  const gateOne = await post('/af/gate', { token: a.token });
  assert.equal(gateOne.allow, false);
});

test('nonce budget: gate allows up to AF_NONCE_BUDGET calls then denies as replay', async () => {
  const a = await post('/af/verify', { sid: 's5', step: 'cap1', signals: { jsProof: true, touchEvents: 5, timeToInteractMs: 2000 } });
  const b = await post('/af/verify', { sid: 's5', step: 'cap2', prevToken: a.token, signals: { jsProof: true, touchEvents: 5, timeToInteractMs: 2000 } });
  const g1 = await post('/af/gate', { token: b.token });
  const g2 = await post('/af/gate', { token: b.token });
  const g3 = await post('/af/gate', { token: b.token });
  assert.equal(g1.allow, true);
  assert.equal(g2.allow, true);
  assert.equal(g3.allow, false);
  assert.equal(g3.reason, 'replay');
});
