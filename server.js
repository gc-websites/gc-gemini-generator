import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import requestIp from 'request-ip';

import { generateAndPost, postUserEmail } from './functions.js';
import { generateImg, generateProduct, postToStrapi } from './functionsForProducts.js';
import { generateAndPostCholesterin } from './functionsCholesterin.js';
import { generateAndPostHairStyles } from './functionsHairStyles.js';
import { generateAndPostPixelHost } from './functionsPixelHost.js';
import { generateAndPostWpcrew } from './functionsWpcrew.js';
import { createTelegramBot } from './tgBot.js';
import { generateCommonTitle, generateProductsArray, postMultiproductToStrapi } from './functionsForMultiproducts.js';
import { checkSitesAvailability } from './siteChecker.js';
import { runAutoCommenter, formatReportForTelegram } from './autoCommenter.js';
import { attachForumRoutes } from './forumRoutes.js';
import { seedPersonas, genThreadSafe, genReplySafe, seedForum, seedForumQuick, fillRepliesOnExistingThreads, fillCannedReplies, fillCannedThreads } from './functionsForum.js';
import { sendTikTokEvent } from './tiktokEvents.js';
import { sendMetaEvent } from './metaEvents.js';
import { attachAntifraudRoutes, shouldForwardConversion } from './antifraud/index.js';

const server = express();
const PORT = process.env.PORT || 4000;
dotenv.config();

const STRAPI_API_URL = process.env.STRAPI_API_URL;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TG_TOKEN = process.env.TG_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// TikTok Events API (server-side). Token is the secret (in .env as TT_TOKEN);
// pixel id is public and defaults to the configured pixel. Test code is optional.
const TT_TOKEN = process.env.TT_TOKEN;
const TT_PIXEL_ID = process.env.TT_PIXEL_ID || 'CGUJ36RC77U0HA6062A0';
const TT_TEST_EVENT_CODE = process.env.TT_TEST_EVENT_CODE;

// Meta Conversions API for the FUNNEL (server-side). Deliberately namespaced
// FB_FUNNEL_* — the legacy leads pipeline (functionsForTracking.js) already owns
// FB_PIXEL_ID/FB_ACCESS_TOKEN in this .env for a DIFFERENT pixel. Pixel id falls
// back to the ad URL's fb_pixel param the browser forwarded. Test code optional.
const FB_TOKEN = process.env.FB_FUNNEL_TOKEN;
const FB_PIXEL_ID = process.env.FB_FUNNEL_PIXEL_ID;
const FB_TEST_EVENT_CODE = process.env.FB_FUNNEL_TEST_EVENT_CODE;

