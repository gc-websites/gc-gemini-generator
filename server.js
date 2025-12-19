import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from "crypto";
import cron from 'node-cron';
import {generateAndPost, postUserEmail} from './functions.js';
import { generateImg, generateProduct, generateRefLink, getTag, getTags, postToStrapi, updateTagFbclid, updateTagStatus } from './functionsForProducts.js';
import { generateAndPostCholesterin} from './functionsCholesterin.js';
import { generateAndPostHairStyles } from './functionsHairStyles.js';
import { tagCreator } from './tagCreator.js';
import { createTelegramBot } from "./tgBot.js";
import requestIp from 'request-ip';

const server = express();
const PORT = process.env.PORT || 4000;
dotenv.config();

const STRAPI_API_URL = process.env.STRAPI_API_URL;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TG_TOKEN = process.env.TG_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const PIXEL_ID = process.env.PIXEL_ID;
const PIXEL_TOKEN = process.env.PIXEL_TOKEN ;

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
  const {query, link, country} = req.body;
  const tag = await getTags(country);
  console.log('Tag created');
  const refLink = await generateRefLink(link, tag.name);
  console.log('RefLink Created');
  const product = {
    title: '',
    descriptionfield1: '',
    descriptionfield2: '',
    descriptionfield3: '',
    descriptionfield4: '',
    image: '',
    link: refLink,
    tag: tag.name
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
  await updateTagStatus(tag, country);
  console.log('Tag status updated');
  const createTagRes = await tagCreator(country);
  console.log('New tag created');
  if(createTagRes){
    res.json({id: postId});
  }
  else{
    res.json({error: 'ERROR'});
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

server.post('/get-product/ads/:id', async (req, res) => {
  const {id} = req.params;
  const {fbclid} = req.body;
   const lead = await createLead(fbclid, id);
   const result = await strapiLeadPost(lead);
   if(result){
    res.json({data: lead.clickId});
   }
   else{
    console.log('error')
   }
})

server.post('/fbclid', async (req, res) => {
  const {fbclid, productId, tag} = req.body;
  const tagFromStrapi = await getTag(tag);
  const tagId = tagFromStrapi.documentId
  if(tagFromStrapi.fbclid){
    res.status(200).send(true);
  }
  else{
    const result = await updateTagFbclid(fbclid, productId, tag, tagId);
    res.json(result);
  }
})

server.get('/test', async (req, res) => {
  const ip = requestIp.getClientIp(req);
  const userAgent = req.get('user-agent')
  res.json({ip: ip, userAgent: userAgent});
})

server.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});
