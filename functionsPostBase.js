// Shared post-generation pipeline used by functions.js (nice-advice),
// functionsCholesterin.js (cholesterintipps.de) and functionsHairStyles.js
// (hairstylesforseniors.com).
//
// Each site supplies a `siteConfig` describing its language, audience,
// brand voice, category list, Strapi collection and image style. This
// module handles the actual Gemini calls, Imagen calls, Strapi uploads
// and the final POST. Sites stay distinct because each `siteConfig`
// produces noticeably different prompts and images.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenAI } from '@google/genai';
import fetch from 'node-fetch';
import FormData from 'form-data';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;
const STRAPI_API_URL = process.env.STRAPI_API_URL;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const imagen = new GoogleGenAI(GEMINI_API_KEY);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const CURRENT_YEAR = new Date().getFullYear();

// ──────────────────────────────────────────────────────────────────────
// Gemini wrapper with retry on transient errors (429, 5xx, empty body)
// ──────────────────────────────────────────────────────────────────────

async function geminiText(prompt, { model = 'gemini-2.5-flash', retries = 3 } = {}) {
  const m = genAI.getGenerativeModel({ model });
  let lastErr = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const result = await m.generateContent(prompt);
      const text = result.response.text().trim();
      if (text) return text;
      lastErr = new Error('empty response');
    } catch (err) {
      lastErr = err;
      const msg = err.message || '';
      if (msg.includes('429') || /quota|rate/i.test(msg)) {
        const wait = 8000 + attempt * 4000;
        console.warn(`[gemini] rate-limited, waiting ${wait}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(wait);
        continue;
      }
      await sleep(1500);
    }
  }
  throw lastErr || new Error('gemini: retries exhausted');
}

// Strip markdown fences and surrounding quotes the model sometimes adds
function cleanText(t) {
  if (!t) return '';
  return String(t)
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^["'`*\s]+|["'`*\s]+$/g, '')
    .trim();
}

// ──────────────────────────────────────────────────────────────────────
// Topic / query generator — site-specific category + ideation
// ──────────────────────────────────────────────────────────────────────

export async function pickTopicForSite(siteConfig) {
  const pool = siteConfig.categories;
  const randomCategory = pool[Math.floor(Math.random() * pool.length)];
  const categoryId = siteConfig.categoryIds[randomCategory];

  const prompt = `You brainstorm article topics for ${siteConfig.brandName}, a ${siteConfig.language}-language site for ${siteConfig.audience}.

Brand voice: ${siteConfig.brandVoice}

Brainstorm ONE concrete article topic for the category "${randomCategory}".

Rules:
- Write in ${siteConfig.language}.
- Sound like a real reader's question or curiosity (avoid generic listicle headlines).
- 4 to 9 words. No clickbait.
- No quotes, no punctuation at the end, no prefix like "Topic:".
- Do NOT pick a topic that mentions the current year explicitly.
- Avoid these recent topics: ${(siteConfig.recentTopicsHint || []).slice(0, 8).join(' | ') || '(none yet)'}.

Output ONLY the topic line, nothing else.`;

  const raw = await geminiText(prompt);
  return {
    query: cleanText(raw),
    categoryId,
    category: randomCategory,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Rich-content helpers (only used when siteConfig.richContent === true).
// Build Strapi "blocks" (paragraph / heading / list) for deep articles —
// Key Takeaways, step-by-step / mistakes sections and an FAQ — matching what
// the hairstyles frontend renders. Other sites keep the plain 2-section output.
// ──────────────────────────────────────────────────────────────────────

const mkPara = t => ({ type: 'paragraph', children: [{ type: 'text', text: String(t) }] });
const mkHeading = (t, level = 3) => ({ type: 'heading', level, children: [{ type: 'text', text: String(t) }] });
const mkList = (items, ordered = false) => ({
  type: 'list',
  format: ordered ? 'ordered' : 'unordered',
  children: (items || []).filter(Boolean).map(t => ({ type: 'list-item', children: [{ type: 'text', text: String(t) }] })),
});
const splitParas = t => String(t || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean).map(mkPara);
const mkLink = (text, url) => ({ type: 'link', url: String(url), children: [{ type: 'text', text: String(text) }] });
const mkLinkList = items => ({
  type: 'list',
  format: 'unordered',
  children: (items || [])
    .filter(s => s && s.url && s.title)
    .map(s => ({ type: 'list-item', children: [mkLink(s.title, s.url)] })),
});

// Gemini call that returns parsed JSON (tolerant to code fences / stray prose).
async function geminiJSON(prompt, fallback) {
  try {
    const raw = await geminiText(prompt);
    const m = raw.match(/[[{][\s\S]*[\]}]/);
    return JSON.parse(m ? m[0] : raw);
  } catch (e) {
    console.warn('[geminiJSON] parse failed:', e.message);
    return fallback;
  }
}

// Verify a URL actually resolves (no 404) so we never ship broken citations on
// a YMYL/medical site. HEAD first, GET fallback for servers that reject HEAD.
async function urlOk(url, timeoutMs = 12000) {
  const ua = 'Mozilla/5.0 (compatible; CholesterinTippsBot/1.0)';
  const tryFetch = async method => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'User-Agent': ua },
      });
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let status = await tryFetch('HEAD');
    if (status === 403 || status === 405 || status === 501 || !status) {
      status = await tryFetch('GET');
    }
    return status >= 200 && status < 400;
  } catch {
    return false;
  }
}

