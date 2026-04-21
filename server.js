import express from 'express';
import { Mutex } from 'async-mutex';

import cors from 'cors';
import dotenv from 'dotenv';
import crypto from "crypto";
import cron from 'node-cron';
import { generateAndPost, postUserEmail } from './functions.js';
import { generateImg, generateProduct, generateRefLink, getTag, getTags, leadPushStrapi, postToStrapi, resetOldTags, updateTagFbclid, updateTagStatus, claimTag } from './functionsForProducts.js';

import { generateAndPostCholesterin } from './functionsCholesterin.js';
import { generateAndPostHairStyles } from './functionsHairStyles.js';
import { tagCreator } from './tagCreator.js';
import { createTelegramBot } from "./tgBot.js";
import requestIp from 'request-ip';
import { LRUCache } from 'lru-cache'; // <-- Added LRUCache import
import { ParseAmazonOrders } from './playwright/getEarningsData.js';
import { applyCommissionsToPurchases, attachOrdersToLeads, createPurchasesToStrapi, filterNewPurchases, getAmznComissionsFromStrapi, getLeadsFromStrapi, getPurchasesFromStrapiLast24h, getUnusedPurchasesFromStrapi, postPurchasesToStrapi, sendPurchasesToFacebookAndMarkUsed, sendLeadToFacebook } from './functionsForTracking.js';
import { generateCommonTitle, generateProductsArray, postMultiproductToStrapi } from './functionsForMultiproducts.js';
import { checkSitesAvailability } from './siteChecker.js';
import { runAmazonCCApproval } from './functionsForAmazonCC.js';
const server = express();
const PORT = process.env.PORT || 4000;
dotenv.config();

const STRAPI_API_URL = process.env.STRAPI_API_URL;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TG_TOKEN = process.env.TG_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const TG_BOT_ORDERS_ID = process.env.TG_BOT_ORDERS_ID;
const PIXEL_ID = process.env.PIXEL_ID;
const PIXEL_TOKEN = process.env.PIXEL_TOKEN;

const tagMutex = new Mutex();

// LRUCache automatically deletes items older than `ttl` (Time To Live), 
// so we don't need manual setTimeouts that cause memory leaks.
// It also caps the max number of items to prevent out-of-memory errors.
const recentLeads = new LRUCache({
  max: 10000,          // Maximum 10,000 items in cache
  ttl: 1000 * 60 * 60, // Items live for 1 hour (3600000 ms)
});

