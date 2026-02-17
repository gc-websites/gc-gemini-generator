import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from "crypto";
import cron from 'node-cron';
import { generateAndPost, postUserEmail } from './functions.js';
import { generateImg, generateProduct, generateRefLink, getTag, getTags, leadPushStrapi, postToStrapi, resetOldTags, updateTagFbclid, updateTagStatus } from './functionsForProducts.js';
import { generateAndPostCholesterin } from './functionsCholesterin.js';
import { generateAndPostHairStyles } from './functionsHairStyles.js';
import { tagCreator } from './tagCreator.js';
import { createTelegramBot } from "./tgBot.js";
import requestIp from 'request-ip';
import { ParseAmazonOrders } from './playwright/getEarningsData.js';
import { applyCommissionsToPurchases, attachOrdersToLeads, createPurchasesToStrapi, filterNewPurchases, getAmznComissionsFromStrapi, getLeadsFromStrapi, getPurchasesFromStrapiLast24h, getUnusedPurchasesFromStrapi, postPurchasesToStrapi, sendPurchasesToFacebookAndMarkUsed, sendLeadToFacebook } from './functionsForTracking.js';
import { generateCommonTitle, generateProductsArray, postMultiproductToStrapi } from './functionsForMultiproducts.js';
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

const corsOptions = {
  origin: [
    'https://nice-advice.info',
    'https://www.nice-advice.info',
    'http://localhost:5173',
    'https://cholesterintipps.de',
    'https://dev.nice-advice.info',
    'https://www.dev.nice-advice.info',
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

server.post('/generate-post', async (req, res) => {
  generateAndPost();
});

server.post('/generate-product', async (req, res) => {
  const { query, link, country } = req.body;
  //const tag = await getTags(country);
  //console.log('Tag created');
  //const refLink = await generateRefLink(link, tag.name);
  // console.log('RefLink Created');
  const product = {
    title: '',
    descriptionfield1: '',
    descriptionfield2: '',
    descriptionfield3: '',
    descriptionfield4: '',
    image: '',
    link: link,
    country: country
  }
  const result = await generateProduct(query);
  console.log('BodyProductGenerated');
  product.title = result.title;
  product.descriptionfield1 = result.descriptionfield1;
  product.descriptionfield2 = result.descriptionfield2;
  product.descriptionfield3 = result.descriptionfield3;
  product.descriptionfield4 = result.descriptionfield4;
  const imgId = await generateImg(query);
  product.image = imgId;
  const postId = await postToStrapi(product);
  console.log('PostedToStrapi');
  // await updateTagStatus(tag, country);
  // console.log('Tag status updated');
  // const createTagRes = await tagCreator(country);
  // console.log('New tag created');
  if (postId) {
    res.json({ id: postId });
  }
  else {
    res.json({ error: 'ERROR' });
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

    if (!strapiRes.ok) {
      throw new Error(`Strapi error: ${strapiRes.statusText}`);
    }

    const product = await strapiRes.json();
    res.json(product);
  } catch (err) {
    console.error("❌ Error fetching product:", err);
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

    if (!strapiRes.ok) {
      throw new Error(`Strapi error: ${strapiRes.statusText}`);
    }

    const multiproduct = await strapiRes.json();
    res.json(multiproduct);

  } catch (err) {
    console.error('❌ Error fetching multiproduct:', err);
    res.status(500).json({ error: err.message });
  }
});


server.post('/get-product/ads/:id', async (req, res) => {
  const { id } = req.params;
  const { fbclid } = req.body;
  const lead = await createLead(fbclid, id);
  const result = await strapiLeadPost(lead);
  if (result) {
    res.json({ data: lead.clickId });
  }
  else {
    console.log('error')
  }
})

server.post('/fbclid', async (req, res) => {
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
})

server.post('/get-trackingId', async (req, res) => {
  const { country } = req.body;
  const tagFromStrapi = await getTag(country);
  res.json(tagFromStrapi);
})

server.post('/lead', async (req, res) => {
  const { productId, fbp, fbc, trackingId, trackingDocId, country } = req.body;
  const ip = requestIp.getClientIp(req);
  const userAgent = req.get('user-agent')
  const lead = {
    productId: null,
    clickDate: new Date().toISOString(),
    client_ip_address: ip,
    client_user_agent: userAgent,
    fbp: null,
    fbc: null,
    trackingId: null,
    event_name: 'Lead',
    event_time: `${Math.floor(Date.now() / 1000)}`,
    event_id: crypto.randomUUID(),
    event_source_url: 'https://nice-advice.info',
    action_source: 'website'
  };
  lead.productId = productId;
  lead.fbp = fbp;
  lead.fbc = fbc;
  lead.client_ip_address = ip;
  lead.client_user_agent = userAgent;
  lead.trackingId = trackingId;
  const strapiRes = await leadPushStrapi(lead);
  const isUpdated = await updateTagStatus(trackingDocId, country);

  // ✅ Отправляем Lead в Facebook CAPI не дожидаясь (или дожидаясь, по желанию)
  sendLeadToFacebook(lead).catch(err => console.error("FB Lead Error:", err));

  res.json(isUpdated);
})


cron.schedule('0 * * * *', async () => {
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
        body: JSON.stringify({ hours: 48 }),
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
});

cron.schedule("0 * * * *", async () => {
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
  const sendedToFbGroups = await sendPurchasesToFacebookAndMarkUsed(unusedPurchases);

  for (const group of sendedToFbGroups) {
    const { trackingId, items, totalValue } = group;

    const message = items
      .map(p => `
• ID: ${p.id}
  ASIN: ${p.asin}
  Tracking: ${p.trackingId}
  Price: ${p.price}$
  Commission: ${p.commission}%
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






server.get('/test', async (req, res) => {

  try {
    for (let i = 0; i < 100; i++) {
      await tagCreator("USA");
    }

    res.send({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false, error: error.message });
  }

})

server.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});
