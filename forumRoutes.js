// Forum proxy: keeps STRAPI_TOKEN server-side, runs anti-spam pipeline, then writes to Strapi.
// Endpoints: POST /forum/thread, POST /forum/reply, POST /forum/like, POST /forum/view
//
// Pipeline (POST /forum/thread, POST /forum/reply):
//   1. honeypot check
//   2. min-time check (form was open ≥ 3s)
//   3. rate-limit by sha256(ip + RATE_LIMIT_SALT)
//   4. length validation
//   5. GPT modercheck (gpt-5-nano, OK / FLAG / REJECT)
//   6. POST to Strapi with STRAPI_TOKEN
//   7. FLAG → patch isFlagged + ping Telegram
//
// All side-effects are wrapped in try/catch — proxy-level failures
// surface as { error } responses to the React client.

import crypto from 'crypto';
import requestIp from 'request-ip';
import { LRUCache } from 'lru-cache';

const STRAPI_API_URL = process.env.STRAPI_API_URL;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RATE_LIMIT_SALT = process.env.RATE_LIMIT_SALT || 'hfs-forum-default-salt';
const TG_TOKEN = process.env.TG_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

const MIN_FORM_TIME_MS = 3000;
const MAX_TITLE = 200;
const MIN_TITLE = 5;
const MAX_BODY = 5000;
const MIN_BODY = 10;
const MAX_NAME = 50;
const MIN_NAME = 2;

const FORUM_CATEGORIES = [
  'Hair Care',
  'Styling Tips',
  'Color & Dye',
  'Hair Loss & Thinning',
  'Products & Tools',
  'Lifestyle & Confidence',
];

const SUPPORTED_SITES = ['hairstyles', 'cholesterin', 'nice-advice'];

// In-memory rate-limit windows. Each ipHash maps to an array of timestamps;
// we sweep stale entries on every check, so the cap on map size is enough
// to keep memory bounded across deployments.
const rateMap = new LRUCache({
  max: 20000,
  ttl: 1000 * 60 * 60 * 24 * 2, // 48h — longer than the longest window
});

const hashIp = ip => crypto.createHash('sha256').update(`${ip}:${RATE_LIMIT_SALT}`).digest('hex');

const checkRateLimit = ipHash => {
  const now = Date.now();
  const arr = rateMap.get(ipHash) || [];
  const minuteAgo = now - 60 * 1000;
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const lastMinute = arr.filter(t => t > minuteAgo).length;
  const lastHour = arr.filter(t => t > hourAgo).length;
  const lastDay = arr.filter(t => t > dayAgo).length;

  if (lastMinute >= 5) return { ok: false, limit: '5/min' };
  if (lastHour >= 20) return { ok: false, limit: '20/hour' };
  if (lastDay >= 50) return { ok: false, limit: '50/day' };

  return { ok: true };
};

const recordRateLimit = ipHash => {
  const arr = rateMap.get(ipHash) || [];
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const pruned = arr.filter(t => t > dayAgo);
  pruned.push(Date.now());
  rateMap.set(ipHash, pruned);
};

/**
 * GPT moderation. Returns 'OK' | 'FLAG' | 'REJECT'.
 * Fail-open: if the API is down, return 'OK' so legitimate users aren't blocked.
 */
async function gptModercheck(text) {
  if (!OPENAI_API_KEY) {
    console.warn('[forum] OPENAI_API_KEY missing — modercheck fails open');
    return 'OK';
  }

  const SYSTEM_PROMPT = `You are a moderation classifier for an English-language hair-care forum aimed at people 50+. Classify the message into exactly one of:
- OK: relevant, civil, hair/beauty/lifestyle topic
- FLAG: borderline (mild rudeness, off-topic but not malicious, contains promotional links)
- REJECT: profanity, slurs, harassment, explicit sexual content, hate speech, obvious spam (gambling/crypto/pharma/SEO links)

Output strictly one of: OK, FLAG, REJECT`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Per the design doc: gpt-5-nano if available, fall back to gpt-4o-mini
        // (the comments endpoint already uses gpt-4o-mini successfully).
        model: process.env.FORUM_MODERATION_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        max_tokens: 5,
        temperature: 0,
      }),
    });

    if (!res.ok) {
      console.warn('[forum] modercheck non-OK', res.status);
      return 'OK';
    }

    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content ?? '').trim().toUpperCase();
    if (raw.startsWith('REJECT')) return 'REJECT';
    if (raw.startsWith('FLAG')) return 'FLAG';
    return 'OK';
  } catch (err) {
    console.warn('[forum] modercheck error (fail-open):', err.message);
    return 'OK';
  }
}

