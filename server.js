import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {generateGlobalObj, generateImages, prepForPush, strapiPost} from './functions.js';
import { generateImg, generateProduct, postToStrapi } from './functionsForProducts.js';

const server = express();
const PORT = process.env.PORT || 4000;
dotenv.config();

const STRAPI_API_URL = process.env.STRAPI_API_URL;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const corsOptions = {
	origin: [
		'https://nice-advice.info',
		'https://www.nice-advice.info',
    'http://localhost:5173'
	],
	credentials: true,
	methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}

server.use(express.json());
server.use(cors(corsOptions));

server.post('/generate-post', async (req, res) => {
  const {query} = req.body;
  try{
    const result = await generateGlobalObj(query);
    const imageids = await generateImages(result);
    const resultToStrapiPost = await prepForPush(result, imageids);
    const isPostedToStrapi = await strapiPost(resultToStrapiPost);
    res.json(isPostedToStrapi);
  } catch(error){
    res.status(500).json({ error: 'Ошибка на сервере по созданию главного обьекта' });
  }
});

server.post('/generate-posts', async (req, res) => {
  const {topics} = req.body;
  const results = [];
  for(const query of topics){
    try{
      console.log(`⚡ Начинаю обработку темы: "${query}"`);
      const result = await generateGlobalObj(query);
      const imageids = await generateImages(result);
      const resultToStrapiPost = await prepForPush(result, imageids);
      const isPostedToStrapi = await strapiPost(resultToStrapiPost);
      results.push({ query, status: 'ok', result: isPostedToStrapi });
    }catch(error){
      console.error(`❌ Ошибка при обработке "${query}"`, error);
      results.push({ query, status: 'error', error: error.message });
    }
  }
  res.json(results);
});

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


server.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});

