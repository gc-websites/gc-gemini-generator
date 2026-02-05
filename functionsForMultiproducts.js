import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenAI } from "@google/genai";
import fetch from "node-fetch";
import FormData from "form-data";
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const STRAPI_API_URL = process.env.STRAPI_API_URL;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const ai = new GoogleGenAI(GEMINI_API_KEY);

/* ---------------------------------------
   HELPERS
--------------------------------------- */
const cleanText = (text) => {
  if (!text) return '';
  return text
    .replace(/\*\*/g, '')
    .replace(/Here are.*?:/gi, '')
    .split('\n')
    .filter(l => l.trim())
    .slice(0, 1)
    .join('')
    .trim();
};

/* ---------------------------------------
   COMMON TITLE
--------------------------------------- */
export const generateCommonTitle = async (queries) => {
  const prompt = `
Generate ONE short catchy deals headline.
Examples:
- Unbeatable Laptop Deals
- Best Amazon Tech Deals Today

Topics: ${queries.join(', ')}
Return ONLY the title.
`;

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const res = await model.generateContent(prompt);
  return cleanText(res.response.candidates[0].content.parts[0].text);
};

/* ---------------------------------------
   SINGLE PRODUCT CONTENT
--------------------------------------- */
const generateProductContent = async (query) => {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompts = [
    `Generate ONE short catchy product title with deals mention. Topic: ${query}`,
    `Create a very short description starting with emoji. Topic: ${query}`,
    `Create a very short savings description starting with emoji. Topic: ${query}`,
    `Create a very short lifestyle description starting with emoji. Topic: ${query}`,
    `Create a short CTA starting with emoji. Topic: ${query}`,
  ];

  const results = await Promise.all(
    prompts.map(p => model.generateContent(p))
  );

  return {
    title: cleanText(results[0].response.candidates[0].content.parts[0].text),
    descriptionfield1: cleanText(results[1].response.candidates[0].content.parts[0].text),
    descriptionfield2: cleanText(results[2].response.candidates[0].content.parts[0].text),
    descriptionfield3: cleanText(results[3].response.candidates[0].content.parts[0].text),
    descriptionfield4: cleanText(results[4].response.candidates[0].content.parts[0].text),
  };
};

/* ---------------------------------------
   IMAGE
--------------------------------------- */
const generateProductImage = async (query) => {
  const response = await ai.models.generateImages({
    model: "imagen-4.0-generate-001",
    prompt: `High quality product marketing image for ${query}`,
    config: {
      numberOfImages: 1,
      aspectRatio: "16:9",
      outputMimeType: "image/png",
    },
  });

  const imgBytes = response?.generatedImages?.[0]?.image?.imageBytes;
  if (!imgBytes) return null;

  const buffer = Buffer.from(imgBytes, "base64");
  const formData = new FormData();

  formData.append("files", buffer, {
    filename: "product.png",
    contentType: "image/png",
  });

  const upload = await fetch(`${STRAPI_API_URL}/api/upload`, {
    method: "POST",
    headers: { Authorization: STRAPI_TOKEN },
    body: formData,
  });

  const result = await upload.json();
  return result?.[0]?.id || null;
};

/* ---------------------------------------
   BUILD PRODUCTS ARRAY
--------------------------------------- */
export const generateProductsArray = async (productsInput) => {
  const products = [];

  for (const item of productsInput) {
    const content = await generateProductContent(item.query);
    const imageId = await generateProductImage(item.query);

    products.push({
      ...content,
      link: item.link,
      image: imageId,
    });
  }

  return products;
};

/* ---------------------------------------
   POST TO STRAPI
--------------------------------------- */
export const postMultiproductToStrapi = async ({ title, country, products }) => {
  const payload = {
    data: {
      title,
      country,
      product: products // ⬅️ ВАЖНО: API ID = product
    }
  };

  const res = await fetch(`${STRAPI_API_URL}/api/multiproducts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: STRAPI_TOKEN,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(text);

  const json = JSON.parse(text);
  return json?.data?.documentId || null;
};
