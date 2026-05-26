// nice-advice.info — English-language general lifestyle/wellness/family/health.
// Voice is "smart friend explaining what actually works."

import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { generateAndPostForSite } from './functionsPostBase.js';

dotenv.config();

const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const STRAPI_API_URL = process.env.STRAPI_API_URL;

const niceAdviceConfig = {
  brandName: 'NiceAdvice',
  language: 'English',
  audience:
    'general adult readers in the US and UK, ages 28–65, interested in practical lifestyle, family, wellness and everyday-health advice they can apply this week',
  brandVoice:
    'warm, smart-friend tone. Plain language, no jargon. Concrete examples over abstractions. Honest about trade-offs. Never preachy. Reader is treated as intelligent.',
  topicHint:
    'Write the kind of article a busy adult would actually read end-to-end on a coffee break. Favor specifics, examples and one good story over a wall of generic tips.',
  disclaimerHint:
    'If the topic touches medical advice, briefly note that the article is informational and a doctor should be consulted for personal concerns — keep the disclaimer subtle, never legalese.',

  collection: 'posts',
  authorField: 'author',
  categoryField: 'category',
  defaultAuthor: 1,

  categories: [
    'Lifestyle and Wellness',
    'Your Health',
    'Family',
    'Diseases and Conditions',
  ],
  categoryIds: {
    'Lifestyle and Wellness': 18,
    'Your Health': 20,
    Family: 22,
    'Diseases and Conditions': 3,
  },

  imagePrefix: 'niceadvice',

  // Visual identity — bright, modern, US/UK lifestyle. Diverse adults
  // in clean, contemporary settings.
  imageStyle: {
    context:
      'NiceAdvice is a contemporary lifestyle and wellness publication aimed at US/UK adults. Photography style: editorial, warm, modern.',
    palette:
      'warm whites, soft teals, muted terracotta accents. Natural daylight or golden-hour interior light.',

    subjectClose:
      'hands or detail of an everyday object related to the topic (e.g. a notebook, a kitchen counter, a phone, a hand reaching for something).',
    settingClose:
      'modern home interior, kitchen counter, desk, or sunlit corner. Clean but lived-in, not staged.',
    moodClose: 'quietly thoughtful, intimate, like a candid documentary frame.',

    subjectAction:
      'a person in their 30s–60s engaged in a related everyday activity — never staring at the camera, never overtly posed.',
    settingAction:
      'a real-feeling home, neighborhood walk, café, park or workplace. Slight environmental clutter is encouraged for authenticity.',
    moodAction: 'present, slightly hopeful, observational.',

    subjectHero:
      'a contemporary US/UK adult or small group of adults in a lifestyle moment that tells the article story at a glance.',
    settingHero:
      'a meaningful real-world setting: a sunlit living room, a kitchen mid-meal, a city street, a quiet garden — chosen to fit the article topic.',
    moodHero:
      'magazine-cover storytelling. Warm, optimistic, with subtle visual tension that invites the reader in.',

    subjectProduct:
      'still-life or product-style composition of items relevant to the article (books, water bottle, food, plants, tools, etc.) on a clean surface.',
    settingProduct:
      'top-down flat lay or 3/4 angle on a wood or stone surface, ambient morning light.',

    subjectLifestyle:
      'a candid mid-shot of an adult in motion or relaxed at home, away from the product/still-life framing of the previous image.',
    settingLifestyle:
      'casual home environment, balcony, or outdoor walk. Style consistent with a wellness publication.',
  },
};

export async function generateAndPost() {
  return generateAndPostForSite(niceAdviceConfig);
}

export async function postUserEmail(email, source) {
  try {
    const res = await fetch(`${STRAPI_API_URL}/api/emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: STRAPI_TOKEN,
      },
      body: JSON.stringify({ data: { email, source } }),
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return true;
  } catch (err) {
    console.error('[postUserEmail] error:', err.message);
    return err.message;
  }
}

export { niceAdviceConfig };
