// antifraud/score.js
const WEBVIEW_RE = /(musical_ly|bytedancewebview|tiktok|FBAN|FBAV|Instagram)/i;
const HEADLESS_RE = /(HeadlessChrome|PhantomJS|puppeteer|playwright|; *$|^$)/i;

export function scoreSignals({ ua = '', signals = {}, velocity = 1 } = {}) {
  let score = 50;
  const reasons = [];
  const add = (delta, why) => { score += delta; reasons.push(why); };

  // --- User agent ---
  if (HEADLESS_RE.test(ua) || !ua) add(-45, 'headless_ua');
  else if (WEBVIEW_RE.test(ua)) add(+20, 'inapp_webview');
  else add(+5, 'normal_ua');

  // --- JS-execution proof (a real engine echoed the seeded nonce) ---
  if (signals.jsProof === true) add(+15, 'js_proof_ok');
  else add(-15, 'js_proof_missing');

  // --- Honeypot (humans never fill the hidden field) ---
  if (signals.honeypot) add(-50, 'honeypot_filled');

  // --- Interaction realism ---
  const t = Number(signals.timeToInteractMs);
  if (Number.isFinite(t)) {
    if (t < 250) add(-20, 'instant_interaction');
    else if (t > 800) add(+10, 'human_dwell');
  }
  const interactions = (Number(signals.pointerEvents) || 0) + (Number(signals.touchEvents) || 0);
  if (interactions >= 3) add(+10, 'has_interaction');
  else add(-5, 'no_interaction');
  if (Number(signals.scroll) > 0) add(+5, 'scrolled');

  // --- Velocity (many sessions/hits from one IP per window) ---
  if (velocity > 20) add(-30, 'high_velocity');
  else if (velocity > 8) add(-15, 'elevated_velocity');

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, reasons };
}
