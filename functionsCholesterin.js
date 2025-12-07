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

const categories = [
  'Aktuelle Forschung & Studien zum Cholesterin',
  'Alltagstipps für ein cholesterinfreundliches Leben',
  'Erfahrungsberichte & Interviews zum Thema Cholesterin',
  'Ernährung & Lebensstil bei Cholesterinproblemen',
  'Grundlagen & Hintergründe',
  'Mythen & Fakten rund ums Cholesterin',
  'Prävention & Screening von Cholesterinwerten',
  'Spezielle Zielgruppen mit Cholesterin-Thematik',
  'Therapie & Medikamente gegen hohen Cholesterin',
  'Ursachen & Risikofaktoren für erhöhtes Cholesterin'
];

const generateQuery = async () => {
  try{
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    const prompt = `Come up with an interesting topic for a post in the category ${randomCategory} entirely in German. In the response, I want a simple subject line consisting of a few words. There's no need to explain anything or write anything before or after the subject line. So, the response should just be the subject line, one line.`;
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const cleanRes = result.response.text().trim();
    if(randomCategory === 'Aktuelle Forschung & Studien zum Cholesterin'){
      return {query: cleanRes, categoryId: 8, category: randomCategory}
    }else if(randomCategory === 'Alltagstipps für ein cholesterinfreundliches Leben'){
      return {query: cleanRes, categoryId: 9, category: randomCategory}
    }else if(randomCategory === 'Erfahrungsberichte & Interviews zum Thema Cholesterin'){
      return {query: cleanRes, categoryId: 10, category: randomCategory}
    }else if(randomCategory === 'Ernährung & Lebensstil bei Cholesterinproblemen'){
      return {query: cleanRes, categoryId: 3, category: randomCategory}
    }else if(randomCategory === 'Grundlagen & Hintergründe'){
      return {query: cleanRes, categoryId: 1, category: randomCategory}
    }else if(randomCategory === 'Mythen & Fakten rund ums Cholesterin'){
      return {query: cleanRes, categoryId: 7, category: randomCategory}
    }else if(randomCategory === 'Prävention & Screening von Cholesterinwerten'){
      return {query: cleanRes, categoryId: 5, category: randomCategory}
    }else if(randomCategory === 'Spezielle Zielgruppen mit Cholesterin-Thematik'){
      return {query: cleanRes, categoryId: 6, category: randomCategory}
    }else if(randomCategory === 'Therapie & Medikamente gegen hohen Cholesterin'){
      return {query: cleanRes, categoryId: 4, category: randomCategory}
    }else{
      return {query: cleanRes, categoryId: 2, category: randomCategory}
    }
  }
  catch (error) {
    console.error(error);
    return {error: 'Ошибка при генерации Темы'};
  }
  
}

