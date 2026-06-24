// antifraud/decide.js
export function decide({ score, steps = [] }, thresholds = {}) {
  const { CLEAN = 70, MID = 40, AD = 60 } = thresholds;
  const bothCaptchas = steps.includes('cap1') && steps.includes('cap2');

  const band = score >= CLEAN ? 'clean' : score >= MID ? 'mid' : 'low';
  const allowAd = bothCaptchas && score >= AD;
  const challenge = band === 'mid';
  const forwardConversion = allowAd; // conversion fires on a filled ad view → same gate

  return { band, allowAd, challenge, forwardConversion };
}
