// Forum bot generator.
//
// Three public functions:
//   - seedPersonas({ count, site })  → idempotent one-shot, creates bot personas in Strapi
//   - genThread({ site })            → 1 new thread, written in a random persona's voice
//   - genReply({ site })             → 1 reply on a stale-but-not-dead existing thread
//
// All writes use STRAPI_TOKEN. Personas are never exposed to the client.
//
// Gemini is used as the LLM because the project already has the SDK wired up
// (see autoCommenter.js / functionsHairStyles.js).

import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const STRAPI_API_URL = process.env.STRAPI_API_URL;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const FORUM_CATEGORIES = [
  'Hair Care',
  'Styling Tips',
  'Color & Dye',
  'Hair Loss & Thinning',
  'Products & Tools',
  'Lifestyle & Confidence',
];

const DEFAULT_SITE = 'hairstyles';

const pickRandom = arr => arr[Math.floor(Math.random() * arr.length)];

const sleep = ms => new Promise(r => setTimeout(r, ms));

const slugify = text =>
  String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

async function strapi(path, options = {}) {
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
    throw new Error(`Strapi ${options.method || 'GET'} ${path} ${res.status}: ${text.slice(0, 400)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Extract first JSON object found in a Gemini response. Falls back to JSON.parse
// of the whole string if no fence/object boundary heuristic finds one.
function extractJson(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

async function gemini(prompt, { model = 'gemini-2.5-flash', retries = 4 } = {}) {
  const m = genAI.getGenerativeModel({ model });
  let lastErr = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const result = await m.generateContent(prompt);
      const text = result.response.text().trim();
      if (text) return text;
      lastErr = new Error('empty response');
    } catch (err) {
      lastErr = err;
      const msg = err.message || '';
      // 429 = rate-limited; back off harder
      if (msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate')) {
        const wait = 6000 + attempt * 4000;
        console.warn(`[gemini] rate-limited, waiting ${wait}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(wait);
        continue;
      }
      console.warn(`[gemini] error attempt ${attempt + 1}/${retries}: ${msg.slice(0, 200)}`);
      await sleep(1500);
    }
  }
  throw lastErr || new Error('gemini: all retries exhausted');
}

/* ─── Personas ─────────────────────────────────────────────────────── */

const PERSONA_PROMPT = `Generate a persona for a hair-care forum reader aged 50–75.

Return STRICT JSON only (no markdown, no commentary):
{
  "displayName":  "First name only, no last name. Common US/UK names.",
  "ageHint":       55-75 (integer),
  "regionHint":   "US state OR UK county",
  "bio":          "2 sentences, warm, mentions a hobby or family",
  "botPersona":   "Writing style: tone, vocabulary, typical concerns. 3-4 sentences. Will be fed back into the model to write posts in this voice."
}`;

async function generatePersona() {
  const raw = await gemini(PERSONA_PROMPT);
  const parsed = extractJson(raw);
  if (!parsed?.displayName) return null;
  // Defensive defaults
  return {
    displayName: String(parsed.displayName).slice(0, 50),
    ageHint: Number.isFinite(Number(parsed.ageHint)) ? Number(parsed.ageHint) : 60,
    regionHint: String(parsed.regionHint || 'Ohio').slice(0, 60),
    bio: String(parsed.bio || '').slice(0, 480),
    botPersona: String(parsed.botPersona || '').slice(0, 800),
  };
}

async function getExistingPersonaNames(site = DEFAULT_SITE) {
  const out = [];
  let page = 1;
  // Loop through pages (Strapi default pageSize is 25)
  for (; page <= 10; page += 1) {
    const res = await strapi(
      `/forum-personas?filters[site][$eq]=${encodeURIComponent(site)}&pagination[page]=${page}&pagination[pageSize]=100&fields[0]=displayName`,
    );
    const list = res?.data || [];
    list.forEach(p => out.push(p.displayName));
    if (list.length < 100) break;
  }
  return new Set(out);
}

/**
 * Idempotent: skips creation if a persona with the same displayName already
 * exists for this site, so it's safe to run on every deploy or PM2 restart.
 */
export async function seedPersonas({ count = 20, site = DEFAULT_SITE } = {}) {
  const existing = await getExistingPersonaNames(site);
  const created = [];
  let attempts = 0;
  const MAX_ATTEMPTS = count * 3;

  while (created.length < count && attempts < MAX_ATTEMPTS) {
    attempts += 1;
    try {
      const persona = await generatePersona();
      if (!persona) {
        await sleep(800);
        continue;
      }
      if (existing.has(persona.displayName)) {
        // already have this name, regenerate
        continue;
      }
      existing.add(persona.displayName);

      const username = `${slugify(persona.displayName)}-${crypto.randomBytes(2).toString('hex')}`;

      const r = await strapi('/forum-personas', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            displayName: persona.displayName,
            username,
            bio: persona.bio,
            botPersona: persona.botPersona,
            site,
            isBot: true,
            isActive: true,
            usageCount: 0,
            ageHint: persona.ageHint,
            regionHint: persona.regionHint,
          },
        }),
      });
      created.push(r?.data?.documentId);
      console.log(`[forum-seed] +persona ${persona.displayName} (${persona.regionHint})`);
      await sleep(800);
    } catch (err) {
      console.warn('[forum-seed] error:', err.message);
      await sleep(1200);
    }
  }

  return { created: created.length, total: existing.size };
}

/* ─── Persona picker ───────────────────────────────────────────────── */

