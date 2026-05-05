import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const STRAPI_API_URL = process.env.STRAPI_API_URL;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const SITES = [
  {
    key: 'nice-advice',
    domain: 'nice-advice.info',
    collection: 'posts',
    language: 'English',
    audience: 'general adult readers in the US/UK interested in lifestyle, health, family and wellness',
  },
  {
    key: 'cholesterin',
    domain: 'cholesterintipps.de',
    collection: 'post2s',
    language: 'German',
    audience: 'German-speaking adults interested in cholesterol, heart health and healthy nutrition',
  },
  {
    key: 'hairstyles',
    domain: 'hairstylesforseniors.com',
    collection: 'post3s',
    language: 'English',
    audience: 'English-speaking seniors (60+) interested in hairstyles, hair care and beauty',
  },
];

const NAMES_EN = [
  'Linda', 'Karen', 'Susan', 'Patricia', 'Margaret', 'Barbara', 'Nancy', 'Helen',
  'Sandra', 'Donna', 'Carol', 'Ruth', 'Sharon', 'Michelle', 'Laura', 'Sarah',
  'Robert', 'James', 'David', 'Richard', 'Charles', 'Thomas', 'Daniel', 'Paul',
  'Mark', 'Steven', 'Kenneth', 'George', 'Edward', 'Brian', 'Anthony',
  'Catherine', 'Diane', 'Janet', 'Joyce', 'Virginia', 'Kathleen', 'Pamela',
  'Deborah', 'Frances', 'Gloria', 'Theresa', 'Beverly', 'Denise', 'Lori',
];

const NAMES_DE = [
  'Annette', 'Edith', 'Stefanie', 'Erika', 'Silvia', 'Daniela', 'Heike',
  'Petra', 'Brigitte', 'Monika', 'Ursula', 'Renate', 'Gisela', 'Ingrid',
  'Klaus', 'Manfred', 'Hans', 'Wolfgang', 'Peter', 'Jürgen', 'Dieter',
  'Karl', 'Werner', 'Helmut', 'Gerhard', 'Bernd', 'Rolf', 'Herbert',
  'Christine', 'Sabine', 'Andrea', 'Birgit', 'Claudia', 'Gabriele',
];

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

const pickRandomName = (lang) =>
  pickRandom(lang === 'German' ? NAMES_DE : NAMES_EN);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Извлекает короткий текстовый сниппет из rich-text description Strapi.
 */
function extractSnippet(description, maxLen = 600) {
  if (!description) return '';
  if (typeof description === 'string') return description.slice(0, maxLen);
  if (!Array.isArray(description)) return '';

  const parts = [];
  for (const block of description) {
    if (!block?.children) continue;
    for (const child of block.children) {
      if (typeof child?.text === 'string') parts.push(child.text);
    }
    if (parts.join(' ').length > maxLen) break;
  }
  return parts.join(' ').slice(0, maxLen);
}

/**
 * Получает N самых свежих постов из коллекции вместе с уже существующими комментариями.
 */
