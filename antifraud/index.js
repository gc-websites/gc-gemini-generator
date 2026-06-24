// antifraud/index.js
import requestIp from 'request-ip';
import { nanoid } from 'nanoid';
import { signToken, verifyToken } from './token.js';
import { scoreSignals } from './score.js';
import { decide } from './decide.js';
import { hit, seenNonce } from './store.js';

const TOKEN_TTL_S = 30 * 60;

const secret = () => process.env.AF_HMAC_SECRET || '';
const enforce = () => process.env.AF_ENFORCE === 'true';
const thresholds = () => ({
  CLEAN: Number(process.env.AF_THRESHOLD_CLEAN) || 70,
  MID: Number(process.env.AF_THRESHOLD_MID) || 40,
  AD: Number(process.env.AF_THRESHOLD_AD) || 60,
});

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
      if (seenNonce(v.payload.nonce)) {
        return res.json({ allow: !enforce(), reason: 'replay', enforce: enforce() });
      }
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

export function shouldForwardConversion({ afToken, enforce, secret, thresholds = {} }) {
  if (!enforce) return true;            // observe / kill-switch → never block
  const v = verifyToken(afToken, secret);
  if (!v.valid) return false;
  return decide({ score: v.payload.score, steps: v.payload.steps || [] }, thresholds).forwardConversion;
}
