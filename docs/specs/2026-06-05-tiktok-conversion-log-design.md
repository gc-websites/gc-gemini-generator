# TikTok conversion log (`tt-conversion`) — Design

**Date:** 2026-06-05
**Status:** Approved
**Scope:** `gc-server` (new Strapi content-type) + `gc-gemini-generator/server.js` + `tiktokEvents.js`

## 1. Goal

Whenever the server forwards a conversion to the TikTok Events API, also write a
**queryable record to Strapi** describing the send: what was sent and how TikTok
responded. This gives an auditable log in Strapi to answer: how many conversions
were sent, how many TikTok rejected (and why), and whether they carried `ttclid`.

## 2. Decisions (locked with the user)

- **Storage:** a dedicated new Strapi collection **`tt-conversion`** (not reusing
  `click-event`).
- **Coverage:** log **every** attempt — `ok` / `failed` / `skipped` — with a
  `status` field and TikTok's response (`code`, `message`).
- **Non-blocking:** the log write is fire-and-forget; it never blocks the
  `/track-click` response nor the TikTok send.

## 3. Architecture & data flow

1. Client posts the conversion (`ad_view` carrying `tt_event_id`) to `/track-click`.
2. `/track-click` writes the `click-event` row (unchanged) and returns `200`
   immediately.
3. If `tt_event_id` is present, it calls `sendTikTokEvent(...)` (unchanged trigger).
4. In the promise resolution (`.then(result)`), it calls the new helper
   `logTikTokConversion(record)` which `POST`s to `/api/tt-conversions`.
5. `status` is derived from the result: `skipped` (not configured / missing event),
   `ok` (TikTok `code === 0`), otherwise `failed`.

`sendTikTokEvent` is extended to return a normalized shape:
`{ status, ok, code, message, error, skipped, requestBody }` so the logger has the
exact payload that was sent (`request_body`) and the outcome.

### Error handling
- `logTikTokConversion` is fire-and-forget; failures are only `console.error`-logged.
- The TikTok send and the Strapi write never block the user or each other.

### Pixel id
- `pixel_id` stored is the one actually used (`TT_PIXEL_ID`, default
  `CGUJ36RC77U0HA6062A0`).

## 4. `tt-conversion` schema (Strapi 5, `draftAndPublish: false`)

**What was sent:** `session_id`, `event`, `event_id`, `pixel_id`, `ttclid`,
`value` (decimal), `currency`, `content_id`, `client_ip`, `user_agent`, `country`,
`device_type`, `page_url`, `source_url`, `referrer`, `prelend_slug`, `locale`,
`platform`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`,
`request_body` (json — exact payload sent to TikTok).

**Result:** `status` (enum `ok|failed|skipped`), `response_code` (int),
`response_message` (text), `test_event_code`, `sent_at` (datetime).

## 5. Files

- `gc-server/src/api/tt-conversion/content-types/tt-conversion/schema.json` (new)
- `gc-server/src/api/tt-conversion/controllers/tt-conversion.js` (new, core factory)
- `gc-server/src/api/tt-conversion/routes/tt-conversion.js` (new, core factory)
- `gc-server/src/api/tt-conversion/services/tt-conversion.js` (new, core factory)
- `gc-gemini-generator/tiktokEvents.js` — normalized return (`status`, `requestBody`)
- `gc-gemini-generator/server.js` — `logTikTokConversion()` + wire into `/track-click`
- `gc-gemini-generator/tiktokEvents.test.js` (new, `node --test`)

## 6. Testing
- Unit (`node --test`): `buildTikTokEventBody` field mapping; value included only
  when numeric; `sendTikTokEvent` returns `status: 'skipped'` when not configured
  (no network).
- Manual: fire a conversion → a `tt-conversion` row appears with `status=ok`,
  `response_code=0`; kill the token → row appears with `status=skipped/failed`.

## 7. Deploy / rollout notes
- `gc-server` must be deployed first so the `tt-conversion` content-type exists.
- The `STRAPI_TOKEN` used by the server needs create permission on the new
  collection (a full-access token covers it automatically).
- No env changes required.