async function fetchLatestPosts(collection, limit = 10) {
  const url = `${STRAPI_API_URL}/api/${collection}?sort=createdAt:desc`
    + `&pagination%5Blimit%5D=${limit}`
    + `&populate=comments`
    + `&fields%5B0%5D=title`
    + `&fields%5B1%5D=description`
    + `&fields%5B2%5D=documentId`
    + `&fields%5B3%5D=createdAt`
    + `&fields%5B4%5D=publishedAt`;

  const res = await fetch(url, {
    headers: { Authorization: STRAPI_TOKEN },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Strapi GET ${collection} ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = await res.json();
  return json?.data ?? [];
}

/**
 * Генерирует комментарий через Gemini, основываясь на заголовке и кратком описании поста.
 */
async function generateCommentText({ title, snippet, language, audience, existingComments }) {
  const recent = (existingComments || [])
    .slice(-5)
    .map((c) => `- ${c.text}`)
    .join('\n');

  const prompt = `You are simulating a real reader leaving a comment on a blog article.

Write ONE short, natural, human-sounding comment (1–2 sentences, max 200 characters) in ${language}.
Audience: ${audience}.

The comment must:
- Sound like a casual, real reader, not a marketer or AI.
- React emotionally or share a tiny personal angle (own experience, a quick thought, a question).
- Avoid: hashtags, emojis, links, exclamation overload, generic phrases like "Great article!" / "Thanks for sharing!".
- Do NOT repeat or rephrase the comments below — say something different.
- Output ONLY the comment text. No quotes, no name, no markdown, no extra lines.

Article title: "${title}"
Article excerpt: "${snippet}"

${recent ? `Comments already left (DO NOT duplicate their angle):\n${recent}\n` : ''}

Comment:`;

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent(prompt);
  let text = result.response.text().trim();

  // Очистка кавычек и markdown, если Gemini всё-таки их добавил.
  text = text.replace(/^["'`*\s]+|["'`*\s]+$/g, '');
  if (text.length > 280) text = text.slice(0, 277) + '...';
  return text;
}

/**
 * Добавляет в массив комментариев Strapi-поста один новый комментарий.
 */
async function appendCommentToPost(collection, post, comment) {
  const existing = (post.comments || []).map((c) => ({
    username: c.username,
    text: c.text,
    ...(c.createdAt ? { createdAt: c.createdAt } : {}),
  }));

  const updated = [...existing, comment];

  // ВАЖНО: явно возвращаем оригинальный publishedAt, иначе Strapi v5 при PUT
  // ставит его в "сейчас" и ломает любую сортировку по publishedAt на фронте.
  const body = { data: { comments: updated } };
  if (post.publishedAt) body.data.publishedAt = post.publishedAt;

  const res = await fetch(`${STRAPI_API_URL}/api/${collection}/${post.documentId}`, {
    method: 'PUT',
    headers: {
      Authorization: STRAPI_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Strapi PUT ${collection}/${post.documentId} ${res.status}: ${txt.slice(0, 200)}`);
  }
  return true;
}

/**
 * Запускает один проход автокомментатора по всем сайтам.
 * Возвращает структурированный отчёт.
 */
export async function runAutoCommenter({ postsPerSite = 10 } = {}) {
  const startedAt = new Date();
  const report = {
    startedAt: startedAt.toISOString(),
    sites: [],
    totalPosted: 0,
    totalErrors: 0,
  };

  for (const site of SITES) {
    const siteReport = {
      site: site.key,
      domain: site.domain,
      posted: 0,
      skipped: 0,
      errors: [],
      samples: [],
    };

    try {
      const posts = await fetchLatestPosts(site.collection, postsPerSite);
      console.log(`[autoCommenter] ${site.key}: fetched ${posts.length} posts`);

      for (const post of posts) {
        try {
          const snippet = extractSnippet(post.description, 500);
          const text = await generateCommentText({
            title: post.title,
            snippet,
            language: site.language,
            audience: site.audience,
            existingComments: post.comments || [],
          });

          if (!text || text.length < 10) {
            siteReport.skipped += 1;
            console.warn(`[autoCommenter] ${site.key}: empty/short comment for ${post.documentId}`);
            continue;
          }

          const comment = {
            username: pickRandomName(site.language),
            text,
            createdAt: new Date().toISOString(),
          };

          await appendCommentToPost(site.collection, post, comment);
          siteReport.posted += 1;
          report.totalPosted += 1;

          if (siteReport.samples.length < 2) {
            siteReport.samples.push({
              postId: post.documentId,
              title: post.title,
              username: comment.username,
              text: comment.text,
            });
          }

          // лёгкий троттлинг, чтобы не упереться в Gemini RPM и не нагружать Strapi.
          await sleep(1500);
        } catch (err) {
          console.error(`[autoCommenter] ${site.key} post ${post?.documentId}:`, err.message);
          siteReport.errors.push(`${post?.documentId}: ${err.message}`);
          report.totalErrors += 1;
        }
      }
    } catch (err) {
      console.error(`[autoCommenter] ${site.key} fatal:`, err.message);
      siteReport.errors.push(`fatal: ${err.message}`);
      report.totalErrors += 1;
    }

    report.sites.push(siteReport);
  }

  report.finishedAt = new Date().toISOString();
  report.durationSec = Math.round((Date.now() - startedAt.getTime()) / 1000);
  return report;
}

/**
 * Форматирует отчёт для отправки в Telegram.
 */
export function formatReportForTelegram(report) {
  const lines = [];
  lines.push('🤖 *Auto-commenter run*');
  lines.push(`Posted: ${report.totalPosted}, errors: ${report.totalErrors}, ${report.durationSec}s`);
  lines.push('');
  for (const s of report.sites) {
    lines.push(`• ${s.domain}: +${s.posted} comments` + (s.errors.length ? ` (errors: ${s.errors.length})` : ''));
    for (const sample of s.samples) {
      lines.push(`   "${sample.username}": ${sample.text}`);
    }
  }
  return lines.join('\n');
}
