// Batch runner for cholesterintipps.de — generates N deep German articles in
// one go, accumulating chosen topics (and seeding from the most recent existing
// titles) so the batch stays varied and avoids near-duplicates.
//
// Usage: node run-batch-cholesterin.mjs [N]   (default N = 4)

import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { cholesterinConfig } from './functionsCholesterin.js';
import {
  pickTopicForSite,
  generateGlobalObj,
  generateImages,
  prepForPushRich,
  strapiPost,
} from './functionsPostBase.js';

dotenv.config();

const N = Math.max(1, Math.min(10, parseInt(process.argv[2] || '4', 10) || 4));
const STRAPI_API_URL = process.env.STRAPI_API_URL;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Seed the avoid-list with the most recent existing titles so new topics don't
// echo what's already on the site.
async function recentTitles(limit = 40) {
  try {
    const url = `${STRAPI_API_URL}/api/${cholesterinConfig.collection}?fields[0]=title&sort=createdAt:desc&pagination[pageSize]=${limit}`;
    const res = await fetch(url, { headers: { Authorization: STRAPI_TOKEN } });
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.data || []).map(d => d.title || d?.attributes?.title).filter(Boolean);
  } catch {
    return [];
  }
}

async function makeOne(recent) {
  const cfg = { ...cholesterinConfig, recentTopicsHint: recent };
  const { query, categoryId, category } = await pickTopicForSite(cfg);
  console.log(`  topic: "${query}"  →  ${category}`);

  const globalObj = await generateGlobalObj(cfg, query, categoryId, category);
  if (!globalObj) throw new Error('text generation failed');
  console.log(`  title: "${globalObj.title}"  (${globalObj.paragraphs.length} sections)`);

  const imageIds = await generateImages(cfg, globalObj);
  console.log(`  images: ${imageIds.length}/3 uploaded`);

  const prepared = prepForPushRich(globalObj, imageIds);
  const posted = await strapiPost(cfg, prepared);
  const documentId = posted?.data?.documentId;
  console.log(`  posted documentId=${documentId}`);
  return { title: globalObj.title, category, query, documentId, images: imageIds.length };
}

const seed = await recentTitles();
console.log(`Seeded avoid-list with ${seed.length} recent titles. Generating ${N} articles…\n`);

const recent = [...seed];
const results = [];
for (let i = 0; i < N; i += 1) {
  const started = Date.now();
  console.log(`── Artikel ${i + 1}/${N} ──`);
  try {
    const r = await makeOne(recent);
    recent.unshift(r.query, r.title); // bias next pick away from this one
    results.push({ ok: true, ...r, seconds: Math.round((Date.now() - started) / 1000) });
    console.log(`  ✓ done in ${Math.round((Date.now() - started) / 1000)}s\n`);
  } catch (e) {
    results.push({ ok: false, error: e.message });
    console.error(`  ✗ failed: ${e.message}\n`);
  }
  if (i < N - 1) await sleep(2500); // gentle gap between Gemini bursts
}

console.log('\n===== SUMMARY =====');
for (const [i, r] of results.entries()) {
  if (r.ok) {
    console.log(`${i + 1}. [${r.category}] ${r.title}  (id=${r.documentId}, ${r.images}/3 imgs, ${r.seconds}s)`);
  } else {
    console.log(`${i + 1}. FAILED: ${r.error}`);
  }
}
const ok = results.filter(r => r.ok).length;
console.log(`\n${ok}/${N} articles posted.`);