async function buildRichParagraphs(ctx) {
  const { brand, baseRules, title, description, subTitleP1, descrP1, subTitleP2, descrP2, disclaimerHint, cfg = {} } = ctx;

  // Site-aware wording. Every default below reproduces the original hairstyles
  // prompt/label byte-for-byte, so hairstyles (and any non-overriding site)
  // output is unchanged; other sites override via siteConfig fields.
  const editorPersona = cfg.richEditorPersona || 'senior hair-care editor';
  const writerPersona = cfg.richWriterPersona || 'expert hair-care writer';
  const faqPersona = cfg.richFaqPersona || 'hair-care expert';
  const sectionShapes =
    cfg.richSectionShapes ||
    'a numbered step-by-step how-to; "Common Mistakes to Avoid"; "Adjusting for Your Hair Type or Face Shape"';
  const faqReferral =
    cfg.richFaqReferral ||
    'Where the answer touches scalp conditions, significant hair loss or medication, add a warm one-line "see a dermatologist" note.';
  const labels = cfg.richLabels || {};
  const labelTakeaways = labels.keyTakeaways || 'Key Takeaways';
  const labelFaq = labels.faq || 'Frequently Asked Questions';

  const takeaways = await geminiJSON(
    `You are a ${editorPersona} at ${brand}. ${baseRules}
Article title: "${title}". Intro: "${description.slice(0, 300)}".
Write 4-5 SPECIFIC, actionable "${labelTakeaways}" — the real points a reader should remember. Concrete (timings, amounts, techniques), never vague.
Return ONLY a JSON array of strings.`, [],
  );
  const sections = await geminiJSON(
    `You are an ${writerPersona} at ${brand}. ${baseRules}
Article: "${title}". It already has two body sections titled "${subTitleP1}" and "${subTitleP2}" — do NOT repeat them.
Write 2 ADDITIONAL deep, genuinely useful sections specific to this topic. Good shapes: ${sectionShapes}. Use real techniques, timings and amounts — never generic fluff. ${disclaimerHint}
Return ONLY a JSON array of up to 2 objects, each: {"heading":"...","paragraphs":["0-2 lead sentences"],"list":["concrete step or tip","..."],"listOrdered":true_for_step_by_step_else_false}`, [],
  );
  const faq = await geminiJSON(
    `You are a ${faqPersona} at ${brand}. ${baseRules}
Article: "${title}". Write 4 real questions a reader would ask about THIS specific topic, each with a specific 2-4 sentence answer. ${faqReferral}
Return ONLY a JSON array: [{"question":"...","answer":"..."}]`, [],
  );

  // Optional credible outbound sources (per-site, e.g. YMYL/medical), rendered
  // as real Strapi link nodes. Only runs when siteConfig.sources is set, so
  // sites without it (hairstyles, nice-advice) are completely unchanged.
  let sources = [];
  if (cfg.sources) {
    const allow = cfg.sources.domains || [];
    const srcRaw = await geminiJSON(
      `You are a ${faqPersona} at ${brand}. ${baseRules}
Article: "${title}". List 7-9 CREDIBLE, real, currently-existing reference pages a reader could check on this topic (more is better — several will be filtered out). ${cfg.sources.prompt || ''}
Rules: every source must be a real, well-known organisation or established reference (no invented URLs, no blogs, no shops, no affiliate links). Use the organisation's real domain. PREFER the stable overview / topic landing page you are confident exists (often the domain's main topic page) over deep article URLs you might be guessing.
Return ONLY a JSON array: [{"title":"Organisation – Seitentitel","url":"https://..."}]`, [],
    );
    const candidates = (Array.isArray(srcRaw) ? srcRaw : [])
      .filter(s => s && s.title && /^https?:\/\//i.test(s.url || ''))
      .filter(s => {
        if (!allow.length) return true;
        try {
          const host = new URL(s.url).hostname.replace(/^www\./, '');
          return allow.some(d => host === d || host.endsWith('.' + d));
        } catch {
          return false;
        }
      });
    // Drop any link that doesn't actually resolve (Gemini sometimes guesses a
    // plausible-but-404 deep path). Broken citations are an E-E-A-T liability.
    const checked = await Promise.all(
      candidates.map(async s => ({ s, ok: await urlOk(s.url) })),
    );
    sources = checked
      .filter(c => c.ok)
      .map(c => c.s)
      .slice(0, 5);
    console.log(`[sources] ${candidates.length} candidates → ${sources.length} resolve`);
  }

  const paragraphs = [];
  if (Array.isArray(takeaways) && takeaways.filter(Boolean).length >= 2) {
    paragraphs.push({ subtitle: labelTakeaways, description: [mkList(takeaways)], image: undefined });
  }
  paragraphs.push({ subtitle: subTitleP1, description: splitParas(descrP1), image: undefined, _img: 'b1' });
  paragraphs.push({ subtitle: subTitleP2, description: splitParas(descrP2), image: undefined, _img: 'b2' });
  for (const s of Array.isArray(sections) ? sections : []) {
    if (!s || !s.heading) continue;
    const desc = [...(s.paragraphs || []).filter(Boolean).map(mkPara)];
    if ((s.list || []).filter(Boolean).length) desc.push(mkList(s.list, !!s.listOrdered));
    if (desc.length) paragraphs.push({ subtitle: s.heading, description: desc, image: undefined });
  }
  const validFaq = (Array.isArray(faq) ? faq : []).filter(f => f && f.question && f.answer);
  if (validFaq.length >= 2) {
    paragraphs.push({
      subtitle: labelFaq,
      description: validFaq.flatMap(f => [mkHeading(f.question, 3), mkPara(f.answer)]),
      image: undefined,
    });
  }
  if (cfg.sources && sources.length >= 2) {
    const intro = cfg.sources.intro ? [mkPara(cfg.sources.intro)] : [];
    paragraphs.push({
      subtitle: cfg.sources.label || 'Sources',
      description: [...intro, mkLinkList(sources)],
      image: undefined,
    });
  }
  if (cfg.medicalDisclaimerBlock) {
    paragraphs.push({
      subtitle: cfg.medicalDisclaimerLabel || 'Hinweis',
      description: [mkPara(cfg.medicalDisclaimerBlock)],
      image: undefined,
    });
  }
  return paragraphs;
}

// ──────────────────────────────────────────────────────────────────────
// Full post structure generation — title, intro, 2 H2 sections
// ──────────────────────────────────────────────────────────────────────

export async function generateGlobalObj(siteConfig, query, categoryId, category) {
  const lang = siteConfig.language;
  const voice = siteConfig.brandVoice;
  const audience = siteConfig.audience;
  const brand = siteConfig.brandName;
  const topicHint = siteConfig.topicHint || '';

  const baseRules = `Write in ${lang}.
Brand: ${brand}. Voice: ${voice}.
Audience: ${audience}.
${topicHint}`;

  // ── 1. SEO Title ─────────────────────────────────────────────
  const titlePrompt = `You are a senior editor at ${brand}.
${baseRules}

Write ONE SEO-friendly article title about: "${query}" (category: ${category}).

Constraints:
- 50–68 characters.
- Front-load the most important keyword.
- Sounds natural — not a clickbait list ("10 things…").
- No emoji. No quotes. No trailing punctuation.

Output ONLY the title.`;
  const title = cleanText(await geminiText(titlePrompt));

  // ── 2. Intro / lede paragraph ─────────────────────────────────
  const descriptionPrompt = `You are writing the introduction for an article on ${brand}.
${baseRules}

Article title: "${title}"
Topic: "${query}"
Category: ${category}

Write the intro (lede) for this article.

Structure:
1. Open with a vivid, specific scene or relatable observation (1–2 sentences).
2. State the core question or problem the article addresses (1 sentence).
3. Preview what the reader will learn (1 sentence). Use "you" or "we" naturally.

Constraints:
- 720–950 characters total.
- Plain prose. No bullet lists, no headings, no markdown.
- First-person plural or second-person — match the brand voice.
- Mention the topic keyword once, naturally.
- Do not mention any year explicitly.
- ${siteConfig.disclaimerHint || ''}

Output ONLY the intro paragraph.`;
  const description = cleanText(await geminiText(descriptionPrompt));

  // ── 3. Section 1 heading (H2) ─────────────────────────────────
  const subTitleP1Prompt = `Write a single H2 subheading for an article on ${brand}.
${baseRules}

Article title: "${title}"
Article intro: "${description.slice(0, 280)}…"

This is the FIRST main section. It should cover the "core explanation" or "what's actually going on" angle of the topic.

Constraints:
- 45–70 characters.
- Use a long-tail keyword variation (different wording from the title).
- Sounds like a real subheading, not a question fragment.
- No emoji, no quotes, no trailing punctuation.

Output ONLY the heading.`;
  const subTitleP1 = cleanText(await geminiText(subTitleP1Prompt));

  // ── 4. Section 1 body ─────────────────────────────────────────
  const bodyP1Prompt = `You are writing section 1 of an article on ${brand}.
${baseRules}

Article title: "${title}"
Section heading: "${subTitleP1}"

Write the section body.

Content pattern (follow loosely, don't make it formulaic):
1. Concrete example, statistic, or scenario opening.
2. Explain the mechanism / context / "why".
3. Two or three practical takeaways the reader can act on.
4. Close with a sentence that bridges to the next section.

Constraints:
- 800–1100 characters.
- Plain prose. No bullet lists, no sub-headings, no markdown.
- Two or three paragraphs separated by single blank lines.
- ${siteConfig.disclaimerHint || ''}
- Don't mention years explicitly.

Output ONLY the section body.`;
  const descrP1 = cleanText(await geminiText(bodyP1Prompt));

  // ── 5. Section 2 heading (H2) ─────────────────────────────────
  const subTitleP2Prompt = `Write a single H2 subheading for an article on ${brand}.
${baseRules}

Article title: "${title}"
Article intro: "${description.slice(0, 200)}…"
First section heading (do NOT repeat this angle): "${subTitleP1}"

This is the SECOND main section. It should cover the "what to do" / "practical guide" / "real-world application" angle — clearly different from the first section.

Constraints:
- 45–70 characters.
- Use a different long-tail keyword variation than the title and section 1.
- No emoji, no quotes, no trailing punctuation.

Output ONLY the heading.`;
  const subTitleP2 = cleanText(await geminiText(subTitleP2Prompt));

  // ── 6. Section 2 body ─────────────────────────────────────────
  const bodyP2Prompt = `You are writing section 2 of an article on ${brand}.
${baseRules}

Article title: "${title}"
Section heading: "${subTitleP2}"
First section (do NOT repeat its content): "${descrP1.slice(0, 350)}…"

Write the section body.

Content pattern:
1. A concrete situation, common mistake, or reader-question opening.
2. A clear step-by-step or "here's the practical approach" middle.
3. One nuance, exception, or warning — keep readers honest.
4. End on an encouraging, useful note.

Constraints:
- 800–1100 characters.
- Plain prose. Two or three paragraphs separated by single blank lines.
- ${siteConfig.disclaimerHint || ''}
- Don't mention years explicitly.

Output ONLY the section body.`;
  const descrP2 = cleanText(await geminiText(bodyP2Prompt));

  if (!title || !description || !subTitleP1 || !descrP1 || !subTitleP2 || !descrP2) {
    console.log('[postBase] missing one or more text pieces, aborting');
    return false;
  }

  // Rich / deep article structure (hairstyles): Key Takeaways + body sections
  // + step-by-step / mistakes + FAQ, in proper Strapi blocks. Body sections are
  // tagged _img so the image pipeline knows where the 2 photos go.
  if (siteConfig.richContent) {
    const richParagraphs = await buildRichParagraphs({
      brand,
      baseRules,
      title,
      description,
      subTitleP1,
      descrP1,
      subTitleP2,
      descrP2,
      disclaimerHint: siteConfig.disclaimerHint || '',
      cfg: siteConfig,
    });
    return {
      title,
      description: splitParas(description),
      isPopular: false,
      paragraphs: richParagraphs,
      ads: [
        { title: 'Example adds title', url: '' },
        { title: 'Example adds title', url: '' },
        { title: 'Example adds title', url: '' },
      ],
      firstAdBanner: { url: 'https://example.com', image: undefined },
      secondAdBanner: { url: 'https://example.com', image: undefined },
      [siteConfig.authorField]: siteConfig.defaultAuthor,
      [siteConfig.categoryField]: categoryId,
      image: undefined,
    };
  }

  return {
    title,
    description: [{ type: 'paragraph', children: [{ type: 'text', text: description }] }],
    isPopular: false,
    paragraphs: [
      {
        subtitle: subTitleP1,
        description: [{ type: 'paragraph', children: [{ type: 'text', text: descrP1 }] }],
        ads: [
          { title: 'Example adds title', url: '' },
          { title: 'Example adds title', url: '' },
        ],
        image: undefined,
      },
      {
        subtitle: subTitleP2,
        description: [{ type: 'paragraph', children: [{ type: 'text', text: descrP2 }] }],
        ads: [
          { title: 'Example adds title', url: 'https://example.com' },
          { title: 'Example adds title', url: 'https://example.com' },
        ],
        image: undefined,
      },
    ],
    ads: [
      { title: 'Example adds title', url: 'https://example.com' },
      { title: 'Example adds title', url: 'https://example.com' },
      { title: 'Example adds title', url: 'https://example.com' },
    ],
    firstAdBanner: { url: 'https://example.com', image: undefined },
    secondAdBanner: { url: 'https://example.com', image: undefined },
    [siteConfig.authorField]: siteConfig.defaultAuthor,
    [siteConfig.categoryField]: categoryId,
    image: undefined,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Image generation — 5 truly distinct shots per article
// ──────────────────────────────────────────────────────────────────────

// Image slot definitions: each slot has a composition role and an aspect.
// The site config supplies the visual style and which scenes to favor.
function buildImagePrompts(siteConfig, globalObj) {
  const { imageStyle } = siteConfig;
  const title = globalObj.title;
  const intro = globalObj.description[0].children[0].text;
  const p1 = globalObj.paragraphs[0].description[0].children[0].text;
  const p2 = globalObj.paragraphs[1].description[0].children[0].text;
  const h1 = globalObj.paragraphs[0].subtitle;
  const h2 = globalObj.paragraphs[1].subtitle;

  const photoRules = `Style: ultra-realistic editorial photograph, shot on a 50mm DSLR, natural soft lighting, shallow depth of field, photojournalism aesthetic.
Forbidden: illustrations, CGI, 3D renders, cartoons, fantasy, surrealism, embedded text, visible logos, watermarks, brand names, distorted hands or faces.
Composition: rule of thirds, eye-level, color-graded warm midtones.`;

  return [
    // ── Slot 0 → paragraphs[0].image (body 1 illustration) ──
    {
      prompt: `${photoRules}
Site context: ${imageStyle.context}
Color and mood palette: ${imageStyle.palette}

Scene brief: a close-up, intimate photograph that illustrates the moment described in section 1 of this article: "${h1}".
Section excerpt for inspiration: "${p1.slice(0, 280)}"

Subject style: ${imageStyle.subjectClose}
Setting: ${imageStyle.settingClose}
Mood: ${imageStyle.moodClose}`,
      aspectRatio: '4:3',
    },

    // ── Slot 1 → paragraphs[1].image (body 2 illustration) ──
    {
      prompt: `${photoRules}
Site context: ${imageStyle.context}
Color and mood palette: ${imageStyle.palette}

Scene brief: a wider, action-oriented photograph that illustrates the practical advice in section 2: "${h2}".
Section excerpt for inspiration: "${p2.slice(0, 280)}"

Subject style: ${imageStyle.subjectAction}
Setting: ${imageStyle.settingAction}
Mood: ${imageStyle.moodAction}`,
      aspectRatio: '4:3',
    },

    // ── Slot 2 → globalObj.image (hero / opening) ──
    {
      prompt: `${photoRules}
Site context: ${imageStyle.context}
Color and mood palette: ${imageStyle.palette}

Scene brief: the HERO image for the article titled "${title}". This must be a magazine-cover-quality lifestyle photograph — visually arresting, telling the article's whole story in one frame.
Intro for inspiration: "${intro.slice(0, 320)}"

Subject style: ${imageStyle.subjectHero}
Setting: ${imageStyle.settingHero}
Mood: ${imageStyle.moodHero}
Crop: cinematic, leaves negative space for headline overlay on the left third.`,
      aspectRatio: '16:9',
    },

    // ── Slot 3 → firstAdBanner.image (ad banner 1) ──
    {
      prompt: `${photoRules}
Site context: ${imageStyle.context}
Color and mood palette: ${imageStyle.palette}

Scene brief: a friendly, slightly more commercial photograph that complements the article "${title}" — could be a product on a counter, ingredients on a board, or a person reaching for a tool, depending on what fits the topic.

Subject style: ${imageStyle.subjectProduct}
Setting: ${imageStyle.settingProduct}
Mood: warm, inviting, suitable for a sidebar advertisement that doesn't break editorial trust.
Crop: leaves room for a small text overlay in the bottom-right corner.`,
      aspectRatio: '16:9',
    },

    // ── Slot 4 → secondAdBanner.image (ad banner 2) ──
    {
      prompt: `${photoRules}
Site context: ${imageStyle.context}
Color and mood palette: ${imageStyle.palette}

Scene brief: a contrasting "lifestyle" photograph that complements the article "${title}" — visually DIFFERENT from the previous banner. If the previous was a product / still life, this should be a candid person shot, and vice versa.

Subject style: ${imageStyle.subjectLifestyle}
Setting: ${imageStyle.settingLifestyle}
Mood: relaxed, aspirational but grounded.
Crop: medium-wide, framed for a footer banner.`,
      aspectRatio: '16:9',
    },
  ];
}

// Rich image prompts: 3 FULL-frame photos (hero + 2 body sections). No empty
// "negative space for overlay", no text/logos — fixes the previous images that
// had awkward blank areas. Used only when siteConfig.richContent === true.
function buildImagePromptsRich(siteConfig, globalObj) {
  const { imageStyle } = siteConfig;
  const title = globalObj.title;
  const flat = blocks => (blocks || []).flatMap(b => (b.children || []).map(c => c.text || '')).join(' ');
  const b1 = globalObj.paragraphs.find(p => p._img === 'b1');
  const b2 = globalObj.paragraphs.find(p => p._img === 'b2');
  // Site-aware; defaults reproduce the original hairstyles image rules verbatim.
  const peopleLine = imageStyle.peopleConstraint || 'Nobody who looks under 50.';
  const anchorLine = imageStyle.anchorLine || 'Hair is the visual anchor.';
  const rules = `Style: ultra-realistic editorial photograph, 50mm DSLR, natural soft lighting, shallow depth of field, photojournalism aesthetic. Composition: rule of thirds, eye-level, warm midtones, a FULL well-composed frame that fills the image edge to edge — NO blank walls, empty dead space, borders, text, captions, logos or watermarks. No distorted hands or faces. ${peopleLine}
Site context: ${imageStyle.context}
Colour and mood palette: ${imageStyle.palette}
${anchorLine}`;
  return [
    { prompt: `${rules}
Scene: a magazine-cover-quality HERO photograph for the article "${title}". Subject: ${imageStyle.subjectHero} Setting: ${imageStyle.settingHero} Mood: ${imageStyle.moodHero}`, aspectRatio: '4:3', role: 'hero' },
    { prompt: `${rules}
Scene: an intimate close-up that illustrates "${b1?.subtitle || title}". Subject: ${imageStyle.subjectClose} Setting: ${imageStyle.settingClose} Mood: ${imageStyle.moodClose}
For inspiration: ${flat(b1?.description).slice(0, 200)}`, aspectRatio: '4:3', role: 'b1' },
    { prompt: `${rules}
Scene: a wider, action-oriented photograph that illustrates "${b2?.subtitle || title}". Subject: ${imageStyle.subjectAction} Setting: ${imageStyle.settingAction} Mood: ${imageStyle.moodAction}
For inspiration: ${flat(b2?.description).slice(0, 200)}`, aspectRatio: '4:3', role: 'b2' },
  ];
}

export async function generateImages(siteConfig, globalObj) {
  const prompts = siteConfig.richContent
    ? buildImagePromptsRich(siteConfig, globalObj)
    : buildImagePrompts(siteConfig, globalObj);
  const ids = [];

  for (let i = 0; i < prompts.length; i += 1) {
    const { prompt, aspectRatio } = prompts[i];
    try {
      const response = await imagen.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt,
        config: {
          numberOfImages: 1,
          aspectRatio,
          outputMimeType: 'image/png',
        },
      });

      const generated = response.generatedImages?.[0];
      if (!generated?.image?.imageBytes) {
        console.warn(`[image ${i + 1}/5] no image data`, response?.error || '');
        continue;
      }

      const buffer = Buffer.from(generated.image.imageBytes, 'base64');
      const formData = new FormData();
      formData.append('files', buffer, {
        filename: `${siteConfig.imagePrefix || 'article'}-${i + 1}.png`,
        contentType: 'image/png',
      });

      const uploadRes = await fetch(`${STRAPI_API_URL}/api/upload`, {
        method: 'POST',
        headers: { Authorization: STRAPI_TOKEN },
        body: formData,
      });

      const result = await uploadRes.json();
      if (Array.isArray(result) && result[0]?.id) {
        ids.push(result[0].id);
        console.log(`[image ${i + 1}/5] uploaded id=${result[0].id} (${aspectRatio})`);
      } else {
        console.warn(`[image ${i + 1}/5] upload returned no id`, result);
      }
    } catch (err) {
      console.error(`[image ${i + 1}/5] error: ${err.message}`);
    }
  }

  return ids;
}

// ──────────────────────────────────────────────────────────────────────
// Attach images to the global object & POST to Strapi
// ──────────────────────────────────────────────────────────────────────

export function prepForPush(globalObj, ids) {
  const out = globalObj;
  out.paragraphs[0].image = ids[0];
  out.paragraphs[1].image = ids[1];
  out.image = ids[2];
  out.firstAdBanner.image = ids[3];
  out.secondAdBanner.image = ids[4];
  return out;
}

// Rich mode: image ids arrive in [hero, body1, body2] order. Assign by the _img
// tag, then strip the markers so Strapi doesn't reject an unknown field.
export function prepForPushRich(globalObj, ids) {
  const out = globalObj;
  if (ids[0]) out.image = ids[0];
  const b1 = out.paragraphs.find(s => s._img === 'b1');
  const b2 = out.paragraphs.find(s => s._img === 'b2');
  if (b1 && ids[1]) b1.image = ids[1];
  if (b2 && ids[2]) b2.image = ids[2];
  out.paragraphs.forEach(s => {
    delete s._img;
  });
  return out;
}

export async function strapiPost(siteConfig, obj) {
  try {
    const res = await fetch(`${STRAPI_API_URL}/api/${siteConfig.collection}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: STRAPI_TOKEN,
      },
      body: JSON.stringify({ data: obj }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Strapi ${siteConfig.collection} ${res.status}: ${errText.slice(0, 500)}`);
    }
    return res.json();
  } catch (err) {
    console.error(`[strapiPost] ${siteConfig.collection} failed:`, err.message);
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────────────────────────────

export async function generateAndPostForSite(siteConfig) {
  const startedAt = Date.now();
  try {
    const { query, categoryId, category } = await pickTopicForSite(siteConfig);
    console.log(`[${siteConfig.brandName}] topic: ${query} → ${category}`);

    const globalObj = await generateGlobalObj(siteConfig, query, categoryId, category);
    if (!globalObj) throw new Error('global object generation failed');
    console.log(`[${siteConfig.brandName}] text generated (${globalObj.title.length} char title)`);

    const imageIds = await generateImages(siteConfig, globalObj);
    if (!imageIds.length) {
      console.warn(`[${siteConfig.brandName}] no images uploaded; posting without imagery`);
    }
    console.log(`[${siteConfig.brandName}] images uploaded: ${imageIds.length}/5`);

    const prepared = siteConfig.richContent
      ? prepForPushRich(globalObj, imageIds)
      : prepForPush(globalObj, imageIds);
    const posted = await strapiPost(siteConfig, prepared);
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[${siteConfig.brandName}] posted in ${seconds}s, documentId=${posted?.data?.documentId}`);
    return posted;
  } catch (err) {
    console.error(`[${siteConfig.brandName}] generateAndPostForSite error:`, err.message);
    throw err;
  }
}

// Exposed for callers that want individual pieces (e.g. tests)
export { CURRENT_YEAR, geminiText };