async function pickLeastRecentlyUsedPersona({ site = DEFAULT_SITE, exclude = [] } = {}) {
  const res = await strapi(
    `/forum-personas?filters[site][$eq]=${encodeURIComponent(site)}` +
      `&filters[isActive][$eq]=true` +
      `&sort=lastUsedAt:asc,usageCount:asc&pagination[page]=1&pagination[pageSize]=50` +
      `&fields[0]=displayName&fields[1]=bio&fields[2]=botPersona&fields[3]=ageHint&fields[4]=regionHint&fields[5]=usageCount&fields[6]=lastUsedAt`,
  );
  const list = res?.data || [];
  const filtered = list.filter(p => !exclude.includes(p.documentId));
  if (!filtered.length) return null;
  // Add a touch of randomness — pick one of the 5 least recently used
  const top = filtered.slice(0, Math.min(5, filtered.length));
  return pickRandom(top);
}

async function touchPersona(documentId, currentUsage = 0) {
  if (!documentId) return;
  try {
    await strapi(`/forum-personas/${documentId}`, {
      method: 'PUT',
      body: JSON.stringify({
        data: {
          usageCount: (currentUsage || 0) + 1,
          lastUsedAt: new Date().toISOString(),
        },
      }),
    });
  } catch (err) {
    console.warn('[forum] touchPersona failed:', err.message);
  }
}

/* ─── Recent context ──────────────────────────────────────────────── */

async function getRecentThreadTitles({ site = DEFAULT_SITE, limit = 12 } = {}) {
  const res = await strapi(
    `/discussion-threads?filters[site][$eq]=${encodeURIComponent(site)}` +
      `&sort=createdAt:desc&pagination[page]=1&pagination[pageSize]=${limit}` +
      `&fields[0]=title`,
  );
  return (res?.data || []).map(t => t.title).filter(Boolean);
}

async function getRecentCommentsFor(threadDocumentId, limit = 5) {
  const res = await strapi(
    `/forum-comments?filters[thread][documentId][$eq]=${encodeURIComponent(threadDocumentId)}` +
      `&sort=createdAt:desc&pagination[page]=1&pagination[pageSize]=${limit}` +
      `&fields[0]=body&fields[1]=authorName`,
  );
  return (res?.data || []).reverse(); // oldest → newest for prompt context
}

/* ─── genThread ───────────────────────────────────────────────────── */

function buildThreadPrompt(persona, category, recentTitles) {
  return `You are ${persona.displayName}, age ${persona.ageHint}, from ${persona.regionHint}.
Bio: ${persona.bio}
Writing style: ${persona.botPersona}

Write a new forum thread in category "${category}" for an English-language hair-care forum for people 50+.

Rules:
- Title: 40-120 chars, sounds like a real question or experience, no clickbait, no quotes around the title
- Body: 80-300 words, first-person, conversational, may ask a question at the end
- No promotional content, no links, no profanity
- Do NOT repeat any of these recent titles:
${recentTitles.map(t => `  - ${t}`).join('\n') || '  (none)'}

Output STRICT JSON only (no markdown fences, no commentary):
{ "title": "...", "body": "..." }`;
}

export async function genThread({ site = DEFAULT_SITE } = {}) {
  const persona = await pickLeastRecentlyUsedPersona({ site });
  if (!persona) {
    console.warn('[forum] genThread: no personas available. Run seedPersonas first.');
    return null;
  }
  const category = pickRandom(FORUM_CATEGORIES);
  const recentTitles = await getRecentThreadTitles({ site, limit: 12 });

  let parsed = null;
  for (let attempt = 0; attempt < 3 && !parsed; attempt += 1) {
    const raw = await gemini(buildThreadPrompt(persona, category, recentTitles));
    const obj = extractJson(raw);
    if (obj?.title && obj?.body && obj.title.length >= 10 && obj.body.length >= 60) {
      parsed = obj;
    } else {
      await sleep(800);
    }
  }
  if (!parsed) {
    console.warn('[forum] genThread: gemini returned unparseable output.');
    return null;
  }

  const title = String(parsed.title).replace(/^["'`]+|["'`]+$/g, '').slice(0, 200);
  const body = String(parsed.body).slice(0, 5000);
  const slug = `${slugify(title)}-${crypto.randomBytes(3).toString('hex')}`;
  const nowIso = new Date().toISOString();

  const created = await strapi('/discussion-threads', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        title,
        slug,
        body,
        authorName: persona.displayName,
        authorAvatarIdenticon: `${persona.displayName}#${persona.documentId}`,
        persona: { connect: [persona.documentId] },
        site,
        category,
        isAutoCreated: true,
        isPinned: false,
        isLocked: false,
        viewCount: 0,
        commentCount: 0,
        lastActivityAt: nowIso,
      },
    }),
  });

  await touchPersona(persona.documentId, persona.usageCount);
  console.log(`[forum] +thread "${title}" by ${persona.displayName} (${category})`);
  return created?.data;
}

/* ─── genReply ────────────────────────────────────────────────────── */

async function pickStaleThread({ site = DEFAULT_SITE } = {}) {
  // Threads that haven't been replied to in 8h+ and have <12 comments,
  // most recent activity first so we keep older threads still warm.
  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
  const res = await strapi(
    `/discussion-threads?filters[site][$eq]=${encodeURIComponent(site)}` +
      `&filters[isLocked][$eq]=false` +
      `&filters[lastActivityAt][$lt]=${encodeURIComponent(eightHoursAgo)}` +
      `&filters[commentCount][$lt]=12` +
      `&sort=lastActivityAt:desc&pagination[page]=1&pagination[pageSize]=20` +
      `&populate[persona]=true`,
  );
  const list = res?.data || [];
  if (!list.length) return null;
  return pickRandom(list);
}