const generateGlobalObj = async (query, categoryId, category) => {
  const globalObj = {
    title: '',
    description: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            text: ''
          }
        ]}
    ],
    isPopular: false,
    paragraphs: [
      {
        subtitle: '',
        description: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                text: ''
              }
            ]
          }
        ],
        ads: [
          {title: 'Example adds title', url: ''},
          {title: 'Example adds title', url: ''}
        ],
        image: undefined
      },
      {
        subtitle: '',
        description: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                text: ''
              }
            ]
          }
        ],
        ads: [
          {title: 'Example adds title', url: 'https://example.com'},
          {title: 'Example adds title', url: 'https://example.com'}
        ],
        image: undefined
      }
    ],
    ads: [
      {title: 'Example adds title', url: 'https://example.com'},
      {title: 'Example adds title', url: 'https://example.com'},
      {title: 'Example adds title', url: 'https://example.com'}
    ],
    firstAdBanner: {
      url: 'https://example.com',
      image: undefined
    },
    secondAdBanner: {
      url: 'https://example.com',
      image: undefined
    },
    author_2: 1,
    category_2: categoryId,
    image: undefined
  }

  let title = undefined;
  let description = undefined;
  let subTitleP1 = undefined;
  let descrP1 = undefined;
  let subTitleP2 = undefined;
  let descrP2 = undefined;

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  try{
    const resTitle = await model.generateContent(`Come up with an interesting title for my post on the topic ${query}. The title should be approximately 45-70 characters long. In your reply, write absolutely nothing except the title. Don't write anything at the beginning or end of your reply. Just give me the result as the title. The title must be in German. Don't give a truncated answer; the title needs to be full and complete. This post will be related to cholesterol levels and its harmful effects.`);
    title = resTitle.response.text().trim();
  }catch(e){
    console.log(`Ошибка при генерации заголовка поста: ${e}`);
    return false;
  }
  try{
    const resDescription = await model.generateContent(`Create a description for my post. It must contain at least 700 characters. This is the category in which this post will be located on my website ${category}. This is the topic of the post that needs to be taken into account when creating the description ${query}. The description must be in German. In your reply, write absolutely nothing except the description. Don't write anything at the beginning or end of your reply. This post will be related to cholesterol levels and its harmful effects.`);
    description = resDescription.response.text().trim();
  }catch(e){
    console.log(`Ошибка при создании описания поста: ${e}`)
    return false;
  }
  try{
    const resSubTitleP1 = await model.generateContent(`Write a title for a paragraph of my article. In your response, don't include anything other than the title itself. Don't add anything at the beginning or end of your response; just write the title. It should be 45-75 characters long and make sense. When creating the title, consider the category the article is in - ${category}, Also consider the topic of the article - ${query}. When creating a title, take into account the description of my article - ${description}. An article about the dangers of cholesterol. The title must be in German.`);
    subTitleP1 = resSubTitleP1.response.text().trim();
  }catch(e){
    console.log(`Ошибка при создании первого подзаголовка поста: ${e}`)
    return false;
  }
  try{
    const resDescrP1 = await model.generateContent(`Create a paragraph for my article on the website. In your response, write nothing but the paragraph itself. Don't add anything before or after the paragraph. Your response should only include the paragraph itself. Write it in German. Here's the category the paragraph is in - ${category}. This is the topic of my article - ${query}. Here is the description of my article - ${description}. And here is the heading for the paragraph you need to create - ${subTitleP1}. The length of a paragraph must be no less than 700 characters.`);
    descrP1 = resDescrP1.response.text().trim();
  }catch(e){
    console.log(`Ошибка при создании первого параграфа поста: ${e}`);
    return false;
  }
  try{
    const resSubTitleP2 = await model.generateContent(`Write a title for a paragraph of my article. In your response, don't include anything other than the title itself. Don't add anything at the beginning or end of your response; just write the title. It should be 45-75 characters long and make sense. When creating the title, consider the category the article is in - ${category}, Also consider the topic of the article - ${query}. When creating a title, take into account the description of my article - ${description}. An article about the dangers of cholesterol. The title must be in German.`);
    subTitleP2 = resSubTitleP2.response.text().trim();
  }catch(e){
    console.log(`Ошибка при создании второго подзаголовка поста: ${e}`)
    return false;
  }
  try{
    const resDescrP2 = await model.generateContent(`Create a paragraph for my article on the website. In your response, write nothing but the paragraph itself. Don't add anything before or after the paragraph. Your response should only include the paragraph itself. Write it in German. Here's the category the paragraph is in - ${category}. This is the topic of my article - ${query}. Here is the description of my article - ${description}. And here is the heading for the paragraph you need to create - ${subTitleP2}. The length of a paragraph must be no less than 700 characters.`);
    descrP2 = resDescrP2.response.text().trim();
  }catch(e){
    console.log(`Ошибка при создании второго параграфа  поста: ${e}`);
    return false;
  }

  if(title && description && subTitleP1 && descrP1 && subTitleP2 && descrP2){
    globalObj.title = title;
    globalObj.description[0].children[0].text = description;
    globalObj.paragraphs[0].subtitle = subTitleP1;
    globalObj.paragraphs[0].description[0].children[0].text = descrP1;
    globalObj.paragraphs[1].subtitle = subTitleP2;
    globalObj.paragraphs[1].description[0].children[0].text = descrP2;
  }else{
    console.log('Ошибка генерации главного обьекта');
    return false;
  }

  return globalObj;
}

// const generateGlobalObj = async (query) => {
//   try {
//     const prompt = `You are a CMS content generator. All key values ​​must be in German, but do not touch the keys themselves. Return ONLY a valid raw JSON object — no markdown, no explanations, no backticks, no comments. Your output MUST start and end with { and }. Create an article in JSON format based on the topic: "${query}". The article must include exactly 2 paragraphs in the "paragraphs" array. JSON must always have property 'paragraphs' which is an array of EXACTLY 2 objects, no more, no less. Never reply with fewer or more than 2 items in the paragraphs array. The article should match this structure:
//               {
//                 "title": "SEO-optimized, human-readable title (55–65 characters, includes main keyword)",
//                 "description": ["Full intro (min 700 characters). Begin with a 150–160 character SEO meta description, then an engaging intro mentioning ${{query}} and 1–2 LSI terms."],
//                 "isPopular": false,
//                 "paragraphs": [
//                   {
//                     "subtitle": "Informative subheading #1 (with keyword variation)",
//                     "description": ["Comprehensive section (min 700 characters) exploring one core aspect of the topic. Integrate 2–3 LSI terms and implicitly answer one People Also Ask question. Provide examples, steps, or data."],
//                     "ads": [
//                       { "title": "Helpful Tool or Product", "url": "https://..." },
//                       { "title": "Trusted Resource", "url": "https://..." }
//                     ],
//                     "image_prompt": "Describe a realistic, contextually relevant image for this section (avoid text or logos)"
//                   }
//                 ],
//                 "ads": [
//                   { "title": "...", "url": "https://..." },
//                   { "title": "...", "url": "https://..." },
//                   { "title": "...", "url": "https://..." }
//                 ],
//                 "image_prompt": "Describe a realistic, contextually relevant image for this section (avoid text or logos)",
//                 "firstAdBanner": { "url": "https://...", "image_prompt": "Describe a realistic, contextually relevant image for this section (avoid text or logos)" },
//                 "secondAdBanner": { "url": "https://...", "image_prompt": "Describe a realistic, contextually relevant image for this section (avoid text or logos)" }
//               }`
//     const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
//     const result = await model.generateContent(prompt);
//     const jsonResult = JSON.parse(result.response.text())
//     return jsonResult;
//   } catch (error) {
//     console.error(error);
//     return {error: 'Ошибка при генерации Главного Обьекта'};
//   }
// }

