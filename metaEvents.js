// Meta (Facebook) Conversions API (server-to-server) forwarder.
//
// Mirrors the browser pixel's conversion server-side, using the SAME event_id so
// Meta deduplicates the browser fbq event and this server event into one.
// Docs: POST https://graph.facebook.com/v21.0/{PIXEL_ID}/events
//
// Matching quality: we send client_ip_address + client_user_agent + fbc + fbp.
// fbc comes from the _fbc cookie when the pixel set it, otherwise it is built
// from the raw fbclid (fb.1.<now_ms>.<fbclid>) — both are accepted by Meta.

const GRAPH_VERSION = 'v21.0';

/**
 * Build the Conversions API request body from a /track-click conversion.
 * Pure function (no network) so it can be unit-tested.
 *
 * @param {object} p
 * @param {string} p.event          event name (e.g. "Purchase")
 * @param {string} p.eventId        dedup id shared with the browser pixel
 * @param {number} p.eventTimeSec   unix time in SECONDS
 * @param {string} [p.url]          page url where the event happened
 * @param {string} [p.ip]           raw client IP
 * @param {string} [p.userAgent]    raw client UA
 * @param {string} [p.fbc]          _fbc cookie value (preferred)
 * @param {string} [p.fbp]          _fbp cookie value
 * @param {string} [p.fbclid]       raw fbclid — used to build fbc when missing
 * @param {string|number} [p.value] optional conversion value
 * @param {string} [p.currency]     paired with value (defaults USD)
 * @param {string} [p.contentId]
 * @param {string} [p.testEventCode] Events Manager Test Events code
 */
export function buildMetaEventBody(p) {
  const user_data = {};
  if (p.ip) user_data.client_ip_address = p.ip;
  if (p.userAgent) user_data.client_user_agent = p.userAgent;
  const fbc = p.fbc || (p.fbclid ? `fb.1.${Date.now()}.${p.fbclid}` : '');
  if (fbc) user_data.fbc = fbc;
  if (p.fbp) user_data.fbp = p.fbp;

  const custom_data = {};
  const numValue = Number(p.value);
  if (p.value !== undefined && p.value !== null && p.value !== '' && !Number.isNaN(numValue)) {
    custom_data.value = numValue;
    custom_data.currency = p.currency || 'USD';
  }
  if (p.contentId) {
    custom_data.content_ids = [p.contentId];
    custom_data.content_type = 'product';
  }

  const data = {
    event_name: p.event,
    event_time: p.eventTimeSec,
    event_id: p.eventId,
    action_source: 'website',
    user_data,
  };
  if (p.url) data.event_source_url = p.url;
  if (Object.keys(custom_data).length) data.custom_data = custom_data;

  const body = { data: [data] };
  if (p.testEventCode) body.test_event_code = p.testEventCode;
  return body;
}

/**
 * Send one conversion to the Meta Conversions API.
 * Fire-and-forget friendly: never throws, resolves to a small status object,
 * returns early if not configured. Hard timeout so it can't hang the caller.
 *
 * @param {object} input  see buildMetaEventBody (minus testEventCode)
 * @param {object} cfg    { token, pixelId, testEventCode }
 */
export async function sendMetaEvent(input, cfg = {}) {
  const { token, pixelId, testEventCode } = cfg;
  // Normalized return shape (same contract as sendTikTokEvent):
  //   { status: 'ok'|'failed'|'skipped', ok, code, message, error, skipped, requestBody }
  let requestBody = null;
  try {
    if (!token || !pixelId) return { status: 'skipped', skipped: 'not_configured', requestBody: null };
    if (!input.event || !input.eventId) return { status: 'skipped', skipped: 'missing_event', requestBody: null };

    requestBody = buildMetaEventBody({ ...input, testEventCode });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let res;
    try {
      res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody, access_token: token }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const json = await res.json().catch(() => ({}));
    // Meta returns { events_received: 1, fbtrace_id: ... } on success,
    // { error: { message, code, ... } } on failure.
    if (!res.ok || json.error) {
      const msg = json.error?.message || `HTTP ${res.status}`;
      const code = json.error?.code != null ? json.error.code : res.status;
      console.error('❌ Meta CAPI error:', code, msg);
      return { status: 'failed', ok: false, code, message: msg, requestBody };
    }
    return {
      status: 'ok',
      ok: true,
      code: 200,
      message: `events_received=${json.events_received ?? '?'} fbtrace=${json.fbtrace_id || ''}`,
      requestBody,
    };
  } catch (err) {
    console.error('❌ Meta CAPI error:', err?.message || err);
    return { status: 'failed', ok: false, error: err?.message || String(err), requestBody };
  }
}
