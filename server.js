import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {generateGlobalObj, generateImages, prepForPush, strapiPost} from './functions.js';

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


server.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});