const corsOptions = {
  origin: [
    'https://nice-advice.info',
    'https://www.nice-advice.info',
    'http://localhost:5173',
    'https://cholesterintipps.de',
    'https://www.cholesterintipps.de',
    'https://dev.nice-advice.info',
    'https://www.dev.nice-advice.info',
    'https://hairstylesforseniors.com',
    'https://www.hairstylesforseniors.com',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}

server.use(express.json());
server.use(cors(corsOptions));
server.set('trust proxy', true);

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

/* server.post('/fbclid', async (req, res) => {
  const { fbclid, productId, tag } = req.body;
  const tagFromStrapi = await getTag(tag);
  const tagId = tagFromStrapi.documentId
  if (tagFromStrapi.fbclid) {
    res.status(200).send(true);
  }
  else {
    const result = await updateTagFbclid(fbclid, productId, tag, tagId);
    res.json(result);
  }
}) */

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

/* server.post('/get-trackingId', async (req, res) => {
  const { country } = req.body;
  const tagFromStrapi = await getTag(country);
  res.json(tagFromStrapi);
}) */

/* server.post("/lead", async (req, res) => {
  try {
    const {
      fbp,
      fbc,
      productId,
      clickDate,
      tz,
      ip_address,
      user_agent,
      trackingId,
      trackingDocId,
      country,
      external_id,
      gclid,
      wbraid,
      gbraid,
      campaign_id,
      event_source_url
    } = req.body;
    const ip = requestIp.getClientIp(req);
    const userAgent = req.get('user-agent');

    // Используем Mutex для атомарного присвоения тега
    const release = await tagMutex.acquire();
    try {
      // Дедупликация: проверяем по fbp, fbc и ip отдельно
      const now = Date.now();
      const cacheKeyIp = `ip_${ip}_${productId}`;
      const cacheKeyFbp = fbp ? `fbp_${fbp}_${productId}` : null;
      const cacheKeyFbc = fbc ? `fbc_${fbc}_${productId}` : null;

      const cachedIp = recentLeads.get(cacheKeyIp);
      const cachedFbp = cacheKeyFbp ? recentLeads.get(cacheKeyFbp) : null;
      const cachedFbc = cacheKeyFbc ? recentLeads.get(cacheKeyFbc) : null;

      const cached = cachedIp || cachedFbp || cachedFbc;

      if (cached) {
        console.log(`♻️ Duplicate lead intercepted for IP: ${ip}, fbp: ${fbp || 'none'}`);
        return res.json({
          success: true,
          trackingId: cached.trackingId,
          trackingDocId: cached.trackingDocId,
          cached: true
        });
      }

      // Проверяем и бронируем тег (если старый занят - берем новый)
      const claimedTag = await claimTag(trackingDocId, country);

      if (!claimedTag) {
        console.warn("⚠️ No available tags found!");
        return res.status(503).json({ error: "No available tags" });
      }

      let clean_event_source_url = event_source_url || `https://nice-advice.info/product/${productId}`;
      try {
        const parsedUrl = new URL(clean_event_source_url);
        const campId = parsedUrl.searchParams.get('campaign_id') || campaign_id;
        parsedUrl.search = ''; // Remove all query parameters
        if (campId) {
          parsedUrl.searchParams.set('campaign_id', campId);
        }
        clean_event_source_url = parsedUrl.toString();
      } catch (e) {
        // fallback
      }

      const strapiPayload = {
        clickDate: clickDate || new Date().toISOString(),
        client_ip_address: ip,
        fbp: fbp || "",
        fbc: fbc || "",
        productId: productId || "",
        trackingId: trackingId || "",
        client_user_agent: userAgent || "",
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000).toString(),
        event_id: crypto.randomUUID(),
        event_source_url: clean_event_source_url,
        action_source: "website",
        isUsed: false,
        external_id: external_id || null,
        gclid: gclid || null,
        wbraid: wbraid || null,
        gbraid: gbraid || null,
        campaign_id: campaign_id || null
      };

      // Сохраняем лид и отправляем в FB в фоне (без await), чтобы не задерживать юзера
      leadPushStrapi(strapiPayload).catch(err => console.error("❌ Lead saving error:", err));
      sendLeadToFacebook(strapiPayload).catch(err => console.error("FB Lead Error:", err));

      // Обновляем кеш дедупликации (ttl уже обрабатывается LRUCache автоматически)
      const cacheData = {
        trackingId: claimedTag.name,
        trackingDocId: claimedTag.documentId
      };
      recentLeads.set(cacheKeyIp, cacheData);
      if (cacheKeyFbp) recentLeads.set(cacheKeyFbp, cacheData);
      if (cacheKeyFbc) recentLeads.set(cacheKeyFbc, cacheData);

      // Возвращаем финальный тег фронтенду НЕМЕДЛЕННО
      res.json({
        success: true,
        trackingId: claimedTag.name,
        trackingDocId: claimedTag.documentId
      });

    } catch (err) {
      console.error("❌ Lead processing error:", err);
      res.status(500).json({ error: err.message });
    } finally {
      release();
    }
  } catch (err) {
    console.error("❌ Outer Lead processing error:", err);
    res.status(500).json({ error: err.message });
  }
}); */


/* cron.schedule('0 * * * *', async () => {
  try {
    console.log('[CRON][TAGS] start resetOldUsedTags');

    const res = await fetch(
      `${STRAPI_API_URL}/api/tagus/reset-old-used`,
      {
        method: 'POST',
        headers: {
          Authorization: STRAPI_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ hours: 26 }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Strapi error ${res.status}: ${text}`);
    }

    const data = await res.json();
    console.log(
      '[CRON][TAGS] done, threshold:',
      data.thresholdDate
    );
  } catch (err) {
    console.error('[CRON][TAGS] error:', err.message);
  }
}); */

/* async function processAmazonOrders() {
  console.log("🔄 Starting Amazon Orders Processing...");
  try {
    const ordersFromAmazon = await ParseAmazonOrders();
    const leadsFromStrapi = await getLeadsFromStrapi();
    const matchedLeads = await attachOrdersToLeads(ordersFromAmazon, leadsFromStrapi);
    const createdPurchasesForStrapi = await createPurchasesToStrapi(matchedLeads);
    const comissions = await getAmznComissionsFromStrapi();
    const purchasesToStrapi = await applyCommissionsToPurchases(createdPurchasesForStrapi, comissions);
    const purchasesLast24h = await getPurchasesFromStrapiLast24h();
    const newPurchases = await filterNewPurchases(purchasesToStrapi, purchasesLast24h);

    if (newPurchases.length > 0) {
      await postPurchasesToStrapi(newPurchases);
    }

    const unusedPurchases = await getUnusedPurchasesFromStrapi();
    const approvedPurchases = await runAmazonCCApproval(unusedPurchases);
    const sendedToFbGroups = await sendPurchasesToFacebookAndMarkUsed(approvedPurchases);

    for (const group of sendedToFbGroups) {
      const { trackingId, items, totalValue } = group;

      const message = items
        .map(p => `
  • ID: ${p.id}
    ASIN: ${p.asin}
    Tracking: ${p.trackingId}
    Price: ${p.price}$
    Commission: ${p.ccRate ? p.commission + '% + ' + p.ccRate : p.commission}%
    Ordered Count: ${p.orderedCount}
    Category: ${p.category}
    Value: ${p.value}$
    Title: ${p.title}
  `.trim())
        .join("\n\n");

      await bot.sendMessage(
        TG_BOT_ORDERS_ID,
        `⭐️⭐️⭐️ NEW ORDERS ⭐️⭐️⭐️

  New orders sent to Facebook (Group: ${trackingId})
  💰 Total Group Value: ${totalValue}$

  ${message}
  `
      );
    }
    console.log("✅ Finished Amazon Orders Processing.");
  } catch (err) {
    console.error("❌ Error in processAmazonOrders:", err);
  }
}

cron.schedule("0 * * * *", processAmazonOrders); */





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






/* server.get('/test', async (req, res) => {

  try {
    for (let i = 0; i < 100; i++) {
      await tagCreator("USA");
    }

    res.send({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false, error: error.message });
  }

}) */

/* server.get('/test-amazon-flow', async (req, res) => {
  console.log("🔄 Starting test run for Amazon CC flow (skipping new order extraction)...");
  try {
    const unusedPurchases = await getUnusedPurchasesFromStrapi();
    const approvedPurchases = await runAmazonCCApproval(unusedPurchases);
    const sendedToFbGroups = await sendPurchasesToFacebookAndMarkUsed(approvedPurchases);

    for (const group of sendedToFbGroups) {
      const { trackingId, items, totalValue } = group;

      const message = items
        .map(p => `
  • ID: ${p.id}
    ASIN: ${p.asin}
    Tracking: ${p.trackingId}
    Price: ${p.price}$
    Commission: ${p.ccRate ? p.commission + '% + ' + p.ccRate : p.commission}%
    Ordered Count: ${p.orderedCount}
    Category: ${p.category}
    Value: ${p.value}$
    Title: ${p.title}
  `.trim())
        .join("\n\n");

      await bot.sendMessage(
        TG_BOT_ORDERS_ID,
        `⭐️⭐️⭐️ TEST: NEW ORDERS ⭐️⭐️⭐️

  New orders sent to Facebook (Group: ${trackingId})
  💰 Total Group Value: ${totalValue}$

  ${message}
  `
      );
    }
    console.log("✅ Finished test run.");
    res.json({ success: true, sendedToFbGroups });
  } catch (err) {
    console.error("❌ Error in test run:", err);
    res.status(500).json({ error: err.message });
  }
}); */

// ─── Click Tracking for Prelend Analytics ───
function getDeviceType(ua) {
  if (!ua) return 'unknown';
  ua = ua.toLowerCase();
  if (/tablet|ipad|playbook|silk/.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry/.test(ua)) return 'mobile';
  return 'desktop';
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
      utm_term,
      utm_content,
      screen_width,
      screen_height,
      clicked_at,
      gclid,
      fbclid,
      fb_pixel,
      fb_event,
      fb_pixel_mode,
      fb_fire_type,
    } = req.body;

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
        utm_term: utm_term || null,
        utm_content: utm_content || null,
        client_ip: ip || null,
        user_agent: userAgent || null,
        country: country || null,
        device_type: deviceType,
        screen_width: screen_width || null,
        screen_height: screen_height || null,
        clicked_at: clicked_at || new Date().toISOString(),
        gclid: gclid || null,
        fbclid: fbclid || null,
        fb_pixel: fb_pixel || null,
        fb_event: fb_event || null,
        fb_pixel_mode: fb_pixel_mode || null,
        fb_fire_type: fb_fire_type || null,
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
    }).catch(err => console.error('❌ Click tracking Strapi error:', err.message));

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('❌ Click tracking error:', err);
    res.status(200).json({ ok: true }); // Always return 200 to not break UX
  }
});

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
    };

    const updatedComments = [
      ...existingComments.map(c => ({ username: c.username, text: c.text })),
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