function buildReplyPrompt(persona, thread, recentComments) {
  const recent = (recentComments || [])
    .map(c => `${c.authorName}: ${c.body}`)
    .join('\n---\n');

  return `You are ${persona.displayName}, age ${persona.ageHint}, from ${persona.regionHint}.
Bio: ${persona.bio}
Writing style: ${persona.botPersona}

You are reading this forum thread:
Title: "${thread.title}"
Original post: """
${thread.body || ''}
"""

${recent ? `Existing replies (oldest → newest):\n${recent}\n\n` : ''}Write a SHORT, natural reply (40-180 words). Rules:
- First-person, warm, conversational. Share your own experience or a small tip.
- React to the OP or to one of the existing replies, but don't directly quote them.
- No greetings like "Hi there!". Jump straight into the thought.
- No links, no promotional content, no profanity.
- No headers, no bullet lists.

Output STRICT JSON only (no markdown fences):
{ "body": "..." }`;
}

export async function genReply({ site = DEFAULT_SITE } = {}) {
  const thread = await pickStaleThread({ site });
  if (!thread) {
    console.log('[forum] genReply: no stale threads.');
    return null;
  }

  const excludeIds = [];
  if (thread.persona?.documentId) excludeIds.push(thread.persona.documentId);
  const persona = await pickLeastRecentlyUsedPersona({ site, exclude: excludeIds });
  if (!persona) {
    console.warn('[forum] genReply: no other personas to use.');
    return null;
  }

  const recent = await getRecentCommentsFor(thread.documentId, 5);

  let parsed = null;
  for (let attempt = 0; attempt < 3 && !parsed; attempt += 1) {
    const raw = await gemini(buildReplyPrompt(persona, thread, recent));
    const obj = extractJson(raw);
    if (obj?.body && obj.body.length >= 30) parsed = obj;
    else await sleep(800);
  }
  if (!parsed) {
    console.warn('[forum] genReply: gemini returned unparseable output.');
    return null;
  }

  const body = String(parsed.body).slice(0, 5000);
  const nowIso = new Date().toISOString();

  const created = await strapi('/forum-comments', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        thread: { connect: [thread.documentId] },
        body,
        authorName: persona.displayName,
        authorAvatarIdenticon: `${persona.displayName}#${persona.documentId}`,
        persona: { connect: [persona.documentId] },
        isHidden: false,
        isFlagged: false,
        likes: 0,
      },
    }),
  });

  try {
    await strapi(`/discussion-threads/${thread.documentId}`, {
      method: 'PUT',
      body: JSON.stringify({
        data: {
          commentCount: (thread.commentCount || 0) + 1,
          lastActivityAt: nowIso,
        },
      }),
    });
  } catch (err) {
    console.warn('[forum] genReply: thread touch failed:', err.message);
  }

  await touchPersona(persona.documentId, persona.usageCount);
  console.log(`[forum] +reply by ${persona.displayName} on "${thread.title}"`);
  return created?.data;
}

/* ─── Helpers exposed for manual triggers ──────────────────────────── */

export async function genThreadSafe(opts = {}) {
  try {
    return await genThread(opts);
  } catch (err) {
    console.error('[forum] genThread fatal:', err.message);
    return null;
  }
}

export async function genReplySafe(opts = {}) {
  try {
    return await genReply(opts);
  } catch (err) {
    console.error('[forum] genReply fatal:', err.message);
    return null;
  }
}

/* ─── One-shot bulk seeder ──────────────────────────────────────────── */
// Generates a reply on a specific thread, ignoring the 8h staleness filter
// used by the cron-driven genReply. Used by seedForum to populate fresh
// threads with conversation right after they're created.
async function genReplyForThread({ threadDocumentId, site = DEFAULT_SITE, excludePersonaIds = [] }) {
  const thread = await strapi(`/discussion-threads/${threadDocumentId}?populate[persona]=true`);
  if (!thread?.data) return null;
  const t = thread.data;
  if (t.isLocked) return null;

  const exclude = [...excludePersonaIds];
  if (t.persona?.documentId) exclude.push(t.persona.documentId);
  const persona = await pickLeastRecentlyUsedPersona({ site, exclude });
  if (!persona) return null;

  const recent = await getRecentCommentsFor(t.documentId, 5);

  let parsed = null;
  for (let attempt = 0; attempt < 3 && !parsed; attempt += 1) {
    const raw = await gemini(buildReplyPrompt(persona, t, recent));
    const obj = extractJson(raw);
    if (obj?.body && obj.body.length >= 30) parsed = obj;
    else await sleep(800);
  }
  if (!parsed) return null;

  const body = String(parsed.body).slice(0, 5000);

  const created = await strapi('/forum-comments', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        thread: { connect: [t.documentId] },
        body,
        authorName: persona.displayName,
        authorAvatarIdenticon: `${persona.displayName}#${persona.documentId}`,
        persona: { connect: [persona.documentId] },
        isHidden: false,
        isFlagged: false,
        likes: Math.floor(Math.random() * 4), // 0-3 organic likes
      },
    }),
  });

  try {
    await strapi(`/discussion-threads/${t.documentId}`, {
      method: 'PUT',
      body: JSON.stringify({
        data: {
          commentCount: (t.commentCount || 0) + 1,
          lastActivityAt: new Date().toISOString(),
        },
      }),
    });
  } catch (err) {
    console.warn('[forum] seed reply thread touch failed:', err.message);
  }

  await touchPersona(persona.documentId, persona.usageCount);
  return { documentId: created?.data?.documentId, personaId: persona.documentId };
}

