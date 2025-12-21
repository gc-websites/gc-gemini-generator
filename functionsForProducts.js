import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenAI } from "@google/genai";
import fetch from "node-fetch";
import FormData from "form-data";
import dotenv from 'dotenv';
import pkg from "paapi5-nodejs-sdk";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const STRAPI_API_URL = process.env.STRAPI_API_URL;
const accessKey = process.env.PAAPI_ACCESS_KEY;
const secretKey = process.env.PAAPI_SECRET_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const ai = new GoogleGenAI(GEMINI_API_KEY);
const { DefaultApi, GetItemsRequest, Configuration } = pkg;

const getTags = async (country) => {
  let strapiUrl;

  if (country === 'USA') {
    strapiUrl = `${STRAPI_API_URL}/api/taguses`;
  } else if (country === 'Canada') {
    strapiUrl = `${STRAPI_API_URL}/api/tagcas`;
  } else {
    throw new Error("Unsupported country");
  }

  try {
    const strapiRes = await fetch(strapiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: STRAPI_TOKEN,
      }
    });

    if (!strapiRes.ok) {
      console.error("❌ Strapi error:", strapiRes.status, strapiRes.statusText);
      return null;
    }

    const json = await strapiRes.json();
    const items = json?.data || [];

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const filtered = items.filter(item => {
      const createdAt = new Date(item.createdAt).getTime();
      const isOlderThan24h = (now - createdAt) >= dayMs;

      return item.isUsed === false && isOlderThan24h;
    });
    return filtered.length > 0 ? filtered[0] : null;

  } catch (err) {
    console.error('❌ getTags error:', err);
    return null;
  }
};

const generateRefLink = (link, partnerTag) => {
  const refLink = `${link}&tag=${partnerTag}-20`;
  return refLink;
}

const generateProduct = async (query) => {
  const titlePrompt = `Generate a short catchy headline with mention of deals. Ex - Unbeatable Deals on Women's Puffer Jackets! Title on the subject ${query}. I want a short answer with only 1 result.`;
  const descriptionfield1Prompt = `Create a very short description on the topic ${query}. Example 🧥 Stay Warm + Stylish: Puffer jackets with ultimate comfort. In your answer, don't write anything superfluous at the beginning or end, just answer my question.
    Do not put any * or similar symbols in your answer. Use emoji approximately as in the example, at least the line should start with an emoji.`;
  const descriptionfield2Prompt = `Create a very short description on the topic ${query}. Example 💰 Hot Deals: Save big — but only for a limited time! In your answer, don't write anything superfluous at the beginning or end, just answer my question.
    Do not put any * or similar symbols in your answer. Use emoji approximately as in the example, at least the line should start with an emoji.`;
  const descriptionfield3Prompt = `Create a very short description on the topic ${query}. Example 🌆 Versatile Wear: Perfect for chilly walks or city nights 🙂. In your answer, don't write anything superfluous at the beginning or end, just answer my question.
    Do not put any * or similar symbols in your answer. Use emoji approximately as in the example, at least the line should start with an emoji.`;
  const descriptionfield4Prompt = `Create a very short description on the topic ${query}. Example 👉 Grab your puffer jacket today — comfort, style & savings in one!; In your answer, don't write anything superfluous at the beginning or end, just answer my question.
    Do not put any * or similar symbols in your answer. Use emoji approximately as in the example, at least the line should start with an emoji.`;
  
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const title = await model.generateContent(titlePrompt);
  const descriptionfield1 = await model.generateContent(descriptionfield1Prompt);
  const descriptionfield2 = await model.generateContent(descriptionfield2Prompt);
  const descriptionfield3 = await model.generateContent(descriptionfield3Prompt);
  const descriptionfield4 = await model.generateContent(descriptionfield4Prompt);
  const cleanTitle = title.response.candidates[0].content.parts[0].text;
  const cleanDescriptionfield1 = descriptionfield1.response.candidates[0].content.parts[0].text;
  const cleanDescriptionfield2 = descriptionfield2.response.candidates[0].content.parts[0].text;
  const cleanDescriptionfield3 = descriptionfield3.response.candidates[0].content.parts[0].text;
  const cleanDescriptionfield4 = descriptionfield4.response.candidates[0].content.parts[0].text;

  return {title: cleanTitle,
          descriptionfield1: cleanDescriptionfield1,
          descriptionfield2: cleanDescriptionfield2,
          descriptionfield3: cleanDescriptionfield3,
          descriptionfield4: cleanDescriptionfield4,
        };
}