async function notifyTelegram(message) {
  if (!TG_TOKEN || !ADMIN_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    console.warn('[forum] Telegram notify failed:', err.message);
  }
}

const stripExtraSpaces = s => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

function validateLengths({ title, body, name }) {
  if (title !== undefined) {
    const t = String(title || '').trim();
    if (t.length < MIN_TITLE || t.length > MAX_TITLE) {
      return `Title must be ${MIN_TITLE}–${MAX_TITLE} characters.`;
    }
  }
  if (body !== undefined) {
    const b = String(body || '').trim();
    if (b.length < MIN_BODY || b.length > MAX_BODY) {
      return `Message must be ${MIN_BODY}–${MAX_BODY} characters.`;
    }
  }
  if (name !== undefined) {
    const n = String(name || '').trim();
    if (n.length < MIN_NAME || n.length > MAX_NAME) {
      return `Name must be ${MIN_NAME}–${MAX_NAME} characters.`;
    }
  }
  return null;
}

async function strapiFetch(path, options = {}) {
  const url = `${STRAPI_API_URL}/api${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: STRAPI_TOKEN,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Strapi ${options.method || 'GET'} ${path} ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json();
}

// Strapi v5 generates the slug via `uid` from `title`, but only when the
// title is supplied at create time and the slug field is left undefined.
// To be safe across Strapi versions we slugify client-side and let Strapi
// dedupe if there's a collision (Strapi appends -1, -2…).
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function attachForumRoutes(server) {
  server.set('trust proxy', true);

  // ── POST /forum/thread ─────────────────────────────────────────────
  server.post('/forum/thread', async (req, res) => {
    try {
      const {
        site,
        category,
        title,
        body,
        authorName,
        website,
        t0,
      } = req.body || {};

      if (website && String(website).trim() !== '') {
        return res.status(422).json({ error: 'Spam detected.' });
      }
      const t0n = Number(t0);
      if (!Number.isFinite(t0n) || Date.now() - t0n < MIN_FORM_TIME_MS) {
        return res.status(422).json({ error: 'Please take a moment to compose your post.' });
      }

      const siteKey = SUPPORTED_SITES.includes(site) ? site : 'hairstyles';
      if (!FORUM_CATEGORIES.includes(category)) {
        return res.status(422).json({ error: 'Unknown category.' });
      }

      const lenErr = validateLengths({ title, body, name: authorName });
      if (lenErr) return res.status(422).json({ error: lenErr });

      const ip = requestIp.getClientIp(req) || '';
      const ipHash = hashIp(ip);
      const rl = checkRateLimit(ipHash);
      if (!rl.ok) {
        return res.status(429).json({ error: `Too many posts (${rl.limit}). Please try again later.` });
      }

      const t = stripExtraSpaces(title);
      const b = String(body).trim();
      const n = stripExtraSpaces(authorName);

      const verdict = await gptModercheck(`Title: ${t}\n\nBody: ${b}`);
      if (verdict === 'REJECT') {
        return res.status(422).json({
          error: 'Your message was not allowed by our content rules. Please keep it civil and on-topic.',
        });
      }

      recordRateLimit(ipHash);

      const nowIso = new Date().toISOString();
      const slug = `${slugify(t)}-${crypto.randomBytes(3).toString('hex')}`;

      let created;
      try {
        created = await strapiFetch('/discussion-threads', {
          method: 'POST',
          body: JSON.stringify({
            data: {
              title: t,
              slug,
              body: b,
              authorName: n,
              authorAvatarIdenticon: `${n}#${Date.now()}`,
              site: siteKey,
              category,
              isAutoCreated: false,
              isPinned: false,
              isLocked: false,
              viewCount: 0,
              commentCount: 0,
              lastActivityAt: nowIso,
              ipHash,
            },
          }),
        });
      } catch (err) {
        console.error('[forum] thread create failed:', err.message);
        return res.status(502).json({ error: 'Could not save your post. Please try again.' });
      }

      const threadId = created?.data?.documentId;
      const finalSlug = created?.data?.slug || slug;

      if (verdict === 'FLAG' && threadId) {
        try {
          await strapiFetch(`/discussion-threads/${threadId}`, {
            method: 'PUT',
            body: JSON.stringify({ data: { isFlagged: true } }),
          });
        } catch (err) {
          console.warn('[forum] flag patch failed:', err.message);
        }
        notifyTelegram(
          `⚠️ *Forum thread flagged*\nSite: ${siteKey}\nCategory: ${category}\nAuthor: ${n}\nTitle: ${t}\nLink: https://hairstylesforseniors.com/forum/t/${finalSlug}`,
        );
      }

      return res.json({
        documentId: threadId,
        slug: finalSlug,
      });
    } catch (err) {
      console.error('[forum] /forum/thread fatal:', err);
      return res.status(500).json({ error: 'Internal error.' });
    }
  });

  // ── POST /forum/reply ──────────────────────────────────────────────
  server.post('/forum/reply', async (req, res) => {
    try {
      const {
        site,
        threadDocumentId,
        parentCommentDocumentId,
        body,
        authorName,
        website,
        t0,
      } = req.body || {};

      if (website && String(website).trim() !== '') {
        return res.status(422).json({ error: 'Spam detected.' });
      }
      const t0n = Number(t0);
      if (!Number.isFinite(t0n) || Date.now() - t0n < MIN_FORM_TIME_MS) {
        return res.status(422).json({ error: 'Please take a moment to compose your reply.' });
      }

      const siteKey = SUPPORTED_SITES.includes(site) ? site : 'hairstyles';
      if (!threadDocumentId || typeof threadDocumentId !== 'string') {
        return res.status(422).json({ error: 'Missing thread.' });
      }

      const lenErr = validateLengths({ body, name: authorName });
      if (lenErr) return res.status(422).json({ error: lenErr });

      const ip = requestIp.getClientIp(req) || '';
      const userAgent = req.get('user-agent') || '';
      const ipHash = hashIp(ip);
      const rl = checkRateLimit(ipHash);
      if (!rl.ok) {
        return res.status(429).json({ error: `Too many posts (${rl.limit}). Please try again later.` });
      }

      const b = String(body).trim();
      const n = stripExtraSpaces(authorName);

      const verdict = await gptModercheck(b);
      if (verdict === 'REJECT') {
        return res.status(422).json({
          error: 'Your reply was not allowed by our content rules. Please keep it civil and on-topic.',
        });
      }

      recordRateLimit(ipHash);

      let thread;
      try {
        thread = await strapiFetch(`/discussion-threads/${threadDocumentId}`);
      } catch (err) {
        if (err.status === 404) {
          return res.status(404).json({ error: 'Discussion not found.' });
        }
        throw err;
      }

      if (thread?.data?.isLocked) {
        return res.status(403).json({ error: 'This discussion is locked.' });
      }

      const commentData = {
        thread: { connect: [threadDocumentId] },
        body: b,
        authorName: n,
        authorAvatarIdenticon: `${n}#${Date.now()}`,
        ipHash,
        userAgent: userAgent.slice(0, 250),
        isHidden: false,
        isFlagged: verdict === 'FLAG',
        likes: 0,
      };
      if (parentCommentDocumentId && typeof parentCommentDocumentId === 'string') {
        commentData.parentComment = { connect: [parentCommentDocumentId] };
      }

      let created;
      try {
        created = await strapiFetch('/forum-comments', {
          method: 'POST',
          body: JSON.stringify({ data: commentData }),
        });
      } catch (err) {
        console.error('[forum] reply create failed:', err.message);
        return res.status(502).json({ error: 'Could not save your reply. Please try again.' });
      }

      const newId = created?.data?.documentId;

      // Touch thread: commentCount + lastActivityAt
      try {
        await strapiFetch(`/discussion-threads/${threadDocumentId}`, {
          method: 'PUT',
          body: JSON.stringify({
            data: {
              commentCount: (thread?.data?.commentCount || 0) + 1,
              lastActivityAt: new Date().toISOString(),
            },
          }),
        });
      } catch (err) {
        console.warn('[forum] thread touch failed:', err.message);
      }

      if (verdict === 'FLAG') {
        notifyTelegram(
          `⚠️ *Forum reply flagged*\nSite: ${siteKey}\nThread: ${thread?.data?.title || threadDocumentId}\nAuthor: ${n}\nBody: ${b.slice(0, 200)}`,
        );
      }

      return res.json({ documentId: newId });
    } catch (err) {
      console.error('[forum] /forum/reply fatal:', err);
      return res.status(500).json({ error: 'Internal error.' });
    }
  });

  // ── POST /forum/like ───────────────────────────────────────────────
  server.post('/forum/like', async (req, res) => {
    try {
      const { commentDocumentId } = req.body || {};
      if (!commentDocumentId || typeof commentDocumentId !== 'string') {
        return res.status(422).json({ error: 'Missing comment id.' });
      }

      const ip = requestIp.getClientIp(req) || '';
      const ipHash = hashIp(ip);
      // very light rate-limit on likes — 60/min is generous
      const now = Date.now();
      const key = `like:${ipHash}`;
      const arr = (rateMap.get(key) || []).filter(t => t > now - 60_000);
      if (arr.length >= 60) {
        return res.status(429).json({ error: 'Too many likes — slow down.' });
      }
      arr.push(now);
      rateMap.set(key, arr);

      let comment;
      try {
        comment = await strapiFetch(`/forum-comments/${commentDocumentId}`);
      } catch (err) {
        if (err.status === 404) return res.status(404).json({ error: 'Comment not found.' });
        throw err;
      }

      const current = Number(comment?.data?.likes || 0);
      const next = current + 1;

      try {
        await strapiFetch(`/forum-comments/${commentDocumentId}`, {
          method: 'PUT',
          body: JSON.stringify({ data: { likes: next } }),
        });
      } catch (err) {
        console.error('[forum] like update failed:', err.message);
        return res.status(502).json({ error: 'Could not save your like.' });
      }

      return res.json({ likes: next });
    } catch (err) {
      console.error('[forum] /forum/like fatal:', err);
      return res.status(500).json({ error: 'Internal error.' });
    }
  });

  // ── POST /forum/view ───────────────────────────────────────────────
  // Best-effort view counter. No moderation, no auth.
  server.post('/forum/view', async (req, res) => {
    try {
      const { threadDocumentId, currentCount } = req.body || {};
      if (!threadDocumentId || typeof threadDocumentId !== 'string') {
        return res.status(422).json({ error: 'Missing thread id.' });
      }

      const ip = requestIp.getClientIp(req) || '';
      const ipHash = hashIp(ip);
      const key = `view:${threadDocumentId}:${ipHash}`;
      // Only count each ip once per 6h per thread.
      if (rateMap.get(key)) {
        return res.json({ skipped: true });
      }
      rateMap.set(key, true, { ttl: 1000 * 60 * 60 * 6 });

      const next = Number(currentCount || 0) + 1;
      try {
        await strapiFetch(`/discussion-threads/${threadDocumentId}`, {
          method: 'PUT',
          body: JSON.stringify({ data: { viewCount: next } }),
        });
      } catch (err) {
        // Drop silently — views are best-effort
        return res.json({ skipped: true });
      }

      return res.json({ viewCount: next });
    } catch (err) {
      return res.status(200).json({ skipped: true });
    }
  });
}
