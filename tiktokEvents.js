// TikTok Events API (server-to-server) forwarder.
//
// Mirrors the browser pixel's conversion server-side, using the SAME event_id so
// TikTok deduplicates the browser event and this server event into one.
// Docs: Business API v1.3 — POST /open_api/v1.3/event/track/.

const TT_API_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

/**
 * Build the TikTok Events API request body from a /track-click conversion.
 * Pure function (no network) so it can be unit-tested.
 *
 * @param {object} p
 * @param {string} p.pixelId        TikTok pixel / event_source_id
 * @param {string} p.event          event name (e.g. "Purchase")
 * @param {string} p.eventId        dedup id shared with the browser pixel
 * @param {number} p.eventTimeSec   unix time in SECONDS
 * @param {string} [p.url]          page url where the event happened
 * @param {string} [p.referrer]
 * @param {string} [p.ip]           raw client IP (not hashed for web)
 * @param {string} [p.userAgent]    raw UA (not hashed for web)
 * @param {string} [p.ttclid]       TikTok click id (not hashed)
 * @param {string|number} [p.value] optional conversion value
 * @param {string} [p.currency]     paired with value (defaults USD)
 * @param {string} [p.contentId]
 * @param {string} [p.testEventCode] TikTok Test Events code
 */
export function buildTikTokEventBody(p) {
  const user = {};
  if (p.ttclid) user.ttclid = p.ttclid;
  if (p.ip) user.ip = p.ip;
  if (p.userAgent) user.user_agent = p.userAgent;

  const properties = {};
  const numValue = Number(p.value);
  if (p.value !== undefined && p.value !== null && p.value !== '' && !Number.isNaN(numValue)) {
    properties.value = numValue;
    properties.currency = p.currency || 'USD';
  }
  if (p.contentId) {
    properties.content_id = p.contentId;
    properties.content_type = 'product';
  }

  const data = {
    event: p.event,
    event_time: p.eventTimeSec,
    event_id: p.eventId,
    user,
    page: {},
    properties,
  };
  if (p.url) data.page.url = p.url;
  if (p.referrer) data.page.referrer = p.referrer;

  const body = {
    event_source: 'web',
    event_source_id: p.pixelId,
    data: [data],
  };
  if (p.testEventCode) body.test_event_code = p.testEventCode;
  return body;
}

/**
 * Send one conversion to the TikTok Events API.
 * Fire-and-forget friendly: never throws, resolves to a small status object,
 * returns early if not configured. Has a hard timeout so it can't hang the caller.
 *
 * @param {object} input  see buildTikTokEventBody (minus pixelId/testEventCode)
 * @param {object} cfg    { token, pixelId, testEventCode }
 */
export async function sendTikTokEvent(input, cfg = {}) {
  const { token, pixelId, testEventCode } = cfg;
  // Normalized return shape so the caller can log the outcome:
  //   { status: 'ok'|'failed'|'skipped', ok, code, message, error, skipped, requestBody }
  // requestBody is the exact payload sent to TikTok (null when skipped).
  let requestBody = null;
  try {
    if (!token || !pixelId) return { status: 'skipped', skipped: 'not_configured', requestBody: null };
    if (!input.event || !input.eventId) return { status: 'skipped', skipped: 'missing_event', requestBody: null };

    requestBody = buildTikTokEventBody({ ...input, pixelId, testEventCode });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let res;
    try {
      res = await fetch(TT_API_URL, {
        method: 'POST',
        headers: {
          'Access-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const json = await res.json().catch(() => ({}));
    // TikTok returns { code: 0, message: "OK", ... } on success.
    if (json.code !== 0) {
      console.error('❌ TikTok Events API non-zero:', json.code, json.message);
      return { status: 'failed', ok: false, code: json.code, message: json.message, requestBody };
    }
    return { status: 'ok', ok: true, code: 0, message: json.message, requestBody };
  } catch (err) {
    console.error('❌ TikTok Events API error:', err?.message || err);
    return { status: 'failed', ok: false, error: err?.message || String(err), requestBody };
  }
}