/* ─── Persona-less seeder (works when the token lacks forum-persona access) ── */

const SENIOR_NAMES = [
  'Linda', 'Karen', 'Susan', 'Patricia', 'Margaret', 'Barbara', 'Nancy', 'Helen',
  'Sandra', 'Donna', 'Carol', 'Ruth', 'Sharon', 'Laura', 'Kathleen', 'Pamela',
  'Deborah', 'Frances', 'Gloria', 'Theresa', 'Beverly', 'Denise', 'Lori',
  'Robert', 'James', 'David', 'Richard', 'Charles', 'Thomas', 'Daniel', 'Paul',
  'Mark', 'Steven', 'Kenneth', 'George', 'Edward', 'Brian', 'Anthony', 'Walter',
];

const REGIONS = [
  'Ohio', 'Texas', 'Florida', 'Oregon', 'Maine', 'North Carolina',
  'Yorkshire', 'Devon', 'Kent', 'Surrey', 'Cornwall', 'Sussex',
];

const VOICES = [
  'warm, practical, mentions her grandchildren occasionally; short sentences',
  'thoughtful, slightly self-deprecating, prefers home remedies over salon products',
  'curious and open-minded, tries new products often, gives honest reviews',
  'no-nonsense, direct, has a strong opinion and shares it kindly',
  'cheerful and chatty, often references gardening or pets',
  'reflective, mentions how things have changed since their 40s',
  'budget-conscious, looks for drugstore alternatives, shares tips',
  'experienced, often quotes their stylist or hairdresser',
];

function makePersonaStub() {
  const name = pickRandom(SENIOR_NAMES);
  return {
    displayName: name,
    ageHint: 55 + Math.floor(Math.random() * 18),
    regionHint: pickRandom(REGIONS),
    bio: '',
    botPersona: pickRandom(VOICES),
  };
}

async function genThreadNoPersona({ site = DEFAULT_SITE } = {}) {
  const persona = makePersonaStub();
  const category = pickRandom(FORUM_CATEGORIES);
  const recentTitles = await getRecentThreadTitles({ site, limit: 12 });

  let parsed = null;
  for (let attempt = 0; attempt < 3 && !parsed; attempt += 1) {
    const raw = await gemini(buildThreadPrompt(persona, category, recentTitles));
    const obj = extractJson(raw);
    if (obj?.title && obj?.body && obj.title.length >= 10 && obj.body.length >= 60) {
      parsed = obj;
    } else {
      await sleep(800);
    }
  }
  if (!parsed) return null;

  const title = String(parsed.title).replace(/^["'`]+|["'`]+$/g, '').slice(0, 200);
  const body = String(parsed.body).slice(0, 5000);
  const slug = `${slugify(title)}-${crypto.randomBytes(3).toString('hex')}`;
  const nowIso = new Date().toISOString();

  const created = await strapi('/discussion-threads', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        title,
        slug,
        body,
        authorName: persona.displayName,
        authorAvatarIdenticon: `${persona.displayName}#${crypto.randomBytes(2).toString('hex')}`,
        site,
        category,
        isAutoCreated: true,
        isPinned: false,
        isLocked: false,
        viewCount: Math.floor(Math.random() * 25),
        commentCount: 0,
        lastActivityAt: nowIso,
      },
    }),
  });

  console.log(`[forum-seed] +thread "${title}" by ${persona.displayName} (${category})`);
  return { ...created?.data, _authorName: persona.displayName };
}

async function genReplyNoPersona({ thread, excludeNames = [] }) {
  // pick a name different from the OP and from recent repliers
  let persona;
  for (let i = 0; i < 10; i += 1) {
    const candidate = makePersonaStub();
    if (!excludeNames.includes(candidate.displayName)) {
      persona = candidate;
      break;
    }
  }
  if (!persona) persona = makePersonaStub();

  const recent = await getRecentCommentsFor(thread.documentId, 5);

  let parsed = null;
  for (let attempt = 0; attempt < 3 && !parsed; attempt += 1) {
    try {
      const raw = await gemini(buildReplyPrompt(persona, thread, recent));
      const obj = extractJson(raw);
      if (obj?.body && obj.body.length >= 30) parsed = obj;
      else {
        console.warn(`[forum-reply] unparseable response, len=${raw?.length || 0}`);
        await sleep(1500);
      }
    } catch (err) {
      console.warn(`[forum-reply] gemini call failed: ${err.message?.slice(0, 200)}`);
      await sleep(2000);
    }
  }
  if (!parsed) return null;

  const body = String(parsed.body).slice(0, 5000);

  const created = await strapi('/forum-comments', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        thread: { connect: [thread.documentId] },
        body,
        authorName: persona.displayName,
        authorAvatarIdenticon: `${persona.displayName}#${crypto.randomBytes(2).toString('hex')}`,
        isHidden: false,
        isFlagged: false,
        likes: Math.floor(Math.random() * 5),
      },
    }),
  });

  try {
    await strapi(`/discussion-threads/${thread.documentId}`, {
      method: 'PUT',
      body: JSON.stringify({
        data: {
          commentCount: (thread.commentCount || 0) + 1,
          lastActivityAt: new Date().toISOString(),
        },
      }),
    });
  } catch (_) { /* non-fatal */ }

  return { documentId: created?.data?.documentId, name: persona.displayName };
}