const corsOptions = {
  origin: [
    'https://nice-advice.info',
    'https://www.nice-advice.info',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:4173',
    'https://cholesterintipps.de',
    'https://www.cholesterintipps.de',
    'https://dev.nice-advice.info',
    'https://www.dev.nice-advice.info',
    'https://hairstylesforseniors.com',
    'https://www.hairstylesforseniors.com',
    'https://suggestionoftheday.com',
    'https://www.suggestionoftheday.com',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}

server.use(express.json());
server.use(cors(corsOptions));
server.set('trust proxy', true);

attachForumRoutes(server);
attachAntifraudRoutes(server);

const bot = createTelegramBot(TG_TOKEN);

server.post("/send", async (req, res) => {
  const { chatId, message } = req.body;

  try {
    await bot.sendMessage(chatId, message);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

bot.on("message", (msg) => {
  const chat = msg.chat;

  console.log({
    chatId: chat.id,
    type: chat.type,        // private | group | supergroup | channel
    title: chat.title,      // название группы / канала
    username: chat.username // если есть
  });
});


let isRunning = false;
cron.schedule('0 0,12 * * *', async () => {
  if (isRunning) {
    console.log('generateAndPost already running — skipping this run.');
    return;
  }
  isRunning = true;
  try {
    console.log('Scheduled job start:', new Date().toISOString());
    const niceAdvicePostId = await generateAndPost();
    await bot.sendMessage(
      ADMIN_CHAT_ID,
      `⭐️⭐️⭐️NEW POST⭐️⭐️⭐️
✅NiceAdvice✅

Title:  ${niceAdvicePostId.data.title}

https://nice-advice.info/post/${niceAdvicePostId.data.documentId}`,
      {
        disable_web_page_preview: true
      });
    const cholesterinPostId = await generateAndPostCholesterin();
    await bot.sendMessage(
      ADMIN_CHAT_ID,
      `⭐️⭐️⭐️NEW POST⭐️⭐️⭐️
✅CholesterinTipps✅

Title: ${cholesterinPostId.data.title}

https://cholesterintipps.de/post/${cholesterinPostId.data.documentId}`,
      {
        disable_web_page_preview: true
      });
    const hairStylesPostId = await generateAndPostHairStyles();
    await bot.sendMessage(
      ADMIN_CHAT_ID,
      `⭐️⭐️⭐️NEW POST⭐️⭐️⭐️
✅HairStylesForSeniors✅

Title: ${hairStylesPostId.data.title}

https://hairstylesforseniors.com/post/${hairStylesPostId.data.documentId}`,
      {
        disable_web_page_preview: true
      });
    // PixelHost (post4s) — isolated: its own try/catch so a failure here can
    // never affect the three sites generated above.
    try {
      const pixelHostPost = await generateAndPostPixelHost();
      await bot.sendMessage(
        ADMIN_CHAT_ID,
        `⭐️⭐️⭐️NEW POST⭐️⭐️⭐️
✅PixelHost✅

Title: ${pixelHostPost.title}

https://pixelhost.io/article/${pixelHostPost.slug}`,
        {
          disable_web_page_preview: true
        });
    } catch (pixelHostErr) {
      console.error('PixelHost generation error:', pixelHostErr);
    }
    // WP Crew (post5s) — isolated: its own try/catch so a failure here can
    // never affect the sites generated above.
    try {
      const wpcrewPost = await generateAndPostWpcrew();
      await bot.sendMessage(
        ADMIN_CHAT_ID,
        `⭐️⭐️⭐️NEW POST⭐️⭐️⭐️
✅WP Crew✅

Title: ${wpcrewPost.title}

https://wpcrew.co/article/${wpcrewPost.slug}`,
        {
          disable_web_page_preview: true
        });
    } catch (wpcrewErr) {
      console.error('WP Crew generation error:', wpcrewErr);
    }
    console.log('Scheduled job end:', new Date().toISOString());
  } catch (err) {
    console.error('Scheduled job error:', err);
  } finally {
    isRunning = false;
  }
}, {
  timezone: 'Europe/Kiev'
});

cron.schedule('30 9 * * *', async () => {
  console.log('Running daily site availability check...');
  try {
    const report = await checkSitesAvailability();
    await bot.sendMessage(ADMIN_CHAT_ID, report);
    console.log('Site check report sent to Telegram.');
  } catch (error) {
    console.error('Error during site availability check:', error);
  }
}, {
  timezone: 'Europe/Kiev'
});

// ─── Auto-commenter: every 2 hours, comment on the 10 freshest posts of each site ───
let isAutoCommenterRunning = false;
async function runAutoCommenterJob({ trigger = 'cron' } = {}) {
  if (isAutoCommenterRunning) {
    console.log('[autoCommenter] already running — skipping this run.');
    return { skipped: true };
  }
  isAutoCommenterRunning = true;
  try {
    console.log(`[autoCommenter] start (${trigger}):`, new Date().toISOString());
    const report = await runAutoCommenter({ postsPerSite: 10 });
    console.log(`[autoCommenter] done: posted=${report.totalPosted} errors=${report.totalErrors} in ${report.durationSec}s`);
    try {
      await bot.sendMessage(ADMIN_CHAT_ID, formatReportForTelegram(report), {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
    } catch (tgErr) {
      console.warn('[autoCommenter] telegram notify failed:', tgErr.message);
    }
    return report;
  } catch (err) {
    console.error('[autoCommenter] fatal:', err);
    try {
      await bot.sendMessage(ADMIN_CHAT_ID, `❌ Auto-commenter failed: ${err.message}`);
    } catch (_) { /* ignore */ }
    throw err;
  } finally {
    isAutoCommenterRunning = false;
  }
}

// Once a day at 11:00 Kyiv time. Each run leaves ~1 new comment on each of
// the freshest posts per site — daily cadence keeps engagement looking
// organic without spamming posts or burning through Gemini quota.
cron.schedule('0 11 * * *', () => {
  runAutoCommenterJob({ trigger: 'cron' }).catch(err =>
    console.error('[autoCommenter] cron error:', err.message)
  );
}, {
  timezone: 'Europe/Kiev'
});

// ─── Forum bot generators ─────────────────────────────────────────────────
// Two threads/day (10:00 and 19:00 ET) + ~10 replies/day distributed.
let isForumThreadRunning = false;
async function runForumThread() {
  if (isForumThreadRunning) {
    console.log('[forum-cron] genThread already running — skip.');
    return;
  }
  isForumThreadRunning = true;
  try {
    const result = await genThreadSafe({ site: 'hairstyles' });
    if (result?.title) {
      console.log(`[forum-cron] thread created: ${result.title}`);
    }
  } finally {
    isForumThreadRunning = false;
  }
}

let isForumReplyRunning = false;
async function runForumReply() {
  if (isForumReplyRunning) {
    console.log('[forum-cron] genReply already running — skip.');
    return;
  }
  isForumReplyRunning = true;
  try {
    await genReplySafe({ site: 'hairstyles' });
  } finally {
    isForumReplyRunning = false;
  }
}

// New forum threads — 10:00 and 19:00 America/New_York (2/day).
cron.schedule('0 10,19 * * *', () => {
  runForumThread().catch(err => console.error('[forum-cron] thread error:', err.message));
}, {
  timezone: 'America/New_York',
});

// Forum replies — every 6 hours (4/day). genReply is idempotent and only
// fires when a thread is older than 8h with <12 comments, so this won't
// over-populate threads even though the cron ticks 4 times.
cron.schedule('15 */6 * * *', () => {
  runForumReply().catch(err => console.error('[forum-cron] reply error:', err.message));
}, {
  timezone: 'America/New_York',
});

// Admin / manual endpoints — handy for first-run seeding and ops.
server.post('/forum-admin/seed-personas', async (req, res) => {
  try {
    const { count, site } = req.body || {};
    const result = await seedPersonas({
      count: Number(count) || 20,
      site: site || 'hairstyles',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[forum-admin] seedPersonas error:', err);
    res.status(500).json({ error: err.message });
  }
});

server.post('/forum-admin/gen-thread', async (req, res) => {
  try {
    const out = await genThreadSafe({ site: req.body?.site || 'hairstyles' });
    res.json({ success: !!out, data: out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

server.post('/forum-admin/gen-reply', async (req, res) => {
  try {
    const out = await genReplySafe({ site: req.body?.site || 'hairstyles' });
    res.json({ success: !!out, data: out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

server.post('/forum-admin/seed-all', async (req, res) => {
  try {
    const result = await seedForum({
      personasCount: Number(req.body?.personasCount) || 8,
      threadsCount: Number(req.body?.threadsCount) || 5,
      repliesPerThread: Number(req.body?.repliesPerThread) || 3,
      site: req.body?.site || 'hairstyles',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

server.post('/forum-admin/seed-quick', async (req, res) => {
  try {
    const result = await seedForumQuick({
      threadsCount: Number(req.body?.threadsCount) || 5,
      repliesPerThread: Number(req.body?.repliesPerThread) || 3,
      site: req.body?.site || 'hairstyles',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

server.post('/forum-admin/fill-replies', async (req, res) => {
  try {
    const result = await fillRepliesOnExistingThreads({
      maxThreads: Number(req.body?.maxThreads) || 6,
      repliesPerThread: Number(req.body?.repliesPerThread) || 3,
      maxComments: Number(req.body?.maxComments) || 4,
      site: req.body?.site || 'hairstyles',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

server.post('/forum-admin/canned-threads', async (req, res) => {
  try {
    const result = await fillCannedThreads({ site: req.body?.site || 'hairstyles' });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

server.post('/forum-admin/canned-replies', async (req, res) => {
  try {
    const result = await fillCannedReplies({
      maxThreads: Number(req.body?.maxThreads) || 8,
      repliesPerThread: Number(req.body?.repliesPerThread) || 3,
      maxComments: Number(req.body?.maxComments) || 4,
      site: req.body?.site || 'hairstyles',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

server.post('/test-auto-comment', async (req, res) => {
  try {
    const report = await runAutoCommenterJob({ trigger: 'manual' });
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

server.get('/test-check-sites', async (req, res) => {
  try {
    const report = await checkSitesAvailability();
    await bot.sendMessage(ADMIN_CHAT_ID, report);
    res.json({ success: true, report });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

server.post('/generate-post', async (req, res) => {
  try {
    await generateAndPost();
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error in /generate-post:", err);
    res.status(500).json({ error: err.message });
  }
});

server.post('/generate-product', async (req, res) => {
  try {
    const { query, link, country } = req.body;
    const product = {
      title: '',
      descriptionfield1: '',
      descriptionfield2: '',
      descriptionfield3: '',
      descriptionfield4: '',
      image: '',
      link: link,
      country: country
    };

    // Parallelize generating product text and generating image
    const [result, imgId] = await Promise.all([
      generateProduct(query),
      generateImg(query)
    ]);

    console.log('BodyProductGenerated');
    product.title = result.title;
    product.descriptionfield1 = result.descriptionfield1;
    product.descriptionfield2 = result.descriptionfield2;
    product.descriptionfield3 = result.descriptionfield3;
    product.descriptionfield4 = result.descriptionfield4;
    product.image = imgId;

    const postId = await postToStrapi(product);
    console.log('PostedToStrapi');

    if (postId) {
      res.json({ id: postId });
    } else {
      res.status(500).json({ error: 'ERROR: No postId returned' });
    }
  } catch (err) {
    console.error("❌ Error in /generate-product:", err);
    res.status(500).json({ error: err.message });
  }
})

server.get('/get-product/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const strapiRes = await fetch(`${STRAPI_API_URL}/api/products/${id}?populate=image`, {
      headers: {
        Authorization: STRAPI_TOKEN,
      },
    });

    if (strapiRes.status === 404) {
      console.log(`⚠️ Product not found (404) for ID: ${id}`);
      return res.status(404).json({ error: "Product not found" });
    }

    if (!strapiRes.ok) {
      throw new Error(`Strapi error: ${strapiRes.statusText}`);
    }

    const product = await strapiRes.json();
    if (!product.data || product.data === null) {
      console.log(`⚠️ Product not found (404) for ID: ${id}`);
      return res.status(404).json({ error: "Product not found" });
    }
    res.json(product);
  } catch (err) {
    console.error("❌ Error fetching product:", err);
    res.status(500).json({ error: err.message });
  }
})

server.get('/get-product-temu/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const strapiRes = await fetch(`${STRAPI_API_URL}/api/product-temus/${id}?populate=image`, {
      headers: {
        Authorization: STRAPI_TOKEN,
      },
    });

    if (strapiRes.status === 404) {
      console.log(`⚠️ Temu Product not found (404) for ID: ${id}`);
      return res.status(404).json({ error: "Temu Product not found" });
    }

    if (!strapiRes.ok) {
      throw new Error(`Strapi error: ${strapiRes.statusText}`);
    }

    const product = await strapiRes.json();
    if (!product.data || product.data === null) {
      console.log(`⚠️ Temu Product not found (404) for ID: ${id}`);
      return res.status(404).json({ error: "Temu Product not found" });
    }
    res.json(product);
  } catch (err) {
    console.error("❌ Error fetching temu product:", err);
    res.status(500).json({ error: err.message });
  }
})

server.get('/get-product-v2/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const strapiRes = await fetch(`${STRAPI_API_URL}/api/product-v2s/${id}?populate=*`, {
      headers: {
        Authorization: STRAPI_TOKEN,
      },
    });

    if (strapiRes.status === 404) {
      console.log(`⚠️ Product V2 not found (404) for ID: ${id}`);
      return res.status(404).json({ error: "Product V2 not found" });
    }

    if (!strapiRes.ok) {
      throw new Error(`Strapi error: ${strapiRes.statusText} for ID: ${id}`);
    }

    const product = await strapiRes.json();
    if (!product.data || product.data === null) {
      console.log(`⚠️ Product V2 not found (404) for ID: ${id}`);
      return res.status(404).json({ error: "Product V2 not found" });
    }
    res.json(product);
  } catch (err) {
    console.error("❌ Error fetching product-v2:", err);
    res.status(500).json({ error: err.message });
  }
})

server.get('/get-product-v3/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const url = `${STRAPI_API_URL}/api/product-v3s/${id}?populate[0]=titleImg&populate[1]=subImg&populate[2]=product3.img`;
    const strapiRes = await fetch(url, {
      headers: {
        Authorization: STRAPI_TOKEN,
      },
    });
    if (strapiRes.status === 404) {
      console.log(`⚠️ Product V3 not found (404) for ID: ${id}`);
      return res.status(404).json({ error: "Product V3 not found" });
    }

    if (!strapiRes.ok) {
      throw new Error(`Strapi error: ${strapiRes.statusText} for ID: ${id}`);
    }

    const product = await strapiRes.json();
    if (!product.data || product.data === null) {
      console.log(`⚠️ Product V3 not found (404) for ID: ${id}`);
      return res.status(404).json({ error: "Product V3 not found" });
    }
    res.json(product);
  } catch (err) {
    console.error("❌ Error fetching product-v3:", err);
    res.status(500).json({ error: err.message });
  }
})

server.get('/get-multiproduct/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const strapiRes = await fetch(
      `${STRAPI_API_URL}/api/multiproducts/${id}?populate[product][populate]=image`,
      {
        headers: {
          Authorization: STRAPI_TOKEN,
        },
      }
    );

    if (strapiRes.status === 404) {
      console.log(`⚠️ Multiproduct not found (404) for ID: ${id}`);
      return res.status(404).json({ error: "Multiproduct not found" });
    }

    if (!strapiRes.ok) {
      throw new Error(`Strapi error: ${strapiRes.statusText}`);
    }

    const multiproduct = await strapiRes.json();
    if (!multiproduct.data || multiproduct.data === null) {
      console.log(`⚠️ Multiproduct not found (404) for ID: ${id}`);
      return res.status(404).json({ error: "Multiproduct not found" });
    }
    res.json(multiproduct);

  } catch (err) {
    console.error('❌ Error fetching multiproduct:', err);
    res.status(500).json({ error: err.message });
  }
});

server.post('/email', async (req, res) => {
  const { email, source } = req.body;
  if (!email || !source) {
    return res.status(400).json({ error: 'Missing email or source' });
  }

  try {
    const success = await postUserEmail(email, source);
    if (success === true) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: success }); // returns the error message
    }
  } catch (err) {
    console.error('Email endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});


server.post('/generate-multiproducts', async (req, res) => {
  const { country, products } = req.body;

  if (!country || !Array.isArray(products) || products.length < 5 || products.length > 15) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  try {
    const queries = products.map(p => p.query);

    const commonTitle = await generateCommonTitle(queries);
    const generatedProducts = await generateProductsArray(products);

    const documentId = await postMultiproductToStrapi({
      title: commonTitle,
      country,
      products: generatedProducts
    });

    res.json({
      success: true,
      documentId
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});






// ─── Click Tracking for Prelend Analytics ───
function getDeviceType(ua) {
  if (!ua) return 'unknown';
  ua = ua.toLowerCase();
  if (/tablet|ipad|playbook|silk/.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry/.test(ua)) return 'mobile';
  return 'desktop';
}

// Write one row to the Strapi `tt-conversion` collection logging a TikTok Events
// API send (what was sent + TikTok's response). Fire-and-forget: never blocks.
async function logTikTokConversion(record) {
  try {
    const r = await fetch(`${STRAPI_API_URL}/api/tt-conversions`, {
      method: 'POST',
      headers: {
        Authorization: STRAPI_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: record }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('❌ tt-conversion log rejected:', r.status, txt.slice(0, 500));
    }
  } catch (err) {
    console.error('❌ tt-conversion log error:', err.message);
  }
}

async function logFbConversion(record) {
  try {
    const r = await fetch(`${STRAPI_API_URL}/api/fb-conversions`, {
      method: 'POST',
      headers: {
        Authorization: STRAPI_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: record }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('❌ fb-conversion log rejected:', r.status, txt.slice(0, 500));
    }
  } catch (err) {
    console.error('❌ fb-conversion log error:', err.message);
  }
}

// --- funnel_step canonical ordering + server-side backfill -------------------
// step_order is a coarse funnel position for grouping/sorting; exact within-session
// order still comes from ms_since_start. Gaps of 10 leave room for future steps.
const STEP_ORDER = {
  captcha1_shown: 10,
  captcha1_passed: 20,
  prelander_view: 30,
  captcha2_shown: 40,
  captcha2_passed: 50,
  ad_view: 60, // legacy/unknown slot
  ad_view_v_top: 61, // /v/ slot 4020462057
  cta_click: 70,
  offer_view: 80,
  ad_view_o_top: 81, // /o/ slot 9081217047
  ad_view_o_mid1: 82, // /o/ slot 8220091745 (after 1st paragraph)
  ad_view_o_mid2: 83, // /o/ slot 3800970206 (after intro block)
  ad_view_o: 84, // legacy /o/ ad_view without a slot step
  outbound_click: 90,
  page_exit: 99,
};
// Derive a precise funnel_step from the coarse event_type + source_url, so rows from
// older/cached clients (or the legacy hairstyles captcha) are still labeled correctly.
function deriveFunnelStep(eventType, sourceUrl) {
  const s = String(sourceUrl || '');
  const onV = s.includes('/v/');
  const onO = s.includes('/o/');
  switch (eventType) {
    case 'captcha_shown': return onV ? 'captcha2_shown' : 'captcha1_shown';
    case 'captcha_passed': return onV ? 'captcha2_passed' : 'captcha1_passed';
    case 'prelend_view': return onO ? 'offer_view' : 'prelander_view';
    // /v/ has exactly one slot so the page alone pins it; /o/ has 3 slots — without
    // an explicit funnel_step from the client we can only say "some /o/ ad".
    case 'ad_view': return onV ? 'ad_view_v_top' : onO ? 'ad_view_o' : 'ad_view';
    case 'cta_click': return 'cta_click';
    case 'outbound_click': return 'outbound_click';
    case 'page_exit': return 'page_exit';
    default: return null;
  }
}

server.post('/track-click', async (req, res) => {
  try {
    let ip = requestIp.getClientIp(req);
    if (ip && ip.includes('::ffff:')) {
      ip = ip.replace('::ffff:', '');
    }
    const userAgent = req.get('user-agent') || '';
    const deviceType = getDeviceType(userAgent);

    // Try to get country from IP if geoip-lite is installed
    let country = '';
    try {
      const geoip = await import('geoip-lite');
      const geo = geoip.default.lookup(ip);
      if (geo) {
        country = geo.country;
      }
    } catch (e) {
      // geoip-lite not installed or lookup failed
    }

    const {
      session_id,
      event_type,
      prelend_slug,
      locale,
      source_url,
      destination_url,
      referrer,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_campaign_name,
      utm_term,
      utm_content,
      screen_width,
      screen_height,
      clicked_at,
      gclid,
      fbclid,
      fb_pixel,
      fb_event,
      fb_event_id,
      fbc,
      fbp,
      fb_value,
      fb_currency,
      fb_content_id,
      fb_pixel_mode,
      fb_fire_type,
      page_url,
      tt_pixel,
      tt_event,
      tt_event_id,
      ttclid,
      tt_value,
      tt_currency,
      tt_content_id,
      platform,
      landing_url,
      sequence,
      ms_since_start,
      scroll_depth,
      time_on_page,
      meta,
      af_token,
      funnel_step,
      step_order,
      ui_locale,
    } = req.body;

    // null-guard: drop un-stitchable / un-classifiable junk (no session or no step).
    // Returns 200 so the client beacon isn't retried, but nothing is written to Strapi.
    if (!session_id || !event_type) {
      return res.status(200).json({ ok: true, skipped: 'missing session_id or event_type' });
    }

    // Precise funnel step + canonical order (backfilled when the client omits funnel_step).
    // A generic 'ad_view' from older/cached clients is upgraded to the per-page step too.
    const resolvedStep =
      (funnel_step && funnel_step !== 'ad_view' ? funnel_step : null) ||
      deriveFunnelStep(event_type, source_url) ||
      funnel_step ||
      null;
    const resolvedOrder =
      step_order != null
        ? Number(step_order)
        : resolvedStep && STEP_ORDER[resolvedStep] != null
          ? STEP_ORDER[resolvedStep]
          : null;

    const payload = {
      data: {
        session_id: session_id || null,
        event_type: event_type || null,
        prelend_slug: prelend_slug || null,
        locale: locale || null,
        source_url: source_url || null,
        destination_url: destination_url || null,
        referrer: referrer || null,
        utm_source: utm_source || null,
        utm_medium: utm_medium || null,
        utm_campaign: utm_campaign || null,
        utm_campaign_name: utm_campaign_name || null,
        utm_term: utm_term || null,
        utm_content: utm_content || null,
        client_ip: ip || null,
        user_agent: userAgent || null,
        country: country || null,
        device_type: deviceType,
        funnel_step: resolvedStep || null,
        step_order: resolvedOrder,
        ui_locale: ui_locale || locale || null,
        screen_width: screen_width || null,
        screen_height: screen_height || null,
        clicked_at: clicked_at || new Date().toISOString(),
        gclid: gclid || null,
        fbclid: fbclid || null,
        fb_pixel: fb_pixel || null,
        fb_event: fb_event || null,
        fb_event_id: fb_event_id || null,
        fb_pixel_mode: fb_pixel_mode || null,
        fb_fire_type: fb_fire_type || null,
        platform: platform || null,
        page_url: page_url || null,
        landing_url: landing_url || null,
        sequence: sequence != null ? Number(sequence) : null,
        ms_since_start: ms_since_start != null ? String(ms_since_start) : null,
        scroll_depth: scroll_depth != null ? Number(scroll_depth) : null,
        time_on_page: time_on_page != null ? Number(time_on_page) : null,
        ttclid: ttclid || null,
        tt_pixel: tt_pixel || null,
        tt_event: tt_event || null,
        tt_event_id: tt_event_id || null,
        meta: meta || null,
      }
    };

    // Fire-and-forget to Strapi — don't block the response
    fetch(`${STRAPI_API_URL}/api/click-events`, {
      method: 'POST',
      headers: {
        Authorization: STRAPI_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
      .then(async (r) => {
        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          console.error('❌ Strapi click-event rejected:', r.status, txt.slice(0, 500));
        }
      })
      .catch(err => console.error('❌ Click tracking Strapi error:', err.message));

    const afEnforce = process.env.AF_ENFORCE === 'true';
    const afOk = shouldForwardConversion({
      afToken: af_token,
      enforce: afEnforce,
      secret: process.env.AF_HMAC_SECRET || '',
      thresholds: {
        CLEAN: Number(process.env.AF_THRESHOLD_CLEAN) || 70,
        MID: Number(process.env.AF_THRESHOLD_MID) || 40,
        AD: Number(process.env.AF_THRESHOLD_AD) || 60,
      },
    });
    if (!afOk) {
      console.log('🛡️ antifraud: conversion forward withheld for session', session_id);
    }

    // Forward the conversion to the TikTok Events API (server-side; deduped with
    // the browser pixel via the shared tt_event_id). tt_event_id now rides on the
    // conversion event (the first ad view). Fire-and-forget — never blocks.
    if (afOk && tt_event_id) {
      const ttEvent = tt_event || 'Purchase';
      const numTtValue =
        tt_value != null && tt_value !== '' && !Number.isNaN(Number(tt_value))
          ? Number(tt_value)
          : null;
      sendTikTokEvent(
        {
          event: ttEvent,
          eventId: tt_event_id,
          eventTimeSec: Math.floor(Date.now() / 1000),
          url: page_url || (source_url ? `https://nice-advice.info${source_url}` : undefined),
          referrer,
          ip,
          userAgent,
          ttclid,
          value: tt_value,
          currency: tt_currency,
          contentId: tt_content_id,
        },
        { token: TT_TOKEN, pixelId: TT_PIXEL_ID, testEventCode: TT_TEST_EVENT_CODE }
      )
        // Mirror the send into Strapi `tt-conversion` (what was sent + TikTok's
        // response). Fire-and-forget — never blocks the response or the user.
        .then((result) =>
          logTikTokConversion({
            session_id: session_id || null,
            event: ttEvent,
            event_id: tt_event_id,
            pixel_id: TT_PIXEL_ID || null,
            ttclid: ttclid || null,
            value: numTtValue,
            currency: tt_currency || null,
            content_id: tt_content_id || null,
            client_ip: ip || null,
            user_agent: userAgent || null,
            country: country || null,
            device_type: deviceType || null,
            page_url: page_url || null,
            source_url: source_url || null,
            referrer: referrer || null,
            prelend_slug: prelend_slug || null,
            locale: locale || null,
            platform: platform || null,
            utm_source: utm_source || null,
            utm_medium: utm_medium || null,
            utm_campaign: utm_campaign || null,
            utm_campaign_name: utm_campaign_name || null,
            utm_content: utm_content || null,
            status: result.status || (result.ok ? 'ok' : 'failed'),
            response_code: result.code != null ? Number(result.code) : null,
            response_message:
              result.message || result.error || (result.skipped ? `skipped:${result.skipped}` : null),
            test_event_code: TT_TEST_EVENT_CODE || null,
            request_body: result.requestBody || null,
            sent_at: new Date().toISOString(),
          })
        )
        .catch((err) => console.error('❌ TikTok send/log chain error:', err?.message || err));
    }

    // Forward the conversion to the Meta Conversions API (server-side; deduped with
    // the browser fbq via the shared fb_event_id, which rides ONLY the conversion
    // event — the first ad view, see fbConversion.ts). Fire-and-forget — never blocks.
    if (afOk && fb_event_id) {
      const fbEventName = fb_event || 'Purchase';
      const fbPixelUsed = FB_PIXEL_ID || fb_pixel || null;
      const numFbValue =
        fb_value != null && fb_value !== '' && !Number.isNaN(Number(fb_value))
          ? Number(fb_value)
          : null;
      sendMetaEvent(
        {
          event: fbEventName,
          eventId: fb_event_id,
          eventTimeSec: Math.floor(Date.now() / 1000),
          url: page_url || (source_url ? `https://nice-advice.info${source_url}` : undefined),
          ip,
          userAgent,
          fbc,
          fbp,
          fbclid,
          value: fb_value,
          currency: fb_currency,
          contentId: fb_content_id,
        },
        { token: FB_TOKEN, pixelId: fbPixelUsed, testEventCode: FB_TEST_EVENT_CODE }
      )
        // Mirror the send into Strapi `fb-conversion` (what was sent + Meta's
        // response). Fire-and-forget — never blocks the response or the user.
        .then((result) =>
          logFbConversion({
            session_id: session_id || null,
            event: fbEventName,
            event_id: fb_event_id,
            pixel_id: fbPixelUsed,
            fbclid: fbclid || null,
            fbc: fbc || null,
            fbp: fbp || null,
            value: numFbValue,
            currency: fb_currency || null,
            content_id: fb_content_id || null,
            client_ip: ip || null,
            user_agent: userAgent || null,
            country: country || null,
            device_type: deviceType || null,
            page_url: page_url || null,
            source_url: source_url || null,
            referrer: referrer || null,
            prelend_slug: prelend_slug || null,
            ui_locale: ui_locale || locale || null,
            platform: platform || null,
            utm_source: utm_source || null,
            utm_medium: utm_medium || null,
            utm_campaign: utm_campaign || null,
            utm_campaign_name: utm_campaign_name || null,
            utm_content: utm_content || null,
            status: result.status || (result.ok ? 'ok' : 'failed'),
            response_code: result.code != null ? Number(result.code) : null,
            response_message:
              result.message || result.error || (result.skipped ? `skipped:${result.skipped}` : null),
            test_event_code: FB_TEST_EVENT_CODE || null,
            request_body: result.requestBody || null,
            sent_at: new Date().toISOString(),
          })
        )
        .catch((err) => console.error('❌ Meta send/log chain error:', err?.message || err));
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('❌ Click tracking error:', err);
    res.status(200).json({ ok: true }); // Always return 200 to not break UX
  }
});

// ─── Comment moderation via OpenAI ─────────────────────────────────────────
/**
 * Sends the comment text to GPT-4o-mini for moderation.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
async function moderateComment(text) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a comment moderation assistant. '
              + 'Analyze the user comment for profanity, hate speech, threats, spam, '
              + 'sexual content, or any other inappropriate material. '
              + 'Reply ONLY with valid JSON in this exact format: '
              + '{"allowed":true} if the comment is acceptable, '
              + 'or {"allowed":false,"reason":"short English reason"} if it is not. '
              + 'No extra text, no markdown.',
          },
          { role: 'user', content: text },
        ],
        max_tokens: 60,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      console.warn('⚠️ OpenAI moderation API error:', response.status);
      return { allowed: true }; // fail-open: don't block if OpenAI is down
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim() ?? '{"allowed":true}';
    const result = JSON.parse(raw);
    return result;
  } catch (err) {
    console.warn('⚠️ moderateComment error (fail-open):', err.message);
    return { allowed: true }; // fail-open
  }
}

// ─── Site → Strapi collection mapping ───────────────────────────────────────
// `site` identifier sent by the client  →  Strapi REST collection name
const SITE_TO_COLLECTION = {
  'nice-advice':   'posts',    // Post  (nice-advice.info)
  'hairstyles':    'post3s',   // Post3 (hairstylesforseniors.com)
  'cholesterin':   'post2s',   // Post2 (cholesterintipps.de)
};

// Fallback: detect collection from the request Origin header
function collectionFromOrigin(origin = '') {
  if (origin.includes('cholesterintipps.de'))       return 'post2s';
  if (origin.includes('hairstylesforseniors.com'))   return 'post3s';
  return 'posts'; // nice-advice.info is the default
}

/**
 * POST /comment
 * Body: { postId: string, username: string, text: string, site?: string }
 *   postId   – documentId of the post in Strapi
 *   username – commenter display name
 *   text     – comment body
 *   site     – optional explicit identifier: 'nice-advice' | 'hairstyles' | 'cholesterin'
 *              Falls back to Origin header detection if omitted.
 */
server.post('/comment', async (req, res) => {
  try {
    const { postId, username, text, site } = req.body;

    if (!postId || !username || !text) {
      return res.status(400).json({ error: 'postId, username and text are required' });
    }

    if (username.trim().length < 1 || username.trim().length > 100) {
      return res.status(400).json({ error: 'username must be between 1 and 100 characters' });
    }

    if (text.trim().length < 1 || text.trim().length > 2000) {
      return res.status(400).json({ error: 'text must be between 1 and 2000 characters' });
    }

    // Resolve which Strapi collection to use
    const origin = req.get('origin') || '';
    const collection = (site && SITE_TO_COLLECTION[site])
      ? SITE_TO_COLLECTION[site]
      : collectionFromOrigin(origin);

    console.log(`💬 New comment for ${collection} postId=${postId} site=${site || origin}`);

    // 0. Moderate the comment with ChatGPT before saving
    const moderation = await moderateComment(text.trim());
    if (!moderation.allowed) {
      console.log(`🚫 Comment rejected by moderation. Reason: ${moderation.reason}`);
      return res.status(422).json({
        error: `Your comment was not allowed: ${moderation.reason || 'it contains inappropriate content'}.`,
      });
    }

    // 1. Fetch the current post to get its existing comments
    const getRes = await fetch(
      `${STRAPI_API_URL}/api/${collection}/${postId}?populate=comments`,
      {
        headers: { Authorization: STRAPI_TOKEN },
      }
    );

    if (getRes.status === 404) {
      return res.status(404).json({ error: 'Post not found' });
    }
    if (!getRes.ok) {
      const errText = await getRes.text();
      throw new Error(`Strapi GET error ${getRes.status}: ${errText}`);
    }

    const postData = await getRes.json();
    const existingComments = postData?.data?.comments ?? [];

    // 2. Build the updated comments array (keep existing + append new one)
    const newComment = {
      username: username.trim(),
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };

    const updatedComments = [
      ...existingComments.map(c => ({
        username: c.username,
        text: c.text,
        ...(c.createdAt ? { createdAt: c.createdAt } : {}),
      })),
      newComment,
    ];

    // 3. PUT the updated comments back to Strapi
    const putRes = await fetch(
      `${STRAPI_API_URL}/api/${collection}/${postId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: STRAPI_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: { comments: updatedComments } }),
      }
    );

    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(`Strapi PUT error ${putRes.status}: ${errText}`);
    }

    const updatedPost = await putRes.json();

    // Return only the saved comment so the client can append it immediately
    res.status(201).json({
      success: true,
      comment: newComment,
      totalComments: updatedPost?.data?.comments?.length ?? updatedComments.length,
    });
  } catch (err) {
    console.error('❌ /comment error:', err);
    res.status(500).json({ error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});
