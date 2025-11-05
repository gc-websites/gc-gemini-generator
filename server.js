import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from "crypto";
import cron from 'node-cron';
import {generateAndPost} from './functions.js';
import { generateImg, generateProduct, postToStrapi } from './functionsForProducts.js';
import { createLead, readCSV, strapiLeadPost } from './pixel.js';
import { generateAndPostCholesterin} from './functionsCholesterin.js';
import { generateAndPostHairStyles } from './functionsHairStyles.js';

const server = express();
const PORT = process.env.PORT || 4000;
dotenv.config();

const STRAPI_API_URL = process.env.STRAPI_API_URL;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PIXEL_ID = process.env.PIXEL_ID;
const PIXEL_TOKEN = process.env.PIXEL_TOKEN ;

const corsOptions = {
	origin: [
		'https://nice-advice.info',
		'https://www.nice-advice.info',
    'http://localhost:5173',
    'https://cholesterintipps.de'
	],
	credentials: true,
	methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}

server.use(express.json());
server.use(cors());


let isRunning = false;
cron.schedule('0 8,20 * * *', async () => {
  if (isRunning) {
    console.log('generateAndPost already running — skipping this run.');
    return;
  }
  isRunning = true;
  try {
    console.log('Scheduled job start:', new Date().toISOString());
    await generateAndPost();
    await generateAndPostCholesterin();
    await generateAndPostHairStyles();
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

// server.post('/generate-posts', async (req, res) => {
//   const {topics} = req.body;
//   const results = [];
//   for(const query of topics){
//     try{
//       console.log(`⚡ Начинаю обработку темы: "${query}"`);
//       const result = await generateGlobalObj(query);
//       const imageids = await generateImages(result);
//       const resultToStrapiPost = await prepForPush(result, imageids);
//       const isPostedToStrapi = await strapiPost(resultToStrapiPost);
//       results.push({ query, status: 'ok', result: isPostedToStrapi });
//     }catch(error){
//       console.error(`❌ Ошибка при обработке "${query}"`, error);
//       results.push({ query, status: 'error', error: error.message });
//     }
//   }
//   res.json(results);
// });

server.post('/generate-product', async (req, res) => {
  const {query, link} = req.body;
  const product = {
    title: '',
    descriptionfield1: '',
    descriptionfield2: '',
    descriptionfield3: '',
    descriptionfield4: '',
    image: '',
    link: link
  }
  const result = await generateProduct(query);
  product.title = result.title;
  product.descriptionfield1 = result.descriptionfield1;
  product.descriptionfield2 = result.descriptionfield2;
  product.descriptionfield3 = result.descriptionfield3;
  product.descriptionfield4 = result.descriptionfield4;
  const imgId = await generateImg(query);
  product.image = imgId;
  const postId = await postToStrapi(product);
  res.json({id: postId});
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

server.get('/test', async (req, res) => {
   const result = await generateAndPostHairStyles();
   res.status(200).send(result);
})


server.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});