/* ─── Canned-thread seeder ─────────────────────────────────────────── */
// Hand-crafted threads covering all 6 categories. Used to bootstrap the
// forum without depending on Gemini's RPM budget. Bodies are evergreen
// and read like real questions/experiences from people 50+.

const CANNED_THREADS = [
  // ─── Hair Care ───
  {
    category: 'Hair Care',
    author: 'Susan',
    title: "How often do you wash? I'm starting to think every other day is too much at 62",
    body:
      "My mother washed her hair once a week and her hair was beautiful into her 80s. I've always washed every other day but lately my hair feels dry and brittle by evening. Has anyone successfully stretched out their wash schedule after a lifetime of frequent washing? How long did the awkward 'transition' period last?",
  },
  {
    category: 'Hair Care',
    author: 'Patricia',
    title: 'Best gentle shampoo for dry, color-treated hair over 60?',
    body:
      "I've been using the same drugstore shampoo for years but recently my hair feels like straw. I color about every 6 weeks and use heat tools once or twice a week. Looking for something gentle but that actually cleans (not just a co-wash). Doesn't have to be expensive — I'd love to hear what's worked.",
  },
  {
    category: 'Hair Care',
    author: 'Helen',
    title: 'Scalp itching that nothing seems to help — anyone solved this?',
    body:
      "For the last 6 months my scalp has been driving me crazy. Tried tea tree shampoo, apple cider vinegar rinses, switched detergents, nothing helps. Dermatologist said it's just dryness but the creams she gave me didn't help. Has anyone here cracked this?",
  },

  // ─── Styling Tips ───
  {
    category: 'Styling Tips',
    author: 'Carol',
    title: 'Letting my hair air-dry has changed everything — wish I started 20 years ago',
    body:
      "I've been blow-drying my hair every morning since I was 25. Last summer I just gave up because it was too hot. Three months in and my hair has a wave I never knew existed, way less frizz, and I think it actually grew faster. Anyone else made this switch later in life?",
  },
  {
    category: 'Styling Tips',
    author: 'James',
    title: 'Men 65+ — what cut have you settled on? I keep going too short',
    body:
      "Lost a lot of hair on top in the last 10 years and I've been getting it buzzed short to hide the thin patches. My wife thinks it makes me look severe. Any guys here found a cut that works for thinning on top without going all the way to a buzz? I'd love to see what's working for others.",
  },
  {
    category: 'Styling Tips',
    author: 'Donna',
    title: 'Bangs at 60? Yes or no — I keep going back and forth',
    body:
      "I had bangs for most of my life and grew them out about 5 years ago. Lately I miss them. My friend says bangs make you look younger but my hairdresser warned me forehead bangs can also highlight every line. What's been your experience? Are 'curtain bangs' the safer bet?",
  },

  // ─── Color & Dye ───
  {
    category: 'Color & Dye',
    author: 'Margaret',
    title: 'Finally embracing the silver — six months in and I have thoughts',
    body:
      "Stopped coloring in November. The growing-out phase was brutal for the first three months (lots of headbands and hats). But now I have about 4 inches of natural silver-white and I genuinely love it. Wish someone had told me my silver is actually quite pretty. Anyone else gone through this transition?",
  },
  {
    category: 'Color & Dye',
    author: 'Sandra',
    title: 'Box dye keeps turning brassy after 2 weeks — what am I doing wrong?',
    body:
      "I dye my hair a medium ash brown at home every 6 weeks. Within 10-14 days it's bright orange-brown. I'm using cool-toned shampoo, no chlorine pool exposure, hard water filter on the shower. Stylists tell me 'go to a salon' but I'm on a fixed income. Any home tips that actually worked?",
  },

  // ─── Hair Loss & Thinning ───
  {
    category: 'Hair Loss & Thinning',
    author: 'Barbara',
    title: 'Has biotin actually worked for anyone? Or is it just expensive pee?',
    body:
      "I've been on biotin (5000 mcg daily) for 4 months. My nails are stronger but I honestly can't tell if my hair is thicker. Doctor says some studies show benefit, others don't. Curious if anyone here has seen real, visible improvement — and how long did it take?",
  },
  {
    category: 'Hair Loss & Thinning',
    author: 'Robert',
    title: 'Minoxidil at 68 — should I bother starting now?',
    body:
      "Lost most of my hair on the crown over the last 15 years. Just curious if minoxidil could help recover anything at this point, or if it's mostly useful for people earlier in the thinning process. My GP says it's safe but had no opinion on effectiveness for my situation. Real experiences appreciated.",
  },

  // ─── Products & Tools ───
  {
    category: 'Products & Tools',
    author: 'Ruth',
    title: 'Switched to a wooden brush — am I imagining the difference?',
    body:
      "Picked up a $12 wooden brush at a craft fair on a whim, started using it instead of my old plastic one. Within two weeks my hair feels less staticky, less frizzy, and easier to style. Is there science behind this or am I making it up? Curious what brushes you all swear by.",
  },
  {
    category: 'Products & Tools',
    author: 'Kenneth',
    title: 'Best beard trimmer that holds up for years — recommendations?',
    body:
      "Mine just died after 4 years and I'm overwhelmed by options now. I want something with battery life that lasts an actual week, good guards, and not made of fragile plastic. Budget around $50-80. What's lasted you?",
  },
  {
    category: 'Products & Tools',
    author: 'Sharon',
    title: 'Is the silk pillowcase hype real? Worth $40?',
    body:
      "Everyone keeps mentioning silk pillowcases for hair. I sleep on a regular cotton one and my hair is fine in the morning. Tempted to try but $40 for a single pillowcase feels steep. For those who switched — would you do it again?",
  },

  // ─── Lifestyle & Confidence ───
  {
    category: 'Lifestyle & Confidence',
    author: 'Gloria',
    title: "Stopped getting compliments after going gray — has anyone else noticed?",
    body:
      "When I had my hair colored I got compliments constantly. Since going natural silver about a year ago, I get fewer comments from strangers and friends. Not bothered exactly — but it's interesting how visible we are at different stages. Has anyone else noticed this? Are we less visible to the world after a certain age?",
  },
  {
    category: 'Lifestyle & Confidence',
    author: 'Walter',
    title: "First grandchild on the way — should I dye my beard? I look 'old' in photos",
    body:
      "My beard went mostly white at 58. I'm 64 now and our daughter is having her first baby in two months. Looking at recent photos I look much older than I feel. Wife says I look distinguished. Has anyone here played around with beard color? Did it actually help or was it more trouble than it was worth?",
  },
  {
    category: 'Lifestyle & Confidence',
    author: 'Theresa',
    title: 'Finally chopped 8 inches off after 30 years of long hair — best decision',
    body:
      "Wore my hair past my shoulders since college. Last month I just walked in and said 'collarbone length'. I was terrified, then I cried, then I loved it. Routine is shorter, I look in the mirror and recognize myself, and I feel lighter (literally). Anyone else done this and felt the same?",
  },
];