const generateImages = async (globalObj) => {
  const img1 = `Create an image for an article on my website. It's a German-language website about the dangers of cholesterol. The image must be of the highest quality, super realistic, without magic or non-existent objects. Make it as close to reality as possible. Here's the title of my article - ${globalObj.title}. Here is the description of my article - ${globalObj.description[0].children[0].text}. Here is the paragraph of my article - ${globalObj.paragraphs[0].description[0].children[0].text}. Create an image for this article based on this information. It should be realistic and reflective of real life.`;
  const img2 = `Create an image for an article on my website. It's a German-language website about the dangers of cholesterol. The image must be of the highest quality, super realistic, without magic or non-existent objects. Make it as close to reality as possible. Here's the title of my article - ${globalObj.title}. Here is the description of my article - ${globalObj.description[0].children[0].text}. Here is the paragraph of my article - ${globalObj.paragraphs[1].description[0].children[0].text}. Create an image for this article based on this information. It should be realistic and reflective of real life.`;
  const img3 = `Create an image for an article on my website. It's a German-language website about the dangers of cholesterol. The image must be of the highest quality, super realistic, without magic or non-existent objects. Make it as close to reality as possible. Here's the title of my article - ${globalObj.title}. Here is the description of my article - ${globalObj.description[0].children[0].text}. Create an image for this article based on this information. It should be realistic and reflective of real life.`;
  const img4 = `Create an image for an article on my website. It's a German-language website about the dangers of cholesterol. The image must be of the highest quality, super realistic, without magic or non-existent objects. Make it as close to reality as possible. Here's the title of my article - ${globalObj.title}. Here is the description of my article - ${globalObj.description[0].children[0].text}. Here is the first paragraph of my article - ${globalObj.paragraphs[0].description[0].children[0].text}. Here is the second paragraph of my article - ${globalObj.paragraphs[1].description[0].children[0].text}. Create an image for this article based on this information. It should be realistic and reflective of real life.`;
  const img5 = `Create an image for an article on my website. It's a German-language website about the dangers of cholesterol. The image must be of the highest quality, super realistic, without magic or non-existent objects. Make it as close to reality as possible. Here's the title of my article - ${globalObj.title}. Here is the description of my article - ${globalObj.description[0].children[0].text}. Here is the first paragraph of my article - ${globalObj.paragraphs[0].description[0].children[0].text}. Here is the second paragraph of my article - ${globalObj.paragraphs[1].description[0].children[0].text}. Create an image for this article based on this information. It should be realistic and reflective of real life.`;
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

const prepForPush = async (ids, obj) => {
  const editedObj = obj;
  editedObj.paragraphs[0].image = ids[0];
  editedObj.paragraphs[1].image = ids[1];
  editedObj.image = ids[2];
  editedObj.firstAdBanner.image = ids[3];
  editedObj.secondAdBanner.image = ids[4];

  return editedObj;
}

const strapiPost = async (obj) => {
  try {
    console.log(obj);
      const strapiRes = await fetch(`${STRAPI_API_URL}/api/post2s`, {
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
      return strapiRes.json();
    } catch (err) {
      console.error('❌ Create-post error:', err)
      return err.message;
    }
}

const generateAndPostCholesterin = async () => {
  try {
    const { query, categoryId, category } = await generateQuery();
    console.log('Тема згенерована');
    const globalObj = await generateGlobalObj(query, categoryId, category);
    console.log('Глобальний обєкт згенеровано');
    const imageIds = await generateImages(globalObj);
    console.log('картинки завантажено');
    const prepForPushRes = await prepForPush(imageIds, globalObj);
    console.log('обєкт змінено')
    const isPostedToStrapi = await strapiPost(prepForPushRes);
    return isPostedToStrapi;

    // const imageids = await generateImages(result);
    // const resultToStrapiPost = await prepForPush(result, imageids, categoryId);
    // const isPostedToStrapi = await strapiPost(resultToStrapiPost);
    // console.log('generateAndPost finished:', isPostedToStrapi);
    // return isPostedToStrapi;
  } catch (error) {
    console.error('Ошибка в generateAndPost:', error);
    throw error;
  }
}

export {generateGlobalObj, generateImages, generateQuery, prepForPush, strapiPost, generateAndPostCholesterin};