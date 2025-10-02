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

const generateGlobalObj = async (query) => {
  try {
    const prompt = `You are a CMS content generator. Return ONLY a valid raw JSON object — no markdown, no explanations, no backticks, no comments. Your output MUST start and end with { and }. Create an article in JSON format based on the topic: "${query}". The article must include exactly 2 paragraphs in the "paragraphs" array. JSON must always have property 'paragraphs' which is an array of EXACTLY 2 objects, no more, no less. Never reply with fewer or more than 2 items in the paragraphs array. The article should match this structure:
              {
                "title": "...",
                "description": ["... (min 700 characters)"],
                "isPopular": false,
                "paragraphs": [
                  {
                    "subtitle": "...",
                    "description": ["... (min 700 characters)"],
                    "ads": [
                      { "title": "...", "url": "https://..." },
                      { "title": "...", "url": "https://..." }
                    ],
                    "image_prompt": "prompt for image generation"
                  }
                ],
                "ads": [
                  { "title": "...", "url": "https://..." },
                  { "title": "...", "url": "https://..." },
                  { "title": "...", "url": "https://..." }
                ],
                "image_prompt": "main image prompt",
                "firstAdBanner": { "url": "https://...", "image_prompt": "..." },
                "secondAdBanner": { "url": "https://...", "image_prompt": "..." }
              }`
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const jsonResult = JSON.parse(result.response.text())
    return jsonResult;
  } catch (error) {
    console.error(error);
    return {error: 'Ошибка при генерации Главного Обьекта'};
  }
}

const generateImages = async (obj) => {
  const img1 = obj.paragraphs[0].image_prompt;
  const img2 = obj.paragraphs[1].image_prompt;
  const img3 = obj.image_prompt;
  const img4 = obj.firstAdBanner.image_prompt;
  const img5 = obj.secondAdBanner.image_prompt;
  const prompts = [img1, img2, img3, img4, img5];
  const ids = [];
  
  for (let i = 0; i < prompts.length; i++) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image-preview",
    contents: prompts[i],
    generationConfig: { candidateCount: 1 },
  });

  const part = response.candidates[0].content.parts.find((p) => p.inlineData);
  if (!part) continue;

  const buffer = Buffer.from(part.inlineData.data, "base64");

  const formData = new FormData();
  formData.append("files", buffer, {
    filename: `gemini-image-${i + 1}.png`,
    contentType: "image/png",
  });

  const uploadRes = await fetch(`${STRAPI_API_URL}/api/upload`, {
    method: "POST",
    headers: {
      Authorization: STRAPI_TOKEN,
    },
    body: formData,
  });

  const result = await uploadRes.json();
  if (Array.isArray(result) && result[0]?.id) {
      ids.push(result[0].id);
      console.log(`✅ Uploaded image ${i + 1} to Strapi: id=${result[0].id}`);
    } else {
      console.warn(`⚠️ No id found for image ${i + 1}`, result);
    }
}
return ids;
}

const prepForPush = async (obj, ids) => {
  const editedObj = JSON.parse(
  JSON.stringify(obj, (key, value) => (key === "image_prompt" ? undefined : value)));
  
  editedObj.author = 1;
  editedObj.category = 22;

  editedObj.image = ids[0];
  editedObj.firstAdBanner.image = ids[1];
  editedObj.secondAdBanner.image = ids[2];
  editedObj.paragraphs[0].image = ids[3];
  editedObj.paragraphs[1].image = ids[4];
  
  // верхний уровень description
  if (Array.isArray(editedObj.description)) {
    editedObj.description = editedObj.description.map(text => ({
      type: "paragraph",
      children: [{ type: "text", text }]
    }));
  }

  // внутри paragraphs
  if (Array.isArray(editedObj.paragraphs)) {
    editedObj.paragraphs = editedObj.paragraphs.map(p => {
      if (Array.isArray(p.description)) {
        p.description = p.description.map(text => ({
          type: "paragraph",
          children: [{ type: "text", text }]
        }));
      }
      return p;
    });
  }
  return editedObj;
}

const strapiPost = async (obj) => {
  try {
      const strapiRes = await fetch(`${STRAPI_API_URL}/api/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: STRAPI_TOKEN,
        },
        body: JSON.stringify({ data: obj }),
      })
      if (!strapiRes.ok) {
        const err = await strapiRes.text()
        throw new Error(err)
      }
      return true;
    } catch (err) {
      console.error('❌ Create-post error:', err)
      return err.message;
    }
}

export {generateGlobalObj, generateImages, prepForPush, strapiPost};