export async function fillCannedThreads({
  site = DEFAULT_SITE,
  shuffle = true,
} = {}) {
  const report = { created: [], errors: [] };
  const list = shuffle ? CANNED_THREADS.slice().sort(() => Math.random() - 0.5) : CANNED_THREADS;

  // Check for existing titles so we don't duplicate
  let existingTitles = new Set();
  try {
    const ex = await strapi(
      `/discussion-threads?filters[site][$eq]=${encodeURIComponent(site)}&fields[0]=title&pagination[pageSize]=100`,
    );
    existingTitles = new Set((ex?.data || []).map(t => t.title));
  } catch (_) { /* not fatal */ }

  for (const seed of list) {
    if (existingTitles.has(seed.title)) {
      console.log(`[forum-canned-thread] skip duplicate: ${seed.title.slice(0, 50)}…`);
      continue;
    }
    try {
      const slug = `${slugify(seed.title)}-${crypto.randomBytes(3).toString('hex')}`;
      const nowIso = new Date().toISOString();
      const created = await strapi('/discussion-threads', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            title: seed.title,
            slug,
            body: seed.body,
            authorName: seed.author,
            authorAvatarIdenticon: `${seed.author}#${crypto.randomBytes(2).toString('hex')}`,
            site,
            category: seed.category,
            isAutoCreated: true,
            isPinned: false,
            isLocked: false,
            viewCount: Math.floor(Math.random() * 80),
            commentCount: 0,
            lastActivityAt: nowIso,
          },
        }),
      });
      if (created?.data?.documentId) {
        report.created.push({
          id: created.data.documentId,
          title: seed.title,
          category: seed.category,
        });
        console.log(`[forum-canned-thread] +${seed.category}: ${seed.title.slice(0, 50)}…`);
      } else {
        report.errors.push(`null response on "${seed.title.slice(0, 40)}"`);
      }
      // 2.5s between thread creates to dodge Strapi Cloud write throttle
      await sleep(2500);
    } catch (err) {
      report.errors.push(`${seed.title.slice(0, 40)}: ${err.message}`);
    }
  }

  return report;
}

/* ─── Canned-reply seeder ──────────────────────────────────────────── */
// Pre-written, evergreen replies that fit any hair-care thread for an
// audience of people 50+. Used to seed demo content without burning
// through Gemini's free-tier RPM budget. Replies are organic-sounding,
// avoid clichés ("Great article!"), and vary in tone.

