// antifraud/index.js
import requestIp from 'request-ip';
import { nanoid } from 'nanoid';
import { signToken, verifyToken } from './token.js';
import { scoreSignals } from './score.js';
import { decide } from './decide.js';
import { hit, bumpNonce } from './store.js';

const TOKEN_TTL_S = 30 * 60;

const secret = () => process.env.AF_HMAC_SECRET || '';
const enforce = () => process.env.AF_ENFORCE === 'true';
const thresholds = () => ({
  CLEAN: Number(process.env.AF_THRESHOLD_CLEAN) || 70,
  MID: Number(process.env.AF_THRESHOLD_MID) || 40,
  AD: Number(process.env.AF_THRESHOLD_AD) || 60,
});
const nonceBudget = () => Number(process.env.AF_NONCE_BUDGET) || 12;

function clientIp(req) {
  let ip = requestIp.getClientIp(req) || '';
  return ip.replace('::ffff:', '');
}

export function attachAntifraudRoutes(server) {
  server.post('/af/verify', (req, res) => {
    try {
      const { sid, step, signals = {}, prevToken } = req.body || {};
      if (!sid || (step !== 'cap1' && step !== 'cap2')) {
        return res.status(400).json({ error: 'bad_request' });
      }

      let steps = ['cap1'];
      if (step === 'cap2') {
        const prev = verifyToken(prevToken, secret());
        if (!prev.valid || prev.payload.sid !== sid || !prev.payload.steps?.includes('cap1')) {
          return res.status(200).json({ error: 'cap1_required', enforce: enforce() });
        }
        steps = ['cap1', 'cap2'];
      }

      const ua = req.get('user-agent') || '';
      const ip = clientIp(req);
      const velocity = hit(`v:${ip}`);
      const { score, reasons } = scoreSignals({ ua, signals, velocity });
      const d = decide({ score, steps }, thresholds());

      const now = Math.floor(Date.now() / 1000);
      const token = signToken(
        { sid, steps, score, iat: now, exp: now + TOKEN_TTL_S, nonce: nanoid(), bind: bindHash(ip, ua) },
        secret(),
      );

      // Observe-mode logging hook (Task 7 forwards this to Strapi).
      logDecision({ sid, step, score, reasons, band: d.band, ip });

      return res.json({ token, score, band: d.band, enforce: enforce() });
    } catch (e) {
      return res.status(500).json({ error: 'verify_failed' });
    }
  });

  server.post('/af/gate', (req, res) => {
    try {
      const { token } = req.body || {};
      const v = verifyToken(token, secret());
      if (!v.valid) {
        return res.json({ allow: !enforce(), reason: v.reason || 'invalid', enforce: enforce() });
      }
      // Per-token nonce BUDGET: the funnel gates several ad slots with one token
      // (na_v_top + na_o_top/mid1/mid2 + reloads), so allow up to AF_NONCE_BUDGET
      // gate calls per token; beyond that it's replay/abuse. Only consumed under
      // enforce (observe never bumps, keeping calibration logs clean).
      if (enforce() && bumpNonce(v.payload.nonce) > nonceBudget()) {
        return res.json({ allow: false, reason: 'replay', enforce: true });
      }
      // NOTE: token `bind` (ip/ua) is intentionally a SOFT signal — not hard-checked
      // here (webview egress IPs shift); see spec §4.1A.
      const d = decide({ score: v.payload.score, steps: v.payload.steps || [] }, thresholds());
      return res.json({ allow: enforce() ? d.allowAd : true, reason: d.band, enforce: enforce() });
    } catch (e) {
      return res.status(500).json({ error: 'gate_failed' });
    }
  });
}

function bindHash(ip, ua) {
  // soft bind — webview egress IPs shift, so this informs trust, it is not a hard check
  return `${ip.split('.').slice(0, 2).join('.')}|${(ua.match(/\(([^)]+)\)/)?.[1] || '').slice(0, 24)}`;
}

// Replaced with a real Strapi sink in Task 7; no-op so unit tests stay isolated.
let logDecision = () => {};
export function __setLogger(fn) { logDecision = fn; }

// Map one anti-fraud decision to a Strapi `click-event` row. Reuses the existing
// content type (no schema change): event_type tags the row as a decision and the
// score/band/reasons ride along in meta.
export function buildAfLogRow({ sid, step, score, reasons, band, ip }) {
  return {
    data: {
      session_id: sid || null,
      event_type: 'af_decision',
      funnel_step: `af_${step}`,
      client_ip: ip || null,
      meta: { score, band, reasons },
      clicked_at: new Date().toISOString(),
    },
  };
}

// Install the real Strapi sink. The env is read at call time (not module load),
// because server.js runs dotenv.config() AFTER importing this module — checking at
// import time would always see unset env and silently never log. In unit tests
// STRAPI_API_URL/STRAPI_TOKEN are unset, so this stays a no-op (no network).
__setLogger((d) => {
  if (!process.env.STRAPI_API_URL || !process.env.STRAPI_TOKEN) return;
  fetch(`${process.env.STRAPI_API_URL}/api/click-events`, {
    method: 'POST',
    headers: { Authorization: process.env.STRAPI_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildAfLogRow(d)),
  }).catch((e) => console.error('af log error:', e.message));
});

export function shouldForwardConversion({ afToken, enforce, secret, thresholds = {} }) {
  if (!enforce) return true;            // observe / kill-switch → never block
  const v = verifyToken(afToken, secret);
  if (!v.valid) return false;
  return decide({ score: v.payload.score, steps: v.payload.steps || [] }, thresholds).forwardConversion;
}
