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

const categories = ['Lifestyle and Wellness', 'Your Health', 'Family', 'Diseases and Conditions'];

const generateQuery = async () => {
  try{
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    const prompt = `Come up with an interesting topic for a post in the category ${randomCategory}. In the response, I want a simple subject line consisting of a few words. There's no need to explain anything or write anything before or after the subject line. So, the response should just be the subject line, one line.`;
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const cleanRes = result.response.text().trim();
    if(randomCategory === 'Lifestyle and Wellness'){
      return {query: cleanRes, categoryId: 18}
    }else if(randomCategory === 'Your Health'){
      return {query: cleanRes, categoryId: 20}
    }else if(randomCategory === 'Family'){
      return {query: cleanRes, categoryId: 22}
    }else{
      return {query: cleanRes, categoryId: 3}
    }
  }
  catch (error) {
    console.error(error);
    return {error: 'Ошибка при генерации Темы'};
  }
}

const generateGlobalObj = async (query) => {
  try {
    const prompt = `You are a CMS content generator. Return ONLY a valid raw JSON object — no markdown, no explanations, no backticks, no comments. Your output MUST start and end with { and }. Create an article in JSON format based on the topic: "${query}". The article must include exactly 2 paragraphs in the "paragraphs" array. JSON must always have property 'paragraphs' which is an array of EXACTLY 2 objects, no more, no less. Never reply with fewer or more than 2 items in the paragraphs array. The article should match this structure:
              {
                "title": "SEO-optimized, human-readable title (55–65 characters, includes main keyword)",
                "description": ["Full intro (min 700 characters). Begin with a 150–160 character SEO meta description, then an engaging intro mentioning ${{query}} and 1–2 LSI terms."],
                "isPopular": false,
                "paragraphs": [
                  {
                    "subtitle": "Informative subheading #1 (with keyword variation)",
                    "description": ["Comprehensive section (min 700 characters) exploring one core aspect of the topic. Integrate 2–3 LSI terms and implicitly answer one People Also Ask question. Provide examples, steps, or data."],
                    "ads": [
                      { "title": "Helpful Tool or Product", "url": "https://..." },
                      { "title": "Trusted Resource", "url": "https://..." }
                    ],
                    "image_prompt": "Describe a realistic, contextually relevant image for this section (avoid text or logos)"
                  }
                ],
                "ads": [
                  { "title": "...", "url": "https://..." },
                  { "title": "...", "url": "https://..." },
                  { "title": "...", "url": "https://..." }
                ],
                "image_prompt": "Describe a realistic, contextually relevant image for this section (avoid text or logos)",
                "firstAdBanner": { "url": "https://...", "image_prompt": "Describe a realistic, contextually relevant image for this section (avoid text or logos)" },
                "secondAdBanner": { "url": "https://...", "image_prompt": "Describe a realistic, contextually relevant image for this section (avoid text or logos)" }
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

const prepForPush = async (obj, ids, categoryId) => {
  const editedObj = JSON.parse(
  JSON.stringify(obj, (key, value) => (key === "image_prompt" ? undefined : value)));
  
  editedObj.author = 1;
  editedObj.category = categoryId;

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

const generateAndPost = async () => {
  try {
    const { query, categoryId } = await generateQuery();
    const result = await generateGlobalObj(query);
    const imageids = await generateImages(result);
    const resultToStrapiPost = await prepForPush(result, imageids, categoryId);
    const isPostedToStrapi = await strapiPost(resultToStrapiPost);
    console.log('generateAndPost finished:', isPostedToStrapi);
    return isPostedToStrapi;
  } catch (error) {
    console.error('Ошибка в generateAndPost:', error);
    throw error;
  }
}

export {generateGlobalObj, generateImages, generateQuery, prepForPush, strapiPost, generateAndPost};