const CANNED_REPLIES = [
  "I went through the same thing two years ago and what finally helped was switching to a sulfate-free shampoo and only washing twice a week. Took about a month to see a difference but it was worth the patience.",
  "My hairdresser told me something similar - she said our hair changes texture every decade. I've started using a leave-in conditioner with argan oil and it's made a noticeable difference for me.",
  "Honestly, I gave up fighting it. I let mine go natural last spring and got compliments from strangers in the grocery store. Confidence does more than any product, in my experience.",
  "Have you tried a silk pillowcase? Sounds silly but my granddaughter convinced me to try one and the breakage I was dealing with disappeared within a few weeks.",
  "I'm in my late 60s and dealing with the exact same issue. What worked for me was a weekly olive oil mask - just warm a tablespoon and work it through, leave for an hour, then wash out. Old-fashioned but effective.",
  "Same boat here. My doctor mentioned that thyroid changes after 50 can affect hair too, so it might be worth a quick blood test if you haven't had one recently. Mine was a little off and the medication helped.",
  "Drugstore products have come a long way. I was a salon-loyalist for 30 years but the Pantene one for thinning hair (the one with the silver label) honestly works as well as the $40 bottle I used to buy.",
  "I asked my stylist this exact question last month! She said biotin supplements take about 3-6 months to show results, so if you're trying that, don't give up too soon. I'm at month 4 and just starting to see new growth at the temples.",
  "What you're describing sounds so familiar. For me, the game-changer was getting a proper layered cut - it gave the illusion of volume without me having to do much. My stylist made all the difference.",
  "I had to laugh reading this - my husband says my hair has a 'personality of its own' now. I've embraced air-drying and a tiny bit of mousse. Less heat damage seems to have helped over time.",
  "Cold rinse at the end of every wash. Sounds awful but it really does close the cuticle and make a difference in shine. My mother taught me that one and I've been doing it for 40 years.",
  "I switched to a wooden brush a few years back and my hair feels less staticky and more manageable. Small change but it stuck.",
  "Don't underestimate water quality. We moved last year and the difference in our water completely changed how my hair behaves. We added a shower filter and it's much better now.",
  "My sister swears by rosemary oil mixed into her conditioner. I was skeptical but tried it for two months and there's definitely something to it. Worth a few dollars to experiment.",
  "I lost a lot of hair after a stressful year with my husband's illness. It came back, but slowly. Be gentle with yourself - sometimes it's not about the product at all.",
  "Have you talked to your stylist about a glaze treatment? It's not a color, just a clear shine treatment that lasts about 4-6 weeks. Game changer for dull hair in my experience.",
  "I gave up shampooing daily about 5 years ago - went to every 3 days - and it took my hair a few weeks to adjust but now it looks so much healthier.",
  "Pro tip from my hairdresser of 25 years: always apply conditioner from mid-length down, never on the scalp. I was doing it wrong for years.",
  "Same issue here. I started using a wide-tooth comb on wet hair instead of a brush and the breakage dropped to almost nothing.",
  "I'd add - drink more water than you think you need. My dermatologist said dehydration shows up in your hair before anywhere else. Boring advice but it helped me.",
  "There's a stylist on YouTube who specializes in hair over 50 - search 'hair over 50' and you'll find her. She has free tutorials that taught me more than years of salon visits.",
  "My experience: less is more. I used to use 5 products. Now I use 2 (shampoo, leave-in conditioner) and my hair has never looked better.",
  "Has anyone tried a scalp massage routine? I do 5 minutes every other night before bed and my scalp feels healthier. Whether it actually grows hair faster, I can't say, but it's relaxing.",
  "I switched to color-safe shampoo even though I don't color my hair, and it's gentler. Worth checking the label on what you currently use.",
  "I'm going to be the dissenting voice - I tried all these tricks and nothing really worked until I just accepted what my hair wanted to do. Once I stopped fighting it, it cooperated.",
  "Heat protectant. Even on cool air. My hairdresser drilled this into me. The cumulative damage from drying adds up over decades.",
];

const SEEDED_NAMES = [
  'Linda', 'Karen', 'Susan', 'Patricia', 'Margaret', 'Barbara', 'Nancy', 'Helen',
  'Sandra', 'Donna', 'Carol', 'Ruth', 'Sharon', 'Laura', 'Kathleen', 'Pamela',
  'Robert', 'James', 'David', 'Richard', 'Charles', 'Thomas', 'Daniel', 'Paul',
  'Mark', 'Steven', 'Kenneth', 'George', 'Edward', 'Brian', 'Anthony', 'Walter',
];

/**
 * Fills threads with hand-curated replies. No Gemini calls — fully reliable
 * for demo/seed purposes. Picks unique replies per thread (no repeats within
 * the same thread).
 */
export async function fillCannedReplies({
  maxThreads = 8,
  repliesPerThread = 3,
  maxComments = 4,
  site = DEFAULT_SITE,
} = {}) {
  console.log(`[forum-canned] START maxThreads=${maxThreads} repliesPerThread=${repliesPerThread} maxComments=${maxComments} site=${site}`);
  const report = { threads: [], replies: 0, errors: [] };

  const list = await strapi(
    `/discussion-threads?filters[site][$eq]=${encodeURIComponent(site)}` +
      `&filters[commentCount][$lt]=${maxComments}` +
      `&filters[isLocked][$eq]=false` +
      `&sort=createdAt:desc&pagination[page]=1&pagination[pageSize]=${maxThreads}`,
  );
  const threads = list?.data || [];
  console.log(`[forum-canned] picked ${threads.length} threads`);

  // Shuffle a copy of the reply pool per thread to keep things varied
  const shuffleCopy = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  for (const t of threads) {
    const entry = { id: t.documentId, title: t.title, replies: 0 };
    report.threads.push(entry);

    const replyPool = shuffleCopy(CANNED_REPLIES);
    const namePool = shuffleCopy(SEEDED_NAMES).filter(n => n !== t.authorName);
    let commentCount = t.commentCount || 0;

    for (let r = 0; r < repliesPerThread; r += 1) {
      try {
        const replyBody = replyPool[r % replyPool.length];
        const name = namePool[r % namePool.length];
        // Both ?status=published query AND publishedAt in body — together
        // these reliably get past the silent {data:null} response.
        const created = await strapi('/forum-comments?status=published', {
          method: 'POST',
          body: JSON.stringify({
            data: {
              thread: { connect: [t.documentId] },
              body: replyBody,
              authorName: name,
              likes: Math.floor(Math.random() * 6),
              publishedAt: new Date().toISOString(),
            },
          }),
        });
        if (created?.data?.documentId) {
          report.replies += 1;
          entry.replies += 1;
          commentCount += 1;
          console.log(`[forum-canned] +reply by ${name} on "${t.title.slice(0, 40)}…"`);
          await sleep(1500);
        } else {
          console.warn(`[forum-canned] no documentId — sleeping 20s before next`);
          await sleep(20000);
        }
      } catch (err) {
        console.error(`[forum-canned] reply error: ${err.message}`);
        report.errors.push(`reply on ${t.documentId}: ${err.message}`);
      }
    }

    // Touch thread's commentCount + lastActivityAt
    try {
      await strapi(`/discussion-threads/${t.documentId}`, {
        method: 'PUT',
        body: JSON.stringify({
          data: {
            commentCount,
            lastActivityAt: new Date().toISOString(),
          },
        }),
      });
    } catch (err) {
      report.errors.push(`thread touch ${t.documentId}: ${err.message}`);
    }
  }

  return report;
}