const generateImg = async (query) => {
  const prompt = `Design a bold, clickbait-style YouTube thumbnail (strictly 16:9 aspect ratio, 1920x1080px) with a high-contrast background image relevant to the topic. Place a large, eye-catching headline in the center using clear, easy-to-read fonts. Use strong, minimal wording (3–6 words max) for maximum impact. Add a bright red button-style CTA below the headline that reads: See the Amazon Deal or See the Amazon Sale. Position the Amazon logo at the top center of the image, unaltered. Ensure the overall look feels modern, sharp, and scroll-stopping, with clean composition and balanced spacing. Look & Feel Guidelines (reusable across niches): Background: Use split-screen, lifestyle, or product-focused images that show clear before/after or desirable outcomes. Typography: Bold, sans-serif fonts with strong contrast (white or bright tones against darker areas) Image on the subject ${query}.`;
  const response = await ai.models.generateImages({
    model: "imagen-4.0-generate-001",
    prompt: prompt,
    config: {
      numberOfImages: 1,
      aspectRatio: "16:9",
      outputMimeType: "image/png",
    },
  });

  const generated = response.generatedImages?.[0];
if (!generated) {
  console.warn("⚠️ No image object", response);
  return null;
}

const imgBytes = generated.image.imageBytes;
if (!imgBytes) {
  console.warn("⚠️ No imageBytes found in response", generated);
  return null;
}

const buffer = Buffer.from(imgBytes, "base64");


const formData = new FormData();
formData.append("files", buffer, {
  filename: "imagen-thumbnail.png",
  contentType: "image/png",
});

const uploadRes = await fetch(`${STRAPI_API_URL}/api/upload`, {
  method: "POST",
  headers: { Authorization: STRAPI_TOKEN },
  body: formData,
});

const result = await uploadRes.json();
if (Array.isArray(result) && result[0]?.id) {
  console.log(`✅ Uploaded image to Strapi: id=${result[0].id}`);
  return result[0].id;
} else {
  console.warn("⚠️ No id found for uploaded image", result);
  return null;
}
}

const postToStrapi = async (product) => {
  try {
        const strapiRes = await fetch(`${STRAPI_API_URL}/api/products`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: STRAPI_TOKEN,
          },
          body: JSON.stringify({ data: product }),
        })
        if (!strapiRes.ok) {
          const err = await strapiRes.text()
          throw new Error(err)
        }
        const result = await strapiRes.json();
        return result.data.documentId;
      } catch (err) {
        console.error('❌ Create-post error:', err)
        return err.message;
      }
}

const updateTagStatus = async (tag, country) => {
  let collection;
  if (country === 'USA') {
    collection = "taguses";
  } else if (country === 'Canada') {
    collection = "tagcas";
  }

  const updateUrl = `${STRAPI_API_URL}/api/${collection}/${tag.documentId}`;
  const updateRes = await fetch(updateUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `${STRAPI_TOKEN}`,
      },
      body: JSON.stringify({
        data: {
          isUsed: true,
        },
      })
    });

    if (!updateRes.ok) {
      console.error("❌ Strapi update error:", updateRes.status, await updateRes.text());
      return null;
    }

    const updated = await updateRes.json();
    return updated;

}

const getTag = async (country) => {
  let endpoint;

  if (country === 'USA') {
    endpoint = "taguses";
  } else if (country === 'CA') {
    endpoint = "tagcas";
  } else {
    throw new Error("Unsupported tag format");
  }

  const url = `${STRAPI_API_URL}/api/${endpoint}?filters[isUsed][$eq]=false&sort=createdAt:asc`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: STRAPI_TOKEN,
      },
    });

    if (!res.ok) {
      console.error("❌ Strapi error:", res.status, res.statusText);
      return null;
    }

    const json = await res.json();
    return json?.data?.[0] || null;
  } catch (error) {
    console.error("❌ Fetch error:", error);
    return null;
  }
};

const updateTagFbclid = async (fbclid, productId, tag, tagId) => {
  let endpoint;

  // Определяем коллекцию по типу тега
  if (tag.startsWith("subtag-")) {
    endpoint = "taguses";
  } else if (tag.startsWith("subtagcan-")) {
    endpoint = "tagcas";
  } else {
    throw new Error("Unsupported tag format");
  }

  // Формируем URL для обновления конкретного объекта
  const url = `${STRAPI_API_URL}/api/${endpoint}/${tagId}`;

  // Тело обновления
  const body = {
    data: {
      fbclid,
      productId
    }
  };

  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: STRAPI_TOKEN,
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error("❌ Strapi update error:", res.status, await res.text());
      return null;
    }

    const json = await res.json();
    return json?.data || null;

  } catch (err) {
    console.error("❌ Request error:", err);
    return null;
  }
};

const leadPushStrapi = async (lead) => {
  try {
        const strapiRes = await fetch(`${STRAPI_API_URL}/api/leads`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: STRAPI_TOKEN,
          },
          body: JSON.stringify({ data: lead }),
        })
        if (!strapiRes.ok) {
          const err = await strapiRes.text()
          throw new Error(err)
        }
        const result = await strapiRes.json();
        return result.data.documentId;
      } catch (err) {
        console.error('❌ Create-post error:', err)
        return err.message;
      }
}



export {generateProduct, generateImg, postToStrapi, getTags, generateRefLink, updateTagStatus, getTag, updateTagFbclid, leadPushStrapi};