/**
 * Picks N existing threads that have fewer than maxComments replies and
 * adds K replies to each. Useful for backfilling conversation onto threads
 * that the cron / bulk seeder created but didn't fully populate.
 */
export async function fillRepliesOnExistingThreads({
  maxThreads = 6,
  repliesPerThread = 3,
  maxComments = 4,
  site = DEFAULT_SITE,
} = {}) {
  const report = { threads: [], replies: 0, errors: [] };

  // Find threads with low comment counts
  const list = await strapi(
    `/discussion-threads?filters[site][$eq]=${encodeURIComponent(site)}` +
      `&filters[commentCount][$lt]=${maxComments}` +
      `&filters[isLocked][$eq]=false` +
      `&sort=createdAt:desc&pagination[page]=1&pagination[pageSize]=${maxThreads}`,
  );
  const threads = list?.data || [];

  for (const t of threads) {
    const entry = { id: t.documentId, title: t.title, replies: 0 };
    report.threads.push(entry);
    const usedNames = t.authorName ? [t.authorName] : [];
    const threadState = { ...t };

    for (let r = 0; r < repliesPerThread; r += 1) {
      try {
        const out = await genReplyNoPersona({
          thread: threadState,
          excludeNames: usedNames,
        });
        if (out?.documentId) {
          report.replies += 1;
          entry.replies += 1;
          threadState.commentCount = (threadState.commentCount || 0) + 1;
          if (out.name) usedNames.push(out.name);
          console.log(`[forum-fill] +reply by ${out.name} on "${t.title.slice(0, 40)}…"`);
        } else {
          console.warn(`[forum-fill] gemini returned no reply for "${t.title.slice(0, 40)}…"`);
        }
        // 5s between replies to stay well under Gemini's free-tier RPM cap
        await sleep(5000);
      } catch (err) {
        console.error(`[forum-fill] reply error on ${t.documentId}: ${err.message}`);
        report.errors.push(`reply on ${t.documentId}: ${err.message}`);
      }
    }
    await sleep(500);
  }

  return report;
}

/**
 * Persona-less bulk seeder. Skips the forum-persona table entirely.
 * Use this when the Strapi token doesn't have access to forum-persona.
 */
export async function seedForumQuick({
  threadsCount = 5,
  repliesPerThread = 3,
  site = DEFAULT_SITE,
} = {}) {
  const report = { threads: [], replies: 0, errors: [] };

  for (let i = 0; i < threadsCount; i += 1) {
    try {
      const t = await genThreadNoPersona({ site });
      if (!t?.documentId) {
        report.errors.push(`thread ${i + 1}: skipped`);
        continue;
      }
      const threadEntry = { id: t.documentId, title: t.title, replies: 0 };
      report.threads.push(threadEntry);

      // accumulate names to keep replies varied
      const usedNames = [t._authorName];
      // track commentCount locally so we don't re-fetch every iteration
      const threadState = { ...t, commentCount: 0 };

      for (let r = 0; r < repliesPerThread; r += 1) {
        try {
          const out = await genReplyNoPersona({
            thread: threadState,
            excludeNames: usedNames,
          });
          if (out?.documentId) {
            report.replies += 1;
            threadEntry.replies += 1;
            threadState.commentCount += 1;
            if (out.name) usedNames.push(out.name);
          }
          await sleep(600);
        } catch (err) {
          report.errors.push(`reply on ${t.documentId}: ${err.message}`);
        }
      }
      await sleep(800);
    } catch (err) {
      report.errors.push(`thread ${i + 1}: ${err.message}`);
    }
  }

  return report;
}

/**
 * Idempotent-ish bulk seeder for demo / fresh-install scenarios.
 * Creates personas if needed, then N threads, then R replies on each thread.
 */
export async function seedForum({
  personasCount = 8,
  threadsCount = 5,
  repliesPerThread = 3,
  site = DEFAULT_SITE,
} = {}) {
  const report = {
    personas: { created: 0, total: 0 },
    threads: [],
    replies: 0,
    errors: [],
  };

  try {
    const p = await seedPersonas({ count: personasCount, site });
    report.personas = p;
  } catch (err) {
    report.errors.push(`seedPersonas: ${err.message}`);
  }

  for (let i = 0; i < threadsCount; i += 1) {
    try {
      const t = await genThreadSafe({ site });
      if (!t?.documentId) {
        report.errors.push(`thread ${i + 1}: skipped`);
        continue;
      }
      report.threads.push({ id: t.documentId, title: t.title, replies: 0 });

      for (let r = 0; r < repliesPerThread; r += 1) {
        try {
          const out = await genReplyForThread({ threadDocumentId: t.documentId, site });
          if (out?.documentId) {
            report.replies += 1;
            report.threads[report.threads.length - 1].replies += 1;
          }
          await sleep(600);
        } catch (err) {
          report.errors.push(`reply on ${t.documentId}: ${err.message}`);
        }
      }
      // small breather between threads to keep Gemini rate-limit happy
      await sleep(800);
    } catch (err) {
      report.errors.push(`thread ${i + 1}: ${err.message}`);
    }
  }

  return report;
}
